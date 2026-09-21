/**
 * Test Suite: Intelligent Loop Detector & Sibling Pattern Recognition
 */

const assert = require('assert');
const LoopDetector = require('../src/shared/loop-detector');

function runLoopTests() {
  console.log('🧪 Starting Loop Detector & Sibling Pattern Unit Tests...\n');

  // Test 1: Table Row Loop Detection
  console.log('🔹 Test 1: Table Row Sibling Detection');
  const tableStep = {
    type: 'CLICK',
    fingerprint: {
      tagName: 'a',
      parentTag: 'td',
      selectors: {
        cssPath: 'table#orders-table tbody > tr:nth-child(3) > td:nth-child(4) > a.download-btn'
      }
    }
  };
  const tableResult = LoopDetector.analyzeStep(tableStep);
  assert.strictEqual(tableResult.isLoopCandidate, true);
  assert.strictEqual(tableResult.patternType, 'table-row');
  assert(tableResult.containerSelector.includes('tr'), 'Container selector should target table rows');
  console.log('  ✅ Table row loop detection passed\n');

  // Test 2: Unordered List Sibling Detection
  console.log('🔹 Test 2: List Item Sibling Detection');
  const listStep = {
    type: 'CLICK',
    fingerprint: {
      tagName: 'button',
      parentTag: 'li',
      selectors: {
        cssPath: 'ul.document-list > li:nth-child(2) > button.export-btn'
      }
    }
  };
  const listResult = LoopDetector.analyzeStep(listStep);
  assert.strictEqual(listResult.isLoopCandidate, true);
  assert.strictEqual(listResult.patternType, 'list-item');
  assert(listResult.containerSelector.includes('li'), 'Container selector should target list items');
  console.log('  ✅ List item loop detection passed\n');

  // Test 3: Workflow Step Partitioning (Setup vs Loop Steps)
  console.log('🔹 Test 3: Step Sequence Partitioning');
  const steps = [
    { type: 'NAVIGATE', url: 'https://example.com/login' },
    { type: 'TYPE', value: 'admin' },
    { type: 'CLICK', target: 'login-button' },
    { type: 'NAVIGATE', url: 'https://example.com/reports' },
    { type: 'CLICK', selectors: { cssPath: 'table tbody tr:nth-child(1) a.view' } }, // Loop action 1
    { type: 'CLICK', selectors: { cssPath: 'table tbody tr:nth-child(1) a.download' } } // Loop action 2
  ];

  const partition = LoopDetector.partitionWorkflow(steps, 4);
  assert.strictEqual(partition.setupSteps.length, 4, 'Setup steps should contain 4 steps');
  assert.strictEqual(partition.loopSteps.length, 2, 'Loop steps should contain the complete per-item procedure');
  assert.strictEqual(partition.loopSteps[0].type, 'CLICK');
  console.log('  ✅ Step partitioning passed\n');

  // Test 4: Angular Material Toolbar / Navigation Exclusions
  console.log('🔹 Test 4: Navigation and Site Chrome Exclusions');
  const navStep = {
    type: 'CLICK',
    fingerprint: {
      tagName: 'span',
      parentTag: 'mat-toolbar',
      role: 'tab',
      selectors: {
        cssPath: 'mat-toolbar.top-nav > span:nth-of-type(3)'
      }
    }
  };
  const navResult = LoopDetector.analyzeStep(navStep);
  assert.strictEqual(navResult.isLoopCandidate, false);
  assert.strictEqual(navResult.role, 'SETUP');
  assert.strictEqual(navResult.isNavigationOrChrome, true);
  console.log('  ✅ Navigation toolbar step excluded from loop candidates\n');

  // Test 5: Form Login Inputs Excluded
  console.log('🔹 Test 5: Form Authentication Excluded');
  const loginStep = {
    type: 'TYPE',
    fingerprint: {
      tagName: 'input',
      attributes: { type: 'password', name: 'password' },
      selectors: {
        cssPath: 'form#login-form > div:nth-child(2) > input[type=password]'
      }
    }
  };
  const loginResult = LoopDetector.analyzeStep(loginStep);
  assert.strictEqual(loginResult.isLoopCandidate, false);
  assert.strictEqual(loginResult.role, 'SETUP');
  console.log('  ✅ Login input excluded from loop candidates\n');

  // Test 6: Automatically identify loop candidate index skipping navigation
  console.log('🔹 Test 6: Auto-identify Loop Candidate Index');
  const mixedWorkflow = [
    { type: 'NAVIGATE', url: 'https://customerportal.usoil.com/#/home' },
    { type: 'CLICK', selectors: { cssPath: 'mat-toolbar > span:nth-of-type(3)' } }, // Navigation tab (My Reports)
    { type: 'CLICK', selectors: { cssPath: 'table.invoices-table tbody tr:nth-child(1) td a.download' } } // Data row loop item
  ];
  const detectedIndex = LoopDetector.findLoopCandidateIndex(mixedWorkflow);
  assert.strictEqual(detectedIndex, 2, 'Should skip navbar tab and pick table row as loopStepIndex');
  console.log('  ✅ findLoopCandidateIndex successfully skipped navigation and picked table row\n');

  console.log('🎉 ALL LOOP DETECTOR TESTS PASSED SUCCESSFULLY!\n');
}

runLoopTests();
