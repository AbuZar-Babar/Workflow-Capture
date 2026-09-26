/**
 * Test Suite: Reusable Item Filter Evaluator
 *
 * Verifies:
 * 1. Shared filter contract normalization: modern itemFilter, legacy rowFilter,
 *    filterColumn/filterValue, and match-all omission.
 * 2. Strict validation: empty fields, invalid shapes, unsupported operators, empty values.
 * 3. Pure evaluation for `contains` and `equals` with case-insensitivity and whitespace trimming.
 * 4. Missing/unavailable configured fields return validation errors and never match.
 * 5. Batch preview evaluation with counts, previews, available fields, and error reporting.
 * 6. Independence: zero external dependencies on browser, DB, dashboard, or express.
 */

'use strict';

const assert = require('assert');
const {
  SUPPORTED_OPERATORS,
  normalizeItemFilter,
  validateItemFilter,
  evaluateItemFilter,
  evaluateFilterPreview,
  extractAvailableFields,
  resolveFieldValue,
  ItemFilter
} = require('../src/shared/item-filter');

function runItemFilterTests() {
  console.log('🧪 Starting Reusable Item Filter Evaluator Unit Tests...\n');

  // --------------------------------------------------------------------------
  // Group 1: Normalization & Legacy Compatibility
  // --------------------------------------------------------------------------
  console.log('🔹 Group 1: Normalization & Legacy Filter Compatibility');
  {
    // 1.1 Omission / match-all
    assert.strictEqual(normalizeItemFilter(undefined), null);
    assert.strictEqual(normalizeItemFilter(null), null);
    assert.strictEqual(normalizeItemFilter({}), null);
    assert.strictEqual(normalizeItemFilter({ itemFilter: null }), null);
    assert.strictEqual(normalizeItemFilter({ rowFilter: null }), null);

    // 1.2 Modern itemFilter shape
    const standardFilter = { field: 'Type', operator: 'contains', value: 'Invoice' };
    const normStandard = normalizeItemFilter(standardFilter);
    assert.strictEqual(normStandard.field, 'Type');
    assert.strictEqual(normStandard.operator, 'contains');
    assert.strictEqual(normStandard.value, 'Invoice');

    // 1.3 Envelope unwrapping { itemFilter: { ... } }
    const wrappedFilter = { itemFilter: { field: 'Status', operator: 'equals', value: 'Paid' } };
    const normWrapped = normalizeItemFilter(wrappedFilter);
    assert.strictEqual(normWrapped.field, 'Status');
    assert.strictEqual(normWrapped.operator, 'equals');
    assert.strictEqual(normWrapped.value, 'Paid');

    // 1.4 Whitespace and case normalization on filter definitions
    const messyFilter = { field: '  Type  ', operator: '  CONTAINS  ', value: '  Invoice  ' };
    const normMessy = normalizeItemFilter(messyFilter);
    assert.strictEqual(normMessy.field, 'Type');
    assert.strictEqual(normMessy.operator, 'contains');
    assert.strictEqual(normMessy.value, 'Invoice');

    // 1.5 Legacy rowFilter: { column: "Type", value: "Invoice" }
    const legacyRowFilter = { column: 'Type', value: 'Invoice' };
    const normLegacy1 = normalizeItemFilter(legacyRowFilter);
    assert.strictEqual(normLegacy1.field, 'Type');
    assert.strictEqual(normLegacy1.operator, 'contains');
    assert.strictEqual(normLegacy1.value, 'Invoice');

    // 1.6 Wrapped legacy rowFilter: { rowFilter: { column: "Category", value: "Electronics" } }
    const wrappedLegacy = { rowFilter: { column: 'Category', value: 'Electronics' } };
    const normLegacy2 = normalizeItemFilter(wrappedLegacy);
    assert.strictEqual(normLegacy2.field, 'Category');
    assert.strictEqual(normLegacy2.operator, 'contains');
    assert.strictEqual(normLegacy2.value, 'Electronics');

    // 1.7 Legacy rowFilter with text instead of value
    const legacyTextFilter = { column: 'Type', text: 'Credit Memo' };
    const normLegacyText = normalizeItemFilter(legacyTextFilter);
    assert.strictEqual(normLegacyText.field, 'Type');
    assert.strictEqual(normLegacyText.value, 'Credit Memo');

    // 1.8 Legacy filterColumn / filterValue pair
    const legacyPair = { filterColumn: 'Type', filterValue: 'Invoice' };
    const normPair = normalizeItemFilter(legacyPair);
    assert.strictEqual(normPair.field, 'Type');
    assert.strictEqual(normPair.operator, 'contains');
    assert.strictEqual(normPair.value, 'Invoice');

    // 1.9 Legacy filterValue without filterColumn defaults to 'Type'
    const legacyValOnly = { filterValue: 'Invoice' };
    const normValOnly = normalizeItemFilter(legacyValOnly);
    assert.strictEqual(normValOnly.field, 'Type');
    assert.strictEqual(normValOnly.value, 'Invoice');

    // 1.10 Legacy special wildcards '__any__' and 'all' normalize to null (match-all)
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: '__any__' }), null);
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: 'all' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: '__any__' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: 'all' }), null);
    assert.strictEqual(normalizeItemFilter({ column: 'Type', value: '' }), null);
    assert.strictEqual(normalizeItemFilter({ filterValue: '' }), null);

    // 1.11 Malformed inputs marked as invalid
    assert.strictEqual(normalizeItemFilter('invalid').__invalid, true);
    assert.strictEqual(normalizeItemFilter(123).__invalid, true);
    assert.strictEqual(normalizeItemFilter([]).__invalid, true);
    assert.strictEqual(normalizeItemFilter({ itemFilter: 'not an object' }).__invalid, true);

    console.log('  ✅ Normalization and legacy compatibility passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 2: Filter Validation
  // --------------------------------------------------------------------------
  console.log('🔹 Group 2: Filter Validation Rules');
  {
    // 2.1 Valid filters
    assert.strictEqual(validateItemFilter(null).valid, true);
    assert.strictEqual(validateItemFilter(undefined).valid, true);
    assert.strictEqual(validateItemFilter({ field: 'Type', operator: 'contains', value: 'Invoice' }).valid, true);
    assert.strictEqual(validateItemFilter({ field: 'Status', operator: 'equals', value: 'Paid' }).valid, true);

    // 2.2 Rejection of non-object filters
    const valString = validateItemFilter('not a filter');
    assert.strictEqual(valString.valid, false);
    assert(valString.error.includes('must be an object'));

    const valArray = validateItemFilter([{ field: 'Type', value: 'Inv' }]);
    assert.strictEqual(valArray.valid, false);
    assert(valArray.error.includes('must be an object'));

    // 2.3 Rejection of empty or missing field
    const emptyField1 = validateItemFilter({ field: '', operator: 'contains', value: 'Invoice' });
    assert.strictEqual(emptyField1.valid, false);
    assert(emptyField1.error.includes('field cannot be empty'));

    const emptyField2 = validateItemFilter({ field: '   ', operator: 'contains', value: 'Invoice' });
    assert.strictEqual(emptyField2.valid, false);
    assert(emptyField2.error.includes('field cannot be empty'));

    const missingField = validateItemFilter({ operator: 'contains', value: 'Invoice' });
    assert.strictEqual(missingField.valid, false);
    assert(missingField.error.includes('field cannot be empty'));

    // 2.4 Rejection of unsupported operators
    const invalidOp1 = validateItemFilter({ field: 'Type', operator: 'regex', value: 'Invoice' });
    assert.strictEqual(invalidOp1.valid, false);
    assert(invalidOp1.error.includes('Unsupported filter operator "regex"'));

    const invalidOp2 = validateItemFilter({ field: 'Type', operator: 'startsWith', value: 'Inv' });
    assert.strictEqual(invalidOp2.valid, false);
    assert(invalidOp2.error.includes('Unsupported filter operator "startswith"'));

    const invalidOp3 = validateItemFilter({ field: 'Amount', operator: '>', value: '100' });
    assert.strictEqual(invalidOp3.valid, false);
    assert(invalidOp3.error.includes('Unsupported filter operator ">"'));

    // 2.5 Rejection of missing or empty value
    const emptyVal1 = validateItemFilter({ field: 'Type', operator: 'contains', value: '' });
    assert.strictEqual(emptyVal1.valid, false);
    assert(emptyVal1.error.includes('value cannot be empty'));

    const emptyVal2 = validateItemFilter({ field: 'Type', operator: 'contains', value: '   ' });
    assert.strictEqual(emptyVal2.valid, false);
    assert(emptyVal2.error.includes('value cannot be empty'));

    const missingVal = validateItemFilter({ field: 'Type', operator: 'contains' });
    assert.strictEqual(missingVal.valid, false);
    assert(missingVal.error.includes('value cannot be empty'));

    console.log('  ✅ Validation rules passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 3: Positive & Negative Evaluation ('contains')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 3: Evaluation with "contains" Operator');
  {
    const filter = { field: 'Type', operator: 'contains', value: 'Invoice' };

    // 3.1 Exact match
    const res1 = evaluateItemFilter(filter, { Type: 'Invoice' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.field, 'Type');
    assert.strictEqual(res1.expectedValue, 'Invoice');
    assert.strictEqual(res1.actualValue, 'Invoice');
    assert.strictEqual(res1.operator, 'contains');
    assert.strictEqual(res1.error, null);
    assert(res1.reason.includes('contains "Invoice"'));

    // 3.2 Case-insensitivity (lowercase value against uppercase actual)
    const res2 = evaluateItemFilter(filter, { Type: 'TAX INVOICE' });
    assert.strictEqual(res2.matches, true);
    assert.strictEqual(res2.actualValue, 'TAX INVOICE');

    // 3.3 Substring match
    const res3 = evaluateItemFilter(filter, { Type: 'Standard Invoice #1029' });
    assert.strictEqual(res3.matches, true);

    // 3.4 Whitespace trimming
    const res4 = evaluateItemFilter(
      { field: 'Type', operator: 'contains', value: '  Invoice  ' },
      { Type: '  Invoice INV-001  ' }
    );
    assert.strictEqual(res4.matches, true);

    // 3.5 Negative match
    const res5 = evaluateItemFilter(filter, { Type: 'Credit Memo' });
    assert.strictEqual(res5.matches, false);
    assert.strictEqual(res5.actualValue, 'Credit Memo');
    assert.strictEqual(res5.error, null);
    assert(res5.reason.includes('does not contain "Invoice"'));

    console.log('  ✅ "contains" operator evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 4: Positive & Negative Evaluation ('equals')
  // --------------------------------------------------------------------------
  console.log('🔹 Group 4: Evaluation with "equals" Operator');
  {
    const filter = { field: 'Status', operator: 'equals', value: 'Paid' };

    // 4.1 Exact match
    const res1 = evaluateItemFilter(filter, { Status: 'Paid' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.error, null);
    assert(res1.reason.includes('equals "Paid"'));

    // 4.2 Case-insensitivity
    const res2 = evaluateItemFilter(filter, { Status: 'PAID' });
    assert.strictEqual(res2.matches, true);

    // 4.3 Whitespace trimming
    const res3 = evaluateItemFilter(filter, { Status: '  Paid  ' });
    assert.strictEqual(res3.matches, true);

    // 4.4 Negative match on substring (contains is true, but equals is false)
    const res4 = evaluateItemFilter(filter, { Status: 'Partially Paid' });
    assert.strictEqual(res4.matches, false);
    assert(res4.reason.includes('does not equal "Paid"'));

    // 4.5 Negative match on completely different value
    const res5 = evaluateItemFilter(filter, { Status: 'Pending' });
    assert.strictEqual(res5.matches, false);

    console.log('  ✅ "equals" operator evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 5: Field Resolution, Casing, and Map Types
  // --------------------------------------------------------------------------
  console.log('🔹 Group 5: Field Resolution & Casing Flexibility');
  {
    // 5.1 Case-insensitive field name lookup
    const filterLower = { field: 'type', operator: 'equals', value: 'Invoice' };
    const res1 = evaluateItemFilter(filterLower, { Type: 'Invoice' });
    assert.strictEqual(res1.matches, true);
    assert.strictEqual(res1.field, 'Type');

    // 5.2 Whitespace trimmed field name lookup
    const filterSpaced = { field: '  Invoice Number  ', operator: 'contains', value: '001' };
    const res2 = evaluateItemFilter(filterSpaced, { 'Invoice Number': 'INV-2026-001' });
    assert.strictEqual(res2.matches, true);

    // 5.3 Actual field name has whitespace in fieldsMap
    const res3 = evaluateItemFilter(
      { field: 'Account', operator: 'equals', value: 'Acme' },
      { '  Account  ': 'Acme' }
    );
    assert.strictEqual(res3.matches, true);

    // 5.4 Support for ES6 Map instances as fieldsMap
    const fieldsMap = new Map([
      ['Item #', '1'],
      ['Type', 'Invoice'],
      ['Amount', '$1,250.00']
    ]);
    const resMap = evaluateItemFilter({ field: 'Type', operator: 'equals', value: 'Invoice' }, fieldsMap);
    assert.strictEqual(resMap.matches, true);
    assert.strictEqual(resMap.field, 'Type');

    // 5.5 Numeric values in fieldsMap
    const resNum = evaluateItemFilter(
      { field: 'Amount', operator: 'equals', value: '1250' },
      { Amount: 1250 }
    );
    assert.strictEqual(resNum.matches, true);
    assert.strictEqual(resNum.actualValue, '1250');

    console.log('  ✅ Field resolution and casing flexibility passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 6: Missing & Unavailable Configured Fields
  // --------------------------------------------------------------------------
  console.log('🔹 Group 6: Missing & Unavailable Fields (Never Match)');
  {
    const filter = { field: 'Type', operator: 'contains', value: 'Invoice' };

    // 6.1 Field not in available fields map
    const res1 = evaluateItemFilter(filter, {
      'Invoice #': 'INV-001',
      Customer: 'Acme Corp',
      Amount: '$500'
    });
    assert.strictEqual(res1.matches, false, 'Missing configured field must NEVER match');
    assert(res1.error !== null, 'Must return a validation error for missing field');
    assert(res1.error.includes('Configured field "Type" is not available on item'));
    assert(res1.reason.includes('Invoice #'), 'Reason must list available fields');
    assert(res1.reason.includes('Customer'));

    // 6.2 Fields map is empty
    const resEmpty = evaluateItemFilter(filter, {});
    assert.strictEqual(resEmpty.matches, false);
    assert(resEmpty.error !== null);
    assert(resEmpty.reason.includes('no fields available on item'));

    // 6.3 Fields map is null or undefined
    const resNull = evaluateItemFilter(filter, null);
    assert.strictEqual(resNull.matches, false);
    assert(resNull.error !== null);

    // 6.4 Field exists but actual value is null/empty string
    const resEmptyVal = evaluateItemFilter(
      { field: 'Type', operator: 'equals', value: 'Invoice' },
      { Type: '' }
    );
    assert.strictEqual(resEmptyVal.matches, false);
    assert.strictEqual(resEmptyVal.error, null); // field existed, so no missing-field error, just didn't match

    console.log('  ✅ Missing field rejection passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 7: Malformed Filters Never Match
  // --------------------------------------------------------------------------
  console.log('🔹 Group 7: Malformed Filters Return Validation Errors (Never Match)');
  {
    const item = { Type: 'Invoice' };

    // 7.1 Primitive filter
    const res1 = evaluateItemFilter('not a filter', item);
    assert.strictEqual(res1.matches, false);
    assert(res1.error.includes('must be an object'));

    // 7.2 Empty field name
    const res2 = evaluateItemFilter({ field: '', operator: 'contains', value: 'Invoice' }, item);
    assert.strictEqual(res2.matches, false);
    assert(res2.error.includes('field cannot be empty'));

    // 7.3 Invalid operator
    const res3 = evaluateItemFilter({ field: 'Type', operator: 'invalid_op', value: 'Invoice' }, item);
    assert.strictEqual(res3.matches, false);
    assert(res3.error.includes('Unsupported filter operator "invalid_op"'));

    // 7.4 Empty value
    const res4 = evaluateItemFilter({ field: 'Type', operator: 'contains', value: '' }, item);
    assert.strictEqual(res4.matches, false);
    assert(res4.error.includes('value cannot be empty'));

    console.log('  ✅ Malformed filter evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 8: No-Filter (Match All) Behavior
  // --------------------------------------------------------------------------
  console.log('🔹 Group 8: No-Filter / Match All Behavior');
  {
    const sampleItem = { Type: 'Credit Memo', Amount: '$300' };

    // 8.1 undefined filter matches all
    const resUndef = evaluateItemFilter(undefined, sampleItem);
    assert.strictEqual(resUndef.matches, true);
    assert.strictEqual(resUndef.error, null);
    assert(resUndef.reason.includes('no filter configured'));

    // 8.2 null filter matches all
    const resNull = evaluateItemFilter(null, sampleItem);
    assert.strictEqual(resNull.matches, true);

    // 8.3 empty object matches all
    const resEmpty = evaluateItemFilter({}, sampleItem);
    assert.strictEqual(resEmpty.matches, true);

    // 8.4 legacy wildcards match all
    const resWild1 = evaluateItemFilter({ column: 'Type', value: '__any__' }, sampleItem);
    assert.strictEqual(resWild1.matches, true);

    const resWild2 = evaluateItemFilter({ filterValue: 'all' }, sampleItem);
    assert.strictEqual(resWild2.matches, true);

    // 8.5 Match-all matches even if item has no fields
    const resNoFields = evaluateItemFilter(null, {});
    assert.strictEqual(resNoFields.matches, true);

    console.log('  ✅ Match-all behavior passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 9: Batch Preview Evaluation (evaluateFilterPreview)
  // --------------------------------------------------------------------------
  console.log('🔹 Group 9: Batch Filter Preview Evaluation');
  {
    const items = [
      { index: 0, label: 'Invoice 1', fields: { 'Invoice #': 'INV-001', Type: 'Invoice', Amount: '$100' } },
      { index: 1, label: 'Invoice 2', fields: { 'Invoice #': 'INV-002', Type: 'Credit Memo', Amount: '$50' } },
      { index: 2, label: 'Invoice 3', fields: { 'Invoice #': 'INV-003', Type: 'Invoice', Amount: '$250' } },
      { index: 3, label: 'Invoice 4', fields: { 'Invoice #': 'INV-004', Type: 'Estimate', Amount: '$400' } }
    ];

    // 9.1 Filter: Type contains "Invoice"
    const preview = evaluateFilterPreview({ field: 'Type', operator: 'contains', value: 'Invoice' }, items);
    assert.strictEqual(preview.totalCount, 4);
    assert.strictEqual(preview.selectedCount, 2);
    assert.strictEqual(preview.skippedCount, 2);
    assert.strictEqual(preview.selectedPreview.length, 2);
    assert.strictEqual(preview.skippedPreview.length, 2);
    assert.strictEqual(preview.selectedPreview[0].index, 0);
    assert.strictEqual(preview.selectedPreview[1].index, 2);
    assert.strictEqual(preview.skippedPreview[0].index, 1);
    assert.strictEqual(preview.skippedPreview[1].index, 3);
    assert.deepStrictEqual(preview.errors, []);
    assert(preview.availableFields.includes('Invoice #'));
    assert(preview.availableFields.includes('Type'));
    assert(preview.availableFields.includes('Amount'));

    // 9.2 Preview with missing field reports error
    const previewMissing = evaluateFilterPreview({ field: 'NonExistent', operator: 'equals', value: 'X' }, items);
    assert.strictEqual(previewMissing.totalCount, 4);
    assert.strictEqual(previewMissing.selectedCount, 0);
    assert.strictEqual(previewMissing.skippedCount, 4);
    assert.strictEqual(previewMissing.errors.length, 1);
    assert(previewMissing.errors[0].includes('Configured field "NonExistent" is not available on item'));

    // 9.3 Preview with no filter accepts all items
    const previewAll = evaluateFilterPreview(null, items);
    assert.strictEqual(previewAll.totalCount, 4);
    assert.strictEqual(previewAll.selectedCount, 4);
    assert.strictEqual(previewAll.skippedCount, 0);

    console.log('  ✅ Batch filter preview evaluation passed\n');
  }

  // --------------------------------------------------------------------------
  // Group 10: ItemFilter Namespace API Interface
  // --------------------------------------------------------------------------
  console.log('🔹 Group 10: ItemFilter Namespace API Compliance');
  {
    assert.strictEqual(typeof ItemFilter.normalize, 'function');
    assert.strictEqual(typeof ItemFilter.validate, 'function');
    assert.strictEqual(typeof ItemFilter.evaluate, 'function');
    assert.strictEqual(typeof ItemFilter.evaluatePreview, 'function');
    assert.strictEqual(typeof ItemFilter.extractFields, 'function');
    assert.deepStrictEqual(ItemFilter.SUPPORTED_OPERATORS, ['contains', 'equals']);

    const res = ItemFilter.evaluate({ field: 'A', operator: 'equals', value: '1' }, { A: '1' });
    assert.strictEqual(res.matches, true);

    console.log('  ✅ ItemFilter namespace interface compliance passed\n');
  }

  console.log('🎉 ALL ITEM FILTER EVALUATOR UNIT TESTS PASSED SUCCESSFULLY!\n');
}

runItemFilterTests();
