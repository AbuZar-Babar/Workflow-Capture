/**
 * ConditionEvaluator
 * 
 * Type-aware condition and filter evaluation engine for intent-driven workflow execution.
 * Supports string, numeric, date, status, and compound AND/OR conditions with automatic
 * type casting, whitespace trimming, currency/number normalization, and fuzzy date parsing.
 */

class ConditionEvaluator {
  /**
   * Normalizes an arbitrary filter/condition input into a standardized array of condition rules.
   * Handles:
   *  - Single condition object { field, operator, value }
   *  - Legacy rowFilter { column, value }
   *  - Compound group { matchType: 'AND'|'OR', conditions: [...] }
   *  - Array of conditions
   * 
   * @param {object|array|null} filterInput 
   * @returns {object} { matchType: 'AND'|'OR', rules: Array<{ field, operator, value, secondValue }> }
   */
  static normalizeConditions(filterInput) {
    if (!filterInput) {
      return { matchType: 'AND', rules: [] };
    }

    // Direct compound structure
    if (filterInput.conditions && Array.isArray(filterInput.conditions)) {
      return {
        matchType: (filterInput.matchType || filterInput.conjunction || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND',
        rules: filterInput.conditions.map(c => this._normalizeSingleRule(c)).filter(Boolean)
      };
    }

    // Array of rules
    if (Array.isArray(filterInput)) {
      return {
        matchType: 'AND',
        rules: filterInput.map(c => this._normalizeSingleRule(c)).filter(Boolean)
      };
    }

    // Single itemFilter { field, operator, value }
    if (filterInput.field || filterInput.operator) {
      const rule = this._normalizeSingleRule(filterInput);
      return { matchType: 'AND', rules: rule ? [rule] : [] };
    }

    // Legacy rowFilter { column, value }
    if (filterInput.column !== undefined) {
      return {
        matchType: 'AND',
        rules: [{
          field: String(filterInput.column).trim(),
          operator: filterInput.operator || 'contains',
          value: filterInput.value
        }]
      };
    }

    return { matchType: 'AND', rules: [] };
  }

  static _normalizeSingleRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const field = String(rule.field || rule.column || rule.key || '').trim();
    if (!field) return null;

    const operator = String(rule.operator || rule.op || 'contains').toLowerCase().trim();
    const value = rule.value !== undefined ? rule.value : (rule.text !== undefined ? rule.text : '');
    const secondValue = rule.secondValue !== undefined ? rule.secondValue : rule.valueTo;

    return {
      field,
      operator,
      value,
      secondValue
    };
  }

  /**
   * Evaluates an item record against the normalized condition rules.
   * 
   * @param {object} itemData - Key-value pair of item fields (e.g. { "Invoice Number": "INV-1001", "Date": "Sep 28, 2026", "Status": "New", "Amount": "$1,250.00" })
   * @param {object|array} filterInput - Raw or normalized condition configuration
   * @returns {{ matches: boolean, reason: string|null, failedRule: object|null }}
   */
  static evaluate(itemData, filterInput) {
    const normalized = this.normalizeConditions(filterInput);
    if (!normalized.rules.length) {
      return { matches: true, reason: null, failedRule: null };
    }

    if (!itemData || typeof itemData !== 'object') {
      return {
        matches: false,
        reason: 'Item data is empty or invalid',
        failedRule: normalized.rules[0]
      };
    }

    const { matchType, rules } = normalized;

    if (matchType === 'OR') {
      let anyMatch = false;
      const failureReasons = [];

      for (const rule of rules) {
        const res = this.evaluateSingleRule(itemData, rule);
        if (res.matches) {
          anyMatch = true;
          break;
        } else {
          failureReasons.push(res.reason);
        }
      }

      if (anyMatch) {
        return { matches: true, reason: null, failedRule: null };
      } else {
        return {
          matches: false,
          reason: `Did not match any OR conditions: [${failureReasons.join('; ')}]`,
          failedRule: rules[0]
        };
      }
    }

    // Default 'AND'
    for (const rule of rules) {
      const res = this.evaluateSingleRule(itemData, rule);
      if (!res.matches) {
        return {
          matches: false,
          reason: res.reason,
          failedRule: rule
        };
      }
    }

    return { matches: true, reason: null, failedRule: null };
  }

