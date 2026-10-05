const assert = require('assert');
const { detectLoginSequence, isLoginAction, isSessionAuthenticated } = require('../src/shared/auth-detector');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');

console.log('🧪 Starting Session Auth & Login Skip Unit Tests...\n');

// Mock recorded actions representing a login flow followed by report generation
const sampleLoginWorkflowActions = [
  { index: 0, type: 'CLICK', name: 'Log In Button', target: { fingerprint: { text: 'Log In', tagName: 'button' } } },
  { index: 1, type: 'CLICK', name: 'Username Input', target: { fingerprint: { name: 'username', tagName: 'input' } } },
  { index: 2, type: 'TYPE', name: 'Username Input', value: 'myuser@company.com', target: { fingerprint: { name: 'username', tagName: 'input' } } },
  { index: 3, type: 'CLICK', name: 'Password Field', target: { fingerprint: { type: 'password', tagName: 'input' } } },
  { index: 4, type: 'TYPE', name: 'Password Field', value: 'secret123', meta: { isPassword: true }, target: { fingerprint: { type: 'password', tagName: 'input' } } },
  { index: 5, type: 'CLICK', name: 'Login Submit Button', target: { fingerprint: { text: 'Sign In', tagName: 'button' } } },
  { index: 6, type: 'CLICK', name: 'My Reports Element', target: { fingerprint: { text: 'My Reports', tagName: 'span' }, candidates: [{ strategy: 'css-path', value: '.my-reports-link' }] } },
  { index: 7, type: 'CLICK', name: 'Customer Select', target: { fingerprint: { text: 'Customer', tagName: 'mat-select' } } }
];

const sampleNonLoginActions = [
  { index: 0, type: 'CLICK', name: 'Invoices Tab', target: { fingerprint: { text: 'Invoices' } } },
  { index: 1, type: 'CLICK', name: 'Download PDF', target: { fingerprint: { text: 'Download' } } }
];

// ------------------------------------------------------------
// Test 1: detectLoginSequence
// ------------------------------------------------------------
console.log('🔹 Test 1: detectLoginSequence accurately detects auth steps and boundary');
const loginSeq = detectLoginSequence(sampleLoginWorkflowActions);
assert.strictEqual(loginSeq.hasLoginSequence, true, 'Should detect login sequence');
assert.strictEqual(loginSeq.startIndex, 0, 'Start index should be 0');
assert.strictEqual(loginSeq.endIndex, 5, 'End index should be 5 (the submit button)');
assert.strictEqual(loginSeq.loginActionCount, 6, 'Login count should be 6');
assert.strictEqual(loginSeq.firstPostLoginIndex, 6, 'First post login index should be 6');
assert.strictEqual(loginSeq.firstPostLoginAction.name, 'My Reports Element');
console.log('  ✅ Correctly detected 6-step login sequence with boundary at Step #7');

const nonLoginSeq = detectLoginSequence(sampleNonLoginActions);
assert.strictEqual(nonLoginSeq.hasLoginSequence, false, 'Should not detect login sequence');
assert.strictEqual(nonLoginSeq.firstPostLoginIndex, 0, 'First post-login should be 0');
console.log('  ✅ Correctly returned false for non-login workflow');

// ------------------------------------------------------------
// Test 2: isLoginAction helper
// ------------------------------------------------------------
console.log('\n🔹 Test 2: isLoginAction verifies individual actions');
assert.strictEqual(isLoginAction(sampleLoginWorkflowActions[0]), true, 'Log In button is a login action');
assert.strictEqual(isLoginAction(sampleLoginWorkflowActions[2]), true, 'Username TYPE is a login action');
assert.strictEqual(isLoginAction(sampleLoginWorkflowActions[4]), true, 'Password TYPE is a login action');
assert.strictEqual(isLoginAction(sampleLoginWorkflowActions[6]), false, 'My Reports is NOT a login action');
console.log('  ✅ isLoginAction correctly classified login vs non-login actions');

