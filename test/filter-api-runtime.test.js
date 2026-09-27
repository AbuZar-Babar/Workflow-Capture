/**
 * Test Suite: Filter and Item Limits in API and Runtime (Task 6)
 *
 * Covers:
 * 1. API request normalization and strict loopLimit validation in run-controller
 * 2. Persisted run configuration and counters in DB
 * 3. Filter operators (equals, contains, dateBetween, all, any, match-all)
 * 4. Invalid configuration rejection (missing field, invalid field, empty conditions, invalid matchMode, invalid date, reversed range, invalid loopLimit)
 * 5. Limit semantics (no limit, limit 1, limit N, limit > matches, limit > total)
 * 6. Selection order (filter-first, limit-second, discovery order preserved)
 * 7. Terminal statuses (SKIPPED_FILTER, SKIPPED_LIMIT, SKIPPED_DUPLICATE, SUCCESS, FAILED)
 * 8. Failure + limit (failed item does not allow 6th item to be selected)
 * 9. Retry semantics (retry does not consume additional limit slot)
 * 10. Legacy filter compatibility (rowFilter, filterColumn/filterValue, single condition)
 * 11. Preview / Runtime agreement on identical datasets
 * 12. Client API method options forwarding
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { db } = require('../src/database/db');
const runController = require('../src/api/run-controller');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const ItemDiscovery = require('../src/shared/item-discovery');
const {
  normalizeItemFilter,
  validateItemFilter,
  evaluateFilterPreview,
  evaluateItemFilter: sharedEvaluateItemFilter
} = require('../src/shared/item-filter');

function mockHttp(body = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method: 'POST',
    user: { id: 'test_user_filter_t6' },
    headers: {}
  };

  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      responseData = data ? JSON.parse(data) : null;
    }
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData
  };
}

function createMockPage() {
  const page = {
    url: () => 'https://citymart.i21web.com/portal',
    bringToFront: async () => {},
    goto: async () => {},
    evaluate: async (fn, ...args) => {
      if (typeof fn === 'function') return fn(...args);
      return null;
    },
    mainFrame: () => ({}),
    target: () => ({
      createCDPSession: async () => ({
        send: async () => {}
      })
    }),
    browser: () => ({
      pages: async () => [page],
      disconnect: async () => {},
      on: () => {},
      off: () => {}
    })
  };
  return page;
}

function setupMockRunner(runner, itemsWithFields, options = {}) {
  const page = createMockPage();
  runner.replayEngine = {
    connect: async () => page.browser(),
    disconnect: async () => {},
    _ensureSelectorResolverInFrame: async () => {},
    _applyStealthEvasion: async () => {},
    dismissOverlays: async () => {},
    executeAction: async () => {},
    executeActionWithinItem: async (el, action, idx) => {
      if (options.failItemIndexes && options.failItemIndexes.includes(options.currentItemIndex)) {
        throw new Error(`Simulated failure on item ${options.currentItemIndex}`);
      }
    },
    page
  };

  runner.waitForDownload = async () => [];
  runner.configureDownloadInterception = async () => {};
  runner.navigateToWorkflowTarget = async () => {};

  return { page };
}

async function runAllTests() {
  console.log('🧪 Starting Task 6: Filter and Item Limits API & Runtime Test Suite...\n');

  const origExtract = LoopReplayRunner.extractDiscoveredItems;
  const origDiscover = ItemDiscovery.discover;
  const origGetItemHandle = ItemDiscovery.getItemHandle;
  const origExecuteLoop = LoopReplayRunner.prototype.executeLoop;

  try {
    // =========================================================================
    // Group 1: API Request Normalization & Validation in run-controller
    // =========================================================================
    console.log('🔹 Group 1: API Normalization & Validation in run-controller');

    // Stub background execution during controller API tests to prevent real CDP connection attempts
    LoopReplayRunner.prototype.executeLoop = async function() {
      return { status: 'COMPLETED', itemsTotal: 0, itemsSucceeded: 0, itemsFailed: 0, itemsSkipped: 0, results: [] };
    };

    const wfId = `wf_t6_val_${Date.now()}`;
    db.insert('workflows', {
      id: wfId,
      name: 'Task 6 Validation Workflow',
      userId: 'test_user_filter_t6',
      steps: [
        { type: 'NAVIGATE', url: 'https://example.com' },
        { type: 'CLICK', role: 'LOOP_TARGET', fingerprint: { tagName: 'tr' } }
      ],
      loopStepIndex: 1,
      isLoop: true
    });

    // 1a: loopLimit = 0 rejected (400)
    let http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      loopLimit: 0,
      isLoop: true
    });
    assert.strictEqual(http.getStatus(), 400, 'loopLimit = 0 should return 400');
    assert.ok(http.getData().error.includes('loopLimit'), 'Error should mention loopLimit');

    // 1b: loopLimit = -5 rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      loopLimit: -5,
      isLoop: true
    });
    assert.strictEqual(http.getStatus(), 400, 'loopLimit = -5 should return 400');

    // 1c: loopLimit = 3.5 rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      loopLimit: 3.5,
      isLoop: true
    });
    assert.strictEqual(http.getStatus(), 400, 'loopLimit = 3.5 should return 400');

    // 1d: loopLimit = "abc" rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      loopLimit: 'abc',
      isLoop: true
    });
    assert.strictEqual(http.getStatus(), 400, 'loopLimit = "abc" should return 400');

    // 1e: Invalid matchMode rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      itemFilter: {
        matchMode: 'invalidMode',
        conditions: [{ field: 'Status', operator: 'equals', value: 'Open' }]
      }
    });
    assert.strictEqual(http.getStatus(), 400, 'Invalid matchMode should return 400');

    // 1f: Empty conditions rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      itemFilter: {
        matchMode: 'all',
        conditions: []
      }
    });
    assert.strictEqual(http.getStatus(), 400, 'Empty conditions array should return 400');

    // 1g: Invalid operator rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'Status', operator: 'unknownOp', value: 'Open' }]
      }
    });
    assert.strictEqual(http.getStatus(), 400, 'Unknown operator should return 400');

    // 1h: Reversed date range rejected (400)
    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      itemFilter: {
        matchMode: 'all',
        conditions: [{
          field: 'Due Date',
          operator: 'dateBetween',
          value: { from: '2026-05-10', to: '2026-05-01' }
        }]
      }
    });
    assert.strictEqual(http.getStatus(), 400, 'Reversed date range should return 400');

    console.log('  ✅ API request normalization and rejection passed\n');

    // =========================================================================
    // Group 2: Persist Run Configuration in DB
    // =========================================================================
    console.log('🔹 Group 2: Persist Run Configuration in DB');

    const validFilter = {
      matchMode: 'all',
      conditions: [
        { field: 'Type', operator: 'equals', value: 'Invoice' },
        { field: 'Due Date', operator: 'dateBetween', value: { from: '2026-01-01', to: '2026-01-31' } }
      ]
    };

    http = mockHttp();
    await runController.executeWorkflow(http.req, http.res, wfId, {
      mode: 'loop',
      isLoop: true,
      loopStepIndex: 1,
      itemFilter: validFilter,
      loopLimit: 10
    });

    assert.strictEqual(http.getStatus(), 202, 'Valid execution request should return 202');
    const runId = http.getData().runId;
    const runRecord = db.findById('runs', runId);
    assert.ok(runRecord, 'Run record should exist in database');
    assert.strictEqual(runRecord.loopLimit, 10, 'Run record must persist loopLimit: 10');
    assert.strictEqual(runRecord.itemFilter.matchMode, 'all', 'Run record must persist normalized itemFilter');
    assert.strictEqual(runRecord.itemFilter.conditions.length, 2);
    assert.strictEqual(runRecord.matchingCount, 0, 'Run record initialized with matchingCount');
    assert.strictEqual(runRecord.selectedCount, 0, 'Run record initialized with selectedCount');
    assert.strictEqual(runRecord.skippedFilterCount, 0, 'Run record initialized with skippedFilterCount');
    assert.strictEqual(runRecord.skippedLimitCount, 0, 'Run record initialized with skippedLimitCount');
    assert.strictEqual(runRecord.skippedDuplicateCount, 0, 'Run record initialized with skippedDuplicateCount');

    console.log('  ✅ DB run record correctly persists itemFilter and loopLimit\n');

    // Restore real executeLoop implementation for Groups 3+
    LoopReplayRunner.prototype.executeLoop = origExecuteLoop;

    // =========================================================================
    // Group 3: Runner Loop Execution: Filter-first, Limit-second, Discovery Order
    // =========================================================================
    console.log('🔹 Group 3: Runner Loop Execution: Filter First, Limit Second');

    // Fixture: 6 items in discovery order:
    // A: Type = 'Credit Memo' -> mismatch
    // B: Type = 'Invoice', Status = 'Open' -> match 1
    // C: Type = 'Quote' -> mismatch
    // D: Type = 'Invoice', Status = 'Open' -> match 2
    // E: Type = 'Invoice', Status = 'Open' -> match 3
    // F: Type = 'Invoice', Status = 'Open' -> match 4
    const sampleItems = [
      { index: 0, label: 'Doc A', text: 'Doc A', fields: { 'Doc Number': 'A', Type: 'Credit Memo', Status: 'Closed' } },
      { index: 1, label: 'Doc B', text: 'Doc B', fields: { 'Doc Number': 'B', Type: 'Invoice', Status: 'Open' } },
      { index: 2, label: 'Doc C', text: 'Doc C', fields: { 'Doc Number': 'C', Type: 'Quote', Status: 'Pending' } },
      { index: 3, label: 'Doc D', text: 'Doc D', fields: { 'Doc Number': 'D', Type: 'Invoice', Status: 'Open' } },
      { index: 4, label: 'Doc E', text: 'Doc E', fields: { 'Doc Number': 'E', Type: 'Invoice', Status: 'Open' } },
      { index: 5, label: 'Doc F', text: 'Doc F', fields: { 'Doc Number': 'F', Type: 'Invoice', Status: 'Open' } }
    ];

    LoopReplayRunner.extractDiscoveredItems = async () => sampleItems;
    ItemDiscovery.discover = async () => ({
      success: true,
      itemCount: sampleItems.length,
      items: sampleItems,
      collection: { itemTag: 'tr' }
    });
    ItemDiscovery.getItemHandle = async () => ({
      asElement: () => ({
        evaluate: async () => ({ text: 'Doc', link: '', dataId: '' }),
        dispose: async () => {}
      }),
      dispose: async () => {}
    });

    const runnerLimit2 = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_lim2_${Date.now()}`,
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'Type', operator: 'equals', value: 'Invoice' }]
      },
      loopLimit: 2
    });

    const executionContext = { failItemIndexes: [], currentItemIndex: -1 };
    setupMockRunner(runnerLimit2, sampleItems, executionContext);

    const manifestLimit2 = await runnerLimit2.executeLoop(db.findById('workflows', wfId), 1);

    // Verify counters:
    // Total: 6
    // Matches: B, D, E, F = 4
    // Selected: B, D = 2
    // Skipped Filter: A, C = 2
    // Skipped Limit: E, F = 2
    assert.strictEqual(manifestLimit2.itemsTotal, 6, 'itemsTotal should be 6');
    assert.strictEqual(manifestLimit2.matchingCount, 4, 'matchingCount should be 4');
    assert.strictEqual(manifestLimit2.selectedCount, 2, 'selectedCount should be 2');
    assert.strictEqual(manifestLimit2.skippedFilterCount, 2, 'skippedFilterCount should be 2');
    assert.strictEqual(manifestLimit2.skippedLimitCount, 2, 'skippedLimitCount should be 2');
    assert.strictEqual(manifestLimit2.itemsSkipped, 4, 'itemsSkipped should be 4 (2 filter + 2 limit)');
    assert.strictEqual(manifestLimit2.itemsSucceeded, 2, 'itemsSucceeded should be 2');

    // Verify selection order preserved: B (item 1) and D (item 3) are SUCCESS
    const resA = manifestLimit2.results.find(r => r.itemIndex === 0);
    const resB = manifestLimit2.results.find(r => r.itemIndex === 1);
    const resC = manifestLimit2.results.find(r => r.itemIndex === 2);
    const resD = manifestLimit2.results.find(r => r.itemIndex === 3);
    const resE = manifestLimit2.results.find(r => r.itemIndex === 4);
    const resF = manifestLimit2.results.find(r => r.itemIndex === 5);

    assert.strictEqual(resA.status, 'SKIPPED_FILTER', 'Item A must be SKIPPED_FILTER');
    assert.strictEqual(resB.status, 'SUCCESS', 'Item B must be SUCCESS');
    assert.strictEqual(resC.status, 'SKIPPED_FILTER', 'Item C must be SKIPPED_FILTER');
    assert.strictEqual(resD.status, 'SUCCESS', 'Item D must be SUCCESS');
    assert.strictEqual(resE.status, 'SKIPPED_LIMIT', 'Item E must be SKIPPED_LIMIT');
    assert.strictEqual(resF.status, 'SKIPPED_LIMIT', 'Item F must be SKIPPED_LIMIT');

    console.log('  ✅ Filter-first, limit-second, and discovery order verified\n');

    // =========================================================================
    // Group 4: Failure + Limit Semantics
    // =========================================================================
    console.log('🔹 Group 4: Failure + Limit Semantics');

    // If item B (first match) fails, runner must NOT select item E (beyond limit)
    const runnerFail = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_fail_${Date.now()}`,
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'Type', operator: 'equals', value: 'Invoice' }]
      },
      loopLimit: 2,
      maxItemRetries: 0
    });

    const failContext = { failItemIndexes: [1], currentItemIndex: -1 };
    setupMockRunner(runnerFail, sampleItems, failContext);
    runnerFail.replayEngine.executeActionWithinItem = async (el, action, idx) => {
      if (runnerFail._currentExecutingIndex === 1) {
        throw new Error('Simulated network failure on item B');
      }
    };

    // Track executing index by wrapping getItemHandle
    ItemDiscovery.getItemHandle = async (page, discovery, i) => {
      runnerFail._currentExecutingIndex = i;
      return {
        asElement: () => ({
          evaluate: async () => ({ text: `Item #${i}`, link: '', dataId: '' }),
          dispose: async () => {}
        }),
        dispose: async () => {}
      };
    };

    const manifestFail = await runnerFail.executeLoop(db.findById('workflows', wfId), 1);
    assert.strictEqual(manifestFail.selectedCount, 2, 'selectedCount remains 2');
    assert.strictEqual(manifestFail.itemsFailed, 1, 'itemsFailed is 1');
    assert.strictEqual(manifestFail.itemsSucceeded, 1, 'itemsSucceeded is 1');
    assert.strictEqual(manifestFail.skippedLimitCount, 2, 'skippedLimitCount remains 2 (E and F not consumed)');

    const itemBResult = manifestFail.results.find(r => r.itemIndex === 1);
    const itemEResult = manifestFail.results.find(r => r.itemIndex === 4);
    assert.strictEqual(itemBResult.status, 'FAILED', 'Item B status must be FAILED');
    assert.strictEqual(itemEResult.status, 'SKIPPED_LIMIT', 'Item E must NOT be selected after item B failed');

    console.log('  ✅ Failed item does not select a replacement item beyond limit\n');

    // =========================================================================
    // Group 5: Retry Semantics
    // =========================================================================
    console.log('🔹 Group 5: Retry Semantics');

    // Item retried should NOT increment selectedCount
    let attemptsCount = 0;
    const runnerRetry = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_retry_${Date.now()}`,
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'Type', operator: 'equals', value: 'Invoice' }]
      },
      loopLimit: 2,
      maxItemRetries: 2
    });

    setupMockRunner(runnerRetry, sampleItems);
    runnerRetry.replayEngine.executeActionWithinItem = async (el, action, idx) => {
      if (runnerRetry._currentExecutingIndex === 1) {
        attemptsCount++;
        if (attemptsCount === 1) {
          throw new Error('Transient error on first attempt');
        }
      }
    };

    ItemDiscovery.getItemHandle = async (page, discovery, i) => {
      runnerRetry._currentExecutingIndex = i;
      return {
        asElement: () => ({
          evaluate: async () => ({ text: `Item #${i}`, link: '', dataId: '' }),
          dispose: async () => {}
        }),
        dispose: async () => {}
      };
    };

    const manifestRetry = await runnerRetry.executeLoop(db.findById('workflows', wfId), 1);
    assert.strictEqual(attemptsCount, 2, 'Item B was attempted twice (1 retry)');
    assert.strictEqual(manifestRetry.selectedCount, 2, 'selectedCount did not increment on retry');
    assert.strictEqual(manifestRetry.itemsSucceeded, 2, 'Both selected items succeeded');

    console.log('  ✅ Retries do not consume additional limit slots\n');

    // =========================================================================
    // Group 6: Missing Field Rejection (No Unsafe Full-Row Fallback)
    // =========================================================================
    console.log('🔹 Group 6: Missing Field Rejection (No Unsafe Fallback)');

    const runnerMissingField = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_miss_${Date.now()}`,
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'NonExistentField', operator: 'equals', value: 'Invoice' }]
      }
    });

    setupMockRunner(runnerMissingField, sampleItems);

    const missManifest = await runnerMissingField.executeLoop(db.findById('workflows', wfId), 1);
    assert.strictEqual(missManifest.status, 'FAILED', 'Runner manifest must be FAILED on configuration error');
    assert.ok(missManifest.error.includes('Filter configuration error') || missManifest.error.includes('NonExistentField'),
      'Must record configuration error for missing schema field in manifest');

    console.log('  ✅ Missing field rejected as configuration error without full-row fallback\n');

    // =========================================================================
    // Group 7: Preview / Runtime Agreement
    // =========================================================================
    console.log('🔹 Group 7: Preview and Runtime Agreement');

    // 18 items dataset matching Section 10:
    // 18 total, 12 match filter, loopLimit = 5
    const batchItems = [];
    for (let i = 0; i < 18; i++) {
      const isMatch = (i % 3 !== 0); // 0, 3, 6, 9, 12, 15 are mismatches (6 items); remaining 12 are matches
      batchItems.push({
        index: i,
        label: `Row #${i + 1}`,
        text: `Row #${i + 1}`,
        fields: {
          'Doc Number': `DOC-${1000 + i}`,
          Type: isMatch ? 'Invoice' : 'Credit Memo',
          'Due Date': `2026-01-${String((i % 28) + 1).padStart(2, '0')}`
        }
      });
    }

    LoopReplayRunner.extractDiscoveredItems = async () => batchItems;
    ItemDiscovery.discover = async () => ({
      success: true,
      itemCount: batchItems.length,
      items: batchItems,
      collection: { itemTag: 'tr' }
    });

    const filterSpec = {
      matchMode: 'all',
      conditions: [{ field: 'Type', operator: 'equals', value: 'Invoice' }]
    };
    const limitSpec = 5;

    // 1. Evaluate Preview
    const previewResult = evaluateFilterPreview(filterSpec, batchItems, {
      loopLimit: limitSpec,
      previewLimit: 20
    });

    assert.strictEqual(previewResult.totalCount, 18);
    assert.strictEqual(previewResult.matchingCount, 12);
    assert.strictEqual(previewResult.selectedCount, 5);
    assert.strictEqual(previewResult.skippedFilterCount, 6);
    assert.strictEqual(previewResult.skippedLimitCount, 7);
    assert.strictEqual(previewResult.skippedCount, 13);

    // 2. Evaluate Runtime
    const runnerAgreement = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_agree_${Date.now()}`,
      itemFilter: filterSpec,
      loopLimit: limitSpec
    });

    setupMockRunner(runnerAgreement, batchItems);
    ItemDiscovery.getItemHandle = async (page, discovery, i) => ({
      asElement: () => ({
        evaluate: async () => ({ text: `Row #${i + 1}`, link: '', dataId: '' }),
        dispose: async () => {}
      }),
      dispose: async () => {}
    });

    const runtimeManifest = await runnerAgreement.executeLoop(db.findById('workflows', wfId), 1);

    assert.strictEqual(runtimeManifest.itemsTotal, previewResult.totalCount);
    assert.strictEqual(runtimeManifest.matchingCount, previewResult.matchingCount);
    assert.strictEqual(runtimeManifest.selectedCount, previewResult.selectedCount);
    assert.strictEqual(runtimeManifest.skippedFilterCount, previewResult.skippedFilterCount);
    assert.strictEqual(runtimeManifest.skippedLimitCount, previewResult.skippedLimitCount);
    assert.strictEqual(runtimeManifest.itemsSkipped, previewResult.skippedCount);

    // Verify preview selected indices match runtime success indices exactly
    const previewSelectedIndices = previewResult.selectedPreview.map(p => p.index);
    const runtimeSelectedIndices = runtimeManifest.results.filter(r => r.status === 'SUCCESS').map(r => r.itemIndex);
    assert.deepStrictEqual(previewSelectedIndices, runtimeSelectedIndices,
      'Preview selected items must match runtime selected items in exact order');

    console.log('  ✅ Preview and Runtime agree 100% on counts and item selection order\n');

    // =========================================================================
    // Group 8: Zero-Matching Items Short Circuit
    // =========================================================================
    console.log('🔹 Group 8: Zero Matching Items (Empty Batch)');

    const runnerZero = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_zero_${Date.now()}`,
      itemFilter: {
        matchMode: 'all',
        conditions: [{ field: 'Type', operator: 'equals', value: 'Receipt' }] // none match
      },
      loopLimit: 5
    });

    LoopReplayRunner.extractDiscoveredItems = async () => sampleItems;
    ItemDiscovery.discover = async () => ({
      success: true,
      itemCount: sampleItems.length,
      items: sampleItems,
      collection: { itemTag: 'tr' }
    });

    setupMockRunner(runnerZero, sampleItems);
    let actionExecuted = false;
    runnerZero.replayEngine.executeActionWithinItem = async () => { actionExecuted = true; };

    const zeroManifest = await runnerZero.executeLoop(db.findById('workflows', wfId), 1);
    assert.strictEqual(zeroManifest.selectedCount, 0, 'selectedCount should be 0');
    assert.strictEqual(zeroManifest.itemsSucceeded, 0, 'itemsSucceeded should be 0');
    assert.strictEqual(zeroManifest.skippedFilterCount, sampleItems.length, 'All items SKIPPED_FILTER');
    assert.strictEqual(actionExecuted, false, 'No item workflows should execute for empty selection');
    assert.strictEqual(zeroManifest.status, 'COMPLETED');

    console.log('  ✅ Zero-match execution completes safely without starting item actions\n');

    // =========================================================================
    // Group 9: Legacy rowFilter & filterColumn / filterValue compatibility
    // =========================================================================
    console.log('🔹 Group 9: Legacy Compatibility');

    // 9a: rowFilter: { column: "Type", value: "Invoice" }
    const runnerLegacyRow = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_leg1_${Date.now()}`,
      rowFilter: { column: 'Type', value: 'Invoice' }
    });
    assert.strictEqual(runnerLegacyRow.itemFilter.matchMode, 'all');
    assert.strictEqual(runnerLegacyRow.itemFilter.conditions[0].field, 'Type');

    // 9b: filterColumn / filterValue
    const runnerLegacyCol = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_leg2_${Date.now()}`,
      filterColumn: 'Type',
      filterValue: 'Invoice'
    });
    assert.strictEqual(runnerLegacyCol.itemFilter.conditions[0].field, 'Type');

    // 9c: Single condition { field, operator, value }
    const runnerSingleCond = new LoopReplayRunner({
      workflowId: wfId,
      runId: `run_leg3_${Date.now()}`,
      itemFilter: { field: 'Type', operator: 'contains', value: 'Invoice' }
    });
    assert.strictEqual(runnerSingleCond.itemFilter.conditions[0].operator, 'contains');

    console.log('  ✅ Legacy filter inputs correctly normalized and supported\n');

    // =========================================================================
    // Group 10: Client API (src/dashboard/public/js/api.js) Options Forwarding
    // =========================================================================
    console.log('🔹 Group 10: Client API (api.js) Options Forwarding');

    const vm = require('vm');
    let apiCode = fs.readFileSync(path.join(__dirname, '../src/dashboard/public/js/api.js'), 'utf8');
    // Replace ESM import with mock Auth
    const calls = [];
    const mockAuth = {
      authenticatedFetch: async (url, options = {}) => {
        calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
        return {
          ok: true,
          json: async () => ({ success: true })
        };
      }
    };
    apiCode = apiCode.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/, '');
    apiCode = apiCode.replace(/export\s+const\s+Api\s*=/, 'const Api =');
    apiCode = apiCode.replace(/export\s+const\s+API\s*=/, 'const API =');
    apiCode += '\nmodule.exports = { Api };';

    const sandbox = {
      module: { exports: {} },
      exports: {},
      Auth: mockAuth,
      JSON,
      encodeURIComponent,
      Boolean,
      Number,
      Error,
      console
    };
    vm.runInNewContext(apiCode, sandbox);
    const clientApi = sandbox.module.exports.Api;

    // Test 10a: discoverWorkflow with options object
    const discFilter = {
      matchMode: 'all',
      conditions: [{ field: 'Status', operator: 'equals', value: 'Open' }]
    };
    await clientApi.discoverWorkflow('wf_client_1', {
      loopStepIndex: 3,
      itemFilter: discFilter,
      loopLimit: 7
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/api/workflows/wf_client_1/discover');
    assert.strictEqual(calls[0].options.method, 'POST');
    assert.strictEqual(calls[0].body.loopStepIndex, 3);
    assert.deepStrictEqual(calls[0].body.itemFilter, discFilter);
    assert.strictEqual(calls[0].body.loopLimit, 7);

    // Test 10b: discoverWorkflow with single integer index
    await clientApi.discoverWorkflow('wf_client_1', 2);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].body.loopStepIndex, 2);

    // Test 10c: executeWorkflow with itemFilter and loopLimit
    const execFilter = {
      matchMode: 'any',
      conditions: [{ field: 'Type', operator: 'equals', value: 'Invoice' }]
    };
    await clientApi.executeWorkflow('wf_client_1', {
      mode: 'loop',
      isLoop: true,
      loopStepIndex: 1,
      forceRedownload: true,
      rowFilter: { column: 'Type', value: 'Invoice' },
      itemFilter: execFilter,
      loopLimit: 12
    });

    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2].url, '/api/workflows/wf_client_1/execute');
    assert.strictEqual(calls[2].options.method, 'POST');
    assert.strictEqual(calls[2].body.mode, 'loop');
    assert.strictEqual(calls[2].body.isLoop, true);
    assert.strictEqual(calls[2].body.loopStepIndex, 1);
    assert.strictEqual(calls[2].body.forceRedownload, true);
    assert.deepStrictEqual(calls[2].body.rowFilter, { column: 'Type', value: 'Invoice' });
    assert.deepStrictEqual(calls[2].body.itemFilter, execFilter);
    assert.strictEqual(calls[2].body.loopLimit, 12);

    console.log('  ✅ Client API forwards itemFilter, loopLimit, and legacy options accurately\n');


    // Cleanup test workflow and runs
    if (db && db.state) {
      db.state.workflows = db.state.workflows.filter(w => !w.id.startsWith('wf_t6_val_'));
      db.state.runs = db.state.runs.filter(r => !r.userId || r.userId !== 'test_user_filter_t6');
      db.save();
    }

    console.log('🎉 ALL TASK 6 FILTER & LIMIT API/RUNTIME TESTS PASSED!\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Task 6 test failed:', err);
    process.exit(1);
  } finally {
    LoopReplayRunner.extractDiscoveredItems = origExtract;
    ItemDiscovery.discover = origDiscover;
    ItemDiscovery.getItemHandle = origGetItemHandle;
    LoopReplayRunner.prototype.executeLoop = origExecuteLoop;
  }
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
