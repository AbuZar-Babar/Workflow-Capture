/**
 * Workflow Capture — Normalized Runtime Data Contract
 * 
 * Formalizes normalized data models separating:
 * 1. WorkflowDefinition (recorded navigation knowledge & intent)
 * 2. RuntimePageState (live DOM evidence & entities)
 * 3. DiscoveredEntity & DiscoveredCollection (repeating items, tables, cards, lists)
 * 4. DiscoveredRecord & DiscoveredField (item data, provenance, confidence)
 * 5. CandidateAction (item-scoped vs page-scoped actions, locators, safety)
 * 6. UserIntent (target entity, action, conditions, limit, deduplication)
 * 7. ExecutionPlan (strategy, steps, stop conditions, recovery policy)
 * 8. ItemExecutionResult (outcome, verified downloads, diagnostics)
 */

'use strict';

/**
 * Creates a normalized WorkflowDefinition
 */
function createWorkflowDefinition(raw = {}) {
  const metadata = raw.metadata || {};
  const actions = Array.isArray(raw.actions || raw.steps) ? (raw.actions || raw.steps) : [];
  return {
    id: raw.id || metadata.recordingId || `wf_${Date.now()}`,
    name: raw.name || metadata.name || 'Workflow',
    description: raw.description || metadata.description || '',
    version: raw.version || metadata.version || '1.0.0',
    startUrl: raw.startUrl || metadata.startUrl || (actions[0]?.url || ''),
    mode: raw.mode || metadata.mode || (metadata.isLoop ? 'LOOP' : 'STANDARD'),
    isLoop: raw.isLoop ?? metadata.isLoop ?? false,
    loopStepIndex: raw.loopStepIndex ?? metadata.loopStepIndex ?? null,
    loopConfidence: raw.loopConfidence ?? metadata.loopConfidence ?? 0,
    patternType: raw.patternType ?? metadata.patternType ?? 'single-element',
    steps: actions.map((a, idx) => ({
      index: idx,
      id: a.id || `act_${idx}`,
      name: a.name || a.elementName || `Step #${idx + 1}`,
      type: (a.type || a.action || 'CLICK').toUpperCase(),
      target: a.target || a.fingerprint || {},
      value: a.value ?? null,
      url: a.url || '',
      role: a.role || (idx === raw.loopStepIndex ? 'LOOP' : 'SETUP'),
      meta: a.meta || {}
    })),
    createdAt: raw.createdAt || metadata.startedAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || metadata.completedAt || new Date().toISOString()
  };
}

/**
 * Creates a normalized RuntimePageState
 */
function createRuntimePageState(data = {}) {
  return {
    url: data.url || '',
    title: data.title || '',
    timestamp: data.timestamp || Date.now(),
    readyState: data.readyState || 'complete',
    entities: Array.isArray(data.entities) ? data.entities : [],
    navigation: {
      hasPagination: Boolean(data.navigation?.hasPagination),
      hasLoadMore: Boolean(data.navigation?.hasLoadMore),
      nextButtonSelector: data.navigation?.nextButtonSelector || null,
      pageCount: data.navigation?.pageCount || null
    },
    activeModal: data.activeModal || null,
    forms: Array.isArray(data.forms) ? data.forms : []
  };
}

/**
 * Creates a normalized DiscoveredCollection
 */
function createDiscoveredCollection(data = {}) {
  return {
    id: data.id || `col_${Date.now()}`,
    type: data.type || 'table_grid', // 'table_grid' | 'card_list' | 'list_group' | 'dropdown_options'
    name: data.name || 'Data Collection',
    itemCount: Number(data.itemCount || (data.items ? data.items.length : 0)),
    itemTag: data.itemTag || 'tr',
    ancestorTag: data.ancestorTag || 'tbody',
    ancestorSelector: data.ancestorSelector || '',
    headerColumns: Array.isArray(data.headerColumns) ? data.headerColumns : (data.columns || []),
    hasActionControls: Boolean(data.hasActionControls),
    actionType: data.actionType || null, // 'download' | 'view' | 'select' | 'checkbox'
    targetColumn: data.targetColumn || null,
    targetActionValue: data.targetActionValue || null,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.95,
    records: Array.isArray(data.records) ? data.records : (Array.isArray(data.items) ? data.items : [])
  };
}

