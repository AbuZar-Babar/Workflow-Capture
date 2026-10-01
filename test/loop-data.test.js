const assert = require('assert');
const { normalizeLoopData, validateLoopData } = require('../src/shared/loop-data');

describe('loop-data', () => {
  it('normalizes discovery into serializable loop data', () => {
    const result = normalizeLoopData({
      success: true,
      confidence: 0.91,
      availableFields: ['Invoice Number', 'Status', 'Status'],
      collection: {
        ancestorTag: 'tbody',
        ancestorSelector: 'table tbody',
        itemTag: 'tr',
        itemSignature: 'tr|td|'
      },
      items: [{
        index: 0,
        text: 'INV-1001 Open',
        tagName: 'tr',
        signature: 'tr|td|',
        fields: { 'Invoice Number': 'INV-1001', Status: 'Open' },
        href: '/invoice/1001',
        id: 'invoice-1001'
      }]
    }, {
      loopStepIndex: 3,
      patternType: 'table-row',
      source: 'recording',
      capturedAt: '2026-10-01T00:00:00.000Z'
    });

    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.loopStepIndex, 3);
    assert.strictEqual(result.patternType, 'table-row');
    assert.strictEqual(result.itemCount, 1);
    assert.deepStrictEqual(result.availableFields, ['Invoice Number', 'Status']);
    assert.strictEqual(result.items[0].fields.Status, 'Open');
    assert.strictEqual(result.items[0].id, 'invoice-1001');
    assert.strictEqual(validateLoopData(result).valid, true);
  });

  it('rejects malformed persisted loop data', () => {
    const result = validateLoopData({
      version: 1,
      collection: {},
      items: []
    });

    assert.strictEqual(result.valid, false);
    assert.match(result.error, /availableFields/);
  });
});
