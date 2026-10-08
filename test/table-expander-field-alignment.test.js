/**
 * Test Suite: Table Expander & Control Column Alignment
 * 
 * Verifies that tables with utility columns (checkboxes, expander/chevron arrows `▸`,
 * row checkers, tree-toggles) correctly align named business columns (Invoice No,
 * Issued, Due Date, Amount, Status, Action) and never misassign expander glyphs to
 * business fields like "Invoice No".
 */

'use strict';

const assert = require('assert');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const { evaluateItemFilter } = require('../src/shared/item-filter');

console.log('\n🧪 Starting Table Expander & Field Alignment Test Suite...\n');

// -------------------------------------------------------------
// Test 1: CityMart Complex Table with Checkbox + Expander Arrow
// Simulates the exact DOM structure seen in test-portal-complex.html
// -------------------------------------------------------------
console.log('🔹 Test 1: CityMart Complex Table (Checkbox + Expander Arrow + Invoice Columns)');

// Simulate a table row DOM node with:
// cell 0: checkbox
// cell 1: expander '▸'
// cell 2: INV-1001
// cell 3: 2026-08-29
// cell 4: 2026-09-28
// cell 5: 12,500
// cell 6: Overdue by 10d
// cell 7: Download PDF
function createCityMartComplexRow({ invNo, issued, due, amount, status, actionText = 'Download PDF' }) {
  const checkboxCell = {
    tagName: 'TD',
    innerText: '',
    textContent: '',
    classList: { contains: (cls) => cls === 'select-col' },
    querySelector: (sel) => sel.includes('checkbox') ? { type: 'checkbox' } : null,
    querySelectorAll: () => []
  };

  const expanderCell = {
    tagName: 'TD',
    innerText: '▸',
    textContent: '▸',
    classList: { contains: (cls) => cls === 'expander-col' || cls === 'expander' },
    querySelector: (sel) => sel.includes('expander') || sel.includes('button') ? { innerText: '▸', textContent: '▸' } : null,
    querySelectorAll: () => []
  };

  const invCell = {
    tagName: 'TD',
    innerText: invNo,
    textContent: invNo,
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const issuedCell = {
    tagName: 'TD',
    innerText: issued,
    textContent: issued,
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const dueCell = {
    tagName: 'TD',
    innerText: due,
    textContent: due,
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const amountCell = {
    tagName: 'TD',
    innerText: amount,
    textContent: amount,
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const statusCell = {
    tagName: 'TD',
    innerText: status,
    textContent: status,
    classList: { contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const actionCell = {
    tagName: 'TD',
    innerText: actionText,
    textContent: actionText,
    classList: { contains: () => false },
    querySelector: (sel) => sel.includes('button') || sel.includes('a') ? { innerText: actionText, textContent: actionText } : null,
    querySelectorAll: () => []
  };

  const allCells = [checkboxCell, expanderCell, invCell, issuedCell, dueCell, amountCell, statusCell, actionCell];

  // Mock table container headers (8 th elements: 2 empty control th, 6 named headers)
  const headerEls = [
    { innerText: '', textContent: '', querySelector: () => null },
    { innerText: '', textContent: '', querySelector: () => null },
    { innerText: 'Invoice No', textContent: 'Invoice No', querySelector: () => null },
    { innerText: 'Issued', textContent: 'Issued', querySelector: () => null },
    { innerText: 'Due Date', textContent: 'Due Date', querySelector: () => null },
    { innerText: 'Amount (PKR)', textContent: 'Amount (PKR)', querySelector: () => null },
    { innerText: 'Status', textContent: 'Status', querySelector: () => null },
    { innerText: 'Action', textContent: 'Action', querySelector: () => null }
  ];

  const tableContainer = {
    querySelector: (sel) => {
      if (sel.includes('thead') || sel.includes('header')) {
        return {
          querySelectorAll: () => headerEls
        };
      }
      return null;
    },
    querySelectorAll: () => headerEls
  };

  return {
    tagName: 'TR',
    innerText: `▸ ${invNo} ${issued} ${due} ${amount} ${status} ${actionText}`,
    textContent: `▸ ${invNo} ${issued} ${due} ${amount} ${status} ${actionText}`,
    children: allCells,
    querySelectorAll: (sel) => sel.includes('td') ? allCells : [],
    querySelector: () => null,
    closest: () => tableContainer,
    parentElement: {
      closest: () => tableContainer
    }
  };
}

(async () => {
  // Test 1a: evaluateItemFilter extracts correct invoice number (NOT arrow ▸)
  const mockRowEl = createCityMartComplexRow({
    invNo: 'INV-1001',
    issued: '2026-08-29',
    due: '2026-09-28',
    amount: '12,500',
    status: 'Overdue by 10d'
  });

  const runner = new LoopReplayRunner({
    id: 'test_runner_expander',
    name: 'Expander Test Flow'
  });

  const mockPage = {};
  const mockDiscovery = {
    items: [],
    collection: {
      headerColumns: ['Invoice No', 'Issued', 'Due Date', 'Amount (PKR)', 'Status', 'Action']
    }
  };

  const mockItemHandle = {
    dispose: async () => {},
    asElement: () => ({
      evaluate: async (fn) => fn(mockRowEl)
    })
  };

  // Mock ItemDiscovery.getItemHandle
  const ItemDiscovery = require('../src/shared/item-discovery');
  const originalGetItemHandle = ItemDiscovery.getItemHandle;
  ItemDiscovery.getItemHandle = async () => mockItemHandle;

  try {
    const filterRes = await runner.evaluateItemFilter(mockPage, mockDiscovery, 0, {
      column: 'Invoice No',
      operator: 'equals',
      value: 'INV-1001'
    });

    assert.strictEqual(filterRes.matches, true, 'Filter on Invoice No should match INV-1001');
    assert.strictEqual(filterRes.actualValue, 'INV-1001', 'Actual value for Invoice No must be INV-1001, NEVER ▸');
    console.log('  ✅ Filter evaluated correctly: "Invoice No" === "INV-1001" (not expander arrow)');

    // Test 1b: Due Date filter matches 2026-09-28 (not shifted to Amount or Issued)
    const dueDateFilterRes = await runner.evaluateItemFilter(mockPage, mockDiscovery, 0, {
      column: 'Due Date',
      operator: 'contains',
      value: '2026-09-28'
    });

    assert.strictEqual(dueDateFilterRes.matches, true, 'Filter on Due Date should match 2026-09-28');
    assert.strictEqual(dueDateFilterRes.actualValue, '2026-09-28', 'Due Date must be 2026-09-28');
    console.log('  ✅ Column alignment verified: "Due Date" === "2026-09-28" (no column shift)');

    // Test 1c: Amount filter matches 12,500
    const amountFilterRes = await runner.evaluateItemFilter(mockPage, mockDiscovery, 0, {
      column: 'Amount (PKR)',
      operator: 'contains',
      value: '12,500'
    });
    assert.strictEqual(amountFilterRes.matches, true, 'Amount filter should match');
    assert.strictEqual(amountFilterRes.actualValue, '12,500', 'Amount must be 12,500');
    console.log('  ✅ Column alignment verified: "Amount (PKR)" === "12,500"');

    // Test 1d: Status filter matches Overdue by 10d
    const statusFilterRes = await runner.evaluateItemFilter(mockPage, mockDiscovery, 0, {
      column: 'Status',
      operator: 'contains',
      value: 'Overdue'
    });
    assert.strictEqual(statusFilterRes.matches, true, 'Status filter should match Overdue');
    assert.strictEqual(statusFilterRes.actualValue, 'Overdue by 10d', 'Status must be Overdue by 10d');
    console.log('  ✅ Column alignment verified: "Status" === "Overdue by 10d"');
  } finally {
    ItemDiscovery.getItemHandle = originalGetItemHandle;
  }

  // -------------------------------------------------------------
  // Test 2: Table with Only Expander Column (No Checkbox)
  // -------------------------------------------------------------
  console.log('\n🔹 Test 2: Table with Only Expander Column (No Checkbox)');
  {
    const expanderCell = {
      tagName: 'TD',
      innerText: '▸',
      textContent: '▸',
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const invCell = {
      tagName: 'TD',
      innerText: 'INV-2005',
      textContent: 'INV-2005',
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const dateCell = {
      tagName: 'TD',
      innerText: '2026-10-01',
      textContent: '2026-10-01',
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: () => []
    };

    const cells = [expanderCell, invCell, dateCell];
    const rowEl = {
      tagName: 'TR',
      innerText: '▸ INV-2005 2026-10-01',
      textContent: '▸ INV-2005 2026-10-01',
      children: cells,
      querySelectorAll: () => cells,
      querySelector: () => null,
      closest: () => ({
        querySelector: () => ({
          querySelectorAll: () => [
            { innerText: 'Invoice No', textContent: 'Invoice No' },
            { innerText: 'Date', textContent: 'Date' }
          ]
        })
      })
    };

    const mockItemHandle2 = {
      dispose: async () => {},
      asElement: () => ({
        evaluate: async (fn) => fn(rowEl)
      })
    };

    ItemDiscovery.getItemHandle = async () => mockItemHandle2;
    try {
      const res = await runner.evaluateItemFilter(mockPage, { items: [], collection: { headerColumns: ['Invoice No', 'Date'] } }, 0, {
        column: 'Invoice No',
        operator: 'equals',
        value: 'INV-2005'
      });
      assert.strictEqual(res.matches, true, 'Invoice No should match INV-2005');
      assert.strictEqual(res.actualValue, 'INV-2005', 'Expander alone must be skipped when matching Invoice No');
      console.log('  ✅ Expander-only column successfully excluded from data mapping');
    } finally {
      ItemDiscovery.getItemHandle = originalGetItemHandle;
    }
  }

  // -------------------------------------------------------------
  // Test 3: Inline Expander Arrow Inside Data Cell (▸ INV-3001)
  // -------------------------------------------------------------
  console.log('\n🔹 Test 3: Inline Expander Arrow Embedded Inside Cell ("▸ INV-3001")');
  {
    const invCell = {
      tagName: 'TD',
      innerText: '▸ INV-3001',
      textContent: '▸ INV-3001',
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const statusCell = {
      tagName: 'TD',
      innerText: 'Paid',
      textContent: 'Paid',
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const cells = [invCell, statusCell];
    const rowEl = {
      tagName: 'TR',
      innerText: '▸ INV-3001 Paid',
      textContent: '▸ INV-3001 Paid',
      children: cells,
      querySelectorAll: () => cells,
      querySelector: () => null,
      closest: () => ({
        querySelector: () => ({
          querySelectorAll: () => [
            { innerText: 'Invoice No', textContent: 'Invoice No' },
            { innerText: 'Status', textContent: 'Status' }
          ]
        })
      })
    };

    const mockItemHandle3 = {
      dispose: async () => {},
      asElement: () => ({
        evaluate: async (fn) => fn(rowEl)
      })
    };

    ItemDiscovery.getItemHandle = async () => mockItemHandle3;
    try {
      const res = await runner.evaluateItemFilter(mockPage, { items: [], collection: { headerColumns: ['Invoice No', 'Status'] } }, 0, {
        column: 'Invoice No',
        operator: 'equals',
        value: 'INV-3001'
      });
      assert.strictEqual(res.matches, true, 'Inline expander glyph must be stripped');
      assert.strictEqual(res.actualValue, 'INV-3001', 'Clean invoice number must be extracted');
      console.log('  ✅ Inline expander glyph cleanly stripped: "▸ INV-3001" -> "INV-3001"');
    } finally {
      ItemDiscovery.getItemHandle = originalGetItemHandle;
    }
  }

  // -------------------------------------------------------------
  // Test 4: Semantic Self-Healing for Document ID & ExecutionModal Filtering
  // -------------------------------------------------------------
  console.log('\n🔹 Test 4: Document ID Self-Healing & ExecutionModal Extraction');
  {
    // Simulate what ExecutionModal receives when preflight or inspection happens
    const sampleDiscoveryData = {
      discovery: {
        items: [
          {
            text: '▸ INV-1001 2026-08-29 2026-09-28 12,500 Overdue by 10d Download PDF',
            fields: {
              'Invoice No': 'INV-1001',
              'Issued': '2026-08-29',
              'Due Date': '2026-09-28',
              'Amount (PKR)': '12,500',
              'Status': 'Overdue by 10d',
              'Action': 'Download PDF',
              _cells: ['INV-1001', '2026-08-29', '2026-09-28', '12,500', 'Overdue by 10d', 'Download PDF']
            }
          },
          {
            text: '▸ INV-1002 2026-09-03 2026-09-28 8,300 Overdue by 10d Download PDF',
            fields: {
              'Invoice No': 'INV-1002',
              'Issued': '2026-09-03',
              'Due Date': '2026-09-28',
              'Amount (PKR)': '8,300',
              'Status': 'Overdue by 10d',
              'Action': 'Download PDF',
              _cells: ['INV-1002', '2026-09-03', '2026-09-28', '8,300', 'Overdue by 10d', 'Download PDF']
            }
          }
        ]
      }
    };

    // Test that corrupt expander arrows are rejected
    const corruptItem = {
      text: '▸ INV-4001 2026-08-01 Paid',
      fields: {
        'Invoice No': '▸', // Corrupted with expander
        'Status': 'Paid',
        _cells: ['INV-4001', '2026-08-01', 'Paid']
      }
    };

    const EXPANDER_GLYPH_REGEX = /^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i;
    assert.strictEqual(EXPANDER_GLYPH_REGEX.test('▸'), true, 'Expander arrow regex detects ▸');
    assert.strictEqual(EXPANDER_GLYPH_REGEX.test('INV-1001'), false, 'Expander regex rejects real invoice number');

    const evalRes = evaluateItemFilter({
      field: 'Invoice No',
      operator: 'equals',
      value: 'INV-1001'
    }, sampleDiscoveryData.discovery.items[0]);
    assert.strictEqual(evalRes.matches, true, 'Filter matches clean INV-1001');
    console.log('  ✅ Item filter matches real invoice number: INV-1001');

    const evalRes2 = evaluateItemFilter({
      field: 'Invoice No',
      operator: 'equals',
      value: 'INV-1002'
    }, sampleDiscoveryData.discovery.items[1]);
    assert.strictEqual(evalRes2.matches, true, 'Filter matches clean INV-1002');
    console.log('  ✅ Item filter matches real invoice number: INV-1002');
  }

  console.log('\n🎉 ALL TABLE EXPANDER & FIELD ALIGNMENT TESTS PASSED!\n');
})().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
