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
    { type: 'CLICK', selectors: { cssPath: 'table tbody tr:nth-child(1) a.download' } } // Loop target (index 4)
  ];

  const partition = LoopDetector.partitionWorkflow(steps, 4);
  assert.strictEqual(partition.setupSteps.length, 4, 'Setup steps should contain 4 steps');
  assert.strictEqual(partition.loopSteps.length, 1, 'Loop steps should contain target step');
  assert.strictEqual(partition.loopSteps[0].type, 'CLICK');
  console.log('  ✅ Step partitioning passed\n');

  console.log('🎉 ALL LOOP DETECTOR TESTS PASSED SUCCESSFULLY!\n');
}

runLoopTests();
