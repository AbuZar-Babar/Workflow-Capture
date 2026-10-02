/**
 * Workflow Capture — Universal Filter Engine
 * 
 * Evaluates structured item records against user intent, mapped concepts,
 * and multi-operator conditions without relying on fragile raw-string scraping.
 * 
 * Supports:
 * - equals, contains, starts_with, ends_with
 * - before, after, between, dateBetween
 * - newer, older
 * - greater_than, less_than, greater_than_or_equal, less_than_or_equal
 * - in, not_in (multiple statuses)
 * - relative dates and date ranges
 * - compound AND/OR condition plans
 */

'use strict';

const { ConditionEvaluator } = require('./condition-evaluator');
const FieldDetector = require('./field-detector');
const IntentResolver = require('../engine/intent-resolver');

class FilterEngine {
  /**
   * Build a concrete, executable filter plan from user intent and discovered portal fields.
   *
   * @param {string|object} intentOrFilter - User prompt, intent object, or direct itemFilter
   * @param {Array<string>} availableFields - Fields discovered on the portal
   * @param {Array<object>} sampleItems - Discovered items for value inspection
   * @returns {object} Filter plan
   */
  static buildFilterPlan(intentOrFilter, availableFields = [], sampleItems = []) {
    if (!intentOrFilter) {
      return {
        isEmpty: true,
        rules: [],
        matchType: 'AND',
        limit: null
      };
    }

    // Direct modern itemFilter / compound condition object
    if (typeof intentOrFilter === 'object' && (intentOrFilter.conditions || intentOrFilter.field || intentOrFilter.column)) {
      const normalized = ConditionEvaluator.normalizeConditions(intentOrFilter);
      return {
        isEmpty: normalized.rules.length === 0,
        rules: normalized.rules,
        matchType: normalized.matchType || 'AND',
        limit: intentOrFilter.loopLimit || intentOrFilter.limit || null
      };
    }

    // Natural language prompt or conversational intent
    const parsedIntent = typeof intentOrFilter === 'string'
      ? IntentResolver.parse(intentOrFilter)
      : IntentResolver.parse(intentOrFilter?.text || intentOrFilter?.prompt || intentOrFilter);

    const { resolvedFilter } = IntentResolver.resolveAgainstPortal(parsedIntent, availableFields, sampleItems);
    const normalized = ConditionEvaluator.normalizeConditions(resolvedFilter);

    return {
      isEmpty: normalized.rules.length === 0,
      rules: normalized.rules,
      matchType: normalized.matchType || 'AND',
      limit: parsedIntent.limit,
      itemMode: parsedIntent.itemMode,
      targetEntity: parsedIntent.target
    };
  }

  /**
   * Evaluates a single item record against the filter plan.
   *
   * @param {object} item - Item object with `fields` map
   * @param {object} filterPlan - Output from buildFilterPlan()
   * @returns {{ matches: boolean, reason: string|null }}
   */
  static evaluateItem(item, filterPlan) {
    if (!filterPlan || filterPlan.isEmpty || !filterPlan.rules || filterPlan.rules.length === 0) {
      return { matches: true, reason: null };
    }

    const itemFields = item?.fields || item || {};
    return ConditionEvaluator.evaluate(itemFields, {
      matchType: filterPlan.matchType || 'AND',
      conditions: filterPlan.rules
    });
  }

  /**
   * Evaluates an array of discovered items against a filter plan, applying limit and deduplication.
   *
   * @param {Array<object>} items - Discovered collection items
   * @param {object} filterPlan - Executable filter plan
   * @param {object} [options] - Options (e.g. limit, previewLimit)
   * @returns {{
   *   totalCount: number,
   *   matchingCount: number,
   *   selectedCount: number,
   *   skippedFilterCount: number,
   *   skippedLimitCount: number,
   *   matchingItems: Array<object>,
   *   selectedItems: Array<object>,
   *   skippedItems: Array<object>,
   *   errors: Array<string>
   * }}
   */
  static evaluateItems(items = [], filterPlan = {}, options = {}) {
    if (!Array.isArray(items)) {
      return {
        totalCount: 0,
        matchingCount: 0,
        selectedCount: 0,
        skippedFilterCount: 0,
        skippedLimitCount: 0,
        matchingItems: [],
        selectedItems: [],
        skippedItems: [],
        errors: ['Items must be an array']
      };
    }

    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : (Number.isInteger(filterPlan.limit) && filterPlan.limit > 0 ? filterPlan.limit : null);

    const matchingItems = [];
    const selectedItems = [];
    const skippedItems = [];
    let skippedFilterCount = 0;
    let skippedLimitCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const evalResult = this.evaluateItem(item, filterPlan);

      if (evalResult.matches) {
        matchingItems.push(item);

        if (limit === null || selectedItems.length < limit) {
          selectedItems.push({
            ...item,
            selectionStatus: 'SELECTED',
            domIndex: i
          });
        } else {
          skippedLimitCount++;
          skippedItems.push({
            ...item,
            selectionStatus: 'SKIPPED_LIMIT',
            skipReason: `Item exceeds limit (${limit})`,
            domIndex: i
          });
        }
      } else {
        skippedFilterCount++;
        skippedItems.push({
          ...item,
          selectionStatus: 'SKIPPED_FILTER',
          skipReason: evalResult.reason || 'Did not match filter condition',
          domIndex: i
        });
      }
    }

    return {
      totalCount: items.length,
      matchingCount: matchingItems.length,
      selectedCount: selectedItems.length,
      skippedFilterCount,
      skippedLimitCount,
      matchingItems,
      selectedItems,
      skippedItems,
      errors: []
    };
  }
}

module.exports = FilterEngine;
