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

  // 4e. Query param JWT token (?token=...) is strictly disallowed to prevent credential exposure in logs
  const queryMock = mockHttp('GET', {}, `/api/events?token=${validJwt}`);
  const queryOk = requireAuth(queryMock.req, queryMock.res);
  assert.strictEqual(queryOk, false, 'JWT in query param must be rejected');
  assert.strictEqual(queryMock.getStatus(), 401, 'Status must be 401');
  assert(queryMock.getData().error.includes('Missing authentication token'), 'Query tokens should not be extracted');
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

  // 7f. Regression check: Host matches but protocol differs (https origin against http server)
  const protoMismatchMock = mockHttp('GET', { host: '127.0.0.1:3000', origin: 'https://127.0.0.1:3000' });
  const protoMismatchOk = handleCors(protoMismatchMock.req, protoMismatchMock.res);
  assert.strictEqual(protoMismatchOk, false, 'Origin with mismatched protocol must be rejected');
  assert.strictEqual(protoMismatchMock.getStatus(), 403, 'Must return 403 Forbidden when protocol differs');

  // Direct isSameOrigin protocol discrimination checks
  assert.strictEqual(isSameOrigin('https://127.0.0.1:3000', '127.0.0.1:3000', 'http'), false, 'isSameOrigin must return false when protocol differs');
  assert.strictEqual(isSameOrigin('http://127.0.0.1:3000', '127.0.0.1:3000', 'http'), true, 'isSameOrigin must return true when protocol and host match');
  assert.strictEqual(isSameOrigin('http://127.0.0.1:3000', '127.0.0.1:3000', 'https'), false, 'isSameOrigin must return false when server is https and origin is http');
  assert.strictEqual(isSameOrigin('https://127.0.0.1:3000', '127.0.0.1:3000', 'https'), true, 'isSameOrigin must return true when both are https');
  console.log('  ✅ CORS origin validation passed\n');

  // --- 8. Client-Side Auth Module (src/dashboard/public/js/auth.js) ---
  console.log('🔹 Test 8: Client-Side Auth State Management');
  const authModulePath = path.join(__dirname, '..', 'src', 'dashboard', 'public', 'js', 'auth.js');
  const authCode = fs.readFileSync(authModulePath, 'utf8');

  function createClientAuthMock() {
    const storage = new Map();
    const mockLocalStorage = {
      getItem: (k) => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear()
    };

    const dispatchedEvents = [];
    const mockWindow = {
      dispatchEvent: (event) => {
        dispatchedEvents.push(event);
      }
    };

    class MockCustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    }

    let lastFetchCall = null;
    let mockFetchResponse = { status: 200, ok: true, json: async () => ({}) };
    const mockFetch = async (url, options) => {
      lastFetchCall = { url, options };
      return mockFetchResponse;
    };

    const evaluator = new Function(
      'localStorage', 'fetch', 'window', 'CustomEvent',
      authCode.replace('export const Auth =', 'const Auth =') + '\nreturn Auth;'
    );

    const clientAuth = evaluator(mockLocalStorage, mockFetch, mockWindow, MockCustomEvent);

    return {
      auth: clientAuth,
      storage,
      dispatchedEvents,
      getLastFetchCall: () => lastFetchCall,
      setFetchResponse: (res) => { mockFetchResponse = res; }
    };
  }

  // 8a. Initial state must have NO fallback developer token and isLoggedIn must be false
  const env1 = createClientAuthMock();
  assert.strictEqual(env1.auth.getToken(), null, 'Default getToken() must be null');
  assert.strictEqual(env1.auth.getUser(), null, 'Default getUser() must be null');
  assert.strictEqual(env1.auth.isLoggedIn(), false, 'Default isLoggedIn() must be false');

  // 8b. setAuth stores real token and user
  env1.auth.setAuth('real-jwt-token-xyz', { id: 'u1', username: 'TestUser', email: 'test@example.com' });
  assert.strictEqual(env1.auth.getToken(), 'real-jwt-token-xyz');
  assert.strictEqual(env1.auth.getUser().username, 'TestUser');
  assert.strictEqual(env1.auth.isLoggedIn(), true, 'isLoggedIn() must be true when token is present');

  // 8c. clearAuth removes token and user and does NOT restore fake dev token
  env1.auth.clearAuth();
  assert.strictEqual(env1.auth.getToken(), null, 'clearAuth() must leave token as null');
  assert.strictEqual(env1.auth.getUser(), null, 'clearAuth() must leave user as null');
  assert.strictEqual(env1.auth.isLoggedIn(), false, 'clearAuth() must leave isLoggedIn() as false');

  // 8d. authenticatedFetch attaches Bearer token when logged in
  env1.auth.setAuth('jwt-token-456', { id: 'u2' });
  await env1.auth.authenticatedFetch('/api/test');
  const fetchCall1 = env1.getLastFetchCall();
  assert.strictEqual(fetchCall1.options.headers['Authorization'], 'Bearer jwt-token-456');

  // 8e. authenticatedFetch does NOT attach Authorization when token is null
  env1.auth.clearAuth();
  await env1.auth.authenticatedFetch('/api/test');
  const fetchCall2 = env1.getLastFetchCall();
  assert.strictEqual(fetchCall2.options.headers['Authorization'], undefined);

  // 8f. authenticatedFetch on 401 clears auth and dispatches auth:logout
  env1.auth.setAuth('expired-jwt', { id: 'u3' });
  env1.setFetchResponse({ status: 401, ok: false });
  await env1.auth.authenticatedFetch('/api/protected');
  assert.strictEqual(env1.auth.getToken(), null, '401 response must trigger clearAuth');
  assert.strictEqual(env1.dispatchedEvents.length, 1);
  assert.strictEqual(env1.dispatchedEvents[0].type, 'auth:logout');

  // 8g. authenticatedFetch on 401 from /api/auth/me does NOT recursively dispatch auth:logout
  env1.auth.setAuth('check-jwt', { id: 'u4' });
  env1.dispatchedEvents.length = 0;
  env1.setFetchResponse({ status: 401, ok: false });
  await env1.auth.authenticatedFetch('/api/auth/me');
  assert.strictEqual(env1.dispatchedEvents.length, 0, '401 on /api/auth/me should not dispatch auth:logout');

  console.log('  ✅ Client-side Auth state management passed\n');

  // --- 9. AuthView UI Flow & Lifecycle Validation ---
  console.log('🔹 Test 9: AuthView UI Flow & Lifecycle Validation');
  const authViewPath = path.join(__dirname, '..', 'src', 'dashboard', 'public', 'js', 'views', 'authView.js');
  const authViewCode = fs.readFileSync(authViewPath, 'utf8');

  function createAuthViewHarness(serverConfig = { allowDevBypass: false }) {
    const domElements = new Map();
    function createMockElement(id, initialDisplay = '') {
      const classes = new Set();
      const style = {
        display: initialDisplay,
        setProperty: (k, v) => { style[k] = v; },
        removeProperty: (k) => { delete style[k]; }
      };
      const attrs = new Map();
      const el = {
        id,
        style,
        value: '',
        disabled: false,
        innerText: '',
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c)
        },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
        getAttribute: (k) => attrs.get(k)
      };
      domElements.set(id, el);
      return el;
    }

    const overlay = createMockElement('authOverlay');
    const form = createMockElement('authForm');
    const toggleModeBtn = createMockElement('authToggleMode');
    const toggleModeText = createMockElement('authToggleText');
    const subtitle = createMockElement('authSubtitle');
    const submitBtn = createMockElement('authSubmitBtn');
    const usernameGroup = createMockElement('usernameGroup', 'none');
    const usernameInput = createMockElement('authUsername');
    const emailInput = createMockElement('authEmail');
    const passwordInput = createMockElement('authPassword');
    const logoutBtn = createMockElement('btnLogout', 'none');
    const dummyLoginBtn = createMockElement('btnDummyLogin');

    const mockDocument = {
      getElementById: (id) => domElements.get(id) || null
    };

    const toasts = [];
    const mockToast = {
      show: (msg, type) => toasts.push({ msg, type })
    };

    const clientAuthMock = createClientAuthMock();

    let dummyLoginCalls = 0;
    const mockApi = {
      login: async (email, password) => {
        if (password === 'ValidPass123!') {
          return { success: true, token: 'user-token-123', user: { id: 'u1', email } };
        }
        throw new Error('Invalid email/username or password');
      },
      signup: async (username, email, password) => {
        return { success: true, token: 'new-user-token', user: { id: 'u2', username, email } };
      },
      dummyLogin: async () => {
        dummyLoginCalls++;
        if (serverConfig.allowDevBypass) {
          return { success: true, token: 'dev-token-bypass', user: { id: 'dev1', username: 'Dev' } };
        }
        throw new Error('Forbidden: Developer dummy login is disabled in secure mode');
      },
      logout: async () => {
        return { success: true };
      }
    };

    const mockWindow = {
      quickEnterDashboard: null,
      dispatchEvent: (e) => clientAuthMock.dispatchedEvents.push(e),
      addEventListener: () => {}
    };

    const cleanedCode = authViewCode
      .replace(/import\s+[\s\S]*?;/g, '')
      .replace('export const AuthView =', 'const AuthView =') + '\nreturn AuthView;';

    const evaluator = new Function(
      'Auth', 'Api', 'Toast', 'document', 'window', 'CustomEvent',
      cleanedCode
    );

    const authView = evaluator(
      clientAuthMock.auth,
      mockApi,
      mockToast,
      mockDocument,
      mockWindow,
      class MockCustomEvent { constructor(t, init) { this.type = t; this.detail = init && init.detail; } }
    );

    return {
      authView,
      overlay,
      form,
      submitBtn,
      emailInput,
      passwordInput,
      usernameInput,
      logoutBtn,
      dummyLoginBtn,
      toasts,
      clientAuth: clientAuthMock.auth,
      setFetchResponse: clientAuthMock.setFetchResponse,
      getDummyLoginCalls: () => dummyLoginCalls,
      windowObj: mockWindow
    };
  }

  // 9a. Startup unauthenticated check: overlay is visible, logout button is hidden
  const hUnauth = createAuthViewHarness({ allowDevBypass: false });
  hUnauth.setFetchResponse({ status: 401, ok: false });
  hUnauth.authView.init();
  await hUnauth.authView.checkAuth();
  assert.strictEqual(hUnauth.overlay.classList.contains('hidden'), false, 'Overlay must be shown when unauthenticated');
  assert.strictEqual(hUnauth.overlay.style.display, 'flex');
  assert.strictEqual(hUnauth.logoutBtn.style.display, 'none');
  assert.strictEqual(hUnauth.clientAuth.isLoggedIn(), false);
  assert.strictEqual(hUnauth.getDummyLoginCalls(), 0, 'Startup must never call dummy login automatically');

  // 9b. Startup authenticated check: overlay is hidden, logout button is shown
  const hAuth = createAuthViewHarness({ allowDevBypass: false });
  hAuth.setFetchResponse({
    status: 200,
    ok: true,
    json: async () => ({ success: true, user: { id: 'u1', username: 'alice' } })
  });
  hAuth.authView.init();
  await hAuth.authView.checkAuth();
  assert.strictEqual(hAuth.overlay.classList.contains('hidden'), true, 'Overlay must be hidden when /api/auth/me succeeds');
  assert.strictEqual(hAuth.overlay.style.display, 'none');
  assert.strictEqual(hAuth.logoutBtn.style.display, '');

  // 9c. Failed login credentials do NOT fall back to dummy login
  const hLoginFail = createAuthViewHarness({ allowDevBypass: false });
  hLoginFail.setFetchResponse({ status: 401, ok: false });
  hLoginFail.authView.init();
  await hLoginFail.authView.checkAuth();
  hLoginFail.emailInput.value = 'user@example.com';
  hLoginFail.passwordInput.value = 'WrongPassword';
  await hLoginFail.form.onsubmit({ preventDefault: () => {} });
  assert(hLoginFail.toasts.some(t => t.type === 'error' && t.msg.includes('Invalid email')), 'Error toast should be displayed');
  assert.strictEqual(hLoginFail.getDummyLoginCalls(), 0, 'Must NOT fall back to dummy login when real credentials fail');
  assert.strictEqual(hLoginFail.overlay.classList.contains('hidden'), false, 'Login form must remain available on failure');
  assert.strictEqual(hLoginFail.clientAuth.isLoggedIn(), false);

  // 9d. Successful login stores token, shows success toast, and hides login form
  hLoginFail.emailInput.value = 'user@example.com';
  hLoginFail.passwordInput.value = 'ValidPass123!';
  await hLoginFail.form.onsubmit({ preventDefault: () => {} });
  assert(hLoginFail.toasts.some(t => t.type === 'success' && t.msg.includes('Logged in successfully')));
  assert.strictEqual(hLoginFail.clientAuth.getToken(), 'user-token-123');
  assert.strictEqual(hLoginFail.clientAuth.isLoggedIn(), true);
  assert.strictEqual(hLoginFail.overlay.classList.contains('hidden'), true, 'Overlay must hide after login succeeds');
  assert.strictEqual(hLoginFail.logoutBtn.style.display, '');

  // 9e. Logout clears real client auth state and returns to login form
  await hLoginFail.logoutBtn.onclick();
  assert.strictEqual(hLoginFail.clientAuth.getToken(), null, 'Logout must clear JWT token');
  assert.strictEqual(hLoginFail.clientAuth.getUser(), null, 'Logout must clear user');
  assert.strictEqual(hLoginFail.clientAuth.isLoggedIn(), false, 'isLoggedIn must be false after logout');
  assert.strictEqual(hLoginFail.overlay.classList.contains('hidden'), false, 'Overlay must reappear after logout');
  assert.strictEqual(hLoginFail.logoutBtn.style.display, 'none');

  // 9f. Developer bypass button in secure mode displays error and does NOT log in
  const hDevSecure = createAuthViewHarness({ allowDevBypass: false });
  hDevSecure.setFetchResponse({ status: 401, ok: false });
  hDevSecure.authView.init();
  await hDevSecure.authView.checkAuth();
  await hDevSecure.dummyLoginBtn.onclick({ preventDefault: () => {} });
  assert(hDevSecure.toasts.some(t => t.type === 'error' && t.msg.includes('disabled in secure mode')), 'Error toast must show bypass is disabled');
  assert.strictEqual(hDevSecure.clientAuth.isLoggedIn(), false, 'Bypass must fail in secure mode');
  assert.strictEqual(hDevSecure.overlay.classList.contains('hidden'), false);

  // 9g. Developer bypass button with server opt-in succeeds and hides overlay
  const hDevOptIn = createAuthViewHarness({ allowDevBypass: true });
  hDevOptIn.setFetchResponse({ status: 401, ok: false });
  hDevOptIn.authView.init();
  await hDevOptIn.authView.checkAuth();
  await hDevOptIn.dummyLoginBtn.onclick({ preventDefault: () => {} });
  assert(hDevOptIn.toasts.some(t => t.type === 'success' && t.msg.includes('developer bypass')));
  assert.strictEqual(hDevOptIn.clientAuth.getToken(), 'dev-token-bypass');
  assert.strictEqual(hDevOptIn.clientAuth.isLoggedIn(), true);
  assert.strictEqual(hDevOptIn.overlay.classList.contains('hidden'), true);

  console.log('  ✅ AuthView UI Flow & Lifecycle validation passed\n');

  console.log('🎉 ALL AUTHENTICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
