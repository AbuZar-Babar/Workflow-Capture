const assert = require('assert');
const { ConditionEvaluator } = require('../src/shared/condition-evaluator.js');
const { IntentCompiler } = require('../src/engine/intent-compiler.js');
const { SemanticResolver } = require('../src/replay/semantic-resolver.js');

console.log('🧪 Starting Intent-Driven Architecture Test Suite...\n');

// 1. Condition Evaluator Date & Status Test
console.log('🔹 Test 1: Date & Status Condition Evaluation');
const invoiceRecord = {
  'Invoice Number': 'INV-2026-99',
  'Type': 'Invoice',
  'Date': 'Sep 27, 2026',
  'Amount': '$4,520.00',
  'Status': 'New'
};

const dateFilter = { field: 'Date', operator: 'date_on_or_after', value: '2026-09-01' };
assert.strictEqual(ConditionEvaluator.evaluate(invoiceRecord, dateFilter).matches, true);

const statusFilter = { field: 'Status', operator: 'equals', value: 'New' };
assert.strictEqual(ConditionEvaluator.evaluate(invoiceRecord, statusFilter).matches, true);

const compoundFilter = {
  matchType: 'AND',
  conditions: [
    { field: 'Type', operator: 'equals', value: 'Invoice' },
    { field: 'Amount', operator: 'greater_than', value: '1000' },
    { field: 'Date', operator: 'date_on_or_after', value: '2026-09-01' }
  ]
};
assert.strictEqual(ConditionEvaluator.evaluate(invoiceRecord, compoundFilter).matches, true);
console.log('  ✅ Date, Status, and Compound conditions passed');

// 2. Intent Compiler Strategy Selection
console.log('🔹 Test 2: Intent Compiler Strategy Selection');
const mockWorkflow = {
  id: 'wf_supplier_portal',
  name: 'CityMart Supplier Portal Flow',
  mode: 'LOOP'
};

const pageSummaryPaginated = {
  pageTitle: 'CityMart Portal',
  entities: [
    { type: 'table_grid', name: 'Invoices', itemCount: 143, columns: ['Invoice Number', 'Type', 'Date', 'Amount'] }
  ],
  navigation: {
    hasPagination: true,
    nextButtonFound: true
  }
};

const rawIntent = {
  targetEntity: 'Invoices',
  action: 'DOWNLOAD',
  itemMode: 'new',
  maxItems: 100,
  paginate: true,
  conditions: { field: 'Type', operator: 'equals', value: 'Invoice' }
};

const plan = IntentCompiler.compilePlan(mockWorkflow, pageSummaryPaginated, rawIntent);

assert.strictEqual(plan.strategy, 'PAGINATED_COLLECTION', 'Strategy should be PAGINATED_COLLECTION');
assert.strictEqual(plan.intent.maxItems, 100);
assert.strictEqual(plan.deduplication.itemMode, 'new');
assert.strictEqual(plan.stopConditions.some(s => s.type === 'MAX_ITEMS_REACHED' && s.value === 100), true);
assert.strictEqual(plan.stopConditions.some(s => s.type === 'PAGES_EXHAUSTED'), true);
console.log('  ✅ Intent Compiler generated dynamic execution plan successfully');

console.log('\n🎉 ALL INTENT-DRIVEN SYSTEM TESTS PASSED SUCCESSFULLY!');
