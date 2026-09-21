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
});
