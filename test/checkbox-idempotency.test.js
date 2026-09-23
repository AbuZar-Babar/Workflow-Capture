const assert = require('assert');
const SelectorResolver = require('../src/shared/selector-resolver');
const { executeClick } = require('../src/replay/action-executors');

console.log('🧪 Starting Checkbox Idempotency & State-Aware Unit Tests...\n');

// Mock DOM element factory
function createMockElement(tag, attrs = {}, props = {}) {
  const attributes = { ...attrs };
  const classListSet = new Set((attrs.class || '').split(/\s+/).filter(Boolean));

  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    type: attrs.type || '',
    id: attrs.id || '',
    checked: props.checked !== undefined ? props.checked : false,
    textContent: props.textContent || '',
    getAttribute(name) {
      return attributes[name] !== undefined ? attributes[name] : null;
    },
    hasAttribute(name) {
      return attributes[name] !== undefined;
    },
    setAttribute(name, val) {
      attributes[name] = val;
    },
    classList: {
      contains(cls) {
        return classListSet.has(cls);
      },
      add(cls) {
        classListSet.add(cls);
      },
      remove(cls) {
        classListSet.delete(cls);
      }
    },
    closest(selector) {
      if (selector.includes('mat-checkbox') && attrs.isMatCheckbox) {
        return this;
      }
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 16, height: 16, x: 10, y: 10, top: 10, left: 10 };
    }
  };
}

// ------------------------------------------------------------
// Test 1: SelectorResolver captures isCheckbox and checked
// ------------------------------------------------------------
console.log('🔹 Test 1: SelectorResolver captures isCheckbox and checked state');

const nativeCb = createMockElement('input', { type: 'checkbox', id: 'chkAutoEmail' }, { checked: true });
const targetInfo = SelectorResolver.captureTarget(nativeCb);

assert.strictEqual(targetInfo.isCheckbox, true, 'Must identify native input checkbox');
assert.strictEqual(targetInfo.checked, true, 'Must capture checked=true state');
assert.strictEqual(targetInfo.fingerprint.isCheckbox, true);
assert.strictEqual(targetInfo.fingerprint.checked, true);
console.log('  ✅ Native input checkbox identified with checked=true');

const uncheckedNativeCb = createMockElement('input', { type: 'checkbox', id: 'chkSaveInvoice' }, { checked: false });
const uncheckedTarget = SelectorResolver.captureTarget(uncheckedNativeCb);
assert.strictEqual(uncheckedTarget.isCheckbox, true);
assert.strictEqual(uncheckedTarget.checked, false);
console.log('  ✅ Native input checkbox identified with checked=false');

const ariaCb = createMockElement('div', { role: 'checkbox', 'aria-checked': 'true' });
const ariaTarget = SelectorResolver.captureTarget(ariaCb);
assert.strictEqual(ariaTarget.isCheckbox, true, 'Must identify role="checkbox"');
assert.strictEqual(ariaTarget.checked, true, 'Must read aria-checked="true"');
console.log('  ✅ ARIA role="checkbox" identified with checked=true');

// ------------------------------------------------------------
// Test 2: executeClick idempotency when checkbox is ALREADY in desiredState
// ------------------------------------------------------------
console.log('\n🔹 Test 2: executeClick skips click if checkbox is ALREADY in desiredState');

let clickCount = 0;
const mockPage = {};

const mockCheckboxHandle = {
  evaluate: async (fn, ...args) => {
    // Simulate DOM element in browser
    const mockEl = {
      tagName: 'INPUT',
      type: 'checkbox',
      checked: true, // Already checked
      offsetWidth: 20,
      offsetHeight: 20,
      getClientRects: () => [{ width: 20, height: 20 }],
      closest: () => null,
      querySelector: () => null,
      getAttribute: () => null,
      classList: { contains: () => false }
    };
    return fn(mockEl, ...args);
  },
  evaluateHandle: async (fn, ...args) => {
    return null;
  },
  click: async () => {
    clickCount++;
  },
  boundingBox: async () => ({ x: 10, y: 10, width: 20, height: 20 })
};

(async () => {
  // Action requesting desiredState: true
  const actionCheck = {
    type: 'CLICK',
    name: 'Auto Invoice Checkbox',
    elementName: 'Auto Invoice Checkbox',
    isCheckbox: true,
    desiredState: true,
    target: { candidates: [{ value: '#chkAutoInvoice' }] }
  };

  await executeClick(mockCheckboxHandle, actionCheck, { page: mockPage });
  assert.strictEqual(clickCount, 0, 'Click must be skipped because checkbox was already checked');
  console.log('  ✅ Click was successfully skipped because checkbox is already in desiredState=true (Idempotent!)');

  // ------------------------------------------------------------
  // Test 3: executeClick clicks checkbox when state differs from desiredState
  // ------------------------------------------------------------
  console.log('\n🔹 Test 3: executeClick clicks checkbox when state differs from desiredState');

  let checkboxState = false; // Currently unchecked
  let actualClickPerformed = 0;

  const mockTogglingCheckboxHandle = {
    evaluate: async (fn, ...args) => {
      const mockEl = {
        tagName: 'INPUT',
        type: 'checkbox',
        get checked() { return checkboxState; },
        offsetWidth: 20,
        offsetHeight: 20,
        getClientRects: () => [{ width: 20, height: 20 }],
        closest: () => null,
        querySelector: () => null,
        getAttribute: () => null,
        classList: { contains: () => false }
      };
      return fn(mockEl, ...args);
    },
    evaluateHandle: async () => null,
    click: async () => {
      actualClickPerformed++;
      checkboxState = true; // Toggle to checked
    },
    boundingBox: async () => ({ x: 10, y: 10, width: 20, height: 20 })
  };

  await executeClick(mockTogglingCheckboxHandle, actionCheck, { page: mockPage });
  assert.strictEqual(actualClickPerformed, 1, 'Click must be executed because checkbox was unchecked');
  assert.strictEqual(checkboxState, true, 'Checkbox must now be checked');
  console.log('  ✅ Click was executed and state toggled to desiredState=true');

  // Re-run the exact same action (REPEAT RUN)
  await executeClick(mockTogglingCheckboxHandle, actionCheck, { page: mockPage });
  assert.strictEqual(actualClickPerformed, 1, 'Click count must still be 1 (skipped on repeat)');
  console.log('  ✅ On workflow repeat, click is skipped and checkbox stays checked!');

  console.log('\n🎉 ALL CHECKBOX IDEMPOTENCY TESTS PASSED SUCCESSFULLY!');
})();