  /**
   * Evaluates a single rule against item data.
   */
  static evaluateSingleRule(itemData, rule) {
    const targetVal = rule.value;
    if (targetVal === '__any__' || targetVal === 'all' || targetVal === '' || targetVal === undefined) {
      return { matches: true, reason: null };
    }

    const rawValue = this.extractFieldValue(itemData, rule.field);
    const op = (rule.operator || 'contains').toLowerCase();

    // 1. Missing / Unreadable Field Guard
    if (rawValue === undefined || rawValue === null) {
      return {
        matches: false,
        reason: `Field "${rule.field}" is missing or unreadable in item`
      };
    }

    // 2. Operators Evaluation
    switch (op) {
      // --- String / Fuzzy Operations ---
      case 'contains':
      case 'includes': {
        const itemStr = String(rawValue).toLowerCase();
        const targetStr = String(targetVal).toLowerCase().trim();
        const matches = itemStr.includes(targetStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") does not contain "${targetVal}"`
        };
      }

      case 'equals':
      case 'eq':
      case '==':
      case '===': {
        const itemStr = String(rawValue).trim().toLowerCase();
        const targetStr = String(targetVal).trim().toLowerCase();
        const matches = itemStr === targetStr;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") does not equal "${targetVal}"`
        };
      }

      case 'not_equals':
      case 'neq':
      case '!=': {
        const itemStr = String(rawValue).trim().toLowerCase();
        const targetStr = String(targetVal).trim().toLowerCase();
        const matches = itemStr !== targetStr;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") equals "${targetVal}" (expected not equal)`
        };
      }

      case 'starts_with': {
        const itemStr = String(rawValue).toLowerCase().trim();
        const targetStr = String(targetVal).toLowerCase().trim();
        const matches = itemStr.startsWith(targetStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") does not start with "${targetVal}"`
        };
      }

      case 'ends_with': {
        const itemStr = String(rawValue).toLowerCase().trim();
        const targetStr = String(targetVal).toLowerCase().trim();
        const matches = itemStr.endsWith(targetStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") does not end with "${targetVal}"`
        };
      }

      case 'in':
      case 'one_of': {
        const targetList = Array.isArray(targetVal)
          ? targetVal.map(v => String(v).toLowerCase().trim())
          : String(targetVal).split(',').map(s => s.toLowerCase().trim());
        const itemStr = String(rawValue).toLowerCase().trim();
        const matches = targetList.includes(itemStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") is not in [${targetList.join(', ')}]`
        };
      }

      case 'not_in': {
        const targetList = Array.isArray(targetVal)
          ? targetVal.map(v => String(v).toLowerCase().trim())
          : String(targetVal).split(',').map(s => s.toLowerCase().trim());
        const itemStr = String(rawValue).toLowerCase().trim();
        const matches = !targetList.includes(itemStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" ("${rawValue}") is present in [${targetList.join(', ')}]`
        };
      }

