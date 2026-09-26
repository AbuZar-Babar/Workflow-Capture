/**
 * Shared Item Filter Evaluator
 *
 * Implements the frozen Shared Filter Contract from docs/MULTI-AGENT-WORK-PLAN.md:
 * - Version 1 supports one condition with `contains` or `equals`.
 * - Comparisons trim whitespace and ignore letter case.
 * - Omitting `itemFilter` means process all discovered items (match all).
 * - Legacy `rowFilter: { column: "Type", value: "Invoice" }` and `filterColumn` / `filterValue`
 *   inputs are accepted and normalized.
 * - A configured field that cannot be read is a validation error. Never fall back to
 *   matching the entire row or accept an item when evaluation fails.
 * - Pure evaluation over a normalized map of field names to values.
 * - Independent of browser, database, dashboard, and API code.
 */

'use strict';

const SUPPORTED_OPERATORS = Object.freeze(['contains', 'equals']);

/**
 * Normalizes any supported filter shape into a standard itemFilter object, or null for match-all.
 *
 * Standard shape:
 * {
 *   field: string,
 *   operator: 'contains' | 'equals',
 *   value: string
 * }
 *
 * @param {any} filterInput - Raw filter input from request body, workflow options, or query.
 * @returns {object|null} - Normalized filter object, null if no filter configured (match all),
 *                          or an object marked with `__invalid: true` if shape is malformed.
 */
function normalizeItemFilter(filterInput) {
  if (filterInput === undefined || filterInput === null) {
    return null;
  }

  // Reject primitive types or arrays
  if (typeof filterInput !== 'object' || Array.isArray(filterInput)) {
    return {
      __invalid: true,
      error: 'Filter must be an object',
      raw: filterInput
    };
  }

  let candidate = filterInput;

  // 1. Unwrap if wrapped in { itemFilter: ... } envelope
  if ('itemFilter' in candidate) {
    if (candidate.itemFilter === undefined || candidate.itemFilter === null) {
      return null;
    }
    candidate = candidate.itemFilter;
    if (typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {
        __invalid: true,
        error: 'Filter must be an object',
        raw: candidate
      };
    }
  }

  // 2. Unwrap if wrapped in legacy { rowFilter: ... } envelope
  if ('rowFilter' in candidate) {
    if (candidate.rowFilter === undefined || candidate.rowFilter === null) {
      return null;
    }
    candidate = candidate.rowFilter;
    if (typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {
        __invalid: true,
        error: 'Filter must be an object',
        raw: candidate
      };
    }
  }

  // 3. Legacy filterColumn / filterValue pair
  if ('filterValue' in candidate) {
    const rawVal = candidate.filterValue;
    if (rawVal === undefined || rawVal === null) return null;
    const strVal = String(rawVal).trim();
    if (!strVal || strVal === '__any__' || strVal === 'all') {
      return null;
    }
    const rawCol = candidate.filterColumn !== undefined && candidate.filterColumn !== null
      ? candidate.filterColumn
      : 'Type';
    const fieldStr = String(rawCol).trim();
    return {
      field: fieldStr || 'Type',
      operator: 'contains',
      value: strVal
    };
  }

  // 4. Legacy rowFilter shape: { column: "...", value: "..." }
  if ('column' in candidate) {
    const rawVal = candidate.value !== undefined ? candidate.value : candidate.text;
    if (rawVal === undefined || rawVal === null) return null;
    const strVal = String(rawVal).trim();
    if (!strVal || strVal === '__any__' || strVal === 'all') {
      return null;
    }
    const rawCol = candidate.column;
    const fieldStr = String(rawCol !== undefined && rawCol !== null ? rawCol : 'Type').trim();
    const rawOp = candidate.operator !== undefined && candidate.operator !== null
      ? String(candidate.operator).trim().toLowerCase()
      : 'contains';
    return {
      field: fieldStr,
      operator: rawOp,
      value: strVal
    };
  }

  // 5. Modern itemFilter shape: { field: "...", operator: "...", value: "..." }
  const keys = Object.keys(candidate);
  if (keys.length === 0) {
    return null;
  }

  // Check if candidate has field, operator, and value properties
  const hasField = 'field' in candidate && candidate.field !== null && candidate.field !== undefined;
  const hasOperator = 'operator' in candidate && candidate.operator !== null && candidate.operator !== undefined;
  const hasValue = 'value' in candidate && candidate.value !== null && candidate.value !== undefined;

  const rawField = hasField ? String(candidate.field).trim() : '';
  const rawOp = hasOperator ? String(candidate.operator).trim().toLowerCase() : '';
  const rawVal = hasValue ? String(candidate.value).trim() : '';

  return {
    field: rawField,
    operator: rawOp,
    value: rawVal,
    _hasField: hasField,
    _hasOperator: hasOperator,
    _hasValue: hasValue
  };
}

