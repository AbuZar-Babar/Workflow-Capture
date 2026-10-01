/**
 * IntentCompiler
 * 
 * Compiles (Workflow Definition + Live Page State + User Runtime Intent)
 * into an optimized, self-healing Dynamic Execution Plan.
 */

const { ConditionEvaluator } = require('../shared/condition-evaluator.js');

class IntentCompiler {
  /**
   * Compiles an execution plan from workflow, live inspection, and runtime intent.
   * 
   * @param {object} workflow - The workflow object containing recorded steps
   * @param {object} pageSummary - Summary from PageInspector
   * @param {object} rawIntent - User intent inputs (from UI or conversational query)
   * @returns {object} DynamicExecutionPlan
   */
  static compilePlan(workflow, pageSummary = {}, rawIntent = {}) {
    const planId = `plan_${Date.now()}`;
    const targetEntity = rawIntent.targetEntity || rawIntent.entity || null;
    const action = (rawIntent.action || 'DOWNLOAD').toUpperCase();
    const itemMode = ['new', 'old', 'all'].includes(rawIntent.itemMode) ? rawIntent.itemMode : 'new';
    
    // Normalize condition filters
    const filterInput = rawIntent.conditions || rawIntent.itemFilter || rawIntent.rowFilter || null;
    const normalizedConditions = ConditionEvaluator.normalizeConditions(filterInput);

    // Normalize max quantity
    const maxItemsRaw = parseInt(rawIntent.maxItems || rawIntent.quantity || rawIntent.limit, 10);
    const maxItems = Number.isInteger(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : null;

    // Determine pagination strategy
    const requestedPaginate = typeof rawIntent.paginate === 'boolean'
      ? rawIntent.paginate
      : (workflow.pagination?.enabled === true);

    const hasPaginationOnPage = pageSummary.navigation?.hasPagination === true;
    const hasLoadMoreOnPage = pageSummary.navigation?.hasLoadMore === true;

    let loopStrategy = 'STANDARD_REPLAY';
    const isLoopMode = rawIntent.mode === 'loop' || rawIntent.isLoop === true || workflow.mode === 'LOOP' || rawIntent.loopStepIndex != null;

    if (isLoopMode) {
      if (pageSummary.entities?.some(e => e.type === 'dropdown_options')) {
        loopStrategy = 'DROPDOWN_OPTION_LOOP';
      } else if (hasPaginationOnPage && requestedPaginate !== false) {
        loopStrategy = 'PAGINATED_COLLECTION';
      } else if (hasLoadMoreOnPage && requestedPaginate !== false) {
        loopStrategy = 'LOAD_MORE_COLLECTION';
      } else {
        loopStrategy = 'SINGLE_PAGE_COLLECTION';
      }
    }

    // Determine Stop Conditions
    const stopConditions = [];
    if (maxItems) {
      stopConditions.push({ type: 'MAX_ITEMS_REACHED', value: maxItems });
    }
    if (loopStrategy === 'PAGINATED_COLLECTION') {
      stopConditions.push({ type: 'PAGES_EXHAUSTED', maxPages: rawIntent.maxPages || 100 });
      stopConditions.push({ type: 'NO_NEXT_PAGE_BUTTON' });
    }
    stopConditions.push({ type: 'CONSECUTIVE_FAILURES_THRESHOLD', maxFailures: 5 });

    // Deduplication rules
    const deduplication = {
      enabled: itemMode !== 'all',
      itemMode,
      forceRedownload: rawIntent.forceRedownload === true || itemMode === 'all'
    };

    return {
      planId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      createdAt: new Date().toISOString(),
      strategy: loopStrategy,
      intent: {
        targetEntity,
        action,
        itemMode,
        maxItems,
        conditions: normalizedConditions,
        paginate: requestedPaginate
      },
      deduplication,
      stopConditions,
      recoveryPolicy: {
        maxItemRetries: 2,
        preserveModalState: true,
        reExecuteSetupOnClosedModal: true
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IntentCompiler };
}
