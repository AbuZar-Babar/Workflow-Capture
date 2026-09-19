const assert = require('assert');
const ActionGeneralizer = require('../src/shared/action-generalizer');

function run() {
  console.log('🧪 Starting Action Generalizer Unit Tests...\n');

  console.log('🔹 Test 1: Convert nth-row CSS path to item-relative path');
  const relative = ActionGeneralizer.toRelativeCss(
    'table#invoices tbody > tr:nth-child(1) > td:nth-child(5) > a.btn-download',
    'tr'
  );
  assert.strictEqual(relative, 'td:nth-child(5) > a.btn-download');
  console.log('  ✅ Relative selector passed\n');

  console.log('🔹 Test 2: Targeting the item itself returns :scope');
  assert.strictEqual(
    ActionGeneralizer.toRelativeCss('table#invoices > tbody > tr:nth-child(1)', 'tr'),
    ':scope'
  );
  console.log('  ✅ Item-target selector passed\n');

  console.log('🔹 Test 3: Generalize a recorded action');
  const action = {
    type: 'CLICK',
    target: {
      candidates: [{ strategy: 'css-path', value: 'table tbody > tr:nth-child(1) > td > a.btn-download', priority: 5 }],
      fingerprint: { tagName: 'a', text: 'Download' }
    }
  };
  const generalized = ActionGeneralizer.generalizeAction(action, {
    itemTag: 'tr',
    itemSignature: 'tr|td>td|'
  });
  assert.strictEqual(generalized.scope, 'item');
  assert.strictEqual(generalized.target.scope, 'item');
  assert.strictEqual(generalized.target.candidates[0].value, 'td > a.btn-download');
  assert.strictEqual(ActionGeneralizer.isGeneralized(generalized), true);
  console.log('  ✅ Action generalization passed\n');

  console.log('🔹 Test 4: Ignore non-CSS candidates');
  const target = ActionGeneralizer.generalizeTarget({
    candidates: [{ strategy: 'xpath', value: '//a[text()="Download"]' }],
    fingerprint: { tagName: 'a', text: 'Download' }
  }, { itemTag: 'tr' });
  assert.strictEqual(target.candidates.length, 0);
  assert.strictEqual(target.fingerprint.text, 'Download');
  console.log('  ✅ Non-CSS candidate handling passed\n');

  console.log('🎉 ALL ACTION GENERALIZER TESTS PASSED SUCCESSFULLY!\n');
}

run();
