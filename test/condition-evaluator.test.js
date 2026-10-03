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

// Test 6: Citymart/iRely Voucher Due Date filtering with positional text fallback
console.log('🔹 Test 6: Voucher Due Date filtering (upcoming & overdue)');
const voucherUpcoming = {
  text: '1099 adjustment 10/1/2026 10/10/2099 10/1/2026 none 10/2/2026',
  fields: {
    'Voucher Type': '1099 adjustment',
    '_rawText': '1099 adjustment 10/1/2026 10/10/2099 10/1/2026 none 10/2/2026'
  }
};
const voucherOverdue = {
  text: '1099 adjustment 1/1/2020 1/10/2020 1/1/2020 none 1/2/2020',
  fields: {
    'Voucher Type': '1099 adjustment',
    '_rawText': '1099 adjustment 1/1/2020 1/10/2020 1/1/2020 none 1/2/2020'
  }
};

// Upcoming test: Due Date >= today
const upcomingFilter = { field: 'Due Date', operator: '>=', value: 'today' };
assert.strictEqual(ConditionEvaluator.evaluate(voucherUpcoming, upcomingFilter).matches, true, 'Voucher with 2099 due date should match upcoming');
assert.strictEqual(ConditionEvaluator.evaluate(voucherOverdue, upcomingFilter).matches, false, 'Voucher with 2020 due date should not match upcoming');

// Overdue test: Due Date <= today
const overdueFilter = { field: 'Due Date', operator: '<=', value: 'today' };
assert.strictEqual(ConditionEvaluator.evaluate(voucherUpcoming, overdueFilter).matches, false, 'Voucher with 2099 due date should not match overdue');
assert.strictEqual(ConditionEvaluator.evaluate(voucherOverdue, overdueFilter).matches, true, 'Voucher with 2020 due date should match overdue');
console.log('  ✅ Voucher Due Date filtering passed');

// Test 7: Nested ExtJS item data with direct and alias fields
console.log('🔹 Test 7: Nested ExtJS item with alias resolution');
const extjsItem = {
  index: 0,
  fields: {
    'Transaction Date': '10/01/2026',
    'Due Date': '10/10/2026',
    'Voucher No.': 'V-9901',
    'Total': '$1,500.00'
  }
};
assert.strictEqual(ConditionEvaluator.extractFieldValue(extjsItem, 'Due Date'), '10/10/2026');
assert.strictEqual(ConditionEvaluator.extractFieldValue(extjsItem, 'due_date'), '10/10/2026');
assert.strictEqual(ConditionEvaluator.extractFieldValue(extjsItem, 'DueDate'), '10/10/2026');
assert.strictEqual(ConditionEvaluator.extractFieldValue(extjsItem, 'Total'), '$1,500.00');
assert.strictEqual(ConditionEvaluator.evaluate(extjsItem, { field: 'Due Date', operator: '>=', value: '2026-10-01' }).matches, true);
assert.strictEqual(ConditionEvaluator.evaluate(extjsItem, { field: 'Due Date', operator: '<=', value: '2026-10-05' }).matches, false);
console.log('  ✅ Nested ExtJS item with alias resolution passed');

console.log('\n🎉 ALL CONDITION EVALUATOR TESTS PASSED SUCCESSFULLY!');
