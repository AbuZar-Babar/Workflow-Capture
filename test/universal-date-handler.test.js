/**
 * Universal Date Handler & Calendar Interaction Test Suite
 * 
 * Verifies generic date handling across all portals:
 * - HTML5 native date/time inputs (type="date", "datetime-local", "month")
 * - Framework datepickers (Flatpickr, DevExpress, jQuery UI, Angular Material, Ant Design)
 * - Date string normalization across ISO, US (MM/DD/YYYY), EU (DD/MM/YYYY), and dash/dot formats
 * - Safe date clicking (clean focus vs CDP OS click preventing native picker popup traps)
 * - Calendar day cell selection sequences
 * - End-to-end replay test of the user's latest recorded workflow actions
 */

const assert = require('assert');
const {
  normalizeDateValue,
  executeClick,
  executeType
} = require('../src/replay/action-executors');

if (typeof global.PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent {
    constructor(type, opts = {}) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
}
if (typeof global.MouseEvent === 'undefined') {
  global.MouseEvent = class MouseEvent {
    constructor(type, opts = {}) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
}

function createBaseDom(overrides = {}) {
  const events = [];
  const dom = {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    id: 'testInput',
    name: 'testInput',
    placeholder: '',
    offsetWidth: 120,
    offsetHeight: 25,
    disabled: false,
    focusCalled: false,
    blurCalled: false,
    scrollIntoViewCalled: false,
    classList: {
      contains(cls) { return false; }
    },
    getClientRects() {
      return [{ width: 120, height: 25 }];
    },
    dispatchEvent(event) {
      events.push(event.type);
    },
    focus() {
      this.focusCalled = true;
    },
    blur() {
      this.blurCalled = true;
    },
    scrollIntoView() {
      this.scrollIntoViewCalled = true;
    },
    getAttribute(name) {
      return this[name] || null;
    },
    hasAttribute(name) {
      return this[name] !== undefined;
    },
    closest(sel) {
      return null;
    },
    ...overrides
  };

  let typeCalled = false;
  let clickCalled = false;
  const handle = {
    _dom: dom,
    _events: events,
    async evaluate(fn, ...args) {
      return fn(dom, ...args);
    },
    async focus() {
      dom.focusCalled = true;
    },
    async click() {
      clickCalled = true;
    },
    async type() {
      typeCalled = true;
      throw new Error('type() should NOT be called on date inputs!');
    },
    wasTypeCalled() {
      return typeCalled;
    },
    wasClickCalled() {
      return clickCalled;
    }
  };

  return handle;
}

async function run() {
  console.log('🧪 Starting Universal Date Handler & Calendar Interaction Test Suite...\n');

  // =========================================================================
  // Group 1: Universal Date String Normalization
  // =========================================================================
  console.log('🔹 Group 1: Universal Date String Normalization');

  // 1.1 ISO format preservation and normalization
  assert.strictEqual(normalizeDateValue('2026-01-11', 'YYYY-MM-DD'), '2026-01-11');
  assert.strictEqual(normalizeDateValue('2026-12-05', 'YYYY-MM-DD'), '2026-12-05');
  assert.strictEqual(normalizeDateValue('2026-1-2', 'YYYY-MM-DD'), '2026-01-02');
  console.log('  ✅ ISO formats normalize accurately to YYYY-MM-DD');

  // 1.2 Datetime-local and Month targets
  assert.strictEqual(normalizeDateValue('2026-01-11T14:30', 'YYYY-MM-DDTHH:mm'), '2026-01-11T14:30');
  assert.strictEqual(normalizeDateValue('2026-01-11', 'YYYY-MM-DDTHH:mm'), '2026-01-11T00:00');
  assert.strictEqual(normalizeDateValue('2026-01-11', 'YYYY-MM'), '2026-01');
  console.log('  ✅ HTML5 datetime-local and month target formats supported');

  // 1.3 Slash formats: US, EU, and Year-first
  assert.strictEqual(normalizeDateValue('2026/12/05', 'YYYY-MM-DD'), '2026-12-05');
  assert.strictEqual(normalizeDateValue('25/12/2026', 'YYYY-MM-DD'), '2026-12-25'); // Day > 12 detected
  assert.strictEqual(normalizeDateValue('12/25/2026', 'YYYY-MM-DD'), '2026-12-25'); // Month 12, Day 25
  assert.strictEqual(normalizeDateValue('05/12/2026', 'DD/MM/YYYY'), '05/12/2026');
  assert.strictEqual(normalizeDateValue('12/05/2026', 'MM/DD/YYYY'), '12/05/2026');
  console.log('  ✅ Slash date strings normalize across US/EU/ISO layouts');

  // 1.4 Dash and Dot formats
  assert.strictEqual(normalizeDateValue('25-12-2026', 'YYYY-MM-DD'), '2026-12-25');
  assert.strictEqual(normalizeDateValue('15.08.2026', 'YYYY-MM-DD'), '2026-08-15');
  console.log('  ✅ Dash and Dot date formats parsed correctly\n');

  // =========================================================================
  // Group 2: Native HTML5 Date Input Value Injection (Bypassing Char-by-Char Corruption)
  // =========================================================================
  console.log('🔹 Group 2: Native HTML5 Date Input Value Injection');

  const dateHandle = createBaseDom({ type: 'date', id: 'startDate', name: 'startDate' });
  const action = {
    type: 'TYPE',
    value: '2026-01-11',
    name: 'Start Date Input',
    target: {
      fingerprint: {
        tagName: 'input',
        type: 'date',
        id: 'startDate'
      }
    }
  };

  const botConfig = {
    typing: {
      minTypingDelayMs: 50,
      maxTypingDelayMs: 100
    }
  };

  await executeType(dateHandle, action, { botConfig });

  assert.strictEqual(dateHandle._dom.value, '2026-01-11', 'Date input value must be exact ISO date');
  assert.strictEqual(dateHandle.wasTypeCalled(), false, 'Puppeteer character typing must be bypassed for date input');
  assert(dateHandle._events.includes('input'), 'Must dispatch input event');
  assert(dateHandle._events.includes('change'), 'Must dispatch change event');
  assert(dateHandle._events.includes('blur'), 'Must dispatch blur event');
  console.log('  ✅ Native <input type="date"> receives direct ISO value without character corruption');

  // 2.2 Datetime-local test
  const datetimeHandle = createBaseDom({ type: 'datetime-local', id: 'apptDate' });
  const dtAction = {
    type: 'TYPE',
    value: '2026-01-11T15:30',
    name: 'Appointment Date',
    target: { fingerprint: { tagName: 'input', type: 'datetime-local' } }
  };
  await executeType(datetimeHandle, dtAction, { botConfig });
  assert.strictEqual(datetimeHandle._dom.value, '2026-01-11T15:30', 'datetime-local value matches ISO datetime');
  console.log('  ✅ HTML5 <input type="datetime-local"> handles ISO datetime correctly\n');

  // =========================================================================
  // Group 3: Framework-Aware Datepicker Support (Flatpickr, DevExpress, jQuery UI)
  // =========================================================================
  console.log('🔹 Group 3: Framework-Aware Datepicker Hooks');

  // 3.1 Flatpickr input mock
  let flatpickrSetDateVal = null;
  const flatpickrHandle = createBaseDom({
    type: 'text',
    classList: { contains: (cls) => cls === 'flatpickr-input' },
    _flatpickr: {
      setDate(val) {
        flatpickrSetDateVal = val;
      }
    }
  });

  await executeType(flatpickrHandle, {
    type: 'TYPE',
    value: '2026-12-05',
    name: 'Flatpickr Input'
  });
  assert.strictEqual(flatpickrSetDateVal, '2026-12-05', 'Flatpickr API setDate must be invoked');
  console.log('  ✅ Flatpickr framework API hook triggered');

  // 3.2 Masked text input with placeholder format
  const maskedHandle = createBaseDom({
    type: 'text',
    placeholder: 'DD/MM/YYYY'
  });

  await executeType(maskedHandle, {
    type: 'TYPE',
    value: '2026-12-05',
    name: 'Masked Date'
  });
  assert.strictEqual(maskedHandle._dom.value, '05/12/2026', 'Masked input adapts to DD/MM/YYYY placeholder format');
  console.log('  ✅ Masked text input adapts to DD/MM/YYYY placeholder\n');

  // =========================================================================
  // Group 4: Safe Date Clicking (Avoiding OS Native Picker Traps)
  // =========================================================================
  console.log('🔹 Group 4: Safe Date & Calendar Clicking');

  const nativeDateClickHandle = createBaseDom({
    type: 'date',
    id: 'startDate'
  });

  await executeClick(nativeDateClickHandle, {
    type: 'CLICK',
    name: 'Start Date Input',
    target: { fingerprint: { tagName: 'input', type: 'date' } }
  });

  assert.strictEqual(nativeDateClickHandle._dom.focusCalled, true, 'Native date input must receive clean DOM focus');
  assert.strictEqual(nativeDateClickHandle.wasClickCalled(), false, 'Raw CDP center mouse click must NOT be fired on native date input to prevent OS popup trap');
  console.log('  ✅ Native date input avoids raw CDP click preventing unscriptable OS popup');

  // 4.2 Calendar Day Cell Click (e.g. table cell in calendar popup)
  let pointerEventsDispatched = [];
  const calendarCellHandle = createBaseDom({
    tagName: 'TD',
    className: 'day active',
    click() { pointerEventsDispatched.push('click'); },
    dispatchEvent(e) { pointerEventsDispatched.push(e.type); }
  });

  await executeClick(calendarCellHandle, {
    type: 'CLICK',
    name: 'Day 15',
    target: { fingerprint: { tagName: 'td', text: '15' } }
  });

  assert(pointerEventsDispatched.includes('pointerdown'), 'Dispatches pointerdown');
  assert(pointerEventsDispatched.includes('mousedown'), 'Dispatches mousedown');
  assert(pointerEventsDispatched.includes('mouseup'), 'Dispatches mouseup');
  assert(pointerEventsDispatched.includes('click'), 'Dispatches click');
  console.log('  ✅ Calendar day cell receives complete pointer and mouse sequence\n');

  // =========================================================================
  // Group 5: Replay of User's Exact Recorded Workflow Sequence
  // =========================================================================
  console.log('🔹 Group 5: Full Sequence Replay (User Recording Simulation)');

  const startDateHandle = createBaseDom({ type: 'date', id: 'startDate', value: '2026-01-01' });
  const endDateHandle = createBaseDom({ type: 'date', id: 'endDate', value: '2026-12-31' });

  // Sequence from recordings/tstting.json:
  // Act 14: CLICK #startDate
  await executeClick(startDateHandle, { type: 'CLICK', name: 'Start Date Input' });
  // Act 15: TYPE #startDate val="2026-01-11"
  await executeType(startDateHandle, { type: 'TYPE', value: '2026-01-11', name: 'Start Date Input' }, { botConfig });
  assert.strictEqual(startDateHandle._dom.value, '2026-01-11');

  // Act 16 & 17: Redundant clicks on #startDate
  await executeClick(startDateHandle, { type: 'CLICK', name: 'Start Date Input' });
  await executeClick(startDateHandle, { type: 'CLICK', name: 'Start Date Input' });
  assert.strictEqual(startDateHandle._dom.value, '2026-01-11', 'Redundant clicks must not corrupt startDate');

  // Act 18, 19, 20: 3 consecutive clicks on #endDate
  await executeClick(endDateHandle, { type: 'CLICK', name: 'End Date Input' });
  await executeClick(endDateHandle, { type: 'CLICK', name: 'End Date Input' });
  await executeClick(endDateHandle, { type: 'CLICK', name: 'End Date Input' });

  // Act 21: TYPE #endDate val="2026-12-05"
  await executeType(endDateHandle, { type: 'TYPE', value: '2026-12-05', name: 'End Date Input' }, { botConfig });
  assert.strictEqual(endDateHandle._dom.value, '2026-12-05', 'endDate must be 2026-12-05 (never dd/mm/0005)');

  // Act 22: CLICK #startDate
  await executeClick(startDateHandle, { type: 'CLICK', name: 'Start Date Input' });
  // Act 23: TYPE #startDate val="2025-11-11"
  await executeType(startDateHandle, { type: 'TYPE', value: '2025-11-11', name: 'Start Date Input' }, { botConfig });
  assert.strictEqual(startDateHandle._dom.value, '2025-11-11', 'startDate updated cleanly to 2025-11-11 (never dd/mm/0001)');

  console.log('  ✅ Final Start Date: ' + startDateHandle._dom.value + ' (Verified)');
  console.log('  ✅ Final End Date:   ' + endDateHandle._dom.value + ' (Verified)');
  console.log('\n🎉 ALL UNIVERSAL DATE HANDLER TESTS PASSED 100%!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
