/**
 * Test Suite: Universal Exception / Interruption Handling & Intelligent Tab Management
 * 
 * Verifies:
 * 1. InterruptionHandler:
 *    - Normal workflow execution runs without perturbation (zero logic regression).
 *    - Native browser dialogs (alert, confirm, prompt) are intercepted and auto-accepted.
 *    - Lingering dialogs are cleared via CDP.
 *    - Blocking overlays/modals are detected and dismissed.
 *    - Actions blocked by interruptions are safely retried once.
 * 2. TabManager:
 *    - Dashboard and pre-existing tabs are strictly protected and never closed.
 *    - Primary portal page is accurately resolved and tracked.
 *    - Duplicate portal tabs are detected and reconciled.
 *    - Auxiliary workflow tabs (GUID document viewers, blobs) are safely cleaned up.
 *    - getPagesToCheck filters out dashboard tabs for element resolution.
 * 3. ReplayEngine integration points:
 *    - Both handlers are attached and wrapped cleanly around action dispatch.
 */

const assert = require('assert');
const InterruptionHandler = require('../src/replay/interruption-handler');
const TabManager = require('../src/replay/tab-manager');
const ReplayEngine = require('../src/replay/replay-engine');

async function runTests() {
  console.log('🧪 Starting Universal Exception & Tab Management Test Suite...\n');

  // =========================================================================
  // Part 1: InterruptionHandler Unit Tests
  // =========================================================================
  console.log('🔹 [Group 1] InterruptionHandler: Normal Execution & Dialog Handling');

  const handler = new InterruptionHandler({ autoAcceptDialogs: true });

  // Test 1.1: Normal execution without interruptions
  let normalExecCount = 0;
  const normalResult = await handler.executeWithRecovery(null, { type: 'CLICK', index: 0 }, async () => {
    normalExecCount++;
    return 'ok_result';
  });
  assert.strictEqual(normalResult, 'ok_result', 'Normal execution must return expected value');
  assert.strictEqual(normalExecCount, 1, 'Normal execution must invoke callback exactly once without retries');
  console.log('  ✅ Case A (Normal Workflow): Executes with zero alteration or overhead');

  // Test 1.2: Native dialog event interception
  let dialogAccepted = false;
  let dialogTypeReported = '';
  const mockDialog = {
    type: () => 'alert',
    message: () => 'You must select one or more EFT Documents to download.',
    accept: async () => { dialogAccepted = true; },
    dismiss: async () => {}
  };

  const mockPageListeners = {};
  const mockPage = {
    url: () => 'https://customerportal.usoil.com/#/message-center',
    isClosed: () => false,
    on: (evt, fn) => { mockPageListeners[evt] = fn; },
    off: (evt, fn) => { delete mockPageListeners[evt]; },
    evaluate: async (fn) => false
  };

  handler.attachToPage(mockPage);
  assert.ok(mockPageListeners['dialog'], 'Page must have dialog listener attached');

  // Trigger the dialog event
  await mockPageListeners['dialog'](mockDialog);
  assert.strictEqual(dialogAccepted, true, 'Dialog must be auto-accepted');
  const history = handler.getInterruptionLog();
  assert.ok(history.length >= 1, 'Interruption must be logged');
  assert.strictEqual(history[0].dialogType, 'alert');
  assert.ok(history[0].message.includes('EFT Documents'), 'Logged message must match intercepted alert');
  console.log('  ✅ Case B (Native Dialog): EFT alert intercepted and auto-accepted cleanly');

  // Test 1.3: Lingering dialog clearance via CDP
  let cdpCommandSent = null;
  const mockTarget = {
    createCDPSession: async () => ({
      send: async (cmd, params) => {
        cdpCommandSent = { cmd, params };
      },
      detach: async () => {}
    })
  };
  const mockCdpPage = {
    isClosed: () => false,
    target: () => mockTarget
  };

  const cleared = await handler.clearLingeringDialogs(mockCdpPage);
  assert.strictEqual(cleared, true, 'Lingering dialog must report cleared');
  assert.strictEqual(cdpCommandSent.cmd, 'Page.handleJavaScriptDialog', 'CDP command must be Page.handleJavaScriptDialog');
  assert.strictEqual(cdpCommandSent.params.accept, true, 'CDP command must accept dialog');
  console.log('  ✅ Case C (Lingering Dialog): CDP Page.handleJavaScriptDialog cleared lingering alert');

  // Test 1.4: Reactive recovery on interruption error
  let attemptCount = 0;
  let simulatedLingeringDialog = true;

  const mockRecoverablePage = {
    url: () => 'https://customerportal.usoil.com',
    isClosed: () => false,
    target: () => ({
      createCDPSession: async () => ({
        send: async () => { simulatedLingeringDialog = false; },
        detach: async () => {}
      })
    }),
    evaluate: async () => false
  };

  const recoveredResult = await handler.executeWithRecovery(
    mockRecoverablePage,
    { type: 'CLICK', index: 1 },
    async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error('Click timeout: waiting for dialog or element obscured');
      }
      return 'recovered_success';
    }
  );

  assert.strictEqual(attemptCount, 2, 'Action must be retried after interruption recovery');
  assert.strictEqual(recoveredResult, 'recovered_success', 'Retried action must return success');
  console.log('  ✅ Case D (Reactive Recovery): Action recovered and retried successfully upon interruption');

  // Test 1.5: Non-interruption errors are propagated cleanly
  let nonInterruptionFailed = false;
  try {
    await handler.executeWithRecovery(null, { type: 'CLICK', index: 2 }, async () => {
      throw new Error('Fatal validation error: invalid formula');
    });
  } catch (err) {
    nonInterruptionFailed = true;
    assert.ok(err.message.includes('Fatal validation error'), 'Original non-interruption error must be preserved');
  }
  assert.strictEqual(nonInterruptionFailed, true, 'Non-interruption error must throw immediately without spurious retries');
  console.log('  ✅ Case E (Error Propagation): Genuine non-interruption error propagated unchanged');

  // DOM element simulation helper for overlay & modal testing
  function createTestDOM(elements) {
    function matches(node, sel) {
      sel = sel.trim();
      if (sel === '*') return true;
      // Support compound tag.class e.g. button.x or button.close
      if (sel.includes('.')) {
        const [tag, ...classes] = sel.split('.');
        if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        return classes.every(c => node.classList && node.classList.contains(c));
      }
      if (sel.startsWith('#')) {
        return node.id === sel.slice(1);
      }
      // Support compound tag[attr=val] or [attr=val]
      if (sel.includes('[') && sel.endsWith(']')) {
        const bracketIndex = sel.indexOf('[');
        const tag = sel.slice(0, bracketIndex);
        if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        const inner = sel.slice(bracketIndex + 1, -1);
        if (inner.includes('*=')) {
          const [attr, rawVal] = inner.split('*=');
          const val = rawVal.replace(/['"i\s]/g, '').toLowerCase();
          const attrVal = (node.getAttribute(attr.trim()) || '').toLowerCase();
          return attrVal.includes(val);
        }
        if (inner.includes('=')) {
          const [attr, rawVal] = inner.split('=');
          const val = rawVal.replace(/['"]/g, '');
          return node.getAttribute(attr.trim()) === val;
        }
        return Boolean(node.getAttribute(inner));
      }
      return node.tagName.toLowerCase() === sel.toLowerCase();
    }

    function queryAllIn(node, selector) {
      const parts = selector.split(',').map(s => s.trim());
      const results = [];
      function recurse(n) {
        for (const part of parts) {
          if (part.includes(' ')) {
            const sub = part.split(/\s+/);
            if (sub.length === 2 && matches(n, sub[1])) {
              let p = n.parent;
              while (p) {
                if (matches(p, sub[0])) { results.push(n); break; }
                p = p.parent;
              }
            }
          } else if (matches(n, part)) {
            results.push(n);
          }
        }
        if (n.children) {
          for (const c of n.children) recurse(c);
        }
      }
      if (node.children) {
        for (const c of node.children) recurse(c);
      }
      return results;
    }

    function buildNode(spec, parent = null) {
      const n = {
        nodeType: 1,
        tagName: (spec.tag || 'div').toUpperCase(),
        className: spec.className || '',
        id: spec.id || '',
        style: spec.style || {},
        classList: {
          contains: (c) => (spec.className || '').split(/\s+/).includes(c)
        },
        attributes: { ...(spec.attributes || {}) },
        getAttribute: (k) => n.attributes[k] || (k === 'id' ? n.id : (k === 'class' ? n.className : null)),
        hasAttribute: (k) => Boolean(n.attributes[k] || (k === 'id' && n.id) || (k === 'class' && n.className)),
        textContent: spec.text || '',
        value: spec.value || '',
        clicked: false,
        styleDisplay: 'block',
        click: () => {
          n.clicked = true;
          // When button is clicked, simulate closing container
          let curr = n;
          while (curr) {
            curr.styleDisplay = 'none';
            curr = curr.parent;
          }
        },
        focus: () => {},
        dispatchEvent: (evt) => {},
        getBoundingClientRect: () => spec.rect || ({ width: 80, height: 40, top: 10, left: 10 }),
        parent,
        children: []
      };
      if (spec.children) {
        n.children = spec.children.map(c => buildNode(c, n));
      }
      n.querySelectorAll = (sel) => queryAllIn(n, sel);
      n.querySelector = (sel) => queryAllIn(n, sel)[0] || null;
      return n;
    }

    const rootNodes = elements.map(e => buildNode(e));
    const mockDoc = {
      querySelectorAll: (sel) => {
        const res = [];
        for (const r of rootNodes) {
          res.push(...queryAllIn({ children: [r] }, sel));
        }
        return res;
      },
      querySelector: (sel) => mockDoc.querySelectorAll(sel)[0] || null
    };

    return {
      rootNodes,
      mockDoc,
      createPage: () => ({
        url: () => 'https://customerportal.usoil.com',
        isClosed: () => false,
        evaluate: async (fn, ...args) => {
          const origDoc = global.document;
          const origWin = global.window;
          const origMouse = global.MouseEvent;
          try {
            global.document = mockDoc;
            global.window = {
              innerWidth: 1024,
              innerHeight: 768,
              getComputedStyle: (el) => ({
                display: (el && el.styleDisplay) || (el?.style?.display) || 'block',
                visibility: 'visible',
                opacity: '1',
                position: el?.style?.position || 'static',
                zIndex: el?.style?.zIndex || 'auto'
              })
            };
            global.MouseEvent = class { constructor(t) { this.type = t; } };
            return await fn(...args);
          } finally {
            global.document = origDoc;
            global.window = origWin;
            global.MouseEvent = origMouse;
          }
        }
      })
    };
  }

  // Test 1.6: Case F (Quick survey popup with close cross button)
  const surveyDom = createTestDOM([{
    tag: 'div',
    className: 'overlay',
    attributes: { 'data-testid': 'survey-modal' },
    children: [{
      tag: 'div',
      className: 'modal',
      children: [
        {
          tag: 'button',
          className: 'x',
          attributes: { 'aria-label': 'Close', 'data-testid': 'modal-close' },
          text: '×'
        },
        { tag: 'h3', text: 'Quick survey' },
        { tag: 'p', text: 'How was your experience?' },
        { tag: 'button', id: 'surveySkip', text: 'Skip' },
        { tag: 'button', id: 'surveySubmit', text: 'Submit' }
      ]
    }]
  }]);

  const surveyPage = surveyDom.createPage();
  const surveyDismissed = await handler.dismissBlockingOverlays(surveyPage);
  assert.strictEqual(surveyDismissed, true, 'Survey modal must be detected and dismissed');
  const crossBtn = surveyDom.mockDoc.querySelector('button.x');
  assert.strictEqual(crossBtn.clicked, true, 'Survey close cross button must be clicked');
  console.log('  ✅ Case F (Survey Popup): "Quick survey" modal cross button [×] detected and clicked');

  // Test 1.7: Case G (Survey modal without cross button falls back to "Skip" button)
  const skipDom = createTestDOM([{
    tag: 'div',
    className: 'overlay',
    attributes: { 'data-testid': 'survey-modal' },
    children: [{
      tag: 'div',
      className: 'modal',
      children: [
        { tag: 'h3', text: 'Quick survey' },
        { tag: 'button', id: 'surveySkip', text: 'Skip' },
        { tag: 'button', id: 'surveySubmit', text: 'Submit' }
      ]
    }]
  }]);
  const skipPage = skipDom.createPage();
  const skipDismissed = await handler.dismissBlockingOverlays(skipPage);
  assert.strictEqual(skipDismissed, true, 'Survey modal must be dismissed via Skip button');
  const skipBtn = skipDom.mockDoc.querySelector('#surveySkip');
  assert.strictEqual(skipBtn.clicked, true, 'Skip button must be clicked');
  console.log('  ✅ Case G (Skip Fallback): "Quick survey" modal dismissed via [Skip] button');

  // Test 1.8: Case H (Newsletter modal with "No thanks" / close cross)
  const newsDom = createTestDOM([{
    tag: 'div',
    className: 'modal',
    children: [
      { tag: 'h3', text: 'Subscribe to newsletter' },
      { tag: 'button', id: 'newsNo', text: 'No thanks' },
      { tag: 'button', id: 'newsYes', text: 'Subscribe' }
    ]
  }]);
  const newsPage = newsDom.createPage();
  const newsDismissed = await handler.dismissBlockingOverlays(newsPage);
  assert.strictEqual(newsDismissed, true, 'Newsletter modal must be dismissed');
  const newsNoBtn = newsDom.mockDoc.querySelector('#newsNo');
  assert.strictEqual(newsNoBtn.clicked, true, 'No thanks button must be clicked');
  console.log('  ✅ Case H (Newsletter Modal): Dismissed via [No thanks] button');

  // Test 1.9: Case I (Session timeout modal with "Stay signed in")
  const sessionDom = createTestDOM([{
    tag: 'div',
    className: 'overlay',
    children: [{
      tag: 'div',
      className: 'modal',
      children: [
        { tag: 'h3', text: 'Your session is expiring' },
        { tag: 'button', id: 'sessStay', text: 'Stay signed in' }
      ]
    }]
  }]);
  const sessPage = sessionDom.createPage();
  const sessDismissed = await handler.dismissBlockingOverlays(sessPage);
  assert.strictEqual(sessDismissed, true, 'Session expiring modal must be dismissed');
  const sessBtn = sessionDom.mockDoc.querySelector('#sessStay');
  assert.strictEqual(sessBtn.clicked, true, 'Stay signed in button must be clicked');
  console.log('  ✅ Case I (Session Modal): Dismissed via [Stay signed in] button');

  // Test 1.10: Case J (Cookie banner with "Decline")
  const cookieDom = createTestDOM([{
    tag: 'div',
    id: 'cookie',
    children: [
      { tag: 'p', text: 'We use cookies' },
      { tag: 'button', id: 'cookieDecline', text: 'Decline' },
      { tag: 'button', id: 'cookieAccept', text: 'Accept' }
    ]
  }]);
  const cookiePage = cookieDom.createPage();
  const cookieDismissed = await handler.dismissBlockingOverlays(cookiePage);
  assert.strictEqual(cookieDismissed, true, 'Cookie banner must be dismissed');
  const cookieBtn = cookieDom.mockDoc.querySelector('#cookieDecline');
  assert.strictEqual(cookieBtn.clicked, true, 'Decline button must be clicked');
  console.log('  ✅ Case J (Cookie Banner): Dismissed via [Decline] button');

  // Test 1.11: Case K (Target Protection: Modal containing intended action target is NOT dismissed)
  const intentionalDom = createTestDOM([{
    tag: 'div',
    className: 'modal show',
    children: [
      { tag: 'button', className: 'close', text: '×' },
      { tag: 'input', id: 'accountNotes', attributes: { id: 'accountNotes' } },
      { tag: 'button', id: 'saveNotes', text: 'Save' }
    ]
  }]);
  const intentionalPage = intentionalDom.createPage();
  const intentionalAction = {
    type: 'TYPE',
    target: {
      candidates: [{ strategy: 'id', value: '#accountNotes' }]
    }
  };
  const intentionalDismissed = await handler.dismissBlockingOverlays(intentionalPage, intentionalAction);
  assert.strictEqual(intentionalDismissed, false, 'Modal containing intended workflow target MUST NOT be dismissed');
  const closeBtn = intentionalDom.mockDoc.querySelector('button.close');
  assert.strictEqual(closeBtn.clicked, false, 'Close button of intentional modal must NOT be clicked');
  console.log('  ✅ Case K (Target Protection): Intentional workflow modal preserved and protected');

  // Test 1.12: Case L (Proactive Dismissal: Popups dismissed before action runs)
  const proactiveDom = createTestDOM([{
    tag: 'div',
    className: 'overlay',
    children: [{
      tag: 'div',
      className: 'modal',
      children: [
        { tag: 'button', className: 'x', text: '×' }
      ]
    }]
  }]);
  const proactivePage = proactiveDom.createPage();
  let actionExecuted = false;
  await handler.executeWithRecovery(proactivePage, { type: 'CLICK', index: 0 }, async () => {
    actionExecuted = true;
    return 'done';
  });
  assert.strictEqual(actionExecuted, true, 'Action must execute cleanly');
  const proactiveCross = proactiveDom.mockDoc.querySelector('button.x');
  assert.strictEqual(proactiveCross.clicked, true, 'Popup must be proactively dismissed before action');
  console.log('  ✅ Case L (Proactive Dismissal): Popup crossed proactively before action execution');

  // Test 1.13: Case M (Generic Custom Popup on Arbitrary Site via Geometry Scan)
  const customSiteDom = createTestDOM([{
    tag: 'div',
    style: { position: 'fixed', zIndex: '9999' },
    rect: { width: 450, height: 350, top: 120, left: 200 },
    children: [
      {
        tag: 'button',
        className: 'custom-btn-29',
        attributes: { 'aria-label': 'Close' },
        rect: { width: 30, height: 30, top: 130, left: 610 },
        text: '✕'
      },
      { tag: 'h2', text: 'Special Promo!' }
    ]
  }]);
  const customSitePage = customSiteDom.createPage();
  const customDismissed = await handler.dismissBlockingOverlays(customSitePage);
  assert.strictEqual(customDismissed, true, 'Generic custom fixed popup must be detected and dismissed');
  const customCross = customSiteDom.mockDoc.querySelector('button.custom-btn-29');
  assert.strictEqual(customCross.clicked, true, 'Cross button [✕] must be clicked');
  console.log('  ✅ Case M (Generic Site Geometry): Arbitrary fixed popup detected via geometry scan and crossed [✕]');

  // Test 1.14: Case N (Tailwind-style Modal without semantic classes)
  const tailwindDom = createTestDOM([{
    tag: 'div',
    className: 'fixed inset-0 z-50 flex items-center justify-center',
    style: { position: 'fixed', zIndex: '50' },
    rect: { width: 1024, height: 768, top: 0, left: 0 },
    children: [{
      tag: 'div',
      className: 'bg-white p-6 rounded shadow-lg',
      rect: { width: 400, height: 300, top: 200, left: 300 },
      children: [
        {
          tag: 'button',
          id: 'tailwindClose',
          className: 'absolute top-3 right-3 text-gray-500',
          attributes: { 'title': 'Close modal' },
          text: '×'
        },
        { tag: 'p', text: 'Sign up for our newsletter' }
      ]
    }]
  }]);
  const tailwindPage = tailwindDom.createPage();
  const tailwindDismissed = await handler.dismissBlockingOverlays(tailwindPage);
  assert.strictEqual(tailwindDismissed, true, 'Tailwind-style modal must be detected and dismissed');
  const tailwindCross = tailwindDom.mockDoc.querySelector('#tailwindClose');
  assert.strictEqual(tailwindCross.clicked, true, 'Tailwind close cross must be clicked');
  console.log('  ✅ Case N (Tailwind Modal): Tailwind fixed z-50 modal cross button [×] detected and clicked');

  // Test 1.15: Case O (GDPR Cookie Banner with "Accept all" fallback)
  const gdprDom = createTestDOM([{
    tag: 'div',
    id: 'onetrust-banner-sdk',
    style: { position: 'fixed', zIndex: '1000' },
    rect: { width: 1024, height: 80, top: 688, left: 0 },
    children: [
      { tag: 'p', text: 'Cookies policy' },
      { tag: 'button', id: 'acceptCookiesBtn', text: 'Accept all cookies' }
    ]
  }]);
  const gdprPage = gdprDom.createPage();
  const gdprDismissed = await handler.dismissBlockingOverlays(gdprPage);
  assert.strictEqual(gdprDismissed, true, 'Cookie banner must be dismissed via Accept All fallback');
  const acceptBtn = gdprDom.mockDoc.querySelector('#acceptCookiesBtn');
  assert.strictEqual(acceptBtn.clicked, true, 'Accept all cookies button must be clicked');
  console.log('  ✅ Case O (GDPR Fallback): Banner dismissed via [Accept all cookies]');

  // Test 1.16: Case P (Multi-pass cascading dismissals: cookie banner + survey modal)
  const cascadingDom = createTestDOM([
    {
      tag: 'div',
      id: 'cookie',
      children: [
        { tag: 'button', id: 'cookieDecline', text: 'Decline' }
      ]
    },
    {
      tag: 'div',
      className: 'overlay',
      children: [{
        tag: 'div',
        className: 'modal',
        children: [
          { tag: 'button', className: 'x', text: '×' }
        ]
      }]
    }
  ]);
  const cascadingPage = cascadingDom.createPage();
  const cascadingDismissed = await handler.dismissBlockingOverlays(cascadingPage);
  assert.strictEqual(cascadingDismissed, true, 'Cascading overlays must both be dismissed in multiple passes');
  const cDecline = cascadingDom.mockDoc.querySelector('#cookieDecline');
  const cCross = cascadingDom.mockDoc.querySelector('button.x');
  assert.strictEqual(cDecline.clicked, true, 'Cookie decline must be clicked in pass 1');
  assert.strictEqual(cCross.clicked, true, 'Survey cross must be clicked in pass 2');
  console.log('  ✅ Case P (Multi-Pass Cascading): Cleared multiple cascading popups across passes');

  // Test 1.17: Case Q (Dropdown & Checkbox Option Preservation)
  const dropdownDom = createTestDOM([
    { tag: 'div', className: 'cdk-overlay-backdrop cdk-overlay-transparent-backdrop' },
    {
      tag: 'div',
      className: 'cdk-overlay-pane',
      children: [{
        tag: 'div',
        role: 'listbox',
        children: [
          {
            tag: 'mat-option',
            children: [
              { tag: 'span', className: 'mat-pseudo-checkbox' },
              { tag: 'span', text: '105992 - DIXIE HIGHWAY ENERGY, LLC' }
            ]
          }
        ]
      }]
    }
  ]);
  const dropdownPage = dropdownDom.createPage();
  const optionAction = {
    type: 'CLICK',
    name: '105992 - DIXIE HIGHWAY ENERGY, LLC... Checkbox',
    isCheckbox: true,
    target: {
      candidates: [
        { strategy: 'text', value: '//mat-option[normalize-space()=\'105992 - DIXIE HIGHWAY ENERGY, LLC\']' },
        { strategy: 'css-path', value: 'body > div:nth-of-type(3) > div:nth-of-type(2) > div > mat-option:nth-of-type(1) > span' }
      ],
      fingerprint: {
        tagName: 'span',
        isCheckbox: true,
        text: '105992 - DIXIE HIGHWAY ENERGY, LLC'
      }
    }
  };

  assert.strictEqual(handler.isOptionOrDropdownAction(optionAction), true, 'Must identify action as dropdown option/checkbox');
  const optionDismissed = await handler.dismissBlockingOverlays(dropdownPage, optionAction);
  assert.strictEqual(optionDismissed, false, 'Must NEVER dismiss or Escape open dropdown when selecting option/checkbox');
  console.log('  ✅ Case Q (Dropdown Option Preservation): Active dropdown panel and options preserved\n');

  // =========================================================================
  // Part 2: TabManager Unit Tests
  // =========================================================================
  console.log('🔹 [Group 2] TabManager: Intelligent Tab Resolution & Safe Cleanup');

  const tabManager = new TabManager({ interruptionHandler: handler });

  // Create mock browser and pages
  const closedPages = [];
  function createMockPage(url, id) {
    let closed = false;
    return {
      _id: id,
      url: () => url,
      isClosed: () => closed,
      close: async () => {
        closed = true;
        closedPages.push(url);
      },
      bringToFront: async () => {},
      evaluate: async () => true,
      target: () => ({ _targetId: id, url: () => url })
    };
  }

  const dashboardPage = createMockPage('http://localhost:3000/app#workflow/123', 'dash_tab');
  const portalPage = createMockPage('https://customerportal.usoil.com/#/message-center', 'portal_tab');
  const guidPage1 = createMockPage('https://customerportal.usoil.com/viewer/c211a36e-b133-466c-a32d-606019992929', 'guid_tab_1');
  const guidPage2 = createMockPage('https://customerportal.usoil.com/viewer/d20308ad-b238-4343-bf11-0a9918283838', 'guid_tab_2');

  const browserListeners = {};
  const mockBrowser = {
    pages: async () => [dashboardPage, portalPage, guidPage1, guidPage2],
    on: (evt, fn) => { browserListeners[evt] = fn; },
    off: (evt, fn) => { delete browserListeners[evt]; }
  };

  // Test 2.1: Initialize and resolve primary page (never pick dashboard)
  await tabManager.initialize(mockBrowser, null, {
    targetUrl: 'https://customerportal.usoil.com/#/message-center'
  });

  const resolvedPrimary = tabManager.getPrimaryPage();
  assert.strictEqual(resolvedPrimary, portalPage, 'Primary page must be the portal page, NEVER the dashboard');
  assert.ok(tabManager.protectedPageIds.has('dash_tab'), 'Dashboard tab must be marked as protected');
  assert.ok(tabManager.protectedPageIds.has('portal_tab'), 'Initial portal tab must be marked as protected');
  console.log('  ✅ Case A (Primary Tab Resolution): Portal page identified, dashboard protected');

  // Test 2.2: Duplicate tab detection on targetcreated
  const duplicatePortalPage = createMockPage('https://customerportal.usoil.com/#/message-center', 'dup_portal');
  let duplicateTarget = {
    type: () => 'page',
    page: async () => duplicatePortalPage
  };
  await browserListeners['targetcreated'](duplicateTarget);
  assert.ok(closedPages.includes('https://customerportal.usoil.com/#/message-center'), 'Duplicate portal tab must be closed');
  assert.strictEqual(portalPage.isClosed(), false, 'Original primary portal tab must NOT be closed');
  console.log('  ✅ Case B (Duplicate Tab): Redundant duplicate portal tab detected and safely closed');

  // Test 2.3: Auxiliary tab cleanup (GUID tabs from screenshots)
  // Simulate auxiliary tabs created during execution
  const newGuidPage = createMockPage('https://customerportal.usoil.com/viewer/e512a36e-b133-466c-a32d-999999999999', 'new_guid');
  await browserListeners['targetcreated']({
    type: () => 'page',
    page: async () => newGuidPage
  });

  await tabManager.cleanupAuxiliaryTabs();
  assert.strictEqual(newGuidPage.isClosed(), true, 'New auxiliary GUID viewer tab must be closed');
  assert.strictEqual(dashboardPage.isClosed(), false, 'Dashboard tab must NEVER be closed');
  assert.strictEqual(portalPage.isClosed(), false, 'Primary portal tab must NEVER be closed');
  console.log('  ✅ Case C (Auxiliary Tab Cleanup): GUID auxiliary tab closed, dashboard & primary preserved');

  // Test 2.4: getPagesToCheck excludes dashboard
  const pagesToCheck = await tabManager.getPagesToCheck();
  const urlsToCheck = pagesToCheck.map(p => p.url());
  assert.ok(urlsToCheck.includes('https://customerportal.usoil.com/#/message-center'), 'Must check portal page');
  assert.ok(!urlsToCheck.some(u => u.includes('localhost:3000')), 'Must NEVER include dashboard page in resolution check');
  console.log('  ✅ Case D (Isolation): getPagesToCheck strictly excludes dashboard tab');

  // Test 2.5: GUID tab detection from latest user screenshot
  assert.strictEqual(
    tabManager._isAuxiliaryUrl('https://customerportal.usoil.com/viewer/a2f87723-04ee-4092-b858-690240958294'),
    true,
    'Screenshot tab a2f87723-... must be identified as auxiliary'
  );
  assert.strictEqual(
    tabManager._isAuxiliaryUrl('https://customerportal.usoil.com/viewer/9c3693e4-018c-4347-801a-829402948201'),
    true,
    'Screenshot tab 9c3693e4-... must be identified as auxiliary'
  );
  assert.strictEqual(
    tabManager._isAuxiliaryUrl('https://customerportal.usoil.com/#/message-center'),
    false,
    'Main portal workflow tab must NEVER be identified as auxiliary'
  );
  console.log('  ✅ Case E (Screenshot GUID Tabs): Detected as auxiliary, main workflow preserved');

  // Test 2.6: Returning to main workflow via ensurePrimaryTabActive
  let primaryBroughtToFront = false;
  portalPage.bringToFront = async () => { primaryBroughtToFront = true; };
  const mockEngine = { page: newGuidPage };
  await tabManager.ensurePrimaryTabActive(mockEngine);
  assert.strictEqual(mockEngine.page, portalPage, 'Engine page must be restored to primaryPage');
  assert.strictEqual(primaryBroughtToFront, true, 'Primary portal page must be brought to the front');
  console.log('  ✅ Case F (Return to Main Workflow): Active tab and focus restored to primary workflow\n');

  // =========================================================================
  // Part 3: ReplayEngine Integration Verification
  // =========================================================================
  console.log('🔹 [Group 3] ReplayEngine: Architecture & Integration Points');

  const engine = new ReplayEngine();
  assert.ok(engine.interruptionHandler instanceof InterruptionHandler, 'ReplayEngine must have interruptionHandler instance');
  assert.ok(engine.tabManager instanceof TabManager, 'ReplayEngine must have tabManager instance');

  // Verify disconnect cleanup
  let tabManagerDestroyed = false;
  engine.tabManager.destroy = () => { tabManagerDestroyed = true; };
  await engine.disconnect();
  assert.strictEqual(tabManagerDestroyed, true, 'engine.disconnect must safely destroy tabManager listeners');
  console.log('  ✅ Case A (ReplayEngine Lifecycle): Handlers instantiated and safely destroyed on disconnect');

  console.log('\n🎉 ALL UNIVERSAL EXCEPTION & TAB MANAGEMENT TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
