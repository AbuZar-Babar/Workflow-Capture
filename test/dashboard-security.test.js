/**
 * Test Suite: Dashboard Security & Local Mode Verification
 *
 * Verifies all subtasks and acceptance criteria for Task 1:
 * 1. Default startup binds explicitly to loopback (127.0.0.1)
 * 2. Tokenless requests to protected API & SSE endpoints receive 401 Unauthorized
 * 3. Valid JWT tokens via Authorization header, Cookie header, and query param succeed
 * 4. Developer bypass is disabled by default (rejects dummy-login & bypass tokens)
 * 5. Explicit developer bypass opt-in (ALLOW_DEV_BYPASS=true on loopback) enables bypass
 * 6. Developer bypass cannot silently become network-access mode (refused on 0.0.0.0 / external IPs)
 * 7. CORS origin handling: same-origin allowed, unlisted cross-origins rejected (403),
 *    allowlist supported, and wildcard (*) CORS is strictly absent from authenticated responses.
 */

const assert = require('assert');
const http = require('http');
const server = require('../src/dashboard/server');
const { signToken } = require('../src/auth/token-service');
const { db } = require('../src/database/db');
const { isDevBypassEnabled, isLoopbackAddress } = require('../src/auth/auth-middleware');

function makeRequest(port, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: {
        host: `127.0.0.1:${port}`,
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed,
          rawBody: data
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

function testSseConnect(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        host: `127.0.0.1:${port}`,
        ...headers
      }
    }, (res) => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers
      });
      process.nextTick(() => req.destroy());
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.end();
  });
}

