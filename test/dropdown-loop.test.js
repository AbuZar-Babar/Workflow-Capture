const { test, describe } = require('node:test');
const assert = require('node:assert');
const LoopDetector = require('../src/shared/loop-detector');
const ActionGeneralizer = require('../src/shared/action-generalizer');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');

describe('Dropdown Option Loop Detection & Generalization', () => {
  const dropdownOptionStep = {
    index: 2,
    type: 'CLICK',
    target: {
      candidates: [
        { strategy: 'css-path', value: 'body > div:nth-of-type(3) > div:nth-of-type(2) > div > div > mat-option:nth-of-type(1) > mat-pseudo-checkbox' },
        { strategy: 'text', value: '//mat-option[contains(., "105992")]//mat-pseudo-checkbox' }
      ],
      fingerprint: {
        tagName: 'mat-pseudo-checkbox',
        parentTag: 'mat-option',
        classes: ['mat-pseudo-checkbox', 'mat-mdc-option-pseudo-checkbox'],
        text: '105992 - DIXIE HIGHWAY ENERGY, LLC'
      }
    },
    isLoop: true,
    loopMode: 'sequential_iteration'
  };

  const pageButtonStep = {
    index: 4,
    type: 'CLICK',
    target: {
      candidates: [
        { strategy: 'css-path', value: 'body > app-root > div > mat-sidenav-container > mat-sidenav-content > app-my-reports > div > input:nth-of-type(1)' }
      ],
      fingerprint: {
        tagName: 'input',
        attributes: { type: 'button', value: 'Run Report' }
      }
    }
  };

  const backdropStep = {
    index: 3,
    type: 'CLICK',
    target: {
      candidates: [
        { strategy: 'attribute', value: '.cdk-overlay-backdrop' }
      ],
      fingerprint: {
        tagName: 'div',
        classes: ['cdk-overlay-backdrop']
      }
    }
  };

  test('LoopDetector.analyzeStep recognizes mat-option / dropdown-option', () => {
    const analysis = LoopDetector.analyzeStep(dropdownOptionStep);
    assert.strictEqual(analysis.isLoopCandidate, true);
    assert.strictEqual(analysis.patternType, 'dropdown-option');
    assert.strictEqual(analysis.role, 'LOOP');
  });

  test('LoopDetector.findLoopCandidateIndex prioritizes explicit isLoop / sequential_iteration step', () => {
    const steps = [
      { index: 0, type: 'CLICK', role: 'SETUP' },
      { index: 1, type: 'CLICK', role: 'SETUP' },
      dropdownOptionStep,
      backdropStep,
      pageButtonStep
    ];

    const idx = LoopDetector.findLoopCandidateIndex(steps);
    assert.strictEqual(idx, 2);
  });

  test('ActionGeneralizer classifies option click as scope: item and page button as scope: page', () => {
    const collection = {
      ancestorTag: 'div',
      ancestorSelector: 'div[role="listbox"]',
      itemTag: 'mat-option',
      itemSignature: 'mat-option|mat-pseudo-checkbox'
    };

    const isOptionRelative = ActionGeneralizer.isItemRelative(dropdownOptionStep, collection);
    assert.strictEqual(isOptionRelative, true);

    const isButtonRelative = ActionGeneralizer.isItemRelative(pageButtonStep, collection);
    assert.strictEqual(isButtonRelative, false);

    const isBackdropRelative = ActionGeneralizer.isItemRelative(backdropStep, collection);
    assert.strictEqual(isBackdropRelative, false);

    const loopSteps = [dropdownOptionStep, backdropStep, pageButtonStep];
    const generalized = ActionGeneralizer.generalizeActions(loopSteps, collection);

    assert.strictEqual(generalized.length, 3);
    assert.strictEqual(generalized[0].scope, 'item');
    assert.strictEqual(generalized[1].scope, 'page');
    assert.strictEqual(generalized[2].scope, 'page');
  });

  test('LoopReplayRunner.isDropdownOptionCollection identifies mat-option collections', () => {
    const runner = new LoopReplayRunner({ runId: 'test_dropdown_detection' });

    assert.strictEqual(
      runner.isDropdownOptionCollection({ itemTag: 'mat-option' }),
      true
    );

    assert.strictEqual(
      runner.isDropdownOptionCollection({ itemTag: 'div', ancestorSelector: '.cdk-overlay-pane' }),
      true
    );

    assert.strictEqual(
      runner.isDropdownOptionCollection(
        { itemTag: 'div' },
        [{ tagName: 'mat-option' }]
      ),
      true
    );

    assert.strictEqual(
      runner.isDropdownOptionCollection({ itemTag: 'tr', ancestorTag: 'tbody' }),
      false
    );
  });

  test('Dropdown single-selection simulation unchecks previous and checks current', () => {
    // Model state of 4 options
    const options = [
      { id: 0, text: 'Customer 1', selected: true },
      { id: 1, text: 'Customer 2', selected: false },
      { id: 2, text: 'Customer 3', selected: false },
      { id: 3, text: 'Customer 4', selected: false }
    ];

    function simulateSingleSelect(items, targetIdx) {
      const actions = [];
      // Uncheck phase
      for (let i = 0; i < items.length; i++) {
        if (i !== targetIdx && items[i].selected) {
          items[i].selected = false;
          actions.push({ action: 'UNCHECK', index: i });
        }
      }
      // Check phase
      if (!items[targetIdx].selected) {
        items[targetIdx].selected = true;
        actions.push({ action: 'CHECK', index: targetIdx });
      }
      return actions;
    }

    // Iteration 1: Target item index 1 (uncheck 0, check 1)
    const actions1 = simulateSingleSelect(options, 1);
    assert.deepStrictEqual(actions1, [
      { action: 'UNCHECK', index: 0 },
      { action: 'CHECK', index: 1 }
    ]);
    assert.strictEqual(options[0].selected, false);
    assert.strictEqual(options[1].selected, true);
    assert.strictEqual(options[2].selected, false);

    // Iteration 2: Target item index 2 (uncheck 1, check 2)
    const actions2 = simulateSingleSelect(options, 2);
    assert.deepStrictEqual(actions2, [
      { action: 'UNCHECK', index: 1 },
      { action: 'CHECK', index: 2 }
    ]);
    assert.strictEqual(options[1].selected, false);
    assert.strictEqual(options[2].selected, true);

    // Iteration 3: Target item index 3 (uncheck 2, check 3)
    const actions3 = simulateSingleSelect(options, 3);
    assert.deepStrictEqual(actions3, [
      { action: 'UNCHECK', index: 2 },
      { action: 'CHECK', index: 3 }
    ]);
    assert.strictEqual(options[2].selected, false);
    assert.strictEqual(options[3].selected, true);
  });

  test('detectAndFilterItems efficiently detects all options and filters by condition', async () => {
    const runner = new LoopReplayRunner({ runId: 'test_filter_items' });

    const mockDiscovery = {
      itemCount: 5,
      items: [
        { index: 0, text: 'Select All', fields: { Type: 'Select All', Option: 'Select All' } },
        { index: 1, text: 'Invoice', fields: { Type: 'Invoice', Option: 'Invoice' } },
        { index: 2, text: 'Transaction', fields: { Type: 'Transaction', Option: 'Transaction' } },
        { index: 3, text: 'Fuel Invoice', fields: { Type: 'Fuel Invoice', Option: 'Fuel Invoice' } },
        { index: 4, text: 'EFT Payment', fields: { Type: 'EFT Payment', Option: 'EFT Payment' } }
      ]
    };

    // Filter 1: Type contains "Invoice"
    const evaluatedInvoice = await runner.detectAndFilterItems(null, mockDiscovery, true, {
      column: 'Type',
      operator: 'contains',
      value: 'Invoice'
    });

    assert.strictEqual(evaluatedInvoice.length, 5);
    const matchingInvoice = evaluatedInvoice.filter(it => it.matches);
    const skippedInvoice = evaluatedInvoice.filter(it => !it.matches);

    assert.strictEqual(matchingInvoice.length, 2);
    assert.strictEqual(matchingInvoice[0].itemIdentifier.itemLabel, 'Invoice');
    assert.strictEqual(matchingInvoice[1].itemIdentifier.itemLabel, 'Fuel Invoice');

    assert.strictEqual(skippedInvoice.length, 3);
    assert.strictEqual(skippedInvoice[0].reason, 'Dropdown "Select All" control excluded from data items');

    // Filter 2: Type equals "Transaction"
    const evaluatedTransaction = await runner.detectAndFilterItems(null, mockDiscovery, true, {
      column: 'Type',
      operator: 'equals',
      value: 'Transaction'
    });

    const matchingTx = evaluatedTransaction.filter(it => it.matches);
    assert.strictEqual(matchingTx.length, 1);
    assert.strictEqual(matchingTx[0].itemIdentifier.itemLabel, 'Transaction');
  });

  test('executeDropdownOptionSingleSelect selects appropriate option without mass-deleting', async () => {
    const runner = new LoopReplayRunner({ runId: 'test_single_select' });

    // Mock page with DOM context
    const domOptions = [
      {
        textContent: 'Select All',
        selected: true,
        isConnected: true,
        getBoundingClientRect: () => ({ width: 100, height: 30 })
      },
      {
        textContent: 'Invoice',
        selected: true, // Selected because "Select All" was on
        isConnected: true,
        getBoundingClientRect: () => ({ width: 100, height: 30 })
      },
      {
        textContent: 'Transaction',
        selected: true,
        isConnected: true,
        getBoundingClientRect: () => ({ width: 100, height: 30 })
      }
    ];

    const mockPage = {
      evaluate: async (fn, targetIdx, expectedText) => {
        const origWindow = global.window;
        const origDoc = global.document;

        global.window = {
          getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
        };

        const elements = domOptions.map((opt, i) => {
          const el = {
            textContent: opt.textContent,
            innerText: opt.textContent,
            isConnected: opt.isConnected,
            getBoundingClientRect: opt.getBoundingClientRect,
            getAttribute: (attr) => attr === 'aria-selected' ? (opt.selected ? 'true' : 'false') : null,
            classList: {
              contains: (cls) => cls === 'mat-mdc-option-selected' && opt.selected
            },
            querySelector: (sel) => {
              if (sel.includes('mat-pseudo-checkbox-checked') && opt.selected) {
                return {};
              }
              return null;
            },
            click: () => {
              if (i === 0) {
                // Clicking Select All when checked unchecks everything
                domOptions.forEach(o => { o.selected = false; });
              } else {
                opt.selected = !opt.selected;
              }
            },
            scrollIntoView: () => {}
          };
          return el;
        });

        global.document = {
          querySelectorAll: (sel) => elements
        };

        try {
          return fn(targetIdx, expectedText);
        } finally {
          global.window = origWindow;
          global.document = origDoc;
        }
      }
    };

    // Step 1: Target "Invoice" when "Select All" was initially checked
    const res1 = await runner.executeDropdownOptionSingleSelect(mockPage, 1, 'Invoice');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.targetText, 'Invoice');
    assert.strictEqual(domOptions[0].selected, false, 'Select All should be uncheck');
    assert.strictEqual(domOptions[1].selected, true, 'Invoice should be selected');
    assert.strictEqual(domOptions[2].selected, false, 'Transaction should NOT be selected');

    // Step 2: Next iteration targets "Transaction"
    const res2 = await runner.executeDropdownOptionSingleSelect(mockPage, 2, 'Transaction');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.targetText, 'Transaction');
    assert.strictEqual(domOptions[0].selected, false, 'Select All should remain uncheck');
    assert.strictEqual(domOptions[1].selected, false, 'Invoice should now be uncheck');
    assert.strictEqual(domOptions[2].selected, true, 'Transaction should now be selected');
  });
});
