const assert = require('assert');
const { ConditionEvaluator } = require('../src/shared/condition-evaluator.js');

console.log('🧪 Starting Condition Evaluator Unit Tests...\n');

// Test 1: String contains / equals / in
console.log('🔹 Test 1: String matching');
const item1 = { 'Invoice Number': 'INV-1001', 'Type': 'Invoice', 'Status': 'Pending Approval' };

assert.strictEqual(ConditionEvaluator.evaluate(item1, { field: 'Type', operator: 'equals', value: 'Invoice' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item1, { field: 'Type', operator: 'equals', value: 'Credit Memo' }).matches, false);
assert.strictEqual(ConditionEvaluator.evaluate(item1, { field: 'Status', operator: 'contains', value: 'Pending' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item1, { field: 'Status', operator: 'in', value: 'Pending Approval, Approved' }).matches, true);
console.log('  ✅ String matching passed');

// Test 2: Numeric comparisons with currency symbols and commas
console.log('🔹 Test 2: Numeric comparisons');
const item2 = { 'Amount': '$1,450.50', 'Quantity': '15', 'Tax': '0.00' };

assert.strictEqual(ConditionEvaluator.evaluate(item2, { field: 'Amount', operator: 'greater_than', value: '1000' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item2, { field: 'Amount', operator: 'less_than', value: '500' }).matches, false);
assert.strictEqual(ConditionEvaluator.evaluate(item2, { field: 'Quantity', operator: 'greater_than_or_equal', value: 15 }).matches, true);
console.log('  ✅ Numeric comparisons passed');

// Test 3: Date comparisons
console.log('🔹 Test 3: Date comparisons');
const item3 = { 'Date': 'Sep 25, 2026', 'DueDate': '2026-10-15' };

assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'Date', operator: 'date_on_or_after', value: '2026-09-01' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'Date', operator: 'date_before', value: '2026-09-20' }).matches, false);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'DueDate', operator: 'date_between', value: '2026-10-01', secondValue: '2026-10-31' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'DueDate', operator: '<=', value: '2026-10-15' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'DueDate', operator: '<=', value: '2026-10-10' }).matches, false);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'DueDate', operator: '>=', value: '2026-10-15' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(item3, { field: 'DueDate', operator: '>=', value: '2026-10-20' }).matches, false);

const pastItem = { 'Due Date': '9/12/2026' };
const futureItem = { 'Due Date': '10/15/2026' };
// Assuming today is after 9/12/2026:
assert.strictEqual(ConditionEvaluator.evaluate(pastItem, { field: 'Due Date', operator: '<=', value: '9/28/2026' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(futureItem, { field: 'Due Date', operator: '<=', value: '9/28/2026' }).matches, false);
assert.strictEqual(ConditionEvaluator.evaluate(futureItem, { field: 'Due Date', operator: '>=', value: '9/28/2026' }).matches, true);
console.log('  ✅ Date comparisons passed');

// Test 4: Compound AND / OR logic
console.log('🔹 Test 4: Compound AND / OR logic');
const item4 = { 'Type': 'Invoice', 'Status': 'New', 'Amount': '$250.00' };

const compoundAnd = {
  matchType: 'AND',
  conditions: [
    { field: 'Type', operator: 'equals', value: 'Invoice' },
    { field: 'Status', operator: 'equals', value: 'New' },
    { field: 'Amount', operator: 'less_than', value: '500' }
  ]
};
assert.strictEqual(ConditionEvaluator.evaluate(item4, compoundAnd).matches, true);

const compoundOr = {
  matchType: 'OR',
  conditions: [
    { field: 'Type', operator: 'equals', value: 'Credit Memo' },
    { field: 'Status', operator: 'equals', value: 'New' }
  ]
};
assert.strictEqual(ConditionEvaluator.evaluate(item4, compoundOr).matches, true);
console.log('  ✅ Compound AND / OR passed');

// Test 5: Missing field guard
console.log('🔹 Test 5: Missing field guard');
const missingRes = ConditionEvaluator.evaluate(item4, { field: 'NonExistentColumn', operator: 'equals', value: 'Test' });
assert.strictEqual(missingRes.matches, false);
assert.ok(missingRes.reason.includes('missing or unreadable'));
console.log('  ✅ Missing field guard passed');

console.log('\n🎉 ALL CONDITION EVALUATOR TESTS PASSED SUCCESSFULLY!');