/**
 * Validates a normalized or raw filter object.
 *
 * @param {any} filterInput - Raw or normalized filter.
 * @returns {{ valid: boolean, error: string|null, filter: object|null }}
 */
function validateItemFilter(filterInput) {
  const normalized = normalizeItemFilter(filterInput);

  // Omitted or match-all filter is valid
  if (normalized === null) {
    return { valid: true, error: null, filter: null };
  }

  // Structural invalidity
  if (normalized.__invalid) {
    return {
      valid: false,
      error: normalized.error || 'Filter must be an object',
      filter: null
    };
  }

  // Empty field name
  if (!normalized._hasField && !normalized.field) {
    return {
      valid: false,
      error: 'Filter field cannot be empty',
      filter: normalized
    };
  }

  if (!normalized.field || normalized.field.trim() === '') {
    return {
      valid: false,
      error: 'Filter field cannot be empty',
      filter: normalized
    };
  }

  // Missing or blank operator
  if (!normalized.operator || normalized.operator.trim() === '') {
    return {
      valid: false,
      error: 'Filter operator cannot be empty',
      filter: normalized
    };
  }

  // Unsupported operator
  if (!SUPPORTED_OPERATORS.includes(normalized.operator)) {
    return {
      valid: false,
      error: `Unsupported filter operator "${normalized.operator}". Supported operators: ${SUPPORTED_OPERATORS.join(', ')}`,
      filter: normalized
    };
  }

  // Missing or empty value
  if (!normalized.value || normalized.value.trim() === '') {
    return {
      valid: false,
      error: 'Filter value cannot be empty',
      filter: normalized
    };
  }

  return {
    valid: true,
    error: null,
    filter: {
      field: normalized.field,
      operator: normalized.operator,
      value: normalized.value
    }
  };
}

/**
 * Extracts available fields from a map or list of items.
 *
 * @param {object|Map|Array} source - An item fields map or list of item objects.
 * @returns {string[]} - Array of unique field names.
 */
function extractAvailableFields(source) {
  if (!source) return [];

  const fieldSet = new Set();

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item) continue;
      const fields = item.fields || item;
      if (fields instanceof Map) {
        for (const k of fields.keys()) {
          const trimmed = String(k).trim();
          if (trimmed) fieldSet.add(trimmed);
        }
      } else if (typeof fields === 'object') {
        for (const k of Object.keys(fields)) {
          const trimmed = String(k).trim();
          if (trimmed) fieldSet.add(trimmed);
        }
      }
    }
  } else if (source instanceof Map) {
    for (const k of source.keys()) {
      const trimmed = String(k).trim();
      if (trimmed) fieldSet.add(trimmed);
    }
  } else if (typeof source === 'object') {
    for (const k of Object.keys(source)) {
      const trimmed = String(k).trim();
      if (trimmed) fieldSet.add(trimmed);
    }
  }

  return Array.from(fieldSet);
}

/**
 * Looks up a field in a fields map with whitespace-trimmed, case-insensitive comparison.
 *
 * @param {object|Map} fieldsMap - Field names to values.
 * @param {string} targetField - Target field name to resolve.
 * @returns {{ found: boolean, matchedField: string|null, value: any, availableFields: string[] }}
 */
