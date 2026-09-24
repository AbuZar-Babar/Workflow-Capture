/**
 * Test Suite: Generic Row Filter & Document Discrimination (Invoices vs Credit Memos)
 */

const assert = require('assert');
const { db } = require('../src/database/db');
const runController = require('../src/api/run-controller');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');

function mockHttp(body = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method: 'POST',
    user: { id: 'test_user_filter' },
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

// Mock element simulating a table row in ERP grid (e.g. iRely, DevExpress, SAP)
function createMockRowElement({ typeValue, docNumber, customer }) {
  return {
    asElement: () => ({
      evaluate: async (fn) => {
        // Mock the DOM evaluation callback inside evaluateItemFilter
        const mockDomContext = {
          innerText: `${docNumber} ${typeValue} ${customer} Download`,
          textContent: `${docNumber} ${typeValue} ${customer} Download`,
          querySelectorAll: (sel) => {
            return [
              { innerText: docNumber, textContent: docNumber },
              { innerText: typeValue, textContent: typeValue },
              { innerText: customer, textContent: customer },
              { innerText: 'Download', textContent: 'Download' }
            ];
          },
          closest: () => ({
            querySelectorAll: (sel) => {
              return [
                { innerText: 'Doc Number', textContent: 'Doc Number' },
                { innerText: 'Type', textContent: 'Type' },
                { innerText: 'Customer', textContent: 'Customer' },
                { innerText: 'Action', textContent: 'Action' }
              ];
            }
          })
        };
        return fn(mockDomContext);
      }
    }),
    dispose: async () => {}
  };
}

async function runFilterTests() {
  console.log('🧪 Starting Row Filtering & Document Discrimination Test Suite...\n');

  // Stub runner start to avoid contacting CDP during unit tests
  const origStart = LoopReplayRunner.prototype.start;
  LoopReplayRunner.prototype.start = async function() { return { success: true }; };

  // -------------------------------------------------------------
  // Test 1: RunController persists rowFilter in run record
  // -------------------------------------------------------------
  console.log('🔹 Test 1: RunController accepts and stores rowFilter parameter');
  const wfId = `wf_filter_test_${Date.now()}`;
  db.insert('workflows', {
    id: wfId,
    name: 'iRely Invoices Only Flow',
    userId: 'test_user_filter',
    steps: [
      { type: 'NAVIGATE', url: 'https://citymart.i21web.com/search-invoices' },
      { type: 'CLICK', role: 'LOOP_TARGET', fingerprint: { tagName: 'tr' } }
    ],
    loopStepIndex: 1,
    isLoop: true
  });

  const http = mockHttp();
  await runController.executeWorkflow(http.req, http.res, wfId, {
    mode: 'loop',
    isLoop: true,
    loopStepIndex: 1,
    rowFilter: {
      column: 'Type',
      value: 'Invoice'
    }
  });

  assert.strictEqual(http.getStatus(), 202);
  const runId = http.getData().runId;
  const runRecord = db.findById('runs', runId);
  assert.ok(runRecord, 'Run record should exist');
  assert.deepStrictEqual(runRecord.rowFilter, { column: 'Type', value: 'Invoice' });
  console.log('  ✅ RunController correctly persisted rowFilter\n');

  // -------------------------------------------------------------
  // Test 2: Runner initializes with rowFilter
  // -------------------------------------------------------------
  console.log('🔹 Test 2: LoopReplayRunner constructor receives rowFilter');
  const runner = new LoopReplayRunner({
    workflowId: wfId,
    runId: 'test_run_filter_1',
    rowFilter: { column: 'Type', value: 'Invoice' }
  });
  assert.deepStrictEqual(runner.rowFilter, { column: 'Type', value: 'Invoice' });
  console.log('  ✅ LoopReplayRunner correctly stored rowFilter\n');

  // -------------------------------------------------------------
  // Test 3: evaluateItemFilter correctly accepts Invoices and rejects Credit Memos
  // -------------------------------------------------------------
  console.log('🔹 Test 3: evaluateItemFilter targets Invoice column');
  
  // Mock ItemDiscovery.getItemHandle for tests
  const ItemDiscovery = require('../src/shared/item-discovery');
  const originalGetItemHandle = ItemDiscovery.getItemHandle;

  try {
    // 3a: Testing an "Invoice" row against filter { column: 'Type', value: 'Invoice' }
    const invoiceRowHandle = createMockRowElement({
      docNumber: 'SI-177926',
      typeValue: 'Invoice',
      customer: 'Metro Market'
    });
    ItemDiscovery.getItemHandle = async () => invoiceRowHandle;

    const resInvoice = await runner.evaluateItemFilter(null, {}, 0, { column: 'Type', value: 'Invoice' });
    assert.strictEqual(resInvoice.matches, true, 'Invoice row should match target "Invoice"');
    assert.strictEqual(resInvoice.column, 'type');
    assert.strictEqual(resInvoice.actualValue, 'Invoice');
    console.log('  ✅ "Invoice" row matched successfully:', resInvoice.reason);

    // 3b: Testing a "Credit Memo" row against filter { column: 'Type', value: 'Invoice' }
    const creditMemoRowHandle = createMockRowElement({
      docNumber: 'CM-004812',
      typeValue: 'Credit Memo',
      customer: 'Corner Grocer'
    });
    ItemDiscovery.getItemHandle = async () => creditMemoRowHandle;

    const resCreditMemo = await runner.evaluateItemFilter(null, {}, 1, { column: 'Type', value: 'Invoice' });
    assert.strictEqual(resCreditMemo.matches, false, 'Credit Memo row should NOT match target "Invoice"');
    assert.strictEqual(resCreditMemo.column, 'type');
    assert.strictEqual(resCreditMemo.actualValue, 'Credit Memo');
    console.log('  ✅ "Credit Memo" row skipped successfully:', resCreditMemo.reason);

    // 3c: Inverted test: user wants "Credit Memo" rows only
    const resTargetCredit = await runner.evaluateItemFilter(null, {}, 1, { column: 'Type', value: 'Credit Memo' });
    assert.strictEqual(resTargetCredit.matches, true, 'Credit Memo row should match when target is Credit Memo');
    console.log('  ✅ Dynamic switch: "Credit Memo" matched when target is Credit Memo');

    // 3d: No filter or __any__ accepts all
    const resAny = await runner.evaluateItemFilter(null, {}, 1, { column: 'Type', value: '__any__' });
    assert.strictEqual(resAny.matches, true, '__any__ must accept all rows');

    const resNone = await runner.evaluateItemFilter(null, {}, 1, null);
    assert.strictEqual(resNone.matches, true, 'null filter must accept all rows');
    console.log('  ✅ No filter / __any__ correctly accepts all rows\n');

  } finally {
    ItemDiscovery.getItemHandle = originalGetItemHandle;
  }

  // Cleanup test run & workflow
  if (db && db.state) {
    db.state.workflows = db.state.workflows.filter(w => w.id !== wfId);
    db.state.runs = db.state.runs.filter(r => r.id !== runId);
    db.save();
  }

  console.log('🎉 All Row Filter & Discrimination Tests Passed!\n');
  process.exit(0);
}

runFilterTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