/**
 * Creates a normalized DiscoveredRecord
 */
function createDiscoveredRecord(data = {}) {
  return {
    index: typeof data.index === 'number' ? data.index : 0,
    identity: {
      key: data.identity?.key || data.itemKey || `item_${data.index + 1}`,
      label: data.identity?.label || data.itemLabel || data.text || `Item #${data.index + 1}`,
      primaryIdentifier: data.identity?.primaryIdentifier || data.docId || null
    },
    fields: data.fields && typeof data.fields === 'object' ? data.fields : {},
    provenance: data.provenance || 'dom_extraction',
    confidence: typeof data.confidence === 'number' ? data.confidence : 1.0,
    status: {
      isDownloaded: Boolean(data.isDownloaded),
      downloadedFile: data.downloadedFile || null,
      isOldData: Boolean(data.isOldData)
    },
    rawText: data.rawText || data.text || ''
  };
}

/**
 * Creates a normalized CandidateAction
 */
function createCandidateAction(data = {}) {
  return {
    type: (data.type || 'CLICK').toUpperCase(),
    scope: data.scope || 'item', // 'item' | 'page'
    category: data.category || 'action', // 'download' | 'navigation' | 'selection' | 'form_input' | 'destructive'
    relativeSelector: data.relativeSelector || ':scope',
    globalSelector: data.globalSelector || null,
    actionValue: data.actionValue || null,
    targetColumn: data.targetColumn || null,
    isDestructive: Boolean(data.isDestructive),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.9
  };
}

/**
 * Creates a normalized UserIntent
 */
function createUserIntent(data = {}) {
  return {
    targetEntity: data.targetEntity || data.target || 'items',
    action: (data.action || 'DOWNLOAD').toUpperCase(),
    conditions: data.conditions || data.itemFilter || null,
    quantity: data.quantity || data.limit || data.maxItems || null,
    itemMode: ['new', 'old', 'all'].includes(data.itemMode) ? data.itemMode : 'new',
    paginate: Boolean(data.paginate),
    forceRedownload: Boolean(data.forceRedownload)
  };
}

/**
 * Creates a normalized ExecutionPlan
 */
function createExecutionPlan(data = {}) {
  return {
    planId: data.planId || `plan_${Date.now()}`,
    workflowId: data.workflowId || '',
    strategy: data.strategy || 'SINGLE_PAGE_COLLECTION',
    intent: createUserIntent(data.intent || {}),
    setupSteps: Array.isArray(data.setupSteps) ? data.setupSteps : [],
    itemActions: Array.isArray(data.itemActions) ? data.itemActions : [],
    pageActions: Array.isArray(data.pageActions) ? data.pageActions : [],
    deduplication: {
      enabled: data.deduplication?.enabled !== false,
      itemMode: data.deduplication?.itemMode || 'new',
      forceRedownload: Boolean(data.deduplication?.forceRedownload)
    },
    stopConditions: Array.isArray(data.stopConditions) ? data.stopConditions : [],
    recoveryPolicy: {
      maxItemRetries: data.recoveryPolicy?.maxItemRetries || 2,
      skipSetupIfCollectionVisible: data.recoveryPolicy?.skipSetupIfCollectionVisible !== false,
      waitForNavigationOnPostback: data.recoveryPolicy?.waitForNavigationOnPostback !== false
    }
  };
}

/**
 * Creates a normalized ItemExecutionResult
 */
function createItemExecutionResult(data = {}) {
  return {
    index: typeof data.index === 'number' ? data.index : 0,
    identity: data.identity || { key: `item_${data.index + 1}` },
    status: data.status || 'SUCCESS', // 'SUCCESS' | 'FAILED' | 'SKIPPED_FILTER' | 'SKIPPED_LIMIT' | 'SKIPPED_DUPLICATE'
    reason: data.reason || null,
    downloadedFiles: Array.isArray(data.downloadedFiles) ? data.downloadedFiles : [],
    actions: Array.isArray(data.actions) ? data.actions : [],
    error: data.error || null,
    timestamp: data.timestamp || Date.now()
  };
}

module.exports = {
  createWorkflowDefinition,
  createRuntimePageState,
  createDiscoveredCollection,
  createDiscoveredRecord,
  createCandidateAction,
  createUserIntent,
  createExecutionPlan,
  createItemExecutionResult
};