function resolveFieldValue(fieldsMap, targetField) {
  const availableFields = [];
  if (!fieldsMap || typeof fieldsMap !== 'object') {
    return { found: false, matchedField: null, value: undefined, availableFields };
  }

  const normalizedTarget = String(targetField).trim().toLowerCase();
  let exactMatch = null;
  let caseInsensitiveMatch = null;

  if (fieldsMap instanceof Map) {
    for (const [key, val] of fieldsMap.entries()) {
      const strKey = String(key).trim();
      if (strKey) availableFields.push(strKey);
      if (strKey === String(targetField).trim() && exactMatch === null) {
        exactMatch = { matchedField: strKey, value: val };
      } else if (strKey.toLowerCase() === normalizedTarget && caseInsensitiveMatch === null) {
        caseInsensitiveMatch = { matchedField: strKey, value: val };
      }
    }
  } else {
    for (const key of Object.keys(fieldsMap)) {
      const strKey = String(key).trim();
      if (strKey) availableFields.push(strKey);
      if (strKey === String(targetField).trim() && exactMatch === null) {
        exactMatch = { matchedField: strKey, value: fieldsMap[key] };
      } else if (strKey.toLowerCase() === normalizedTarget && caseInsensitiveMatch === null) {
        caseInsensitiveMatch = { matchedField: strKey, value: fieldsMap[key] };
      }
    }
  }

  const matched = exactMatch || caseInsensitiveMatch;
  if (matched) {
    return {
      found: true,
      matchedField: matched.matchedField,
      value: matched.value,
      availableFields
    };
  }

  return {
    found: false,
    matchedField: null,
    value: undefined,
    availableFields
  };
}

/**
 * Pure evaluator for itemFilter against an item's fields map.
 *
 * @param {any} filterInput - Raw or normalized filter input.
 * @param {object|Map} fieldsMap - Map of field names to values for a discovered item.
 * @returns {{
 *   matches: boolean,
 *   field: string|null,
 *   expectedValue: string|null,
 *   actualValue: string|null,
 *   operator: string|null,
 *   reason: string,
 *   error: string|null
 * }}
 */
function evaluateItemFilter(filterInput, fieldsMap) {
  // 1. Validate filter shape and parameters
  const validation = validateItemFilter(filterInput);

  if (!validation.valid) {
    return {
      matches: false,
      field: validation.filter ? validation.filter.field : null,
      expectedValue: validation.filter ? validation.filter.value : null,
      actualValue: null,
      operator: validation.filter ? validation.filter.operator : null,
      reason: `Filter validation error: ${validation.error}`,
      error: validation.error
    };
  }

  const filter = validation.filter;

  // 2. Omitting itemFilter means match all
  if (filter === null) {
    return {
      matches: true,
      field: null,
      expectedValue: null,
      actualValue: null,
      operator: null,
      reason: 'All items accepted (no filter configured)',
      error: null
    };
  }

  // 3. Resolve target field from item fieldsMap
  const resolved = resolveFieldValue(fieldsMap, filter.field);

  // If configured field cannot be read, it is a validation error. Never match.
  if (!resolved.found) {
    const availStr = resolved.availableFields.length > 0
      ? ` (available fields: ${resolved.availableFields.map(f => `"${f}"`).join(', ')})`
      : ' (no fields available on item)';
    return {
      matches: false,
      field: filter.field,
      expectedValue: filter.value,
      actualValue: null,
      operator: filter.operator,
      reason: `Configured field "${filter.field}" was not found in available item fields${availStr}`,
      error: `Configured field "${filter.field}" is not available on item`
    };
  }

  const actualRaw = resolved.value;
  const actualStr = actualRaw !== undefined && actualRaw !== null ? String(actualRaw).trim() : '';
  const expectedStr = String(filter.value).trim();

  const actualLower = actualStr.toLowerCase();
  const expectedLower = expectedStr.toLowerCase();

  let matches = false;
  let reason = '';

  if (filter.operator === 'equals') {
    matches = actualLower === expectedLower;
    reason = matches
      ? `Field "${resolved.matchedField}" ("${actualStr}") equals "${expectedStr}"`
      : `Field "${resolved.matchedField}" is "${actualStr}" (does not equal "${expectedStr}")`;
  } else if (filter.operator === 'contains') {
    matches = actualLower.includes(expectedLower);
    reason = matches
      ? `Field "${resolved.matchedField}" ("${actualStr}") contains "${expectedStr}"`
      : `Field "${resolved.matchedField}" is "${actualStr}" (does not contain "${expectedStr}")`;
  } else {
    // Should have been caught by validation, but guard against any edge case
    return {
      matches: false,
      field: resolved.matchedField,
      expectedValue: expectedStr,
      actualValue: actualStr,
      operator: filter.operator,
      reason: `Filter validation error: Unsupported operator "${filter.operator}"`,
      error: `Unsupported filter operator "${filter.operator}"`
    };
  }

  return {
    matches,
    field: resolved.matchedField,
    expectedValue: expectedStr,
    actualValue: actualRaw !== undefined && actualRaw !== null ? String(actualRaw) : '',
    operator: filter.operator,
    reason,
    error: null
  };
}