// ------------------------------------------------------------
// Test 3: isSessionAuthenticated
// ------------------------------------------------------------
console.log('\n🔹 Test 3: isSessionAuthenticated probes page state');
(async () => {
  // Case A: On logged-in home/dashboard URL with no password field
  const mockPageLoggedIn = {
    isClosed: () => false,
    url: () => 'https://customerportal.usoil.com/#/home',
    evaluate: async (fn, ...args) => {
      // Return false for hasVisiblePassword, true for auth selectors or post-login target
      if (typeof fn === 'function' && fn.toString().includes('input[type="password"]')) {
        return false;
      }
      return true;
    }
  };
  const isAuth = await isSessionAuthenticated(mockPageLoggedIn, loginSeq);
  assert.strictEqual(isAuth, true, 'Should detect authenticated session on #/home');
  console.log('  ✅ Detected active session on authenticated route without password field');

  // Case B: On login URL with password field present
  const mockPageLoggedOut = {
    isClosed: () => false,
    url: () => 'https://customerportal.usoil.com/#/login',
    evaluate: async (fn, ...args) => {
      if (typeof fn === 'function' && fn.toString().includes('input[type="password"]')) {
        return true; // Password field visible!
      }
      return false;
    }
  };
  const isAuthLoggedOut = await isSessionAuthenticated(mockPageLoggedOut, loginSeq);
  assert.strictEqual(isAuthLoggedOut, false, 'Should detect unauthenticated state when password field is visible');
  console.log('  ✅ Detected unauthenticated state when password field is visible on login page');

  // ------------------------------------------------------------
  // Test 4: LoopReplayRunner.executeStandard conditional login skip
  // ------------------------------------------------------------
  console.log('\n🔹 Test 4: LoopReplayRunner.executeStandard skips login steps when session is active');

  const runner = new LoopReplayRunner({ runId: 'test_auth_skip_' + Date.now() });
  const executedSteps = [];

  // Mock replay engine
  runner.replayEngine = {
    connect: async () => ({
      pages: async () => [mockPageLoggedIn],
      newPage: async () => mockPageLoggedIn
    }),
    disconnect: async () => {},
    executeAction: async (step, idx) => {
      executedSteps.push({ index: idx, name: step.name });
      return { success: true };
    },
    page: mockPageLoggedIn
  };
  runner.navigateToWorkflowTarget = async () => {};
  runner.configureDownloadInterception = async () => {};

  const workflow = {
    id: 'wf_test_skip',
    name: 'Customer Report Flow',
    targetUrl: 'https://customerportal.usoil.com/#/home',
    steps: sampleLoginWorkflowActions
  };

  const progressEvents = [];
  const manifest = await runner.executeStandard(workflow, (p) => progressEvents.push(p));

  // Verify that steps 0-5 were skipped and only steps 6 & 7 were executed!
  assert.strictEqual(manifest.itemsSkipped, 6, 'Exactly 6 login steps must be recorded as skipped');
  assert.strictEqual(executedSteps.length, 2, 'Only 2 post-login steps should be executed');
  assert.strictEqual(executedSteps[0].name, 'My Reports Element', 'Execution should start at Step #7 (My Reports)');
  assert.strictEqual(executedSteps[1].name, 'Customer Select', 'Execution should continue with Step #8');

  // Check manifest status
  const skippedResults = manifest.results.filter(r => r.status === 'SKIPPED');
  assert.strictEqual(skippedResults.length, 6, '6 steps in manifest results must have status SKIPPED');
  assert.strictEqual(skippedResults[0].reason, 'SESSION_ALREADY_AUTHENTICATED', 'Reason must be SESSION_ALREADY_AUTHENTICATED');
  console.log('  ✅ executeStandard skipped steps 1-6 and executed post-login steps 7-8 cleanly');

  console.log('\n🎉 ALL SESSION AUTH & LOGIN SKIP TESTS PASSED SUCCESSFULLY!\n');
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
