/**
 * Unit Test Suite for Bot Configuration & Stealth Evasion
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JsonDB } = require('../src/database/db');
const {
  PRESETS,
  getActiveBotConfig,
  updateBotConfig,
  resetBotConfig,
  getBotConfig
} = require('../src/api/bot-config-controller');
const {
  generateBezierPath,
  calculateDelay,
  calculateTypingDelay
} = require('../src/replay/human-mouse');

console.log('🧪 Starting Bot Configuration & Stealth Unit Tests...\n');

// Mock response object helper
function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(data) {
      if (data) this.body = JSON.parse(data);
    }
  };
}

// ------------------------------------------------------------------
// Test 1: Presets Validity & Default Config
// ------------------------------------------------------------------
console.log('🔹 Test 1: Presets Structure & Values');
assert(PRESETS.ultra_stealth, 'Ultra stealth preset should exist');
assert(PRESETS.balanced, 'Balanced preset should exist');
assert(PRESETS.fast, 'Fast preset should exist');

assert(PRESETS.ultra_stealth.mouse.enabled === true, 'Ultra stealth should have mouse enabled');
assert(PRESETS.ultra_stealth.stealth.maskWebdriver === true, 'Ultra stealth should mask webdriver');
assert(PRESETS.fast.mouse.enabled === false, 'Fast track should disable mouse animation');
console.log('  ✅ Presets validated successfully.\n');

// ------------------------------------------------------------------
// Test 2: Human Mouse Bezier Curve Generation
// ------------------------------------------------------------------
console.log('🔹 Test 2: Bezier Trajectory Generator');
const startPt = { x: 10, y: 20 };
const endPt = { x: 250, y: 180 };
const pathPoints = generateBezierPath(startPt, endPt, { steps: 20, wobble: 3, overshoot: true });

assert(Array.isArray(pathPoints), 'Path should be an array of points');
assert(pathPoints.length >= 20, 'Path should have at least requested number of steps');
assert.strictEqual(pathPoints[0].x, startPt.x, 'First point x should match start point');
assert.strictEqual(pathPoints[0].y, startPt.y, 'First point y should match start point');
assert.strictEqual(pathPoints[pathPoints.length - 1].x, endPt.x, 'Last point x should match end point');
assert.strictEqual(pathPoints[pathPoints.length - 1].y, endPt.y, 'Last point y should match end point');

// Validate smooth non-linear progression
let totalDist = 0;
for (let i = 1; i < pathPoints.length; i++) {
  const d = Math.hypot(pathPoints[i].x - pathPoints[i-1].x, pathPoints[i].y - pathPoints[i-1].y);
  totalDist += d;
}
assert(totalDist > Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y), 'Bezier path distance should exceed straight line distance due to curvature');
console.log('  ✅ Bezier curve trajectory verified with natural curvature.\n');

// ------------------------------------------------------------------
// Test 3: Stochastic Typing & Punctuation Hesitation
// ------------------------------------------------------------------
console.log('🔹 Test 3: Stochastic Typing Delay Dynamics');
const typingConfig = {
  minTypingDelayMs: 30,
  maxTypingDelayMs: 90,
  punctuationPauseMs: 200,
  variance: 'uniform'
};

const standardCharDelay = calculateTypingDelay('a', typingConfig);
assert(standardCharDelay >= 30 && standardCharDelay <= 90, `Standard character delay (${standardCharDelay}) should fall in range [30, 90]`);

const punctuationDelay = calculateTypingDelay('.', typingConfig);
assert(punctuationDelay >= 230, `Punctuation delay (${punctuationDelay}) should include punctuation hesitation`);

const spaceDelay = calculateTypingDelay(' ', typingConfig);
assert(spaceDelay > 0, 'Space delay should be calculated');
console.log('  ✅ Typing cadence and punctuation hesitation passed.\n');

// ------------------------------------------------------------------
// Test 4: Bot Config REST API Operations
// ------------------------------------------------------------------
console.log('🔹 Test 4: Bot Config API Endpoints');
const mockReq = { user: { id: 'test_user_01' } };
const mockRes = createMockRes();

getBotConfig(mockReq, mockRes);
assert.strictEqual(mockRes.statusCode, 200);
assert(mockRes.body.success, 'GET /api/bot-config should return success');
assert(mockRes.body.config, 'GET /api/bot-config should return config object');

// Test Update
const updateRes = createMockRes();
updateBotConfig(mockReq, updateRes, {
  preset: 'custom',
  timing: { minActionDelayMs: 400, maxActionDelayMs: 900 },
  mouse: { wobble: 5 }
});
assert.strictEqual(updateRes.statusCode, 200);
assert.strictEqual(updateRes.body.config.timing.minActionDelayMs, 400);
assert.strictEqual(updateRes.body.config.mouse.wobble, 5);

// Test Reset to Ultra Stealth
const resetRes = createMockRes();
resetBotConfig(mockReq, resetRes, { preset: 'ultra_stealth' });
assert.strictEqual(resetRes.statusCode, 200);
assert.strictEqual(resetRes.body.config.preset, 'ultra_stealth');
assert.strictEqual(resetRes.body.config.mouse.speed, 'human');

console.log('  ✅ Bot Config REST API lifecycle passed.\n');

console.log('🎉 ALL BOT CONFIGURATION & STEALTH TESTS PASSED SUCCESSFULLY!\n');
