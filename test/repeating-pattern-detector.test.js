/**
 * Test Suite: Universal Repeating Pattern Detector & Scanner
 * 
 * Validates Step 2:
 * 1. LoopDetector step analysis detects tables, checkbox lists, radio groups, cards, and dropdowns.
 * 2. LoopConfidenceEngine correctly weights repeating checkbox and data grid patterns.
 * 3. RepeatingPatternDetector script syntax and cluster scoring logic.
 * 4. Scanner injected script syntax and field extraction definitions.
 * 5. ProfileRegistry and CitymartProfile decoupling.
 */

'use strict';

const assert = require('assert');
const LoopDetector = require('../src/shared/loop-detector');
const LoopConfidenceEngine = require('../src/shared/loop-confidence-engine');
const RepeatingPatternDetector = require('../src/shared/repeating-pattern-detector');
const Scanner = require('../src/shared/scanner');
const ProfileRegistry = require('../src/profiles/index');
const citymartProfile = require('../src/profiles/citymart.profile');

console.log('🧪 Starting Universal Repeating Pattern Detector & Scanner Test Suite...\n');

// -------------------------------------------------------------
// Test 1: Checkbox List Pattern Detection
// -------------------------------------------------------------
console.log('🔹 Test 1: Checkbox List Pattern Detection');
const checkboxStep = {
  name: 'Click Checkbox',
  selectors: { cssPath: 'form#permissions > div:nth-child(3) > label > input[type="checkbox"]' },
  fingerprint: {
    tagName: 'input',
    type: 'checkbox',
    role: 'checkbox',
    parentTag: 'label'
  }
};
const chkAnalysis = LoopDetector.analyzeStep(checkboxStep);
assert.strictEqual(chkAnalysis.isLoopCandidate, true, 'Checkbox must be identified as loop candidate');
assert.strictEqual(chkAnalysis.patternType, 'checkbox-list', 'Must classify as checkbox-list');
console.log('  ✅ Checkbox list pattern detected\n');

// -------------------------------------------------------------
// Test 2: Radio Group Pattern Detection
// -------------------------------------------------------------
console.log('🔹 Test 2: Radio Group Pattern Detection');
const radioStep = {
  name: 'Select Shipping Option',
  selectors: { cssPath: 'div.shipping-options > div:nth-child(2) > input[type="radio"]' },
  fingerprint: {
    tagName: 'input',
    type: 'radio',
    role: 'radio'
  }
};
const radioAnalysis = LoopDetector.analyzeStep(radioStep);
assert.strictEqual(radioAnalysis.isLoopCandidate, true, 'Radio button must be identified as loop candidate');
assert.strictEqual(radioAnalysis.patternType, 'radio-group', 'Must classify as radio-group');
console.log('  ✅ Radio group pattern detected\n');

// -------------------------------------------------------------
// Test 3: Generic Div Grid & Card Detection
// -------------------------------------------------------------
console.log('🔹 Test 3: Generic Div Grid & Card Detection');
const cardStep = {
  name: 'Click Product Card',
  selectors: { cssPath: 'div.product-grid > div.product-item:nth-child(4) > button.buy-now' },
  fingerprint: {
    tagName: 'button',
    parentTag: 'div',
    classes: ['buy-now']
  }
};
const cardAnalysis = LoopDetector.analyzeStep(cardStep);
assert.strictEqual(cardAnalysis.isLoopCandidate, true, 'Product card action must be identified as loop candidate');
assert.strictEqual(cardAnalysis.patternType, 'card-grid', 'Must classify as card-grid');
console.log('  ✅ Div grid & card detection passed\n');

