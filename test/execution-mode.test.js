/**
 * Test Suite: Execution Mode Resolution (Macro vs Loop)
 */

const assert = require('assert');
const { db } = require('../src/database/db');
const runController = require('../src/api/run-controller');
const workflowController = require('../src/api/workflow-controller');

function mockHttp(body = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method: 'POST',
    user: { id: 'test_user_exec_mode' },
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

async function runExecutionModeTests() {
  console.log('🧪 Starting Execution Mode (Macro vs Loop) Test Suite...\n');

  // Create a mock workflow with table rows (which previously would have triggered auto-loop)
  const wfId = `wf_exec_test_${Date.now()}`;
  const workflow = db.insert('workflows', {
    id: wfId,
    name: 'Invoice Download Flow',
    userId: 'test_user_exec_mode',
    steps: [
      { type: 'NAVIGATE', url: 'https://billing.example.com/invoices' },
      { type: 'CLICK', role: 'SETUP', fingerprint: { tagName: 'tr', parentTag: 'tbody', selectors: { cssPath: 'table#invoices tbody > tr:nth-child(1) td a.download' } } }
    ],
    loopStepIndex: null,
    isLoop: false,
    mode: 'STANDARD'
  });

  // Test 1: Default execution (no body params) MUST run as STANDARD macro, NOT LOOP
  console.log('🔹 Test 1: Default execution must run as STANDARD macro');
  const http1 = mockHttp();
  await runController.executeWorkflow(http1.req, http1.res, wfId, {});
  assert.strictEqual(http1.getStatus(), 202, 'Should accept execution');
  const runId1 = http1.getData().runId;
  const runRecord1 = db.findById('runs', runId1);
  assert.strictEqual(runRecord1.mode, 'STANDARD', 'Run mode must be STANDARD (macro replay)');
  assert.strictEqual(runRecord1.loopStepIndex, null, 'loopStepIndex must be null for standard macro');
  console.log('  ✅ Default execution correctly defaulted to STANDARD macro\n');

  // Test 2: Explicit single mode request MUST run as STANDARD macro
  console.log('🔹 Test 2: Explicit single mode request');
  const http2 = mockHttp();
  await runController.executeWorkflow(http2.req, http2.res, wfId, { mode: 'single', isLoop: false });
  assert.strictEqual(http2.getStatus(), 202);
  const runId2 = http2.getData().runId;
  const runRecord2 = db.findById('runs', runId2);
  assert.strictEqual(runRecord2.mode, 'STANDARD');
  console.log('  ✅ Explicit single mode confirmed\n');

  // Test 3: Explicit loop mode request MUST run as LOOP
  console.log('🔹 Test 3: Explicit loop mode request');
  const http3 = mockHttp();
  await runController.executeWorkflow(http3.req, http3.res, wfId, { mode: 'loop', isLoop: true, loopStepIndex: 1 });
  assert.strictEqual(http3.getStatus(), 202);
  const runId3 = http3.getData().runId;
  const runRecord3 = db.findById('runs', runId3);
  assert.strictEqual(runRecord3.mode, 'LOOP', 'Run mode must be LOOP');
  assert.strictEqual(runRecord3.loopStepIndex, 1, 'loopStepIndex must be set to 1');
  console.log('  ✅ Explicit loop mode confirmed\n');

  // Clean up
  db.delete('workflows', wfId);
  db.delete('runs', runId1);
  db.delete('runs', runId2);
  db.delete('runs', runId3);

  console.log('🎉 ALL EXECUTION MODE TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runExecutionModeTests();