async function runDashboardSecurityTests() {
  console.log('🧪 Starting Dashboard Security Verification Test Suite...\n');

  // --- Test Group 1: Bind Address & Network Safety Invariants ---
  console.log('🔹 Group 1: Bind Address & Network Mode Security Invariants');
  assert.strictEqual(server.HOST, '127.0.0.1', 'Default HOST must be 127.0.0.1 (loopback)');
  assert.strictEqual(isLoopbackAddress('127.0.0.1'), true);
  assert.strictEqual(isLoopbackAddress('localhost'), true);
  assert.strictEqual(isLoopbackAddress('::1'), true);
  assert.strictEqual(isLoopbackAddress('0.0.0.0'), false);
  assert.strictEqual(isLoopbackAddress('192.168.1.100'), false);

  // Verify that dev bypass refuses to activate on external interfaces
  process.env.ALLOW_DEV_BYPASS = 'true';
  process.env.HOST = '0.0.0.0';
  assert.strictEqual(isDevBypassEnabled(), false, 'Dev bypass must NOT activate on 0.0.0.0');

  process.env.HOST = '10.0.0.5';
  assert.strictEqual(isDevBypassEnabled(), false, 'Dev bypass must NOT activate on external IP');

  // Reset to secure default on loopback
  delete process.env.ALLOW_DEV_BYPASS;
  delete process.env.ENABLE_DEV_BYPASS;
  delete process.env.DEV_BYPASS;
  process.env.HOST = '127.0.0.1';
  assert.strictEqual(isDevBypassEnabled(), false, 'Dev bypass must be false by default');
  console.log('  ✅ Loopback default and network-mode invariants verified\n');

  // Start server on an ephemeral loopback port
  let testPort;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });
  console.log(`  🚀 Test server running on http://127.0.0.1:${testPort}\n`);

  try {
    // --- Test Group 2: Tokenless Access Protection (Secure Mode) ---
    console.log('🔹 Group 2: Tokenless Access Protection on API & SSE Endpoints');

    // Protected endpoints without tokens must return 401
    const protectedGetRoutes = [
      '/api/workflows',
      '/api/secrets',
      '/api/runs',
      '/api/runs/active',
      '/api/downloads',
      '/api/recordings',
      '/api/bot-config',
      '/api/status',
      '/api/auth/me'
    ];

    for (const route of protectedGetRoutes) {
      const res = await makeRequest(testPort, { path: route, method: 'GET' });
      assert.strictEqual(res.statusCode, 401, `GET ${route} without token must return 401 Unauthorized`);
      assert(res.data && res.data.error, `GET ${route} response must contain error field`);
      assert(!res.headers['access-control-allow-origin'] || res.headers['access-control-allow-origin'] !== '*', `GET ${route} must not send wildcard CORS`);
    }

    const protectedPostRoutes = [
      '/api/record/start',
      '/api/record/stop',
      '/api/replay/start',
      '/api/replay/stop',
      '/api/browser/launch',
      '/api/browser/open',
      '/api/test/run',
      '/api/test/human-disturbance',
      '/api/runs/stop'
    ];

    for (const route of protectedPostRoutes) {
      const res = await makeRequest(testPort, { path: route, method: 'POST', headers: { 'content-type': 'application/json' } }, {});
      assert.strictEqual(res.statusCode, 401, `POST ${route} without token must return 401 Unauthorized`);
      assert(res.data && res.data.error, `POST ${route} response must contain error field`);
    }

    // Tokenless SSE stream (/api/events) must return 401
    const sseUnauth = await makeRequest(testPort, { path: '/api/events', method: 'GET' });
    assert.strictEqual(sseUnauth.statusCode, 401, 'GET /api/events without token must return 401');
    assert.notStrictEqual(sseUnauth.headers['access-control-allow-origin'], '*', 'SSE must not emit wildcard CORS');

    console.log('  ✅ All protected endpoints strictly reject tokenless access\n');

    // --- Test Group 3: Hardcoded Bypass Tokens & Dummy Login Gating ---
    console.log('🔹 Group 3: Hardcoded Bypass Tokens & Dummy Login in Secure Mode');

    // Fake/bypass tokens must be rejected
    const devTokenRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: { authorization: 'Bearer dev-token' }
    });
    assert.strictEqual(devTokenRes.statusCode, 401, 'Bearer dev-token must be rejected in secure mode');

    const devTestingTokenRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: { authorization: 'Bearer dev-testing-token' }
    });
    assert.strictEqual(devTestingTokenRes.statusCode, 401, 'Bearer dev-testing-token must be rejected in secure mode');

    // POST /api/auth/dummy-login must return 403 in secure mode
    const dummyLoginRes = await makeRequest(testPort, {
      path: '/api/auth/dummy-login',
      method: 'POST'
    });
    assert.strictEqual(dummyLoginRes.statusCode, 403, 'Dummy login must return 403 Forbidden in secure mode');
    console.log('  ✅ Hardcoded tokens and dummy login properly blocked in secure mode\n');

    // --- Test Group 4: Standard Authentication Flow (Register, Login, Me, Logout) ---
    console.log('🔹 Group 4: Standard Authenticated User Flow');
    const uniqueTs = Date.now();
    const testUsername = `sec_user_${uniqueTs}`;
    const testEmail = `sec_${uniqueTs}@workflowcapture.local`;
    const testPass = 'SecureTesting2026!';

    // 1. Register new user
    const regRes = await makeRequest(testPort, {
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, { username: testUsername, email: testEmail, password: testPass });

    assert.strictEqual(regRes.statusCode, 201, 'Registration should return 201');
    assert(regRes.data.token, 'Registration should return signed token');
    assert(regRes.headers['set-cookie'], 'Registration should set auth cookie');
    const userToken = regRes.data.token;

    // 2. Login with registered user
    const loginRes = await makeRequest(testPort, {
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, { email: testEmail, password: testPass });

    assert.strictEqual(loginRes.statusCode, 200, 'Login should return 200');
    assert(loginRes.data.token, 'Login should return token');
    assert(loginRes.headers['set-cookie'], 'Login should return Set-Cookie header');

    // 3. Access protected route with Bearer token
    const authMeRes = await makeRequest(testPort, {
      path: '/api/auth/me',
      method: 'GET',
      headers: { authorization: `Bearer ${userToken}` }
    });
    assert.strictEqual(authMeRes.statusCode, 200, 'GET /api/auth/me with Bearer token must succeed');
    assert.strictEqual(authMeRes.data.user.email, testEmail);

    const workflowsRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: { authorization: `Bearer ${userToken}` }
    });
    assert.strictEqual(workflowsRes.statusCode, 200, 'GET /api/workflows with Bearer token must succeed');

    // 4. Access protected route with Cookie header
    const cookieWfRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: { cookie: `token=${userToken}` }
    });
    assert.strictEqual(cookieWfRes.statusCode, 200, 'GET /api/workflows with cookie must succeed');

    // 5. Access SSE stream with HttpOnly cookie succeeds
    const cookieSseRes = await testSseConnect(testPort, '/api/events', { cookie: `token=${userToken}` });
    assert.strictEqual(cookieSseRes.statusCode, 200, 'GET /api/events with auth cookie must succeed (200)');
    assert.strictEqual(cookieSseRes.headers['content-type'], 'text/event-stream');
    assert.notStrictEqual(cookieSseRes.headers['access-control-allow-origin'], '*', 'SSE must not emit wildcard CORS');

    // 6. Access SSE stream with query parameter ?token= without cookie/header must be rejected (401)
    const querySseRes = await testSseConnect(testPort, `/api/events?token=${userToken}`);
    assert.strictEqual(querySseRes.statusCode, 401, 'GET /api/events with query token must be rejected (401)');

    // 7. Logout clears cookie
    const logoutRes = await makeRequest(testPort, {
      path: '/api/auth/logout',
      method: 'POST'
    });
    assert.strictEqual(logoutRes.statusCode, 200, 'Logout should succeed');
    assert(logoutRes.headers['set-cookie'].some(c => c.includes('Expires=')), 'Logout must expire cookie');

    console.log('  ✅ Standard registration, login, cookie, and SSE-cookie flows verified (query tokens rejected)\n');

    // --- Test Group 5: Explicit Developer Bypass Mode ---
    console.log('🔹 Group 5: Explicit Developer Bypass Mode (ALLOW_DEV_BYPASS=true)');
    process.env.ALLOW_DEV_BYPASS = 'true';
    process.env.HOST = '127.0.0.1';

    // 1. In dev bypass mode, tokenless requests succeed
    const devTokenlessRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET'
    });
    assert.strictEqual(devTokenlessRes.statusCode, 200, 'Tokenless /api/workflows must succeed with dev bypass');

    // 2. Dev bypass tokens succeed
    const devBypassTokenRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: { authorization: 'Bearer dev-testing-token' }
    });
    assert.strictEqual(devBypassTokenRes.statusCode, 200, 'dev-testing-token must succeed with dev bypass');

    // 3. Dummy login succeeds in dev bypass mode
    const devDummyLoginRes = await makeRequest(testPort, {
      path: '/api/auth/dummy-login',
      method: 'POST'
    });
    assert.strictEqual(devDummyLoginRes.statusCode, 200, 'Dummy login must succeed in dev bypass mode');
    assert(devDummyLoginRes.data.token, 'Dummy login should return valid token');

    // Reset back to secure default
    delete process.env.ALLOW_DEV_BYPASS;
    console.log('  ✅ Developer bypass opt-in behavior verified\n');

    // --- Test Group 6: CORS Origin Enforcement & Wildcard Removal ---
    console.log('🔹 Group 6: CORS Policy & Wildcard Elimination');

    // 1. Same-origin request: origin matches host
    const sameOriginRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: {
        authorization: `Bearer ${userToken}`,
        origin: `http://127.0.0.1:${testPort}`
      }
    });
    assert.strictEqual(sameOriginRes.statusCode, 200);
    assert.strictEqual(sameOriginRes.headers['access-control-allow-origin'], `http://127.0.0.1:${testPort}`);
    assert.strictEqual(sameOriginRes.headers['vary'], 'Origin');
    assert.notStrictEqual(sameOriginRes.headers['access-control-allow-origin'], '*', 'No wildcard CORS for same-origin');

    // 2. Remote / unlisted origin rejected with 403 Forbidden
    const unlistedOriginRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: {
        authorization: `Bearer ${userToken}`,
        origin: 'http://malicious-website.com'
      }
    });
    assert.strictEqual(unlistedOriginRes.statusCode, 403, 'Unlisted cross-origin must be rejected with 403 Forbidden');
    assert(unlistedOriginRes.data.error.includes('Cross-origin request from unlisted origin'));

    // 3. Preflight OPTIONS from unlisted origin rejected with 403
    const unlistedPreflightRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'OPTIONS',
      headers: {
        origin: 'http://attacker-site.org',
        'access-control-request-method': 'POST'
      }
    });
    assert.strictEqual(unlistedPreflightRes.statusCode, 403, 'Preflight from unlisted origin must be rejected with 403');

    // 4. Allowed cross-origin via ALLOWED_ORIGINS allowlist
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://external-partner.local';

    // Preflight for allowed origin
    const allowedPreflightRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET'
      }
    });
    assert.strictEqual(allowedPreflightRes.statusCode, 204, 'Preflight for allowed origin must return 204');
    assert.strictEqual(allowedPreflightRes.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.notStrictEqual(allowedPreflightRes.headers['access-control-allow-origin'], '*');

    // Request from allowed origin
    const allowedOriginRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: {
        authorization: `Bearer ${userToken}`,
        origin: 'http://localhost:5173'
      }
    });
    assert.strictEqual(allowedOriginRes.statusCode, 200);
    assert.strictEqual(allowedOriginRes.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.notStrictEqual(allowedOriginRes.headers['access-control-allow-origin'], '*');

    // Request from still-unlisted origin must still fail
    const stillUnlistedRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: {
        authorization: `Bearer ${userToken}`,
        origin: 'http://not-in-allowlist.net'
      }
    });
    assert.strictEqual(stillUnlistedRes.statusCode, 403);

    // 5. Regression check: Host matches but protocol differs (https origin against http server)
    const protoMismatchRes = await makeRequest(testPort, {
      path: '/api/workflows',
      method: 'GET',
      headers: {
        authorization: `Bearer ${userToken}`,
        origin: `https://127.0.0.1:${testPort}`
      }
    });
    assert.strictEqual(protoMismatchRes.statusCode, 403, 'Cross-protocol origin (https vs http) must be rejected with 403 Forbidden even if host matches');
    assert(protoMismatchRes.data.error.includes('Cross-origin request from unlisted origin'));

    delete process.env.ALLOWED_ORIGINS;
    console.log('  ✅ Strict CORS and allowlist enforcement verified\n');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('  🛑 Test server closed successfully\n');
  }

  // --- Test Group 7: EADDRINUSE Fallback Port Retry in startServer ---
  console.log('🔹 Group 7: EADDRINUSE Fallback Port Retry in startServer');
  const dummyServer = http.createServer((_, res) => res.end('dummy'));
  const busyPort = await new Promise((resolve) => {
    dummyServer.listen(0, '127.0.0.1', () => {
      resolve(dummyServer.address().port);
    });
  });

  try {
    const startedServer = await server.startServer(busyPort, '127.0.0.1');
    const assignedPort = startedServer.address().port;
    assert.strictEqual(typeof assignedPort, 'number');
    assert.notStrictEqual(assignedPort, busyPort, 'Server must not bind to busy port');
    assert(assignedPort >= busyPort + 1, 'Server must retry and bind to fallback port >= busyPort + 1');
    await new Promise((resolve) => startedServer.close(resolve));
    console.log('  ✅ Fallback port retry on EADDRINUSE completed successfully without rejecting\n');
  } finally {
    await new Promise((resolve) => dummyServer.close(resolve));
  }

  console.log('🎉 ALL DASHBOARD SECURITY VERIFICATION TESTS PASSED!\n');
}

runDashboardSecurityTests().catch((err) => {
  console.error('❌ Security tests failed with error:', err);
  process.exit(1);
});