      // --- Numeric & Date Comparisons (Dual Mode) ---
      case 'greater_than':
      case 'gt':
      case '>':
      case 'after':
      case 'date_after':
      case 'date_gt': {
        if (this.isDateString(rawValue) || this.isDateString(targetVal)) {
          const itemDate = this.parseDate(rawValue);
          const targetDate = this.parseDate(targetVal);
          if (itemDate && targetDate) {
            targetDate.setHours(23, 59, 59, 999);
            const matches = itemDate.getTime() > targetDate.getTime();
            return {
              matches,
              reason: matches ? null : `Date "${rawValue}" is not after "${targetVal}"`
            };
          }
        }
        const numVal = this.parseNumeric(rawValue);
        const targetNum = this.parseNumeric(targetVal);
        if (numVal === null || targetNum === null) {
          return { matches: false, reason: `Value "${rawValue}" or target "${targetVal}" is not a valid number or date` };
        }
        const matches = numVal > targetNum;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" (${numVal}) is not greater than ${targetNum}`
        };
      }

      case 'greater_than_or_equal':
      case 'gte':
      case '>=':
      case 'on_or_after':
      case 'date_on_or_after':
      case 'date_gte': {
        if (this.isDateString(rawValue) || this.isDateString(targetVal)) {
          const itemDate = this.parseDate(rawValue);
          const targetDate = this.parseDate(targetVal);
          if (itemDate && targetDate) {
            itemDate.setHours(0, 0, 0, 0);
            targetDate.setHours(0, 0, 0, 0);
            const matches = itemDate.getTime() >= targetDate.getTime();
            return {
              matches,
              reason: matches ? null : `Date "${rawValue}" is before "${targetVal}"`
            };
          }
        }
        const numVal = this.parseNumeric(rawValue);
        const targetNum = this.parseNumeric(targetVal);
        if (numVal === null || targetNum === null) {
          return { matches: false, reason: `Value "${rawValue}" or target "${targetVal}" is not a valid number or date` };
        }
        const matches = numVal >= targetNum;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" (${numVal}) is not >= ${targetNum}`
        };
      }

      case 'less_than':
      case 'lt':
      case '<':
      case 'before':
      case 'date_before':
      case 'date_lt': {
        if (this.isDateString(rawValue) || this.isDateString(targetVal)) {
          const itemDate = this.parseDate(rawValue);
          const targetDate = this.parseDate(targetVal);
          if (itemDate && targetDate) {
            itemDate.setHours(0, 0, 0, 0);
            targetDate.setHours(0, 0, 0, 0);
            const matches = itemDate.getTime() < targetDate.getTime();
            return {
              matches,
              reason: matches ? null : `Date "${rawValue}" is not before "${targetVal}"`
            };
          }
        }
        const numVal = this.parseNumeric(rawValue);
        const targetNum = this.parseNumeric(targetVal);
        if (numVal === null || targetNum === null) {
          return { matches: false, reason: `Value "${rawValue}" or target "${targetVal}" is not a valid number or date` };
        }
        const matches = numVal < targetNum;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" (${numVal}) is not less than ${targetNum}`
        };
      }

      case 'less_than_or_equal':
      case 'lte':
      case '<=':
      case 'on_or_before':
      case 'date_on_or_before':
      case 'date_lte': {
        if (this.isDateString(rawValue) || this.isDateString(targetVal)) {
          const itemDate = this.parseDate(rawValue);
          const targetDate = this.parseDate(targetVal);
          if (itemDate && targetDate) {
            itemDate.setHours(23, 59, 59, 999);
            targetDate.setHours(23, 59, 59, 999);
            const matches = itemDate.getTime() <= targetDate.getTime();
            return {
              matches,
              reason: matches ? null : `Date "${rawValue}" is after "${targetVal}"`
            };
          }
        }
        const numVal = this.parseNumeric(rawValue);
        const targetNum = this.parseNumeric(targetVal);
        if (numVal === null || targetNum === null) {
          return { matches: false, reason: `Value "${rawValue}" or target "${targetVal}" is not a valid number or date` };
        }
        const matches = numVal <= targetNum;
        return {
          matches,
          reason: matches ? null : `"${rule.field}" (${numVal}) is not <= ${targetNum}`
        };
      }
      case 'date_gt': {
        const itemDate = this.parseDate(rawValue);
        const targetDate = this.parseDate(targetVal);
        if (!itemDate || !targetDate) {
          return { matches: false, reason: `Cannot parse date from "${rawValue}" or target "${targetVal}"` };
        }
        const matches = itemDate.getTime() > targetDate.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is not after "${targetVal}"`
        };
      }

      case 'date_on_or_after':
      case 'on_or_after':
      case 'date_gte': {
        const itemDate = this.parseDate(rawValue);
        const targetDate = this.parseDate(targetVal);
        if (!itemDate || !targetDate) {
          return { matches: false, reason: `Cannot parse date from "${rawValue}" or target "${targetVal}"` };
        }
        itemDate.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        const matches = itemDate.getTime() >= targetDate.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is before "${targetVal}"`
        };
      }

      case 'date_before':
      case 'before':
      case 'date_lt': {
        const itemDate = this.parseDate(rawValue);
        const targetDate = this.parseDate(targetVal);
        if (!itemDate || !targetDate) {
          return { matches: false, reason: `Cannot parse date from "${rawValue}" or target "${targetVal}"` };
        }
        const matches = itemDate.getTime() < targetDate.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is not before "${targetVal}"`
        };
      }

      case 'date_on_or_before':
      case 'on_or_before':
      case 'date_lte': {
        const itemDate = this.parseDate(rawValue);
        const targetDate = this.parseDate(targetVal);
        if (!itemDate || !targetDate) {
          return { matches: false, reason: `Cannot parse date from "${rawValue}" or target "${targetVal}"` };
        }
        itemDate.setHours(23, 59, 59, 999);
        targetDate.setHours(23, 59, 59, 999);
        const matches = itemDate.getTime() <= targetDate.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is after "${targetVal}"`
        };
      }

      case 'date_between':
      case 'between_dates': {
        const itemDate = this.parseDate(rawValue);
        const startDate = this.parseDate(targetVal);
        const endDate = this.parseDate(rule.secondValue);
        if (!itemDate || !startDate || !endDate) {
          return { matches: false, reason: `Cannot parse date range from "${rawValue}", "${targetVal}", or "${rule.secondValue}"` };
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        const matches = itemDate.getTime() >= startDate.getTime() && itemDate.getTime() <= endDate.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is outside range [${targetVal} - ${rule.secondValue}]`
        };
      }

      case 'last_n_days': {
        const itemDate = this.parseDate(rawValue);
        const days = parseInt(targetVal, 10);
        if (!itemDate || isNaN(days)) {
          return { matches: false, reason: `Invalid date "${rawValue}" or days "${targetVal}"` };
        }
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);
        threshold.setHours(0, 0, 0, 0);
        const matches = itemDate.getTime() >= threshold.getTime();
        return {
          matches,
          reason: matches ? null : `Date "${rawValue}" is older than ${days} day(s)`
        };
      }

      default: {
        const itemStr = String(rawValue).toLowerCase();
        const targetStr = String(targetVal).toLowerCase().trim();
        const matches = itemStr.includes(targetStr);
        return {
          matches,
          reason: matches ? null : `"${rule.field}" does not match condition`
        };
      }
    }
  }

  /**
   * Case-insensitive / normalized lookup of field values from item object.
   */
  static extractFieldValue(itemData, targetFieldName) {
    if (!itemData || !targetFieldName) return null;
    const cleanTarget = String(targetFieldName).toLowerCase().trim();

    // 1. Direct key match
    if (itemData[targetFieldName] !== undefined) {
      return itemData[targetFieldName];
    }

    // 2. Case-insensitive key match
    for (const key of Object.keys(itemData)) {
      if (key.toLowerCase().trim() === cleanTarget) {
        return itemData[key];
      }
    }

    // 3. Fallback for label / text / identifier / type on single-value items (e.g. dropdown options)
    if (cleanTarget === 'label' || cleanTarget === 'text' || cleanTarget === 'title' || cleanTarget === 'type' || cleanTarget === 'document type' || cleanTarget === 'option') {
      return itemData.Type || itemData.type || itemData.Option || itemData.option || itemData.label || itemData.text || itemData.itemLabel || itemData.name || itemData.fullText || null;
    }

    return undefined;
  }

  /**
   * Normalizes numbers from strings containing currency symbols ($), commas, or whitespace.
   */
  static parseNumeric(val) {
    if (typeof val === 'number') return isNaN(val) ? null : val;
    if (!val && val !== 0) return null;
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * Distinguishes date strings from pure numeric strings and random text.
   */
  static isDateString(val) {
    if (val instanceof Date) return true;
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim().toLowerCase();
    if (trimmed === 'today' || trimmed === 'now' || trimmed === 'yesterday' || trimmed === 'tomorrow') return true;
    if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return false;
    if (!/[/\-.]|[a-zA-Z]/.test(trimmed)) return false;
    const parsed = Date.parse(trimmed);
    return !isNaN(parsed);
  }

  /**
   * Robust date parser for standard formats (ISO, MM/DD/YYYY, Mon DD YYYY, etc.) and relative keywords.
   */
  static parseDate(val) {
    if (val instanceof Date && !isNaN(val.getTime())) return new Date(val);
    if (!val) return null;

    const str = String(val).trim();
    const lower = str.toLowerCase();
    if (lower === 'today' || lower === 'now') {
      return new Date();
    }
    if (lower === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    }
    if (lower === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d;
    }

    const timestamp = Date.parse(str);
    if (!isNaN(timestamp)) {
      return new Date(timestamp);
    }

    const cleaned = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
    const cleanedTimestamp = Date.parse(cleaned);
    if (!isNaN(cleanedTimestamp)) {
      return new Date(cleanedTimestamp);
    }

    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  ConditionEvaluator.ConditionEvaluator = ConditionEvaluator;
  module.exports = ConditionEvaluator;
}
