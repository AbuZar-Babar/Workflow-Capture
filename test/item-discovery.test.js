/**
 * Test Suite: Deterministic Item Discovery
 */

const assert = require('assert');
const ItemDiscovery = require('../src/shared/item-discovery');

function runItemDiscoveryTests() {
  console.log('🧪 Starting Item Discovery Unit Tests...\n');

  console.log('🔹 Test 1: Select highest-confidence collection');
  const candidates = [
    { score: 0.61, itemCount: 4 },
    { score: 0.91, itemCount: 10 },
    { score: 0.72, itemCount: 6 }
  ];

  const best = ItemDiscovery.selectBestCandidate(candidates);
  assert.strictEqual(best.score, 0.91);
  assert.strictEqual(best.itemCount, 10);
  console.log('  ✅ Best candidate selection passed\n');

  console.log('🔹 Test 2: Empty candidate set');
  assert.strictEqual(ItemDiscovery.selectBestCandidate([]), null);
  assert.strictEqual(ItemDiscovery.selectBestCandidate(null), null);
  console.log('  ✅ Empty candidate handling passed\n');

  console.log('🔹 Test 3: Invalid candidates are ignored');
  const result = ItemDiscovery.selectBestCandidate([
    null,
    { score: '0.99', itemCount: 20 },
    { score: 0.8, itemCount: 5 }
  ]);
  assert.strictEqual(result.score, 0.8);
  console.log('  ✅ Invalid candidate handling passed\n');

  console.log('🔹 Test 4: Exclude navigation/toolbar candidates even with high score');
  const navCandidate = {
    score: 0.98,
    itemCount: 8,
    ancestorTag: 'mat-toolbar',
    role: 'tablist'
  };
  const tableCandidate = {
    score: 0.85,
    itemCount: 15,
    ancestorTag: 'tbody',
    itemTag: 'tr'
  };
  assert.strictEqual(ItemDiscovery.isNavigationCandidate(navCandidate), true);
  assert.strictEqual(ItemDiscovery.isNavigationCandidate(tableCandidate), false);

  const chosen = ItemDiscovery.selectBestCandidate([navCandidate, tableCandidate]);
  assert.strictEqual(chosen.ancestorTag, 'tbody', 'Must choose data table collection over navigation toolbar');
  assert.strictEqual(chosen.score, 0.85);
  console.log('  ✅ Navigation candidate exclusion passed\n');

  console.log('🎉 ALL ITEM DISCOVERY TESTS PASSED SUCCESSFULLY!\n');
}

runItemDiscoveryTests();
