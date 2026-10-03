/**
 * Workflow Capture — Runtime User Intent Resolver
 * 
 * Understands user purpose from natural language prompts or structured intent
 * and deterministically maps intent concepts to live portal fields and conditions.
 * 
 * Examples:
 * - "Download invoices" -> action: 'download', target: 'invoices'
 * - "Download unpaid invoices from last month" -> action: 'download', target: 'invoices', status: 'unpaid', date: 'last month'
 * - "Export orders from last 7 days" -> action: 'export', target: 'orders', date: 'last 7 days'
 * - "Get new documents" -> action: 'download', target: 'documents', itemMode: 'new'
 */

'use strict';

const FieldDetector = require('../shared/field-detector');

class IntentResolver {
  /**
   * Parse user prompt into structured intent representation.
   *
   * @param {string|object} input - Natural language text or partial intent object
   * @returns {{
   *   target: string,
   *   action: string,
   *   conditions: Array<object>,
   *   limit: number|null,
   *   itemMode: 'new' | 'old' | 'all',
   *   rawInput: string
   * }}
   */
  static parse(input) {
    if (input && typeof input === 'object' && input.target && Array.isArray(input.conditions)) {
      return {
        target: input.target,
        action: (input.action || 'download').toLowerCase(),
        conditions: input.conditions,
        limit: input.limit || input.maxItems || null,
        itemMode: input.itemMode || 'new',
        rawInput: input.rawInput || JSON.stringify(input)
      };
    }

    const text = typeof input === 'string' ? input : (input?.text || input?.query || input?.prompt || '');
    const cleanText = text.trim();
    const lower = cleanText.toLowerCase();

    // 1. Detect Action
    let action = 'download';
    if (/export/i.test(lower)) action = 'export';
    else if (/print/i.test(lower)) action = 'print';
    else if (/view|inspect|read/i.test(lower)) action = 'view';
    else if (/click|select/i.test(lower)) action = 'click';

    // 2. Detect Target Entity
    let target = 'items';
    const targetMatch = lower.match(/\b(invoices?|orders?|transactions?|statements?|reports?|documents?|receipts?|records?|files?|products?|customers?)\b/i);
    if (targetMatch) {
      target = targetMatch[1].toLowerCase();
    }

    // 3. Detect Item Mode / Recency
    let itemMode = 'new';
    if (/\ball\b/i.test(lower) && !/\ball unpaid\b|\ball paid\b/i.test(lower)) {
      itemMode = 'all';
    } else if (/\bold\b|\barchived\b|\bprevious\b/i.test(lower)) {
      itemMode = 'old';
    }

    // 4. Detect Limit / Quantity
    let limit = null;
    const limitMatch = lower.match(/\b(?:first|top|limit|take)\s+(\d+)\b/i) || lower.match(/\b(\d+)\s+(?:invoices?|orders?|items?|records?)\b/i);
    if (limitMatch) {
      const parsed = parseInt(limitMatch[1], 10);
      if (parsed > 0) limit = parsed;
    }

    const conditions = [];

    // 5. Detect Status Concepts
    const statusTokens = [
      'unpaid', 'paid', 'partially paid', 'overdue', 'pending', 'open', 'closed',
      'draft', 'posted', 'approved', 'rejected', 'failed', 'completed', 'active', 'inactive'
    ];
    for (const token of statusTokens) {
      const regex = new RegExp(`\\b${token}\\b`, 'i');
      if (regex.test(lower)) {
        conditions.push({
          concept: 'status',
          operator: 'equals',
          value: token.charAt(0).toUpperCase() + token.slice(1),
          rawToken: token
        });
        break; // Primary status identified
      }
    }

    // 6. Detect Relative Dates (Part 13)
    const relativeDateCondition = this.parseRelativeDate(lower);
    if (relativeDateCondition) {
      conditions.push(relativeDateCondition);
    }

    return {
      target,
      action,
      conditions,
      limit,
      itemMode,
      rawInput: cleanText
    };
  }

