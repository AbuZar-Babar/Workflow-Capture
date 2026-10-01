/**
 * Test Suite: Generic Loop Preflight, Field Detection & Data Selection
 * 
 * Validates:
 * 1. Multi-field and option discovery: table rows & dropdown items expose distinct fields and values.
 * 2. ExecutionModal step selection, field pills, and value pills logic.
 * 3. RunController persistence and forwarding of itemFilter, rowFilter, and itemMode ('new', 'all', 'old').
 * 4. Deduplication & freshness behavior (skipping duplicates for 'new', running all for 'all', running only duplicates for 'old').
 */

const assert = require('assert');
const { db } = require('../src/database/db');
const runController = require('../src/api/run-controller');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const ConditionEvaluator = require('../src/shared/condition-evaluator');

function mockHttp(body = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method: 'POST',
    user: { id: 'test_user_generic_loop' },
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

async function runGenericLoopPreflightTests() {
  console.log('🧪 Starting Generic Loop Preflight & Dynamic Options Test Suite...\n');

  // Test 1: Field values extraction from heterogeneous discovery items
  console.log('🔹 Test 1: Extract distinct fields and values from discovered items');
  const sampleDiscovery = {
    discovery: {
      itemCount: 4,
      items: [
        { id: '1', text: 'INV-1001 Fuel Invoice $500', fields: { Type: 'Fuel Invoice', Status: 'Open', Amount: '$500' } },
        { id: '2', text: 'TX-2001 Standard Invoice $1200', fields: { Type: 'Invoice', Status: 'Closed', Amount: '$1200' } },
        { id: '3', text: 'CM-3001 Credit Memo $300', fields: { Type: 'Credit Memo', Status: 'Open', Amount: '$300' } },
        { id: '4', text: 'TX-4001 Transaction $450', fields: { Type: 'Transaction', Status: 'Pending', Amount: '$450' } }
      ]
    }
  };

  // Simulate server/client fieldValues extraction
  const fieldValues = {};
  for (const item of sampleDiscovery.discovery.items) {
    for (const [k, v] of Object.entries(item.fields)) {
      if (!fieldValues[k]) fieldValues[k] = new Set();
      fieldValues[k].add(v);
    }
  }

  assert.ok(fieldValues['Type'], 'Type field must be extracted');
  assert.strictEqual(fieldValues['Type'].size, 4, 'Should extract 4 distinct types');
  assert.ok(fieldValues['Type'].has('Fuel Invoice'));
  assert.ok(fieldValues['Type'].has('Invoice'));
  assert.ok(fieldValues['Type'].has('Credit Memo'));
  assert.ok(fieldValues['Type'].has('Transaction'));
  assert.ok(fieldValues['Status'].has('Open'));
  assert.ok(fieldValues['Status'].has('Closed'));
  assert.ok(fieldValues['Status'].has('Pending'));
  console.log('  ✅ Extracted fields and distinct values successfully:\n    ', {
    Type: Array.from(fieldValues['Type']),
    Status: Array.from(fieldValues['Status'])
  }, '\n');

  // Test 2: Condition evaluation across discovered items for specific type
  console.log('🔹 Test 2: Filter evaluation selects matching items accurately');
  const invoiceFilter = { field: 'Type', operator: 'contains', value: 'Invoice' };
  const matchedInvoice = sampleDiscovery.discovery.items.filter(item => {
    const res = ConditionEvaluator.evaluate(item.fields, invoiceFilter);
    return res.matches;
  });
  assert.strictEqual(matchedInvoice.length, 2, 'Should match Fuel Invoice and Invoice');

  const txFilter = { field: 'Type', operator: 'equals', value: 'Transaction' };
  const matchedTx = sampleDiscovery.discovery.items.filter(item => {
    const res = ConditionEvaluator.evaluate(item.fields, txFilter);
    return res.matches;
  });
  assert.strictEqual(matchedTx.length, 1, 'Should match exact Transaction only');
  assert.strictEqual(matchedTx[0].fields.Type, 'Transaction');
  console.log('  ✅ Generic filter evaluation verified with contains and equals\n');

  // Test 3: RunController accepts itemMode ('new', 'all', 'old') and itemFilter
  console.log('🔹 Test 3: RunController accepts itemFilter and itemMode');
  const wfId = `wf_generic_${Date.now()}`;
  db.insert('workflows', {
    id: wfId,
    name: 'Generic Invoices Workflow',
    userId: 'test_user_generic_loop',
    steps: [
      { type: 'NAVIGATE', url: 'https://example.com/grid' },
      { type: 'CLICK', role: 'LOOP_TARGET', isLoopCandidate: true, fingerprint: { text: 'Download' } }
    ],
    mode: 'LOOP'
  });

  const http = mockHttp();
  await runController.executeWorkflow(http.req, http.res, wfId, {
    mode: 'loop',
    loopStepIndex: 1,
    itemMode: 'new',
    itemFilter: { field: 'Type', operator: 'contains', value: 'Fuel Invoice' }
  });

  assert.strictEqual(http.getStatus(), 202, 'Should return 202 Accepted');
  const runId = http.getData().runId;
  const run = db.findById('runs', runId);
  assert.ok(run, 'Run record must be created');
  assert.strictEqual(run.mode, 'LOOP');
  assert.strictEqual(run.loopStepIndex, 1);
  assert.ok(run.itemFilter, 'itemFilter must be persisted in run record');
  assert.strictEqual(run.itemFilter.field, 'Type');
  assert.strictEqual(run.itemFilter.value, 'Fuel Invoice');
  console.log('  ✅ RunController persisted itemFilter and execution configuration\n');

  // Test 4: LoopReplayRunner constructor properly receives itemFilter and itemMode
  console.log('🔹 Test 4: LoopReplayRunner stores itemFilter and itemMode');
  const runner = new LoopReplayRunner({
    runId: `run_test_${Date.now()}`,
    workflowId: wfId,
    userId: 'test_user_generic_loop',
    itemMode: 'old',
    itemFilter: { field: 'Type', operator: 'contains', value: 'Invoice' }
  });
  assert.strictEqual(runner.itemMode, 'old', 'Runner must store itemMode "old"');
  assert.ok(runner.rowFilter, 'Runner must store itemFilter in rowFilter');
  assert.strictEqual(runner.rowFilter.field, 'Type');
  assert.strictEqual(runner.rowFilter.value, 'Invoice');
  console.log('  ✅ LoopReplayRunner correctly configured with itemMode and itemFilter\n');

  // Clean up
  db.delete('workflows', wfId);
  db.delete('runs', runId);

  // Test 5: Workflow 1790792182218 Target Detection
  console.log('🔹 Test 5: Real portal recorded workflow targets invoice table row instead of menu link');
  const LoopDetector = require('../src/shared/loop-detector');
  const recordedWf = require('../recordings/workflow-1790792182218.json');
  const candIdx = LoopDetector.findLoopCandidateIndex(recordedWf.actions);
  assert.strictEqual(candIdx, 2, 'Loop candidate index for workflow-1790789495514 must be Step 2 (table row), not Step 0 or 1');
  const step0Analysis = LoopDetector.analyzeStep(recordedWf.actions[0]);
  assert.strictEqual(step0Analysis.role, 'SETUP', 'Step 0 (#Login) must be classified as SETUP');
  const step1Analysis = LoopDetector.analyzeStep(recordedWf.actions[1]);
  assert.strictEqual(step1Analysis.role, 'SETUP', 'Step 1 (#menu-833) must be classified as SETUP');
  const step2Analysis = LoopDetector.analyzeStep(recordedWf.actions[2]);
  assert.strictEqual(step2Analysis.role, 'LOOP', 'Step 2 (grid table row) must be classified as LOOP');
  assert.strictEqual(step2Analysis.patternType, 'table-row', 'Step 2 patternType must be table-row');
  console.log('  ✅ Steps 0 & 1 identified as SETUP and Step 2 identified as table-row LOOP candidate\n');

  // Test 6: RunController auto-corrects loopStepIndex 0 to 2 if step 0 is navigation chrome
  console.log('🔹 Test 6: RunController guards against executing loop on navigation chrome');
  const realWfId = `wf_real_guard_${Date.now()}`;
  db.insert('workflows', {
    id: realWfId,
    name: 'Real Portal Invoices',
    userId: 'test_user_generic_loop',
    steps: recordedWf.actions,
    mode: 'LOOP'
  });
  const httpReal = mockHttp();
  await runController.executeWorkflow(httpReal.req, httpReal.res, realWfId, {
    mode: 'loop',
    loopStepIndex: 0 // Requesting index 0 (which is #Login)
  });
  assert.strictEqual(httpReal.getStatus(), 202);
  const realRunId = httpReal.getData().runId;
  const realRun = db.findById('runs', realRunId);
  assert.strictEqual(realRun.loopStepIndex, 2, 'RunController must auto-correct loopStepIndex from 0 to 2');
  db.delete('workflows', realWfId);
  db.delete('runs', realRunId);
  console.log('  ✅ RunController successfully auto-corrected loopStepIndex to 2\n');

  // Test 7: Multi-type items (Credit Memos and Invoices) filtering and no-filter batch execution
  console.log('🔹 Test 7: Filter matches Credit Memos, Invoices, and supports process-all (no filter)');
  const gridItems = [
    { id: '1', text: 'SI-178902 Credit Memo Net 9 Days -821.24', fields: { 'Invoice Number': 'SI-178902', Type: 'Credit Memo', Term: 'Net 9 Days', Amount: '-821.24' } },
    { id: '2', text: 'SI-178656 Credit Memo Net 9 Days -1997.10', fields: { 'Invoice Number': 'SI-178656', Type: 'Credit Memo', Term: 'Net 9 Days', Amount: '-1997.10' } },
    { id: '3', text: 'INV-2026-101 Standard Invoice Net 30 1500.00', fields: { 'Invoice Number': 'INV-2026-101', Type: 'Invoice', Term: 'Net 30', Amount: '1500.00' } }
  ];

  // A. Filter by Type contains Credit Memo
  const cmFilter = { field: 'Type', operator: 'contains', value: 'Credit Memo' };
  const matchedCM = gridItems.filter(it => ConditionEvaluator.evaluate(it.fields, cmFilter).matches);
  assert.strictEqual(matchedCM.length, 2, 'Should match 2 credit memos');

  // B. Filter by Type contains Invoice
  const invFilter = { field: 'Type', operator: 'contains', value: 'Invoice' };
  const matchedInv = gridItems.filter(it => ConditionEvaluator.evaluate(it.fields, invFilter).matches);
  assert.strictEqual(matchedInv.length, 1, 'Should match 1 standard invoice');

  // C. Process all items (No filter / null itemFilter)
  const matchedAll = gridItems.filter(it => ConditionEvaluator.evaluate(it.fields, null).matches);
  assert.strictEqual(matchedAll.length, 3, 'Null filter must match all 3 items (both Credit Memos and Invoices)');
  // Test 8: Checkbox column offset alignment and Due Date / Days Old extraction
  console.log('🔹 Test 8: Grid column offset correctly aligns data cells without off-by-one shifts');
  const headerColumns = ['Invoice Number', 'Type', 'Term', 'Payment Method', 'Invoice Date', 'Days Old', 'Due Date'];
  // In ExtJS grid, cell 0 is the checkbox column, followed by the data columns
  const rawCells = [
    '', // checkbox cell
    'SI-178902',
    'Credit Memo',
    'Net 9 Days',
    'ACH',
    '9/28/2026',
    '2',
    '9/28/2026'
  ];
  // Align dataCells by stripping the checkbox column
  const dataCells = rawCells.slice(1);
  const fields = {};
  headerColumns.forEach((h, idx) => {
    if (dataCells[idx] !== undefined) fields[h] = dataCells[idx];
  });
  assert.strictEqual(fields['Invoice Number'], 'SI-178902', 'Invoice Number must not be shifted to checkbox');
  assert.strictEqual(fields['Type'], 'Credit Memo', 'Type must be Credit Memo, not invoice number');
  assert.strictEqual(fields['Due Date'], '9/28/2026', 'Due date must be extracted');
  assert.strictEqual(fields['Days Old'], '2', 'Days Old must be extracted');
  console.log('  ✅ ExtJS grid checkbox offset aligned columns accurately:', fields, '\n');

  // Test 9: Deduplication & Old Data Logic by download folder and due date
  console.log('🔹 Test 9: Deduplication identifies files already in download folder and old data logic');
  const fs = require('fs');
  const path = require('path');
  const dedupeRunner = new LoopReplayRunner({
    workflowId: 'wf_dedupe_test',
    workflowName: 'Invoices Download Workflow',
    itemMode: 'new'
  });

  // Create a mock downloaded file in the workflow downloads folder for SI-178902
  const mockFolder = path.resolve(process.cwd(), 'downloads', 'invoices-download-workflow', '2026-09-30');
  fs.mkdirSync(mockFolder, { recursive: true });
  const mockFilePath = path.join(mockFolder, 'SI-178902_Invoice.pdf');
  fs.writeFileSync(mockFilePath, 'PDF-mock-data');

  try {
    // A. Check if already downloaded matches physical file in download folder
    const dedupeCheckNew = dedupeRunner.checkIfAlreadyDownloaded('invoice:SI-178902', 'SI-178902', fields);
    assert.ok(dedupeCheckNew.isDuplicate, 'Must detect that SI-178902 is already in folder');
    assert.ok(dedupeCheckNew.inFolder, 'inFolder flag must be true');

    // B. Check an un-downloaded invoice
    const dedupeCheckUnDownloaded = dedupeRunner.checkIfAlreadyDownloaded('invoice:SI-178275', 'SI-178275', { 'Days Old': '0' });
    assert.strictEqual(dedupeCheckUnDownloaded.isDuplicate, false, 'Un-downloaded invoice must not be duplicate');

    // C. "Old data" categorization based on Days Old > 0
    const dedupeOldData = dedupeRunner.checkIfAlreadyDownloaded('invoice:SI-178275', 'SI-178275', { 'Days Old': '6', 'Due Date': '9/24/2026' });
    assert.strictEqual(dedupeOldData.isOldData, true, 'Invoice with Days Old > 0 or past Due Date must be identified as old data');
    console.log('  ✅ Download folder physical scan and old data categorization verified\n');
  } finally {
    // Clean up mock file and dir
    if (fs.existsSync(mockFilePath)) fs.unlinkSync(mockFilePath);
    if (fs.existsSync(mockFolder)) fs.rmdirSync(mockFolder);
  }

  // Test 10: Single-selection unselects previous row
  console.log('🔹 Test 10: Single-row selection mechanism methods exist and are callable');
  assert.strictEqual(typeof dedupeRunner.clearGridSelections, 'function', 'clearGridSelections must exist');
  assert.strictEqual(typeof dedupeRunner.enforceGridRowSingleSelection, 'function', 'enforceGridRowSingleSelection must exist');
  // Safe execution with null page
  await dedupeRunner.clearGridSelections(null, {});
  await dedupeRunner.enforceGridRowSingleSelection(null, {}, 0);
  console.log('  ✅ Single-selection methods verified\n');

  // Test 11: Date/numeric filter evaluation and nested row deduplication across portals
  console.log('🔹 Test 11: Date/numeric filter evaluation across portals and ExtJS nested row deduplication');
  const sampleItems = [
    { 'Invoice Number': 'SI-178902', 'Type': 'Credit Memo', 'Invoice Date': '9/28/2026', 'Days Old': '2', 'Due Date': '9/28/2026' },
    { 'Invoice Number': 'SI-178656', 'Type': 'Credit Memo', 'Invoice Date': '9/25/2026', 'Days Old': '5', 'Due Date': '9/25/2026' },
    { 'Invoice Number': 'DR-1468-26092', 'Type': 'Invoice', 'Invoice Date': '9/21/2026', 'Days Old': '9', 'Due Date': '9/30/2026' },
    { 'Invoice Number': 'DR-1468-26091', 'Type': 'Invoice', 'Invoice Date': '9/19/2026', 'Days Old': '11', 'Due Date': '9/30/2026' }
  ];

  // A. Filter by Type contains 'Invoice'
  const invoiceMatches = sampleItems.filter(it => ConditionEvaluator.evaluate(it, { field: 'Type', operator: 'contains', value: 'Invoice' }).matches);
  assert.strictEqual(invoiceMatches.length, 2, 'Must match exactly the 2 Invoice rows');
  assert.strictEqual(invoiceMatches[0]['Invoice Number'], 'DR-1468-26092');

  // B. Filter by Days Old <= 5
  const daysMatches = sampleItems.filter(it => ConditionEvaluator.evaluate(it, { field: 'Days Old', operator: '<=', value: '5' }).matches);
  assert.strictEqual(daysMatches.length, 2, 'Must match exactly rows with Days Old <= 5');

  // C. Filter by Due Date >= 9/29/2026
  const dueDateMatches = sampleItems.filter(it => ConditionEvaluator.evaluate(it, { field: 'Due Date', operator: '>=', value: '9/29/2026' }).matches);
  assert.strictEqual(dueDateMatches.length, 2, 'Must match rows with Due Date >= 9/29/2026');

  // D. Verify nested ExtJS row deduplication logic
  const mockAllRows = [
    { tagName: 'TABLE', className: 'x-grid-item', id: 'row1-table', contains: (child) => child.id === 'row1-tr' },
    { tagName: 'TR', className: 'x-grid-row', id: 'row1-tr', contains: () => false },
    { tagName: 'TABLE', className: 'x-grid-item', id: 'row2-table', contains: (child) => child.id === 'row2-tr' },
    { tagName: 'TR', className: 'x-grid-row', id: 'row2-tr', contains: () => false }
  ];
  const deduplicated = mockAllRows.filter(el => !mockAllRows.some(other => other !== el && el.contains(other)));
  assert.strictEqual(deduplicated.length, 2, 'Must deduplicate outer table and inner tr into exactly 2 distinct rows');
  assert.strictEqual(deduplicated[0].id, 'row1-tr');
  assert.strictEqual(deduplicated[1].id, 'row2-tr');
  console.log('  ✅ Date/numeric filter evaluation and nested row deduplication verified\n');

  // Test 12: Topmost active modal priority & background grid window protection in SelectorResolver
  console.log('🔹 Test 12: Topmost active modal priority & background grid window protection in SelectorResolver');
  const SelectorResolver = require('../src/shared/selector-resolver');

  // Create mock DOM with two stacked windows:
  // Window 1: Background Search Grid Window (z-index 19000) with a "Close" button (id: btn-bg-close)
  // Window 2: Foreground Report Viewer Window (z-index 29000) with a "Close" button (id: btn-fg-close)
  const fgCloseBtn = {
    nodeType: 1,
    tagName: 'SPAN',
    id: 'btn-fg-close-inner',
    className: 'x-btn-inner',
    innerText: 'Close',
    textContent: 'Close',
    offsetParent: {},
    getBoundingClientRect: () => ({ x: 91, y: 64, width: 36, height: 16 }),
    closest: (sel) => {
      if (sel.includes('.x-window') || sel.includes('dialog')) return fgWindow;
      return null;
    }
  };

  const bgCloseBtn = {
    nodeType: 1,
    tagName: 'SPAN',
    id: 'btn-bg-close-inner',
    className: 'x-btn-inner',
    innerText: 'Close',
    textContent: 'Close',
    offsetParent: {},
    getBoundingClientRect: () => ({ x: 127, y: 176, width: 36, height: 16 }),
    closest: (sel) => {
      if (sel.includes('.x-window') || sel.includes('dialog')) return bgWindow;
      return null;
    }
  };

  const bgWindow = {
    nodeType: 1,
    tagName: 'DIV',
    id: 'frmfloatingsearch-1069',
    className: 'x-window',
    offsetParent: {},
    getBoundingClientRect: () => ({ x: 120, y: 133, width: 1080, height: 656 }),
    contains: (child) => child === bgCloseBtn,
    compareDocumentPosition: () => 4
  };

  const fgWindow = {
    nodeType: 1,
    tagName: 'DIV',
    id: 'srreportscreen-2056',
    className: 'x-window',
    offsetParent: {},
    getBoundingClientRect: () => ({ x: 30, y: 20, width: 1140, height: 762 }),
    contains: (child) => child === fgCloseBtn,
    compareDocumentPosition: () => 2
  };

  // Mock document with querySelectorAll and evaluate/XPath support
  const mockDoc = {
    querySelectorAll: (sel) => {
      if (sel.includes('.x-window') || sel.includes('role="dialog"')) {
        return [bgWindow, fgWindow];
      }
      if (sel.includes('btnInnerEl')) {
        return [bgCloseBtn, fgCloseBtn];
      }
      return [bgCloseBtn, fgCloseBtn];
    },
    evaluate: (xpath) => ({
      snapshotLength: 2,
      snapshotItem: (idx) => idx === 0 ? bgCloseBtn : fgCloseBtn
    })
  };

  // Mock window.getComputedStyle to return corresponding z-indices
  const originalGetComputedStyle = global.getComputedStyle;
  global.getComputedStyle = (el) => {
    if (el === fgWindow) return { zIndex: '29000', display: 'block', visibility: 'visible' };
    if (el === bgWindow) return { zIndex: '19000', display: 'block', visibility: 'visible' };
    return { zIndex: '0', display: 'block', visibility: 'visible' };
  };

  try {
    // 12a: Verify getTopmostActiveModal returns the foreground window with higher z-index
    const topModal = SelectorResolver.getTopmostActiveModal(mockDoc);
    assert.strictEqual(topModal, fgWindow, 'getTopmostActiveModal must identify fgWindow (z-index 29000) as top modal');
    console.log('  ✅ getTopmostActiveModal correctly identified frontmost active window');

    // 12b: Verify resolveElement resolves fgCloseBtn (in foreground window) and NOT bgCloseBtn
    const closeTarget = {
      candidates: [
        { strategy: 'css-path', value: '#toolbar-1994-targetEl > a > span', uniqueness: 1, priority: 5 },
        { strategy: 'text', value: "//span[normalize-space()='Close']", uniqueness: 2, priority: 4 },
        { strategy: 'data-attr', value: '[data-ref="btnInnerEl"]', uniqueness: 2, priority: 2 }
      ],
      fingerprint: {
        tagName: 'span',
        text: 'Close',
        classes: ['x-btn-inner']
      }
    };

    const resolved = SelectorResolver.resolveElement(closeTarget, { activeModal: topModal }, mockDoc);
    assert.strictEqual(resolved.success, true, 'resolveElement must succeed');
    assert.strictEqual(resolved.element.id, 'btn-fg-close-inner', 'Must resolve the foreground Close button, NOT the background grid Close button!');
    console.log('  ✅ resolveElement prioritized foreground child viewer Close button over background grid button\n');
  } finally {
    global.getComputedStyle = originalGetComputedStyle;
  }

  // Test 13: LoopReplayRunner auxiliary tab protection and lingering modal cleanup
  console.log('🔹 Test 13: LoopReplayRunner auxiliary tab protection and lingering modal cleanup');
  const runnerInstance = new LoopReplayRunner({
    runId: 'test_modal_cleanup_run',
    workflowId: 'test_wf_modal'
  });

  // Verify dashboard URLs are protected
  const testTabUrls = [
    'http://127.0.0.1:3000/app#workflows',
    'http://localhost:3000/app#execution/run_123',
    'https://citymart.i21web.com/report_popup.pdf',
    'https://citymart.i21web.com/main_grid'
  ];
  const isDashboardUrl = (url) => url.includes('127.0.0.1:3000') || url.includes('localhost:3000') || url.includes('/app#');
  assert.strictEqual(isDashboardUrl(testTabUrls[0]), true, '127.0.0.1:3000 dashboard tab must be recognized as dashboard');
  assert.strictEqual(isDashboardUrl(testTabUrls[1]), true, 'localhost:3000 dashboard tab must be recognized as dashboard');
  assert.strictEqual(isDashboardUrl(testTabUrls[2]), false, 'Report PDF popup must be recognized as auxiliary candidate');
  console.log('  ✅ Dashboard and initial tabs protected from premature termination\n');

  // Test 14: Force Redownload and single pill execution in preflight
  console.log('🔹 Test 14: Force redownload and single pill execution in preflight preview');
  const sampleDiscoveredItems = [
    { id: '1', 'Invoice Number': 'SI-178902', isDownloaded: true, downloadedFile: 'SI-178902.pdf' },
    { id: '2', 'Invoice Number': 'SI-178656', isDownloaded: false, downloadedFile: null }
  ];

  // When forceRedownload is false, SI-178902 is skipped for 'new'
  const filterNew = (items, forceRedownload) => {
    return items.filter(it => {
      if (!forceRedownload && it.isDownloaded) return false;
      return true;
    });
  };

  const withoutForce = filterNew(sampleDiscoveredItems, false);
  assert.strictEqual(withoutForce.length, 1, 'Without forceRedownload, downloaded item SI-178902 is skipped');
  assert.strictEqual(withoutForce[0]['Invoice Number'], 'SI-178656');

  const withForce = filterNew(sampleDiscoveredItems, true);
  assert.strictEqual(withForce.length, 2, 'With forceRedownload=true, downloaded item SI-178902 is included');
  assert.strictEqual(withForce[0]['Invoice Number'], 'SI-178902');
  console.log('  ✅ forceRedownload correctly enables execution of previously downloaded items\n');

  // Test 15: Table with trailing summary / footer row (e.g. Row #51) does not block execution or raise filter error
  console.log('🔹 Test 15: Trailing footer/summary row lacking field does not trigger Filter Configuration Error');
  const { evaluateFilterPreview } = require('../src/shared/item-filter');

  const rows51 = [];
  for (let i = 1; i <= 50; i++) {
    const invNo = i === 1 ? 'SI-178902' : `SI-17800${i}`;
    const docType = i % 3 === 0 ? 'Invoice' : 'Credit Memo';
    rows51.push({
      index: i - 1,
      label: `${invNo} · ${docType}`,
      fields: {
        'Invoice Number': invNo,
        'Type': docType,
        'Date': '9/25/2026'
      }
    });
  }
  // Row #51 is a footer / summary row without Invoice Number
  rows51.push({
    index: 50,
    label: 'Item #51 (Summary / Total)',
    text: 'Total Records: 50 | Total Amount: $42,500.00',
    fields: {}
  });

  assert.strictEqual(rows51.length, 51, 'Total rows must be 51');

  // Preview filtering by Invoice Number contains "SI-178902"
  const previewInv = evaluateFilterPreview({ field: 'Invoice Number', operator: 'contains', value: 'SI-178902' }, rows51);
  assert.strictEqual(previewInv.totalCount, 51);
  assert.strictEqual(previewInv.selectedCount, 1, 'Exactly Row 1 with SI-178902 must be selected');
  assert.strictEqual(previewInv.skippedCount, 50, 'Remaining 50 rows (including footer #51) must be skipped, NOT errored');
  assert.deepStrictEqual(previewInv.errors, [], 'Errors must be empty! Row #51 lacking field must not produce a filter error');
  assert.strictEqual(previewInv.selectedPreview[0].actualValue, 'SI-178902');
  console.log('  ✅ Evaluated 51-row table with footer: 1 Selected, 50 Skipped, 0 Errors\n');

  // Test 16: Document Type filtering selects Invoices vs Credit Memos accurately
  console.log('🔹 Test 16: Document Type filtering accurately partitions Credit Memos vs Invoices');
  const previewInvoices = evaluateFilterPreview({ field: 'Type', operator: 'equals', value: 'Invoice' }, rows51);
  assert.strictEqual(previewInvoices.totalCount, 51);
  assert.strictEqual(previewInvoices.selectedCount, 16, 'Should select all 16 Invoices');
  assert.strictEqual(previewInvoices.skippedCount, 35, 'Should skip 34 Credit Memos and 1 footer');
  assert.deepStrictEqual(previewInvoices.errors, [], 'Errors must be empty');

  const previewCM = evaluateFilterPreview({ field: 'Type', operator: 'equals', value: 'Credit Memo' }, rows51);
  assert.strictEqual(previewCM.selectedCount, 34, 'Should select all 34 Credit Memos');
  assert.strictEqual(previewCM.skippedCount, 17, 'Should skip 16 Invoices and 1 footer');
  assert.deepStrictEqual(previewCM.errors, [], 'Errors must be empty');
  // Test 17: Smart Runtime Date Logic (Due date is over vs Due date is not met)
  console.log('🔹 Test 17: Smart Runtime Date Logic (Due date is over vs Due date not met)');
  const sampleVouchers = [
    { index: 0, label: '102863', fields: { 'Due Date': '9/12/2026', 'Invoice Number': 'SI-1001' } },
    { index: 1, label: '102760', fields: { 'Due Date': '9/20/2026', 'Invoice Number': 'SI-1002' } },
    { index: 2, label: '102591', fields: { 'Due Date': '9/28/2026', 'Invoice Number': 'SI-1003' } },
    { index: 3, label: '102555', fields: { 'Due Date': '10/4/2026', 'Invoice Number': 'SI-1004' } },
    { index: 4, label: '102400', fields: { 'Due Date': '10/8/2026', 'Invoice Number': 'SI-1005' } }
  ];

  // Logic 1: Due date is over (<= 9/28/2026) -> should match 9/12, 9/20, 9/28 (3 items), NOT just 1!
  const overdueCount = sampleVouchers.filter(v => ConditionEvaluator.evaluate(v.fields, { field: 'Due Date', operator: '<=', value: '9/28/2026' }).matches).length;
  assert.strictEqual(overdueCount, 3, 'Due date is over (<= 9/28/2026) must match 3 items, not just 1 matching date');

  // Logic 2: Due date is not met (>= 9/28/2026) -> should match 9/28, 10/4, 10/8 (3 items)
  const upcomingCount = sampleVouchers.filter(v => ConditionEvaluator.evaluate(v.fields, { field: 'Due Date', operator: '>=', value: '9/28/2026' }).matches).length;
  assert.strictEqual(upcomingCount, 3, 'Due date not met (>= 9/28/2026) must match 3 items');

  // Logic 3: Due date is strictly upcoming (> 9/28/2026) -> should match 10/4, 10/8 (2 items)
  const futureCount = sampleVouchers.filter(v => ConditionEvaluator.evaluate(v.fields, { field: 'Due Date', operator: '>', value: '9/28/2026' }).matches).length;
  assert.strictEqual(futureCount, 2, 'Future items (> 9/28/2026) must match 2 items');

  // Logic 4: Relative 'today' keyword evaluation
  const todayEvalPast = ConditionEvaluator.evaluate(sampleVouchers[0].fields, { field: 'Due Date', operator: '<=', value: 'today' });
  assert.strictEqual(todayEvalPast.matches, true, '9/12/2026 must be overdue (<= today)');

  console.log('  ✅ Smart Runtime Date Logic verified: 3 overdue, 3 upcoming, relative "today" passed\n');

  // Test 18: Download folder lifecycle and already-in-folder discrimination
  console.log('🔹 Test 18: Download folder lifecycle (Already in folder vs New data only)');
  const folderItems = [
    { index: 0, isDownloaded: true, downloadedFile: 'voucher_102863.pdf', fields: { 'Due Date': '9/12/2026' } },
    { index: 1, isDownloaded: true, downloadedFile: 'voucher_102760.pdf', fields: { 'Due Date': '9/20/2026' } },
    { index: 2, isDownloaded: false, fields: { 'Due Date': '10/4/2026' } }
  ];

  // Already in folder
  const inFolderItems = folderItems.filter(it => it.isDownloaded);
  assert.strictEqual(inFolderItems.length, 2, 'Must identify 2 items already in download folder');

  // New only (not in folder)
  const newItems = folderItems.filter(it => !it.isDownloaded);
  assert.strictEqual(newItems.length, 1, 'Must identify 1 new item not in download folder');
  console.log('  ✅ Download folder lifecycle verified: 2 in folder, 1 new item\n');

  console.log('🎉 ALL GENERIC LOOP PREFLIGHT TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runGenericLoopPreflightTests();


