/**
 * Test Suite: Backend REST API Endpoints & Auth Flow
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JsonDB } = require('../src/database/db');
const authController = require('../src/auth/auth-controller');
const workflowController = require('../src/api/workflow-controller');
const runController = require('../src/api/run-controller');
const { requireAuth } = require('../src/auth/auth-middleware');

// Helper to mock HTTP request/response
function mockHttp(method = 'GET', headers = {}) {
  let statusCode = 200;
  let responseData = null;
  let responseHeaders = {};

  const req = {
    method,
    headers: { ...headers }
  };

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      responseHeaders = hdrs;
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

async function runApiTests() {
  console.log('🧪 Starting Backend API & Endpoints Test Suite...\n');

  // 1. User Registration
  console.log('🔹 Test 1: POST /api/auth/register');
  const uniqueSuffix = Date.now();
  const testEmail = `abuzar_${uniqueSuffix}@workflowcapture.io`;
  const testUsername = `abuzar_${uniqueSuffix}`;
  const regHttp = mockHttp('POST');
  await authController.register(regHttp.req, regHttp.res, {
    username: testUsername,
    email: testEmail,
    password: 'SecurePassword123!'
  });

  assert.strictEqual(regHttp.getStatus(), 201, 'Registration should return 201');
  const regData = regHttp.getData();
  assert(regData.token, 'Should return JWT token');
  assert.strictEqual(regData.user.username, testUsername);
  const authToken = regData.token;
  console.log('  ✅ User registration passed\n');

  // 2. User Login
  console.log('🔹 Test 2: POST /api/auth/login');
  const loginHttp = mockHttp('POST');
  await authController.login(loginHttp.req, loginHttp.res, {
    email: testEmail,
    password: 'SecurePassword123!'
  });
  assert.strictEqual(loginHttp.getStatus(), 200);
  assert(loginHttp.getData().token, 'Login should return valid JWT');
  console.log('  ✅ User login passed\n');

  // 3. Protected Route Without Auth (Must be rejected)
  console.log('🔹 Test 3: Protected Route Rejection (Missing Token)');
  const unauthHttp = mockHttp('GET', {});
  const isAuthorized = requireAuth(unauthHttp.req, unauthHttp.res);
  assert.strictEqual(isAuthorized, false);
  assert.strictEqual(unauthHttp.getStatus(), 401);
  console.log('  ✅ Unauthenticated access successfully blocked\n');

  // 4. Protected Route With Valid Auth
  console.log('🔹 Test 4: Protected Route Success (Valid Token)');
  const authHttp = mockHttp('GET', { authorization: `Bearer ${authToken}` });
  const authPassed = requireAuth(authHttp.req, authHttp.res);
  assert.strictEqual(authPassed, true);
  assert(authHttp.req.user, 'req.user should be populated');
  assert.strictEqual(authHttp.req.user.email, testEmail);
  console.log('  ✅ Authenticated token extraction passed\n');

  // 5. Workflow CRUD via API
  console.log('🔹 Test 5: Workflow API (Create, List, Read, Update, Delete)');
  const createHttp = mockHttp('POST');
  createHttp.req.user = authHttp.req.user;
  workflowController.createWorkflow(createHttp.req, createHttp.res, {
    name: 'Invoice Batch Downloader',
    description: 'Auto downloads customer invoices',
    targetUrl: 'https://billing.example.com/invoices',
    steps: [
      { type: 'NAVIGATE', url: 'https://billing.example.com/invoices' },
      { type: 'CLICK', fingerprint: { tagName: 'tr', selectors: { cssPath: 'table#invoices tbody > tr:nth-child(1) td a.download' } } }
    ]
  });

  assert.strictEqual(createHttp.getStatus(), 201);
  const createdWf = createHttp.getData().workflow;
  assert(createdWf.id, 'Workflow must have an ID');

  // List workflows
  const listHttp = mockHttp('GET');
  listHttp.req.user = authHttp.req.user;
  workflowController.listWorkflows(listHttp.req, listHttp.res);
  assert.strictEqual(listHttp.getStatus(), 200);
  assert(listHttp.getData().workflows.length >= 1);

  // Update workflow
  const updateHttp = mockHttp('PUT');
  updateHttp.req.user = authHttp.req.user;
  workflowController.updateWorkflow(updateHttp.req, updateHttp.res, createdWf.id, {
    name: 'Updated Invoice Downloader'
  });
  assert.strictEqual(updateHttp.getStatus(), 200);
  assert.strictEqual(updateHttp.getData().workflow.name, 'Updated Invoice Downloader');

  // Delete workflow
  const deleteHttp = mockHttp('DELETE');
  deleteHttp.req.user = authHttp.req.user;
  workflowController.deleteWorkflow(deleteHttp.req, deleteHttp.res, createdWf.id);
  assert.strictEqual(deleteHttp.getStatus(), 200);
  console.log('  ✅ Workflow CRUD API lifecycle passed\n');

  // 6. Target URL Normalization & Resolution
  console.log('🔹 Test 6: Target URL Normalization & Resolution');
  const { resolveTargetUrl } = require('../src/utils/url-helper');
  assert.strictEqual(resolveTargetUrl('https://example.com/search'), 'https://example.com/search');
  assert.strictEqual(resolveTargetUrl('example.com'), 'https://example.com');
  assert.strictEqual(resolveTargetUrl('about:blank'), null);
  assert.strictEqual(resolveTargetUrl(''), null);
  const resolvedPortal = resolveTargetUrl('ecommerce-portal.html');
  assert(resolvedPortal && resolvedPortal.startsWith('file:///'), 'Relative html must resolve to file URL');
  console.log('  ✅ Target URL resolution passed\n');

  console.log('🎉 ALL BACKEND REST API & AUTH TESTS PASSED!\n');
}

runApiTests().catch(err => {
  console.error('❌ API Test failed:', err);
  process.exit(1);
});