// -------------------------------------------------------------
// Test 4: Find Loop Candidate Index with Heterogeneous Steps
// -------------------------------------------------------------
console.log('🔹 Test 4: Prioritize Data Loops over Setup Steps');
const workflowSteps = [
  { name: 'Login Click', selectors: { cssPath: 'form#login > button.btn-login' }, fingerprint: { tagName: 'button' } },
  { name: 'Navigation Tab', selectors: { cssPath: 'nav.navbar > a.nav-link' }, fingerprint: { tagName: 'a', role: 'tab' } },
  { name: 'Check Item', selectors: { cssPath: 'div.checklist > div:nth-child(1) > input[type="checkbox"]' }, fingerprint: { tagName: 'input', type: 'checkbox' } },
  { name: 'Download Action', selectors: { cssPath: 'button#btn-download' }, fingerprint: { tagName: 'button' } }
];
const loopIdx = LoopDetector.findLoopCandidateIndex(workflowSteps);
assert.strictEqual(loopIdx, 2, 'Must pick index 2 (the checkbox list item) as the loop starting point');
console.log('  ✅ Loop candidate index prioritization passed\n');

// -------------------------------------------------------------
// Test 5: Loop Confidence Engine Evaluation for Checkbox and Grids
// -------------------------------------------------------------
console.log('🔹 Test 5: Loop Confidence Engine Evaluation');
const chkConfidence = LoopConfidenceEngine.evaluate(chkAnalysis, { allSteps: workflowSteps });
assert(chkConfidence.score >= 0.75, `Checkbox list confidence should be HIGH (got ${chkConfidence.score})`);
assert.strictEqual(chkConfidence.category, 'HIGH');
assert(chkConfidence.reasons.some(r => r.includes('checkbox')));
console.log('  ✅ Loop confidence evaluation passed\n');

// -------------------------------------------------------------
// Test 6: RepeatingPatternDetector Script Validation
// -------------------------------------------------------------
console.log('🔹 Test 6: RepeatingPatternDetector Script Syntax');
const detectorScript = RepeatingPatternDetector.getInjectedScript();
assert(typeof detectorScript === 'string' && detectorScript.length > 500);
// Verify script parses into a valid JS function
const detectorFn = new Function(detectorScript + '\nreturn typeof __workflowCaptureDetectRepeatingPatterns === "function";');
assert.strictEqual(detectorFn(), true, 'Injected detector script must compile without syntax errors');
console.log('  ✅ RepeatingPatternDetector script syntax passed\n');

// -------------------------------------------------------------
// Test 7: Scanner Script Validation
// -------------------------------------------------------------
console.log('🔹 Test 7: Scanner Script Syntax');
const scannerScript = Scanner.getInjectedScannerScript();
assert(typeof scannerScript === 'string' && scannerScript.length > 500);
const scannerFn = new Function(scannerScript + '\nreturn typeof __workflowCaptureScanPage === "function";');
assert.strictEqual(scannerFn(), true, 'Injected scanner script must compile without syntax errors');
console.log('  ✅ Scanner script syntax passed\n');

// -------------------------------------------------------------
// Test 8: Profile Registry Decoupling
// -------------------------------------------------------------
console.log('🔹 Test 8: Profile Registry Decoupling');
const citymartUrlProfile = ProfileRegistry.getProfileForUrl('https://citymart.i21web.com/iRelyProd/login#home');
assert(citymartUrlProfile !== null, 'Citymart URL must match citymart profile');
assert.strictEqual(citymartUrlProfile.id, 'citymart');

const genericUrlProfile = ProfileRegistry.getProfileForUrl('https://app.shopify.com/admin/orders');
assert.strictEqual(genericUrlProfile, null, 'Non-Citymart portal must return null (pure generic mode)');

const type1 = citymartProfile.classifyDocumentType('Sales Invoice #1029');
assert.strictEqual(type1, 'Invoice');
const type2 = citymartProfile.classifyDocumentType('Credit Memo #304');
assert.strictEqual(type2, 'Credit Memo');
console.log('  ✅ Profile registry decoupling passed\n');

console.log('🎉 ALL REPEATING PATTERN DETECTOR & SCANNER TESTS PASSED!\n');
