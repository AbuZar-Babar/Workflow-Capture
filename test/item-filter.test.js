/**
 * Test Suite: Reusable Item Filter Evaluator (v1 + v2 Compound/Date/Limit)
 *
 * Verifies:
 * 1. Shared filter contract normalization: compound conditions, modern itemFilter,
 *    legacy rowFilter, filterColumn/filterValue, and match-all omission.
 * 2. Strict validation: empty fields, invalid shapes, unsupported operators,
 *    empty values, matchMode ('all'/'any'), empty/malformed conditions, and dateBetween ranges.
 * 3. Pure evaluation for `contains` and `equals` with case-insensitivity and whitespace trimming.
 * 4. Deterministic `dateBetween` evaluation with strict YYYY-MM-DD format, inclusive boundaries,
 *    and clear failure reasons for missing or unparseable source dates (Case B).
 * 5. Missing/unavailable configured fields return validation errors and never match (Case A).
 * 6. Compound evaluation: all (AND) vs any (OR) logic with structured reasons.
 * 7. loopLimit semantics: filter first, then select first N matching items in discovery order;
 *    unlimited when omitted/null; rejection of non-positive / non-integer limits.
 * 8. Batch preview evaluation with totalCount, matchingCount, selectedCount,
 *    skippedFilterCount, skippedLimitCount, representative previews, and error reporting.
 * 9. Independence: zero external dependencies on browser, DB, dashboard, or express.
 */

'use strict';

const assert = require('assert');
const {
  SUPPORTED_OPERATORS,
  SUPPORTED_MATCH_MODES,
  normalizeItemFilter,
  validateItemFilter,
  evaluateItemFilter,
  evaluateFilterPreview,
  extractAvailableFields,
  resolveFieldValue,
  validateStrictIsoDate,
  parseSourceDate,
  ItemFilter
} = require('../src/shared/item-filter');