  /**
   * Parse natural language relative dates into deterministic date conditions.
   * Supports: today, yesterday, this week, last week, this month, last month, last 7 days, last 30 days.
   *
   * @param {string} text
   * @param {Date} [referenceDate]
   * @returns {object|null}
   */
  static parseRelativeDate(text = '', referenceDate = new Date()) {
    const lower = text.toLowerCase();
    const now = new Date(referenceDate);

    const toIso = (d) => d.toISOString().slice(0, 10);

    if (/\btoday\b/i.test(lower)) {
      const todayIso = toIso(now);
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: todayIso,
        secondValue: todayIso,
        label: 'today'
      };
    }

    if (/\byesterday\b/i.test(lower)) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yIso = toIso(y);
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: yIso,
        secondValue: yIso,
        label: 'yesterday'
      };
    }

    if (/\blast\s*7\s*days\b/i.test(lower)) {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(start),
        secondValue: toIso(now),
        label: 'last 7 days'
      };
    }

    if (/\blast\s*30\s*days\b/i.test(lower)) {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(start),
        secondValue: toIso(now),
        label: 'last 30 days'
      };
    }

    if (/\blast\s*week\b/i.test(lower)) {
      const dayOfWeek = now.getDay(); // 0 is Sunday
      const prevMonday = new Date(now);
      prevMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7);
      const prevSunday = new Date(prevMonday);
      prevSunday.setDate(prevMonday.getDate() + 6);
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(prevMonday),
        secondValue: toIso(prevSunday),
        label: 'last week'
      };
    }

    if (/\bthis\s*week\b/i.test(lower)) {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(monday),
        secondValue: toIso(now),
        label: 'this week'
      };
    }

    if (/\blast\s*month\b/i.test(lower)) {
      // First day of previous month to last day of previous month
      const firstDayPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastDayPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(firstDayPrevMonth),
        secondValue: toIso(lastDayPrevMonth),
        label: 'last month'
      };
    }

    if (/\bthis\s*month\b/i.test(lower)) {
      const firstDayThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return {
        concept: 'date',
        operator: 'dateBetween',
        value: toIso(firstDayThisMonth),
        secondValue: toIso(now),
        label: 'this month'
      };
    }

    return null;
  }

  /**
   * Resolves structured intent conditions against the available fields of a discovered collection.
   *
   * @param {object} intent - Result of parse()
   * @param {Array<string>} availableFields - Fields discovered on the portal
   * @param {Array<object>} sampleItems - Discovered items for value validation
   * @returns {{
   *   resolvedFilter: object|null,
   *   unresolvedConditions: Array<object>,
   *   mappedFieldMap: object
   * }}
   */
  static resolveAgainstPortal(intent = {}, availableFields = [], sampleItems = []) {
    const conditions = Array.isArray(intent.conditions) ? intent.conditions : [];
    if (conditions.length === 0) {
      return {
        resolvedFilter: null,
        unresolvedConditions: [],
        mappedFieldMap: {}
      };
    }

    // Build sample item field dictionary
    const fieldDict = {};
    for (const f of availableFields) {
      fieldDict[f] = '';
    }
    for (const item of (sampleItems || []).slice(0, 5)) {
      for (const [k, v] of Object.entries(item.fields || {})) {
        if (!fieldDict[k] && v) fieldDict[k] = v;
      }
    }

    const resolvedRules = [];
    const unresolved = [];
    const mappedFieldMap = {};

    for (const cond of conditions) {
      const concept = cond.concept || cond.field;
      const targetField = FieldDetector.resolveFieldForConcept(fieldDict, concept);

      if (targetField) {
        mappedFieldMap[concept] = targetField;
        resolvedRules.push({
          field: targetField,
          operator: cond.operator || 'contains',
          value: cond.value,
          secondValue: cond.secondValue,
          valueTo: cond.secondValue
        });
      } else {
        unresolved.push(cond);
      }
    }

    let resolvedFilter = null;
    if (resolvedRules.length === 1) {
      resolvedFilter = resolvedRules[0];
    } else if (resolvedRules.length > 1) {
      resolvedFilter = {
        matchType: 'AND',
        matchMode: 'all',
        conditions: resolvedRules
      };
    }

    return {
      resolvedFilter,
      unresolvedConditions: unresolved,
      mappedFieldMap
    };
  }
}

module.exports = IntentResolver;