/**
 * Computes preview evaluation for a collection of discovered items.
 *
 * @param {any} filterInput - Raw or normalized filter input.
 * @param {Array<object>} items - List of items with fields: `{ index, fields, ... }` or array of fields maps.
 * @param {object} [options] - Options (e.g. previewLimit).
 * @returns {{
 *   totalCount: number,
 *   selectedCount: number,
 *   skippedCount: number,
 *   selectedPreview: Array<object>,
 *   skippedPreview: Array<object>,
 *   availableFields: string[],
 *   errors: string[]
 * }}
 */
function evaluateFilterPreview(filterInput, items = [], options = {}) {
  const previewLimit = Number.isInteger(options.previewLimit) ? Math.max(1, options.previewLimit) : 5;
  const availableFields = extractAvailableFields(items);
  const errorsSet = new Set();

  let selectedCount = 0;
  let skippedCount = 0;
  const selectedPreview = [];
  const skippedPreview = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fieldsMap = item && typeof item === 'object' && ('fields' in item) ? item.fields : item;
    const result = evaluateItemFilter(filterInput, fieldsMap);

    if (result.error) {
      errorsSet.add(result.error);
    }

    const previewEntry = {
      index: Number.isInteger(item?.index) ? item.index : i,
      label: item?.label || item?.itemLabel || `Item #${i + 1}`,
      field: result.field,
      actualValue: result.actualValue,
      reason: result.reason,
      status: result.matches ? 'SELECTED' : 'SKIPPED_FILTER'
    };

    if (result.matches) {
      selectedCount++;
      if (selectedPreview.length < previewLimit) {
        selectedPreview.push(previewEntry);
      }
    } else {
      skippedCount++;
      if (skippedPreview.length < previewLimit) {
        skippedPreview.push(previewEntry);
      }
    }
  }

  return {
    totalCount: items.length,
    selectedCount,
    skippedCount,
    selectedPreview,
    skippedPreview,
    availableFields,
    errors: Array.from(errorsSet)
  };
}

module.exports = {
  SUPPORTED_OPERATORS,
  normalizeItemFilter,
  normalizeFilter: normalizeItemFilter,
  validateItemFilter,
  validateFilter: validateItemFilter,
  evaluateItemFilter,
  evaluateFilter: evaluateItemFilter,
  evaluateFilterPreview,
  extractAvailableFields,
  resolveFieldValue,
  ItemFilter: {
    SUPPORTED_OPERATORS,
    normalize: normalizeItemFilter,
    validate: validateItemFilter,
    evaluate: evaluateItemFilter,
    evaluatePreview: evaluateFilterPreview,
    extractFields: extractAvailableFields
  }
};
