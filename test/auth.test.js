/**
 * Test Suite: Authentication, Token Service & DB Persistence
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JsonDB } = require('../src/database/db');
const { hashPassword, verifyPassword } = require('../src/auth/password-util');
const { signToken, verifyToken } = require('../src/auth/token-service');
const {
  requireAuth,
  isDevBypassEnabled,
  isLoopbackAddress,
  getAllowedOrigins,
  isSameOrigin,
  validateOrigin,
  handleCors
} = require('../src/auth/auth-middleware');
const { db } = require('../src/database/db');

// Helper to mock request/response for middleware testing
function mockHttp(method = 'GET', headers = {}, url = '/') {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const req = {
    method,
    url,
    headers: { ...headers }
  };

  const res = {
    setHeader(name, val) {
      responseHeaders[name.toLowerCase()] = val;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    writeHead(code, hdrs = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(hdrs)) {
        responseHeaders[k.toLowerCase()] = v;
      }
    },
    end(data) {
      responseData = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    }
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
    getHeader: (name) => responseHeaders[name.toLowerCase()],
    getHeaders: () => responseHeaders
  };
}

async function runTests() {
  console.log('🧪 Starting Authentication & Database Unit Tests...\n');

  // --- 1. Database Storage Test ---
  console.log('🔹 Test 1: JsonDB CRUD operations');
  const testDbPath = path.join(__dirname, 'test-db.json');
  const testDb = new JsonDB(testDbPath);
  testDb.reset();

  const user = testDb.insert('users', {
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'dummyhash'
  });
  assert(user.id, 'User should have generated ID');
  assert.strictEqual(user.username, 'testuser');

  const found = testDb.findOne('users', u => u.email === 'test@example.com');
  assert(found, 'Should find user by email');

  const updated = testDb.update('users', user.id, { username: 'updateduser' });
  assert.strictEqual(updated.username, 'updateduser');

  const deleted = testDb.delete('users', user.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(testDb.findById('users', user.id), null);

  // Clean test db
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  console.log('  ✅ Database CRUD passed\n');

  // --- 2. Password Hashing Test ---
  console.log('🔹 Test 2: Password Hashing & Verification');
  const password = 'SuperSecretPassword2026!';
  const hash = await hashPassword(password);
  assert(hash.includes(':'), 'Hash format should be salt:key');

  const isMatch = await verifyPassword(password, hash);
  assert.strictEqual(isMatch, true, 'Correct password must verify');

  const isWrong = await verifyPassword('WrongPassword!', hash);
  assert.strictEqual(isWrong, false, 'Incorrect password must fail');
  console.log('  ✅ Password hashing and verification passed\n');

  // --- 3. JWT Token Service Test ---
  console.log('🔹 Test 3: JWT Token Signing & Verification');
  const payload = { userId: 'usr_123', email: 'test@example.com' };
  const token = signToken(payload, 3600);
  assert(typeof token === 'string' && token.split('.').length === 3, 'JWT must have 3 parts');

  const decoded = verifyToken(token);
  assert.strictEqual(decoded.valid, true);
  assert.strictEqual(decoded.payload.userId, 'usr_123');

  // Tampered token test
  const tamperedToken = token.slice(0, -5) + 'abcde';
  const tamperedResult = verifyToken(tamperedToken);
  assert.strictEqual(tamperedResult.valid, false, 'Tampered token must fail');

  // Expired token test
  const expiredToken = signToken(payload, -10);
  const expiredResult = verifyToken(expiredToken);
  assert.strictEqual(expiredResult.valid, false, 'Expired token must fail');
  console.log('  ✅ JWT token signing & security verification passed\n');

  // --- 4. requireAuth in Secure Mode (Default) ---
  console.log('🔹 Test 4: requireAuth in Secure Mode (Default)');
  delete process.env.ALLOW_DEV_BYPASS;
  delete process.env.ENABLE_DEV_BYPASS;
  delete process.env.DEV_BYPASS;
  process.env.HOST = '127.0.0.1';

  // 4a. Tokenless request must return 401
  const tokenlessMock = mockHttp('GET');
  const tokenlessOk = requireAuth(tokenlessMock.req, tokenlessMock.res);
  assert.strictEqual(tokenlessOk, false, 'Tokenless access must be blocked in secure mode');
  assert.strictEqual(tokenlessMock.getStatus(), 401, 'Status must be 401');
  assert.strictEqual(tokenlessMock.req.user, undefined, 'No user should be attached');

  // 4b. Hardcoded dev tokens must be rejected in secure mode
  const devTokenMock = mockHttp('GET', { Authorization: 'Bearer dev-token' });
  const devTokenOk = requireAuth(devTokenMock.req, devTokenMock.res);
  assert.strictEqual(devTokenOk, false, 'dev-token must be rejected in secure mode');
  assert.strictEqual(devTokenMock.getStatus(), 401);
  assert(devTokenMock.getData().error.includes('Developer bypass tokens are disabled'));

  // 4c. Valid JWT token via Authorization header must succeed
  let testUser = db.findOne('users', u => u.email === 'testuser@flowmind.local');
  if (!testUser) {
    testUser = db.insert('users', {
      username: 'Test User',
      email: 'testuser@flowmind.local',
      passwordHash: 'dummy'
    });
  }
  const validJwt = signToken({ userId: testUser.id, email: testUser.email, username: testUser.username });
  const authHeaderMock = mockHttp('GET', { Authorization: `Bearer ${validJwt}` });
  const authHeaderOk = requireAuth(authHeaderMock.req, authHeaderMock.res);
  assert.strictEqual(authHeaderOk, true, 'Valid JWT in Authorization header must succeed');
  assert.strictEqual(authHeaderMock.req.user.id, testUser.id);

  // 4d. Valid JWT token via Cookie header must succeed
  const cookieMock = mockHttp('GET', { cookie: `other=123; token=${validJwt}; session=abc` });
  const cookieOk = requireAuth(cookieMock.req, cookieMock.res);
  assert.strictEqual(cookieOk, true, 'Valid JWT in Cookie header must succeed');
  assert.strictEqual(cookieMock.req.user.id, testUser.id);

  // 4e. Valid JWT token via query param must succeed
  const queryMock = mockHttp('GET', {}, `/api/events?token=${validJwt}`);
  const queryOk = requireAuth(queryMock.req, queryMock.res);
  assert.strictEqual(queryOk, true, 'Valid JWT in query param must succeed');
  assert.strictEqual(queryMock.req.user.id, testUser.id);
  console.log('  ✅ Secure mode requireAuth validation passed\n');

  // --- 5. Developer Bypass Opt-In Policy ---
  console.log('🔹 Test 5: Explicit Developer Bypass Opt-In');
  process.env.ALLOW_DEV_BYPASS = 'true';
  process.env.HOST = '127.0.0.1';
  assert.strictEqual(isDevBypassEnabled(), true, 'isDevBypassEnabled should be true on loopback with opt-in');

  // Tokenless request now succeeds with developer profile
  const bypassTokenless = mockHttp('GET');
  const bypassOk = requireAuth(bypassTokenless.req, bypassTokenless.res);
  assert.strictEqual(bypassOk, true, 'Tokenless request must succeed when developer bypass is enabled');
  assert(bypassTokenless.req.user, 'Developer user should be attached');
  assert(bypassTokenless.req.user.username, 'Username should be attached');
  assert(bypassTokenless.req.user.email, 'Email should be attached');

  // Dev bypass tokens succeed
  const bypassDevToken = mockHttp('GET', { Authorization: 'Bearer dev-testing-token' });
  const bypassDevTokenOk = requireAuth(bypassDevToken.req, bypassDevToken.res);
  assert.strictEqual(bypassDevTokenOk, true);
  assert.strictEqual(bypassDevToken.req.user.id, bypassTokenless.req.user.id);
  console.log('  ✅ Developer bypass opt-in policy passed\n');

  // --- 6. Security Invariant: Developer bypass refused on network interfaces ---
  console.log('🔹 Test 6: Safety Invariant — Developer Bypass Prohibited in Network Mode');
  process.env.ALLOW_DEV_BYPASS = 'true';
  process.env.HOST = '0.0.0.0';
  assert.strictEqual(isDevBypassEnabled(), false, 'isDevBypassEnabled must be FALSE if bound to 0.0.0.0');

  process.env.HOST = '192.168.1.150';
  assert.strictEqual(isDevBypassEnabled(), false, 'isDevBypassEnabled must be FALSE if bound to LAN IP');

  // Reset environment
  delete process.env.ALLOW_DEV_BYPASS;
  process.env.HOST = '127.0.0.1';
  console.log('  ✅ Developer bypass network protection passed\n');

  // --- 7. CORS Origin Validation & Headers ---
  console.log('🔹 Test 7: CORS Origin Validation');
  // 7a. No origin (direct curl/same-origin GET)
  const noOriginMock = mockHttp('GET', { host: '127.0.0.1:3000' });
  assert.strictEqual(handleCors(noOriginMock.req, noOriginMock.res), true);
  assert.strictEqual(noOriginMock.getHeader('Access-Control-Allow-Origin'), undefined, 'No CORS header for same-origin direct request');

  // 7b. Same-origin with Origin header
  const sameOriginMock = mockHttp('GET', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' });
  assert.strictEqual(handleCors(sameOriginMock.req, sameOriginMock.res), true);
  assert.strictEqual(sameOriginMock.getHeader('Access-Control-Allow-Origin'), 'http://127.0.0.1:3000');
  assert.notStrictEqual(sameOriginMock.getHeader('Access-Control-Allow-Origin'), '*', 'Wildcard CORS must NOT be used');

  // 7c. Unlisted remote origin must be rejected with 403
  const evilOriginMock = mockHttp('GET', { host: '127.0.0.1:3000', origin: 'http://malicious-website.com' });
  const evilOk = handleCors(evilOriginMock.req, evilOriginMock.res);
  assert.strictEqual(evilOk, false, 'Unlisted origin must be rejected');
  assert.strictEqual(evilOriginMock.getStatus(), 403, 'Must return 403 Forbidden');

  // 7d. OPTIONS preflight from unlisted origin must be rejected with 403
  const optionsEvilMock = mockHttp('OPTIONS', { host: '127.0.0.1:3000', origin: 'http://malicious-website.com' });
  assert.strictEqual(handleCors(optionsEvilMock.req, optionsEvilMock.res), false);
  assert.strictEqual(optionsEvilMock.getStatus(), 403);

  // 7e. Configured allowlist origin
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:4000';
  const allowedOriginMock = mockHttp('GET', { host: '127.0.0.1:3000', origin: 'http://localhost:5173' });
  assert.strictEqual(handleCors(allowedOriginMock.req, allowedOriginMock.res), true);
  assert.strictEqual(allowedOriginMock.getHeader('Access-Control-Allow-Origin'), 'http://localhost:5173');
  delete process.env.ALLOWED_ORIGINS;
  console.log('  ✅ CORS origin validation passed\n');

  console.log('🎉 ALL AUTHENTICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
