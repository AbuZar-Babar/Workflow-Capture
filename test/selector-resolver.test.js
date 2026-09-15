/**
 * Unit Tests for Shared Selector Resolver Logic
 */

const assert = require('assert');
const SelectorResolver = require('../src/shared/selector-resolver');

console.log('\n--- Running Selector Resolver Unit Tests ---');

// Test 1: Stable ID validation
console.log('Test 1: Stable ID vs Dynamic/Unstable ID detection...');
assert.strictEqual(SelectorResolver.isStableId('submit-order-btn'), true, 'submit-order-btn should be stable');
assert.strictEqual(SelectorResolver.isStableId('category-dropdown'), true, 'category-dropdown should be stable');
assert.strictEqual(SelectorResolver.isStableId(':r1:'), false, 'React 18 useId should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('ng-tns-c12-34'), false, 'Angular generated ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('1234567'), false, 'Pure numeric ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('c7a2b9e1-4f3d-4c8a-9e1b-2c3d4e5f6a7b'), false, 'UUID should be marked unstable');
console.log('  Passed: Stable ID heuristics validated.');

// Test 2: Transient / Dynamic CSS Class filtering
console.log('Test 2: Transient class filtering...');
const sampleClasses = ['btn', 'btn-primary', 'active', 'hover', 'focus-visible', 'transition-all', 'css-1a2b3c', 'custom-card'];
const filtered = SelectorResolver.filterStableClasses(sampleClasses);
assert.deepStrictEqual(filtered, ['btn', 'btn-primary', 'custom-card'], 'Should strip transient & CSS-in-JS classes');
console.log('  Passed: Filtered transient classes correctly.');

// Test 3: Fingerprint scoring - Tag mismatch mandatory rejection
console.log('Test 3: Mandatory tag name matching in fingerprint scoring...');
const buttonFingerprint = {
  tagName: 'button',
  id: 'submit-btn',
  name: null,
  type: 'submit',
  role: null,
  placeholder: null,
  ariaLabel: null,
  text: 'Submit Order',
  classes: ['btn'],
  attributes: {}
};

// Mock element with wrong tag
const divElement = {
  tagName: 'div',
  id: 'submit-btn',
  classList: ['btn'],
  getAttribute: () => null,
  hasAttribute: () => false,
  textContent: 'Submit Order'
};

const tagMismatchScore = SelectorResolver.scoreFingerprint(divElement, buttonFingerprint);
assert.strictEqual(tagMismatchScore.matchedTag, false);
assert.strictEqual(tagMismatchScore.score, 0);
assert.strictEqual(tagMismatchScore.passed, false);
console.log('  Passed: Tag mismatch immediately rejected with score 0.');

// Test 4: Fingerprint scoring - High confidence match
console.log('Test 4: High confidence fingerprint match...');
const matchingButton = {
  tagName: 'button',
  id: 'submit-btn',
  classList: ['btn', 'btn-primary'],
  getAttribute: (attr) => attr === 'type' ? 'submit' : null,
  hasAttribute: (attr) => attr === 'type',
  textContent: 'Submit Order'
};

const matchScore = SelectorResolver.scoreFingerprint(matchingButton, buttonFingerprint);
assert.strictEqual(matchScore.matchedTag, true);
assert.strictEqual(matchScore.passed, true);
assert.ok(matchScore.score >= 0.85, `Score should be >= 0.85, got ${matchScore.score}`);
console.log(`  Passed: Exact match scored high confidence: ${matchScore.score}`);

// Test 5: Fingerprint scoring - Fallback tolerance when ID changed but text/tag/type match
console.log('Test 5: Resilience when ID changed but text & attributes match...');
const alteredIdButton = {
  tagName: 'button',
  id: 'dynamic-id-99881',
  classList: ['btn'],
  getAttribute: (attr) => attr === 'type' ? 'submit' : null,
  hasAttribute: (attr) => attr === 'type',
  textContent: 'Submit Order'
};

const alteredScore = SelectorResolver.scoreFingerprint(alteredIdButton, buttonFingerprint);
assert.strictEqual(alteredScore.matchedTag, true);
assert.strictEqual(alteredScore.passed, true, `Should pass minimum threshold 0.70 despite changed ID, got ${alteredScore.score}`);
console.log(`  Passed: Altered ID still scored ${alteredScore.score} >= 0.70 threshold.`);

console.log('\nAll Selector Resolver unit tests passed successfully!\n');
