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
assert.strictEqual(SelectorResolver.isStableId('gridview-1090-record-307'), false, 'ExtJS gridview+record ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('gridview-1301'), false, 'ExtJS gridview ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('record-521'), false, 'ExtJS record ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('ext-gen1024'), false, 'ExtJS ext-gen ID should be marked unstable');
assert.strictEqual(SelectorResolver.isStableId('panel-1045'), false, 'ExtJS panel ID should be marked unstable');
console.log('  Passed: Stable ID heuristics validated (including ExtJS/ERP IDs).');

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
// Test 6: ACTION_TYPES includes KEY_PRESS
console.log('Test 6: ACTION_TYPES includes KEY_PRESS...');
const { ACTION_TYPES } = require('../src/shared/constants');
assert.strictEqual(ACTION_TYPES.KEY_PRESS, 'KEY_PRESS', 'ACTION_TYPES.KEY_PRESS must be defined as KEY_PRESS');
console.log('  Passed: KEY_PRESS constant validated.');

// Test 7: Semantic Fallback Resolution when candidates fail
console.log('Test 7: Semantic Fallback Resolution when candidate selectors fail...');
const mockCellElement = {
  nodeType: 1,
  tagName: 'div',
  id: 'gridview-9999-record-888',
  classList: ['x-grid-cell-inner'],
  getAttribute: (attr) => attr === 'class' ? 'x-grid-cell-inner' : null,
  hasAttribute: (attr) => attr === 'class',
  textContent: 'Invoice',
  offsetParent: {},
  getBoundingClientRect: () => ({ width: 100, height: 28, top: 50, left: 100, bottom: 78, right: 200 })
};

const mockDoc = {
  querySelectorAll: (selector) => {
    if (selector.includes('x-grid-cell-inner') || selector === 'div.x-grid-cell-inner') {
      return [mockCellElement];
    }
    return [];
  },
  evaluate: (xpath) => {
    if (xpath.includes('Invoice')) {
      return {
        snapshotLength: 1,
        snapshotItem: () => mockCellElement
      };
    }
    return { snapshotLength: 0, snapshotItem: () => null };
  }
};

// Target with stale dynamic ID candidates that will fail
const staleTarget = {
  candidates: [
    { strategy: 'css-path', value: '#gridview-1090-record-307 > tbody > tr > td > div', uniqueness: 0, priority: 5 },
    { strategy: 'xpath', value: '/html/body/div[16]/div[2]/table[7]/tr/td[3]/div', uniqueness: 0, priority: 6 }
  ],
  fingerprint: {
    tagName: 'div',
    id: null,
    text: 'Invoice',
    classes: ['x-grid-cell-inner'],
    attributes: {}
  }
};

const fallbackResult = SelectorResolver.resolveElement(staleTarget, { requireVisible: false }, mockDoc);
assert.strictEqual(fallbackResult.success, true, 'Resolver should succeed via semantic fallback');
assert.strictEqual(fallbackResult.element, mockCellElement, 'Should resolve the mock ExtJS invoice cell');
assert.strictEqual(fallbackResult.resolvedCandidate.strategy, 'fingerprint-fallback', 'Strategy should be fingerprint-fallback');
console.log(`  Passed: Successfully resolved element via fallback (score=${fallbackResult.confidenceScore})!`);

// Test 8: Composite option control matching (mat-option element with mat-pseudo-checkbox fingerprint)
console.log('Test 8: Composite option control matching and whitespace-resilient token text scoring...');
const mockMatOption = {
  tagName: 'mat-option',
  id: 'mat-option-42',
  classList: ['mat-mdc-option', 'mdc-list-item'],
  getAttribute: (attr) => attr === 'role' ? 'option' : null,
  hasAttribute: (attr) => attr === 'role',
  textContent: '105992 - DIXIE HIGHWAY ENERGY, LLC (Charge Up 43) - 21100 S DIXIE HWY   MIAMI, FL  33189'
};

const optionFingerprint = {
  tagName: 'mat-pseudo-checkbox',
  id: null,
  role: null,
  text: '105992 - DIXIE HIGHWAY ENERGY, LLC (Charge Up 43) - 21100 S DIXIE HWY MIAMI, FL 33189',
  classes: ['mat-pseudo-checkbox', 'mat-mdc-option-pseudo-checkbox'],
  attributes: {}
};

const optionScore = SelectorResolver.scoreFingerprint(mockMatOption, optionFingerprint);
assert.strictEqual(optionScore.matchedTag, true, 'Composite option control should match tag');
assert.strictEqual(optionScore.passed, true, 'Score should pass minimum threshold');
assert.ok(optionScore.score >= 0.85, `Score should be >= 0.85, got ${optionScore.score}`);
console.log(`  Passed: Composite option scored ${optionScore.score} >= 0.85!`);

console.log('\nAll Selector Resolver unit tests passed successfully!\n');