function runItemFilterTests() {
  console.log('🧪 Starting Reusable Item Filter Evaluator Unit Tests (v1 + v2)...\n');

  // --------------------------------------------------------------------------
  // Group 1: Normalization & Legacy Compatibility
  // --------------------------------------------------------------------------
  console.log('🔹 Group 1: Normalization & Legacy Filter Compatibility');
  {
    // 1.1 Omission / match-all
    assert.strictEqual(normalizeItemFilter(undefined), null);
    assert.strictEqual(normalizeItemFilter(null), null);
    assert.strictEqual(normalizeItemFilter({}), null);
    assert.strictEqual(normalizeItemFilter({ itemFilter: null }), null);
    assert.strictEqual(normalizeItemFilter({ rowFilter: null }), null);

    // 1.2 Modern single condition shape
    const standardFilter = { field: 'Type', operator: 'contains', value: 'Invoice' };
    const normStandard = normalizeItemFilter(standardFilter);
    assert.strictEqual(normStandard.field, 'Type');
    assert.strictEqual(normStandard.operator, 'contains');
    assert.strictEqual(normStandard.value, 'Invoice');
    assert.strictEqual(normStandard.matchMode, 'all');
    assert.strictEqual(normStandard.conditions.length, 1);

    // 1.3 Envelope unwrapping { itemFilter: { ... } }
    const wrappedFilter = { itemFilter: { field: 'Status', operator: 'equals', value: 'Paid' } };
    const normWrapped = normalizeItemFilter(wrappedFilter);
    assert.strictEqual(normWrapped.field, 'Status');
    assert.strictEqual(normWrapped.operator, 'equals');
    assert.strictEqual(normWrapped.value, 'Paid');

    // 1.4 Whitespace and case normalization on filter definitions
    const messyFilter = { field: '  Type  ', operator: '  CONTAINS  ', value: '  Invoice  ' };
    const normMessy = normalizeItemFilter(messyFilter);
    assert.strictEqual(normMessy.field, 'Type');
    assert.strictEqual(normMessy.operator, 'contains');
    assert.strictEqual(normMessy.value, 'Invoice');

    // 1.5 Legacy rowFilter: { column: "Type", value: "Invoice" }
    const legacyRowFilter = { column: 'Type', value: 'Invoice' };
    const normLegacy1 = normalizeItemFilter(legacyRowFilter);
    assert.strictEqual(normLegacy1.field, 'Type');
    assert.strictEqual(normLegacy1.operator, 'contains');
    assert.strictEqual(normLegacy1.value, 'Invoice');

    // 1.6 Wrapped legacy rowFilter: { rowFilter: { column: "Category", value: "Electronics" } }
    const wrappedLegacy = { rowFilter: { column: 'Category', value: 'Electronics' } };
    const normLegacy2 = normalizeItemFilter(wrappedLegacy);
    assert.strictEqual(normLegacy2.field, 'Category');
    assert.strictEqual(normLegacy2.operator, 'contains');
    assert.strictEqual(normLegacy2.value, 'Electronics');

    // 1.7 Legacy rowFilter with text instead of value
    const legacyTextFilter = { column: 'Type', text: 'Credit Memo' };
    const normLegacyText = normalizeItemFilter(legacyTextFilter);
    assert.strictEqual(normLegacyText.field, 'Type');
    assert.strictEqual(normLegacyText.value, 'Credit Memo');

    // 1.8 Legacy filterColumn / filterValue pair
    const legacyPair = { filterColumn: 'Type', filterValue: 'Invoice' };
    const normPair = normalizeItemFilter(legacyPair);
    assert.strictEqual(normPair.field, 'Type');
    assert.strictEqual(normPair.operator, 'contains');
    assert.strictEqual(normPair.value, 'Invoice');

    // 1.9 Legacy filterValue without filterColumn defaults to 'Type'
    const legacyValOnly = { filterValue: 'Invoice' };
    const normValOnly = normalizeItemFilter(legacyValOnly);
    assert.strictEqual(normValOnly.field, 'Type');
    assert.strictEqual(normValOnly.value, 'Invoice');

    // 1.10 Legacy special wildcards '__any__' and 'all' normalize to null (match-all)
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: '__any__' }), null);
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: 'all' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: '__any__' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: 'all' }), null);
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: '' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: '' }), null);

    // 1.11 Malformed inputs marked as invalid
    assert.strictEqual(normalizeItemFilter('invalid').__invalid, true);
    assert.strictEqual(normalizeItemFilter(123).__invalid, true);
    assert.strictEqual(normalizeItemFilter([]).__invalid, true);
    assert.strictEqual(normalizeItemFilter({ itemFilter: 'not an object' }).__invalid, true);

    // 1.12 Compound conditions with matchMode: 'all'
    const compoundAll = {
      matchMode: 'all',
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' },
        { field: 'Type', operator: 'contains', value: 'Invoice' }
      ]
    };
    const normCompAll = normalizeItemFilter(compoundAll);
    assert.strictEqual(normCompAll.matchMode, 'all');
    assert.strictEqual(normCompAll.conditions.length, 2);
    assert.strictEqual(normCompAll.conditions[0].field, 'Status');
    assert.strictEqual(normCompAll.conditions[0].operator, 'equals');
    assert.strictEqual(normCompAll.conditions[0].value, 'Open');
    assert.strictEqual(normCompAll.conditions[1].field, 'Type');
    assert.strictEqual(normCompAll.conditions[1].operator, 'contains');
    assert.strictEqual(normCompAll.conditions[1].value, 'Invoice');

    // 1.13 Compound conditions with matchMode: 'any'
    const compoundAny = {
      matchMode: 'any',
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' },
        { field: 'Status', operator: 'equals', value: 'Pending' }
      ]
    };
    const normCompAny = normalizeItemFilter(compoundAny);
    assert.strictEqual(normCompAny.matchMode, 'any');
    assert.strictEqual(normCompAny.conditions.length, 2);

    // 1.14 Default matchMode (omitted => all)
    const omittedMode = {
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' }
      ]
    };
    const normOmitted = normalizeItemFilter(omittedMode);
    assert.strictEqual(normOmitted.matchMode, 'all');

    // 1.15 Envelope unwrapping with compound conditions
    const wrappedCompound = {
      itemFilter: {
        matchMode: 'any',
        conditions: [{ field: 'A', operator: 'equals', value: '1' }]
      }
    };
    const normWrappedComp = normalizeItemFilter(wrappedCompound);
    assert.strictEqual(normWrappedComp.matchMode, 'any');
    assert.strictEqual(normWrappedComp.conditions.length, 1);

    // 1.16 Case-insensitivity and trimming on matchMode
    const messyMode = {
      matchMode: '  ANY  ',
      conditions: [{ field: 'A', operator: 'equals', value: '1' }]
    };
    assert.strictEqual(normalizeItemFilter(messyMode).matchMode, 'any');

    // 1.17 dateBetween operator canonicalization and value normalization
    const dateFilter = {
      field: 'Due Date',
      operator: '  DATEBETWEEN  ',
      value: { from: ' 2026-01-01 ', to: ' 2026-01-31 ' }
    };
    const normDate = normalizeItemFilter(dateFilter);
    assert.strictEqual(normDate.conditions[0].operator, 'dateBetween');
    assert.strictEqual(normDate.conditions[0].value.from, '2026-01-01');
    assert.strictEqual(normDate.conditions[0].value.to, '2026-01-31');

    console.log('  ✅ Normalization and legacy compatibility passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 2: Filter Validation Rules
  // --------------------------------------------------------------------------
  console.log('🔹 Group 2: Filter Validation Rules');
  {
    // 2.1 Valid filters
    assert.strictEqual(validateItemFilter(null).valid, true);
    assert.strictEqual(validateItemFilter(undefined).valid, true);
    assert.strictEqual(validateItemFilter({ field: 'Type', operator: 'contains', value: 'Invoice' }).valid, true);
    assert.strictEqual(validateItemFilter({ field: 'Status', operator: 'equals', value: 'Paid' }).valid, true);

    // 2.2 Rejection of non-object filters
    const valString = validateItemFilter('not a filter');
    assert.strictEqual(valString.valid, false);
    assert(valString.error.includes('must be an object'));

    const valArray = validateItemFilter([{ field: 'Type', value: 'Inv' }]);
    assert.strictEqual(valArray.valid, false);
    assert(valArray.error.includes('must be an object'));

    // 2.3 Rejection of empty or missing field
    const emptyField1 = validateItemFilter({ field: '', operator: 'contains', value: 'Invoice' });
    assert.strictEqual(emptyField1.valid, false);
    assert(emptyField1.error.includes('field cannot be empty'));

    const emptyField2 = validateItemFilter({ field: '   ', operator: 'contains', value: 'Invoice' });
    assert.strictEqual(emptyField2.valid, false);
    assert(emptyField2.error.includes('field cannot be empty'));

    const missingField = validateItemFilter({ operator: 'contains', value: 'Invoice' });
    assert.strictEqual(missingField.valid, false);
    assert(missingField.error.includes('field cannot be empty'));

    // 2.4 Rejection of missing or blank operator on modern itemFilter
    const missingOp = validateItemFilter({ field: 'Type', value: 'Invoice' });
    assert.strictEqual(missingOp.valid, false);
    assert(missingOp.error.includes('operator cannot be empty'));

    const emptyOp = validateItemFilter({ field: 'Type', operator: '', value: 'Invoice' });
    assert.strictEqual(emptyOp.valid, false);
    assert(emptyOp.error.includes('operator cannot be empty'));

    const blankOp = validateItemFilter({ field: 'Type', operator: '   ', value: 'Invoice' });
    assert.strictEqual(blankOp.valid, false);
    assert(blankOp.error.includes('operator cannot be empty'));

    const nullOp = validateItemFilter({ field: 'Type', operator: null, value: 'Invoice' });
    assert.strictEqual(nullOp.valid, false);
    assert(nullOp.error.includes('operator cannot be empty'));

    const wrappedMissingOp = validateItemFilter({ itemFilter: { field: 'Type', value: 'Invoice' } });
    assert.strictEqual(wrappedMissingOp.valid, false);
    assert(wrappedMissingOp.error.includes('operator cannot be empty'));

    // 2.5 Legacy filter formats preserve contains default when operator is omitted
    const legacyValid1 = validateItemFilter({ column: 'Type', value: 'Invoice' });
    assert.strictEqual(legacyValid1.valid, true);
    assert.strictEqual(legacyValid1.filter.operator, 'contains');

    const legacyValid2 = validateItemFilter({ filterValue: 'Invoice' });
    assert.strictEqual(legacyValid2.valid, true);
    assert.strictEqual(legacyValid2.filter.operator, 'contains');

    const legacyValid3 = validateItemFilter({ filterColumn: 'Category', filterValue: 'Electronics' });
    assert.strictEqual(legacyValid3.valid, true);
    assert.strictEqual(legacyValid3.filter.operator, 'contains');

    const legacyValid4 = validateItemFilter({ rowFilter: { column: 'Type', value: 'Invoice' } });
    assert.strictEqual(legacyValid4.valid, true);
    assert.strictEqual(legacyValid4.filter.operator, 'contains');

    // 2.6 Rejection of unsupported operators
    const invalidOp1 = validateItemFilter({ field: 'Type', operator: 'regex', value: 'Invoice' });
    assert.strictEqual(invalidOp1.valid, false);
    assert(invalidOp1.error.includes('Unsupported filter operator "regex"'));

    const invalidOp2 = validateItemFilter({ field: 'Type', operator: 'startsWith', value: 'Inv' });
    assert.strictEqual(invalidOp2.valid, false);
    assert(invalidOp2.error.includes('Unsupported filter operator "startswith"'));

    const invalidOp3 = validateItemFilter({ field: 'Amount', operator: '>', value: '100' });
    assert.strictEqual(invalidOp3.valid, false);
    assert(invalidOp3.error.includes('Unsupported filter operator ">"'));

    // 2.7 Rejection of missing or empty value for text operators
    const emptyVal1 = validateItemFilter({ field: 'Type', operator: 'contains', value: '' });
    assert.strictEqual(emptyVal1.valid, false);
    assert(emptyVal1.error.includes('value cannot be empty'));

    const emptyVal2 = validateItemFilter({ field: 'Type', operator: 'contains', value: '   ' });
    assert.strictEqual(emptyVal2.valid, false);
    assert(emptyVal2.error.includes('value cannot be empty'));

    const missingVal = validateItemFilter({ field: 'Type', operator: 'contains' });
    assert.strictEqual(missingVal.valid, false);
    assert(missingVal.error.includes('value cannot be empty'));

    // 2.8 Rejection of empty conditions array
    const emptyCond = validateItemFilter({ conditions: [] });
    assert.strictEqual(emptyCond.valid, false);
    assert(emptyCond.error.includes('conditions cannot be empty'));

    // 2.9 Rejection of non-array conditions
    const nonArrayCond = validateItemFilter({ conditions: 'not an array' });
    assert.strictEqual(nonArrayCond.valid, false);
    assert(nonArrayCond.error.includes('conditions must be an array'));

    // 2.10 Rejection of unsupported matchMode
    const invalidMode1 = validateItemFilter({ matchMode: 'xor', conditions: [{ field: 'A', operator: 'equals', value: '1' }] });
    assert.strictEqual(invalidMode1.valid, false);
    assert(invalidMode1.error.includes('Unsupported matchMode "xor"'));

    const invalidMode2 = validateItemFilter({ matchMode: 'none', conditions: [{ field: 'A', operator: 'equals', value: '1' }] });
    assert.strictEqual(invalidMode2.valid, false);
    assert(invalidMode2.error.includes('Unsupported matchMode "none"'));

    // 2.11 Rejection of non-string matchMode
    const nonStrMode = validateItemFilter({ matchMode: 123, conditions: [{ field: 'A', operator: 'equals', value: '1' }] });
    assert.strictEqual(nonStrMode.valid, false);
    assert(nonStrMode.error.includes('matchMode must be a string'));

    // 2.12 Rejection of malformed condition entries inside conditions array
    const malformedEntry1 = validateItemFilter({ conditions: ['not an object'] });
    assert.strictEqual(malformedEntry1.valid, false);
    assert(malformedEntry1.error.includes('must be an object'));

    const malformedEntry2 = validateItemFilter({
      conditions: [
        { field: 'A', operator: 'equals', value: '1' },
        { field: '', operator: 'equals', value: '2' }
      ]
    });
    assert.strictEqual(malformedEntry2.valid, false);
    assert(malformedEntry2.error.includes('field cannot be empty'));

    const malformedEntry3 = validateItemFilter({
      conditions: [
        { field: 'A', operator: 'equals', value: '1' },
        { field: 'B', operator: 'unsupportedOp', value: '2' }
      ]
    });
    assert.strictEqual(malformedEntry3.valid, false);
    assert(malformedEntry3.error.includes('Unsupported filter operator "unsupportedop"'));

    // 2.13 dateBetween validation rules
    const validDateFilter = validateItemFilter({
      field: 'Due Date',
      operator: 'dateBetween',
      value: { from: '2026-01-01', to: '2026-01-31' }
    });
    assert.strictEqual(validDateFilter.valid, true);

    // Missing value object
    const dateNoVal = validateItemFilter({ field: 'Due Date', operator: 'dateBetween' });
    assert.strictEqual(dateNoVal.valid, false);
    assert(dateNoVal.error.includes('value object'));

    const dateStrVal = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: '2026-01-01' });
    assert.strictEqual(dateStrVal.valid, false);
    assert(dateStrVal.error.includes('value object'));

    // Missing from or to
    const dateNoFrom = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { to: '2026-01-31' } });
    assert.strictEqual(dateNoFrom.valid, false);
    assert(dateNoFrom.error.includes("'from' date"));

    const dateNoTo = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-01' } });
    assert.strictEqual(dateNoTo.valid, false);
    assert(dateNoTo.error.includes("'to' date"));

    // Malformed date strings (not strict YYYY-MM-DD)
    const dateSlash = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026/01/01', to: '2026-01-31' } });
    assert.strictEqual(dateSlash.valid, false);
    assert(dateSlash.error.includes('strict YYYY-MM-DD'));

    const dateNotDate = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: 'not-a-date', to: '2026-01-31' } });
    assert.strictEqual(dateNotDate.valid, false);
    assert(dateNotDate.error.includes('strict YYYY-MM-DD'));

    // Invalid calendar month or day
    const dateBadMonth = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-13-01', to: '2026-12-31' } });
    assert.strictEqual(dateBadMonth.valid, false);
    assert(dateBadMonth.error.includes('Invalid month'));

    const dateBadDay = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-02-30', to: '2026-03-31' } });
    assert.strictEqual(dateBadDay.valid, false);
    assert(dateBadDay.error.includes('Invalid day'));

    const dateNonLeap = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-02-29', to: '2026-03-31' } });
    assert.strictEqual(dateNonLeap.valid, false);
    assert(dateNonLeap.error.includes('Invalid day "29" for month "02"'));

    const dateLeapValid = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2024-02-29', to: '2024-03-31' } });
    assert.strictEqual(dateLeapValid.valid, true);

    // Reversed date range (from > to)
    const dateReversed = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-02-01', to: '2026-01-01' } });
    assert.strictEqual(dateReversed.valid, false);
    assert(dateReversed.error.includes('cannot be after'));

    // Same day range (from === to) is valid
    const dateSameDay = validateItemFilter({ field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-15', to: '2026-01-15' } });
    assert.strictEqual(dateSameDay.valid, true);

    console.log('  ✅ Validation rules passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 3: Positive & Negative Evaluation ('contains')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 3: Evaluation with "contains" Operator');
  {
    const filter = { field: 'Type', operator: 'contains', value: 'Invoice' };

    // 3.1 Exact match
    const res1 = evaluateItemFilter(filter, { Type: 'Invoice' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.field, 'Type');
    assert.strictEqual(res1.expectedValue, 'Invoice');
    assert.strictEqual(res1.actualValue, 'Invoice');
    assert.strictEqual(res1.operator, 'contains');
    assert.strictEqual(res1.error, null);
    assert(res1.reason.includes('contains "Invoice"'));

    // 3.2 Case-insensitivity (lowercase value against uppercase actual)
    const res2 = evaluateItemFilter(filter, { Type: 'TAX INVOICE' });
    assert.strictEqual(res2.matches, true);
    assert.strictEqual(res2.actualValue, 'TAX INVOICE');

    // 3.3 Substring match
    const res3 = evaluateItemFilter(filter, { Type: 'Standard Invoice #1029' });
    assert.strictEqual(res3.matches, true);

    // 3.4 Whitespace trimming
    const res4 = evaluateItemFilter(
      { field: 'Type', operator: 'contains', value: '  Invoice  ' },
      { Type: '  Invoice INV-001  ' }
    );
    assert.strictEqual(res4.matches, true);

    // 3.5 Negative match
    const res5 = evaluateItemFilter(filter, { Type: 'Credit Memo' });
    assert.strictEqual(res5.matches, false);
    assert.strictEqual(res5.actualValue, 'Credit Memo');
    assert.strictEqual(res5.error, null);
    assert(res5.reason.includes('does not contain "Invoice"'));

    console.log('  ✅ "contains" operator evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 4: Positive & Negative Evaluation ('equals')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 4: Evaluation with "equals" Operator');
  {
    const filter = { field: 'Status', operator: 'equals', value: 'Paid' };

    // 4.1 Exact match
    const res1 = evaluateItemFilter(filter, { Status: 'Paid' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.error, null);
    assert(res1.reason.includes('equals "Paid"'));

    // 4.2 Case-insensitivity
    const res2 = evaluateItemFilter(filter, { Status: 'PAID' });
    assert.strictEqual(res2.matches, true);

    // 4.3 Whitespace trimming
    const res3 = evaluateItemFilter(filter, { Status: '  Paid  ' });
    assert.strictEqual(res3.matches, true);

    // 4.4 Negative match on substring (contains is true, but equals is false)
    const res4 = evaluateItemFilter(filter, { Status: 'Partially Paid' });
    assert.strictEqual(res4.matches, false);
    assert(res4.reason.includes('does not equal "Paid"'));

    // 4.5 Negative match on completely different value
    const res5 = evaluateItemFilter(filter, { Status: 'Pending' });
    assert.strictEqual(res5.matches, false);

    console.log('  ✅ "equals" operator evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 5: Field Resolution, Casing, and Map Types
  // --------------------------------------------------------------------------
  console.log('🔹 Group 5: Field Resolution & Casing Flexibility');
  {
    // 5.1 Case-insensitive field name lookup
    const filterLower = { field: 'type', operator: 'equals', value: 'Invoice' };
    const res1 = evaluateItemFilter(filterLower, { Type: 'Invoice' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.field, 'Type');

    // 5.2 Whitespace trimmed field name lookup
    const filterSpaced = { field: '  Invoice Number  ', operator: 'contains', value: '001' };
    const res2 = evaluateItemFilter(filterSpaced, { 'Invoice Number': 'INV-2026-001' });
    assert.strictEqual(res2.matches, true);

    // 5.3 Actual field name has whitespace in fieldsMap
    const res3 = evaluateItemFilter(
      { field: 'Account', operator: 'equals', value: 'Acme' },
      { '  Account  ': 'Acme' }
    );
    assert.strictEqual(res3.matches, true);

    // 5.4 Support for ES6 Map instances as fieldsMap
    const fieldsMap = new Map([
      ['Item #', '1'],
      ['Type', 'Invoice'],
      ['Amount', '$1,250.00']
    ]);
    const resMap = evaluateItemFilter({ field: 'Type', operator: 'equals', value: 'Invoice' }, fieldsMap);
    assert.strictEqual(resMap.matches, true);
    assert.strictEqual(resMap.field, 'Type');

    // 5.5 Numeric values in fieldsMap
    const resNum = evaluateItemFilter(
      { field: 'Amount', operator: 'equals', value: '1250' },
      { Amount: 1250 }
    );
    assert.strictEqual(resNum.matches, true);
    assert.strictEqual(resNum.actualValue, '1250');

    console.log('  ✅ Field resolution and casing flexibility passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 6: Missing & Unavailable Configured Fields (Case A vs Case B)
  // --------------------------------------------------------------------------
  console.log('🔹 Group 6: Missing & Unavailable Fields (Never Match)');
  {
    const filter = { field: 'Type', operator: 'contains', value: 'Invoice' };

    // 6.1 Field not in available fields map (Case A: configuration error)
    const res1 = evaluateItemFilter(filter, {
      'Invoice #': 'INV-001',
      Customer: 'Acme Corp',
      Amount: '$500'
    });
    assert.strictEqual(res1.matches, false, 'Missing configured field must NEVER match');
    assert(res1.error !== null, 'Must return a validation error for missing field');
    assert(res1.error.includes('Configured field "Type" is not available on item'));
    assert(res1.reason.includes('Invoice #'), 'Reason must list available fields');
    assert(res1.reason.includes('Customer'));

    // 6.2 Fields map is empty
    const resEmpty = evaluateItemFilter(filter, {});
    assert.strictEqual(resEmpty.matches, false);
    assert(resEmpty.error !== null);
    assert(resEmpty.reason.includes('no fields available on item'));

    // 6.3 Fields map is null or undefined
    const resNull = evaluateItemFilter(filter, null);
    assert.strictEqual(resNull.matches, false);
    assert(resNull.error !== null);

    // 6.4 Field exists but actual value is null/empty string (Case B: no configuration error)
    const resEmptyVal = evaluateItemFilter(
      { field: 'Type', operator: 'equals', value: 'Invoice' },
      { Type: '' }
    );
    assert.strictEqual(resEmptyVal.matches, false);
    assert.strictEqual(resEmptyVal.error, null); // field existed, so no missing-field error, just didn't match

    console.log('  ✅ Missing field rejection passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 7: Malformed Filters Never Match
  // --------------------------------------------------------------------------
  console.log('🔹 Group 7: Malformed Filters Return Validation Errors (Never Match)');
  {
    const item = { Type: 'Invoice' };

    // 7.1 Primitive filter
    const res1 = evaluateItemFilter('not a filter', item);
    assert.strictEqual(res1.matches, false);
    assert(res1.error.includes('must be an object'));

    // 7.2 Empty field name
    const res2 = evaluateItemFilter({ field: '', operator: 'contains', value: 'Invoice' }, item);
    assert.strictEqual(res2.matches, false);
    assert(res2.error.includes('field cannot be empty'));

    // 7.3 Invalid operator
    const res3 = evaluateItemFilter({ field: 'Type', operator: 'invalid_op', value: 'Invoice' }, item);
    assert.strictEqual(res3.matches, false);
    assert(res3.error.includes('Unsupported filter operator "invalid_op"'));

    // 7.4 Empty value
    const res4 = evaluateItemFilter({ field: 'Type', operator: 'contains', value: '' }, item);
    assert.strictEqual(res4.matches, false);
    assert(res4.error.includes('value cannot be empty'));

    // 7.5 Missing or blank operator on modern itemFilter
    const res5 = evaluateItemFilter({ field: 'Type', value: 'Invoice' }, item);
    assert.strictEqual(res5.matches, false);
    assert(res5.error.includes('operator cannot be empty'));

    const res6 = evaluateItemFilter({ field: 'Type', operator: '   ', value: 'Invoice' }, item);
    assert.strictEqual(res6.matches, false);
    assert(res6.error.includes('operator cannot be empty'));

    // 7.6 Legacy format without operator evaluates successfully with contains default
    const resLegacy1 = evaluateItemFilter({ column: 'Type', value: 'Invoice' }, item);
    assert.strictEqual(resLegacy1.matches, true);
    assert.strictEqual(resLegacy1.operator, 'contains');

    const resLegacy2 = evaluateItemFilter({ filterValue: 'Invoice' }, item);
    assert.strictEqual(resLegacy2.matches, true);
    assert.strictEqual(resLegacy2.operator, 'contains');

    console.log('  ✅ Malformed filter evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 8: No-Filter (Match All) Behavior
  // --------------------------------------------------------------------------
  console.log('🔹 Group 8: No-Filter / Match All Behavior');
  {
    const sampleItem = { Type: 'Credit Memo', Amount: '$300' };

    // 8.1 undefined filter matches all
    const resUndef = evaluateItemFilter(undefined, sampleItem);
    assert.strictEqual(resUndef.matches, true);
    assert.strictEqual(resUndef.error, null);
    assert(resUndef.reason.includes('no filter configured'));

    // 8.2 null filter matches all
    const resNull = evaluateItemFilter(null, sampleItem);
    assert.strictEqual(resNull.matches, true);

    // 8.3 empty object matches all
    const resEmpty = evaluateItemFilter({}, sampleItem);
    assert.strictEqual(resEmpty.matches, true);

    // 8.4 legacy wildcards match all
    const resWild1 = evaluateItemFilter({ column: 'Type', value: '__any__' }, sampleItem);
    assert.strictEqual(resWild1.matches, true);

    const resWild2 = evaluateItemFilter({ filterValue: 'all' }, sampleItem);
    assert.strictEqual(resWild2.matches, true);

    // 8.5 Match-all matches even if item has no fields
    const resNoFields = evaluateItemFilter(null, {});
    assert.strictEqual(resNoFields.matches, true);

    console.log('  ✅ Match-all behavior passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 9: dateBetween Evaluation & Boundary Inclusivity
  // --------------------------------------------------------------------------
  console.log('🔹 Group 9: dateBetween Evaluation & Boundary Inclusivity');
  {
    const filter = {
      field: 'Due Date',
      operator: 'dateBetween',
      value: { from: '2026-01-01', to: '2026-01-31' }
    };

    // 9.1 Inclusive lower boundary: item date equals 'from'
    const resFrom = evaluateItemFilter(filter, { 'Due Date': '2026-01-01' });
    assert.strictEqual(resFrom.matches, true);
    assert.strictEqual(resFrom.error, null);
    assert(resFrom.reason.includes('is between "2026-01-01" and "2026-01-31" (inclusive)'));

    // 9.2 Inclusive upper boundary: item date equals 'to'
    const resTo = evaluateItemFilter(filter, { 'Due Date': '2026-01-31' });
    assert.strictEqual(resTo.matches, true);
    assert(resTo.reason.includes('is between "2026-01-01" and "2026-01-31" (inclusive)'));

    // 9.3 In-between date
    const resMid = evaluateItemFilter(filter, { 'Due Date': '2026-01-15' });
    assert.strictEqual(resMid.matches, true);

    // 9.4 Date before lower bound
    const resBefore = evaluateItemFilter(filter, { 'Due Date': '2025-12-31' });
    assert.strictEqual(resBefore.matches, false);
    assert(resBefore.reason.includes('not between "2026-01-01" and "2026-01-31"'));

    // 9.5 Date after upper bound
    const resAfter = evaluateItemFilter(filter, { 'Due Date': '2026-02-01' });
    assert.strictEqual(resAfter.matches, false);
    assert(resAfter.reason.includes('not between "2026-01-01" and "2026-01-31"'));

    // 9.6 Single-day date range (from === to)
    const singleDayFilter = {
      field: 'Date',
      operator: 'dateBetween',
      value: { from: '2026-01-15', to: '2026-01-15' }
    };
    assert.strictEqual(evaluateItemFilter(singleDayFilter, { Date: '2026-01-15' }).matches, true);
    assert.strictEqual(evaluateItemFilter(singleDayFilter, { Date: '2026-01-14' }).matches, false);
    assert.strictEqual(evaluateItemFilter(singleDayFilter, { Date: '2026-01-16' }).matches, false);

    // 9.7 Source date with ISO timestamp (YYYY-MM-DDTHH:mm:ssZ)
    const resIsoTime = evaluateItemFilter(filter, { 'Due Date': '2026-01-15T14:30:00Z' });
    assert.strictEqual(resIsoTime.matches, true);

    // 9.8 Source date with space-separated time
    const resSpaceTime = evaluateItemFilter(filter, { 'Due Date': '2026-01-15 09:00:00' });
    assert.strictEqual(resSpaceTime.matches, true);

    // 9.9 Source date formatted with slashes YYYY/MM/DD
    const resSlashDate = evaluateItemFilter(filter, { 'Due Date': '2026/01/15' });
    assert.strictEqual(resSlashDate.matches, true);

    // 9.10 Source date as JavaScript Date instance
    const resJsDate = evaluateItemFilter(filter, { 'Due Date': new Date('2026-01-15T00:00:00.000Z') });
    assert.strictEqual(resJsDate.matches, true);

    // 9.11 Leap year date in range
    const leapFilter = {
      field: 'Date',
      operator: 'dateBetween',
      value: { from: '2024-02-01', to: '2024-02-29' }
    };
    assert.strictEqual(evaluateItemFilter(leapFilter, { Date: '2024-02-29' }).matches, true);

    console.log('  ✅ dateBetween evaluation & boundary inclusivity passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 10: dateBetween Source Date Failure Handling (Case B vs Case A)
  // --------------------------------------------------------------------------
  console.log('🔹 Group 10: dateBetween Source Date Failure Handling');
  {
    const filter = {
      field: 'Due Date',
      operator: 'dateBetween',
      value: { from: '2026-01-01', to: '2026-01-31' }
    };

    // 10.1 Missing source date value (null / undefined / empty string) - Case B
    const resNull = evaluateItemFilter(filter, { 'Due Date': null });
    assert.strictEqual(resNull.matches, false);
    assert.strictEqual(resNull.error, null, 'Case B: item-level missing value must NOT report a config error');
    assert(resNull.reason.includes('has missing or empty date value'));

    const resEmptyStr = evaluateItemFilter(filter, { 'Due Date': '' });
    assert.strictEqual(resEmptyStr.matches, false);
    assert.strictEqual(resEmptyStr.error, null);
    assert(resEmptyStr.reason.includes('has missing or empty date value'));

    // 10.2 Malformed / unparseable source date - Case B
    const resGibberish = evaluateItemFilter(filter, { 'Due Date': 'not-a-date' });
    assert.strictEqual(resGibberish.matches, false);
    assert.strictEqual(resGibberish.error, null);
    assert(resGibberish.reason.includes('is not a valid date in YYYY-MM-DD format'));

    const resBadDay = evaluateItemFilter(filter, { 'Due Date': '2026-02-30' });
    assert.strictEqual(resBadDay.matches, false);
    assert.strictEqual(resBadDay.error, null);
    assert(resBadDay.reason.includes('is not a valid date in YYYY-MM-DD format'));

    // 10.3 Ambiguous source date (e.g. MM/DD/YYYY or DD/MM/YYYY) - Case B
    const resAmbiguous = evaluateItemFilter(filter, { 'Due Date': '01/02/2026' });
    assert.strictEqual(resAmbiguous.matches, false);
    assert.strictEqual(resAmbiguous.error, null);
    assert(resAmbiguous.reason.includes('is not a valid date in YYYY-MM-DD format'));

    // 10.4 Configured field absent from item schema - Case A
    const resMissingField = evaluateItemFilter(filter, { 'Invoice #': 'INV-001' });
    assert.strictEqual(resMissingField.matches, false);
    assert(resMissingField.error !== null, 'Case A: absent configured field MUST report a configuration error');
    assert(resMissingField.error.includes('Configured field "Due Date" is not available on item'));

    console.log('  ✅ dateBetween source date failure handling passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 11: Compound Evaluation (Multiple Conditions with 'all')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 11: Compound Evaluation with matchMode: "all"');
  {
    const filter = {
      matchMode: 'all',
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' },
        { field: 'Type', operator: 'contains', value: 'Invoice' },
        { field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-01', to: '2026-01-31' } }
      ]
    };

    // 11.1 All conditions match
    const itemMatch = { Status: 'Open', Type: 'Standard Invoice', 'Due Date': '2026-01-15' };
    const resMatch = evaluateItemFilter(filter, itemMatch);
    assert.strictEqual(resMatch.matches, true);
    assert.strictEqual(resMatch.error, null);
    assert.strictEqual(resMatch.matchMode, 'all');
    assert.strictEqual(resMatch.conditionResults.length, 3);
    assert(resMatch.reason.includes('All 3 conditions matched'));

    // 11.2 One condition fails (Status mismatch)
    const itemFailStatus = { Status: 'Closed', Type: 'Standard Invoice', 'Due Date': '2026-01-15' };
    const resFailStatus = evaluateItemFilter(filter, itemFailStatus);
    assert.strictEqual(resFailStatus.matches, false);
    assert.strictEqual(resFailStatus.error, null);
    assert(resFailStatus.reason.includes('1 of 3 condition(s) failed'));

    // 11.3 One condition fails (Date out of range)
    const itemFailDate = { Status: 'Open', Type: 'Standard Invoice', 'Due Date': '2026-02-15' };
    const resFailDate = evaluateItemFilter(filter, itemFailDate);
    assert.strictEqual(resFailDate.matches, false);
    assert.strictEqual(resFailDate.error, null);
    assert(resFailDate.reason.includes('1 of 3 condition(s) failed'));

    // 11.4 Individual item has missing date (Case B inside all)
    const itemMissingDate = { Status: 'Open', Type: 'Standard Invoice', 'Due Date': '' };
    const resMissingDate = evaluateItemFilter(filter, itemMissingDate);
    assert.strictEqual(resMissingDate.matches, false);
    assert.strictEqual(resMissingDate.error, null, 'Missing date on item is an item mismatch, not a configuration error');

    // 11.5 Unavailable configured field in one condition (Case A inside all)
    const itemMissingField = { Status: 'Open', Type: 'Invoice' }; // 'Due Date' missing from item
    const resMissingField = evaluateItemFilter(filter, itemMissingField);
    assert.strictEqual(resMissingField.matches, false);
    assert(resMissingField.error !== null);
    assert(resMissingField.error.includes('Configured field "Due Date" is not available on item'));

    console.log('  ✅ Compound evaluation with matchMode: "all" passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 12: Compound Evaluation (Multiple Conditions with 'any')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 12: Compound Evaluation with matchMode: "any"');
  {
    const filter = {
      matchMode: 'any',
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' },
        { field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-01', to: '2026-01-31' } }
      ]
    };

    // 12.1 First condition matches, second fails
    const item1 = { Status: 'Open', 'Due Date': '2026-05-01' };
    const res1 = evaluateItemFilter(filter, item1);
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.error, null);
    assert(res1.reason.includes('1 of 2 condition(s) matched'));

    // 12.2 First condition fails, second matches
    const item2 = { Status: 'Closed', 'Due Date': '2026-01-10' };
    const res2 = evaluateItemFilter(filter, item2);
    assert.strictEqual(res2.matches, true);

    // 12.3 Both conditions match
    const itemBoth = { Status: 'Open', 'Due Date': '2026-01-10' };
    const resBoth = evaluateItemFilter(filter, itemBoth);
    assert.strictEqual(resBoth.matches, true);
    assert(resBoth.reason.includes('2 of 2 condition(s) matched'));

    // 12.4 Neither condition matches
    const itemNeither = { Status: 'Closed', 'Due Date': '2026-05-01' };
    const resNeither = evaluateItemFilter(filter, itemNeither);
    assert.strictEqual(resNeither.matches, false);
    assert(resNeither.reason.includes('No conditions matched'));

    // 12.5 Missing date value in one condition, but another condition matches
    const itemMissingDate = { Status: 'Open', 'Due Date': null };
    const resMissDate = evaluateItemFilter(filter, itemMissingDate);
    assert.strictEqual(resMissDate.matches, true);

    // 12.6 Unavailable configured field in one condition of 'any' -> configuration error!
    const itemMissingField = { Status: 'Open' }; // 'Due Date' field completely unavailable
    const resMissField = evaluateItemFilter(filter, itemMissingField);
    assert.strictEqual(resMissField.matches, false);
    assert(resMissField.error !== null);

    console.log('  ✅ Compound evaluation with matchMode: "any" passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 13: loopLimit Semantics & Selection Order
  // --------------------------------------------------------------------------
  console.log('🔹 Group 13: loopLimit Semantics & Selection Order');
  {
    // Generate 10 test items: 6 Invoices (indices 0, 2, 4, 6, 8, 9) and 4 Credit Memos (1, 3, 5, 7)
    const items = [
      { index: 0, label: 'Item 0', fields: { Type: 'Invoice', Num: '0' } },
      { index: 1, label: 'Item 1', fields: { Type: 'Credit Memo', Num: '1' } },
      { index: 2, label: 'Item 2', fields: { Type: 'Invoice', Num: '2' } },
      { index: 3, label: 'Item 3', fields: { Type: 'Credit Memo', Num: '3' } },
      { index: 4, label: 'Item 4', fields: { Type: 'Invoice', Num: '4' } },
      { index: 5, label: 'Item 5', fields: { Type: 'Credit Memo', Num: '5' } },
      { index: 6, label: 'Item 6', fields: { Type: 'Invoice', Num: '6' } },
      { index: 7, label: 'Item 7', fields: { Type: 'Credit Memo', Num: '7' } },
      { index: 8, label: 'Item 8', fields: { Type: 'Invoice', Num: '8' } },
      { index: 9, label: 'Item 9', fields: { Type: 'Invoice', Num: '9' } }
    ];

    const filter = { field: 'Type', operator: 'contains', value: 'Invoice' };

    // 13.1 Filtering before limit: 10 items total, 6 match, limit = 3
    const prevLimited = evaluateFilterPreview(filter, items, { loopLimit: 3, previewLimit: 10 });
    assert.strictEqual(prevLimited.totalCount, 10);
    assert.strictEqual(prevLimited.matchingCount, 6);
    assert.strictEqual(prevLimited.selectedCount, 3);
    assert.strictEqual(prevLimited.skippedFilterCount, 4);
    assert.strictEqual(prevLimited.skippedLimitCount, 3);
    assert.strictEqual(prevLimited.skippedCount, 7);

    // Selected items must be first 3 matching items in discovery order: items 0, 2, 4
    assert.strictEqual(prevLimited.selectedPreview.length, 3);
    assert.strictEqual(prevLimited.selectedPreview[0].index, 0);
    assert.strictEqual(prevLimited.selectedPreview[0].status, 'SELECTED');
    assert.strictEqual(prevLimited.selectedPreview[1].index, 2);
    assert.strictEqual(prevLimited.selectedPreview[1].status, 'SELECTED');
    assert.strictEqual(prevLimited.selectedPreview[2].index, 4);
    assert.strictEqual(prevLimited.selectedPreview[2].status, 'SELECTED');

    // Limit-skipped items must be remaining matching items: items 6, 8, 9
    assert.strictEqual(prevLimited.skippedLimitPreview.length, 3);
    assert.strictEqual(prevLimited.skippedLimitPreview[0].index, 6);
    assert.strictEqual(prevLimited.skippedLimitPreview[0].status, 'SKIPPED_LIMIT');
    assert.strictEqual(prevLimited.skippedLimitPreview[1].index, 8);
    assert.strictEqual(prevLimited.skippedLimitPreview[1].status, 'SKIPPED_LIMIT');
    assert.strictEqual(prevLimited.skippedLimitPreview[2].index, 9);
    assert.strictEqual(prevLimited.skippedLimitPreview[2].status, 'SKIPPED_LIMIT');

    // Filter-skipped items: items 1, 3, 5, 7
    assert.strictEqual(prevLimited.skippedFilterPreview.length, 4);
    assert.strictEqual(prevLimited.skippedFilterPreview[0].index, 1);
    assert.strictEqual(prevLimited.skippedFilterPreview[0].status, 'SKIPPED_FILTER');

    // 13.2 Limit of 1: selects only first matching item
    const prevLimit1 = evaluateFilterPreview(filter, items, { loopLimit: 1 });
    assert.strictEqual(prevLimit1.matchingCount, 6);
    assert.strictEqual(prevLimit1.selectedCount, 1);
    assert.strictEqual(prevLimit1.skippedLimitCount, 5);
    assert.strictEqual(prevLimit1.selectedPreview[0].index, 0);

    // 13.3 Limit larger than matching count
    const prevLimit10 = evaluateFilterPreview(filter, items, { loopLimit: 10 });
    assert.strictEqual(prevLimit10.matchingCount, 6);
    assert.strictEqual(prevLimit10.selectedCount, 6);
    assert.strictEqual(prevLimit10.skippedLimitCount, 0);

    // 13.4 Omitted / null limit => unlimited
    const prevUnlimited = evaluateFilterPreview(filter, items, { loopLimit: null });
    assert.strictEqual(prevUnlimited.matchingCount, 6);
    assert.strictEqual(prevUnlimited.selectedCount, 6);
    assert.strictEqual(prevUnlimited.skippedLimitCount, 0);

    const prevOmitted = evaluateFilterPreview(filter, items);
    assert.strictEqual(prevOmitted.matchingCount, 6);
    assert.strictEqual(prevOmitted.selectedCount, 6);
    assert.strictEqual(prevOmitted.skippedLimitCount, 0);

    // 13.5 loopLimit specified inside envelope object
    const prevEnvelope = evaluateFilterPreview({ itemFilter: filter, loopLimit: 2 }, items);
    assert.strictEqual(prevEnvelope.matchingCount, 6);
    assert.strictEqual(prevEnvelope.selectedCount, 2);
    assert.strictEqual(prevEnvelope.skippedLimitCount, 4);

    // 13.6 Invalid limits rejected
    const prevZero = evaluateFilterPreview(filter, items, { loopLimit: 0 });
    assert.strictEqual(prevZero.selectedCount, 0);
    assert(prevZero.errors.some(e => e.includes('positive integer')));

    const prevNegative = evaluateFilterPreview(filter, items, { loopLimit: -5 });
    assert.strictEqual(prevNegative.selectedCount, 0);
    assert(prevNegative.errors.some(e => e.includes('positive integer')));

    const prevFloat = evaluateFilterPreview(filter, items, { loopLimit: 3.5 });
    assert.strictEqual(prevFloat.selectedCount, 0);
    assert(prevFloat.errors.some(e => e.includes('positive integer')));

    const prevStringInvalid = evaluateFilterPreview(filter, items, { loopLimit: 'invalid' });
    assert.strictEqual(prevStringInvalid.selectedCount, 0);
    assert(prevStringInvalid.errors.some(e => e.includes('positive integer')));

    // Numeric string integer is accepted
    const prevNumStr = evaluateFilterPreview(filter, items, { loopLimit: '4' });
    assert.strictEqual(prevNumStr.selectedCount, 4);

    console.log('  ✅ loopLimit semantics & selection order passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 14: Extended Batch Preview Evaluation (Compound + Dates)
  // --------------------------------------------------------------------------
  console.log('🔹 Group 14: Extended Batch Preview Evaluation');
  {
    const items = [
      { index: 0, label: 'Inv 1', fields: { Status: 'Open', 'Due Date': '2026-01-10' } },
      { index: 1, label: 'Inv 2', fields: { Status: 'Closed', 'Due Date': '2026-01-15' } },
      { index: 2, label: 'Inv 3', fields: { Status: 'Open', 'Due Date': '2026-02-10' } },
      { index: 3, label: 'Inv 4', fields: { Status: 'Open', 'Due Date': '2026-01-20' } },
      { index: 4, label: 'Inv 5', fields: { Status: 'Open', 'Due Date': '' } },            // missing date
      { index: 5, label: 'Inv 6', fields: { Status: 'Open', 'Due Date': 'not-a-date' } },   // unparseable date
      { index: 6, label: 'Inv 7', fields: { Status: 'Open', 'Due Date': '2026-01-25' } }
    ];

    const compoundFilter = {
      matchMode: 'all',
      conditions: [
        { field: 'Status', operator: 'equals', value: 'Open' },
        { field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-01', to: '2026-01-31' } }
      ]
    };

    // Filter matches items: 0, 3, 6 (3 matching items).
    // Item 1 fails Status. Item 2 fails Date (Feb). Item 4 missing date. Item 5 unparseable date.
    // Apply loopLimit: 2
    const preview = evaluateFilterPreview(compoundFilter, items, { loopLimit: 2, previewLimit: 5 });

    assert.strictEqual(preview.totalCount, 7);
    assert.strictEqual(preview.matchingCount, 3);
    assert.strictEqual(preview.selectedCount, 2);
    assert.strictEqual(preview.skippedLimitCount, 1);
    assert.strictEqual(preview.skippedFilterCount, 4);
    assert.deepStrictEqual(preview.errors, [], 'Item-level missing/unparseable dates must not create configuration errors');

    // Selected items
    assert.strictEqual(preview.selectedPreview.length, 2);
    assert.strictEqual(preview.selectedPreview[0].index, 0);
    assert.strictEqual(preview.selectedPreview[1].index, 3);

    // Limit skipped item
    assert.strictEqual(preview.skippedLimitPreview.length, 1);
    assert.strictEqual(preview.skippedLimitPreview[0].index, 6);

    // Filter skipped items (first 4)
    assert.strictEqual(preview.skippedFilterPreview.length, 4);

    // Available fields
    assert(preview.availableFields.includes('Status'));
    assert(preview.availableFields.includes('Due Date'));

    // Preview when configured field is absent from item
    const badFieldFilter = {
      field: 'NonExistentField',
      operator: 'equals',
      value: 'X'
    };
    const prevBadField = evaluateFilterPreview(badFieldFilter, items);
    assert.strictEqual(prevBadField.selectedCount, 0);
    assert.strictEqual(prevBadField.errors.length, 1);
    assert(prevBadField.errors[0].includes('NonExistentField'));

    // Preview when filter itself is malformed
    const badFilter = { conditions: [] };
    const prevBadFilter = evaluateFilterPreview(badFilter, items);
    assert.strictEqual(prevBadFilter.selectedCount, 0);
    assert.strictEqual(prevBadFilter.errors.length, 1);
    assert(prevBadFilter.errors[0].includes('conditions cannot be empty'));

    console.log('  ✅ Extended batch preview evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 15: ItemFilter Namespace API Interface Compliance
  // --------------------------------------------------------------------------
  console.log('🔹 Group 15: ItemFilter Namespace API Compliance');
  {
    assert.strictEqual(typeof ItemFilter.normalize, 'function');
    assert.strictEqual(typeof ItemFilter.validate, 'function');
    assert.strictEqual(typeof ItemFilter.evaluate, 'function');
    assert.strictEqual(typeof ItemFilter.evaluatePreview, 'function');
    assert.strictEqual(typeof ItemFilter.extractFields, 'function');
    assert.deepStrictEqual(ItemFilter.SUPPORTED_OPERATORS, ['contains', 'equals', 'dateBetween']);
    assert.deepStrictEqual(ItemFilter.SUPPORTED_MATCH_MODES, ['all', 'any']);

    const res = ItemFilter.evaluate({ field: 'A', operator: 'equals', value: '1' }, { A: '1' });
    assert.strictEqual(res.matches, true);

    console.log('  ✅ ItemFilter namespace interface compliance passed\n');
  }

  console.log('🎉 ALL ITEM FILTER EVALUATOR UNIT TESTS PASSED SUCCESSFULLY!\n');
}

runItemFilterTests();
