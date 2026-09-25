/**
 * In-Page Recorder Script (Runs inside the browser context)
 * 
 * Injected on new document creation via CDP Page.addScriptToEvaluateOnNewDocument.
 * Captures user interactions (CLICK, DOUBLE_CLICK, TYPE, SELECT),
 * buffers text input to prevent per-keystroke noise, and streams actions
 * to Node.js via window.__workflowCaptureEmitAction.
 */

(function () {
  const CURRENT_RECORDER_VERSION = 7;

  // Clean up any listeners from a previous session
  if (typeof window.__workflowCaptureCleanup === 'function') {
    try { window.__workflowCaptureCleanup(); } catch { }
  }

  window.__workflowCaptureVersion = CURRENT_RECORDER_VERSION;
  window.__workflowCaptureInitialized = true;

  // Active input buffer to consolidate typing into a single TYPE action
  let activeInputBuffer = null;
  let isPaused = Boolean(window.__workflowCapturePaused);

  function isRecorderUiEvent(event) {
    const badge = document.getElementById('__workflow_capture_badge__');
    if (!badge) return false;
    const target = event?.target;
    if (target === badge || target?.closest?.('#__workflow_capture_badge__')) return true;
    try {
      return Boolean(event?.composedPath?.().includes(badge));
    } catch {
      return false;
    }
  }

  // Diagnostic stamp: records the last pointerdown/mousedown target/time/coordinates, regardless
  // of whether a click/action ever gets recorded for it. Lets you check,
  // after a session, whether the element/icon/canvas received input at all.
  function handlePointerDownDiag(event) {
    if (isRecorderUiEvent(event)) return;
    const target = event.target;
    if (!target) return;
    const isInsideIframe = (typeof window !== 'undefined' && window.self !== window.top);
    window.__workflowCaptureLastPointerDown = {
      tag: target.tagName,
      id: target.id || null,
      title: target.getAttribute?.('title') || null,
      classes: Array.from(target.classList || []),
      time: Date.now(),
      clientX: event.clientX,
      clientY: event.clientY,
      isCanvas: target.tagName === 'CANVAS',
      isIframe: isInsideIframe
    };
  }

  /**
   * Calculate normalized (0-1) coordinates and dimensions if target is a canvas
   */
  function buildCanvasCoordsIfApplicable(targetEl, event) {
    if (!targetEl || targetEl.tagName !== 'CANVAS') return null;
    try {
      const rect = targetEl.getBoundingClientRect();
      const width = rect.width || targetEl.clientWidth || 1;
      const height = rect.height || targetEl.clientHeight || 1;
      const clientX = event && event.clientX !== undefined ? event.clientX : (event && event.pageX ? event.pageX - window.scrollX : rect.left + width / 2);
      const clientY = event && event.clientY !== undefined ? event.clientY : (event && event.pageY ? event.pageY - window.scrollY : rect.top + height / 2);
      const offsetX = Math.max(0, Math.min(width, clientX - rect.left));
      const offsetY = Math.max(0, Math.min(height, clientY - rect.top));
      const relX = Number((offsetX / width).toFixed(4));
      const relY = Number((offsetY / height).toFixed(4));
      return {
        relX,
        relY,
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        canvasWidth: Math.round(width),
        canvasHeight: Math.round(height)
      };
    } catch {
      return null;
    }
  }

  /**
   * Target equality and container-aware matching for event deduplication
   */
  function isSameTarget(elA, elB) {
    if (!elA || !elB) return false;
    if (elA === elB) return true;
    if (elA.contains && elA.contains(elB)) return true;
    if (elB.contains && elB.contains(elA)) return true;
    const parentA = elA.closest && elA.closest('button, a, .dxm-item, .x-btn, [role="button"], [role="menuitem"], canvas');
    const parentB = elB.closest && elB.closest('button, a, .dxm-item, .x-btn, [role="button"], [role="menuitem"], canvas');
    if (parentA && parentB && parentA === parentB) return true;
    return false;
  }

  let pendingClickTimer = null;
  let pendingClickTarget = null;
  let pendingClickExtra = null;
  const DBL_CLICK_THRESHOLD_MS = 280;

  // Deduplication & pointer tracking
  let lastHandledEventTime = 0;
  let lastHandledTarget = null;

  /**
   * Flush any pending single click action immediately
   */
  function flushPendingClick() {
    if (pendingClickTimer) {
      clearTimeout(pendingClickTimer);
      pendingClickTimer = null;
      if (pendingClickTarget) {
        emitAction('CLICK', pendingClickTarget, pendingClickExtra || {});
      }
      pendingClickTarget = null;
      pendingClickExtra = null;
    }
  }

  /**
   * Fallback target generator if SelectorResolver is unavailable or encounters an error
   */
  function buildFallbackTarget(el) {
    const candidates = [];
    const tagName = (el.tagName || '').toLowerCase();
    const title = el.getAttribute?.('title') || (el.querySelector && el.querySelector('[title]')?.getAttribute?.('title')) || '';
    const id = el.id && !/^\d+$/.test(el.id) ? el.id : null;

    if (title) {
      candidates.push({ strategy: 'attribute', value: `${tagName}[title="${title.replace(/"/g, '\\"')}"]`, uniqueness: 1, priority: 3 });
      candidates.push({ strategy: 'attribute', value: `[title="${title.replace(/"/g, '\\"')}"]`, uniqueness: 1, priority: 3 });
      if (/save|export|pdf|print|download/i.test(title)) {
        candidates.push({ strategy: 'attribute', value: `[title*="save" i]`, uniqueness: 1, priority: 3 });
        candidates.push({ strategy: 'attribute', value: `[title*="export" i]`, uniqueness: 1, priority: 3 });
        candidates.push({ strategy: 'attribute', value: `[title*="download" i]`, uniqueness: 1, priority: 3 });
      }
    }

    if (id) {
      candidates.push({ strategy: 'id', value: `#${id}`, uniqueness: 1, priority: 1 });
    }

    if (tagName === 'canvas') {
      candidates.push({ strategy: 'tag', value: 'canvas', uniqueness: 1, priority: 5 });
      if (id) {
        candidates.push({ strategy: 'id', value: `#${id}`, uniqueness: 1, priority: 1 });
      }
      if (el.className && typeof el.className === 'string') {
        const firstClass = el.className.split(/\s+/).filter(Boolean)[0];
        if (firstClass) {
          candidates.push({ strategy: 'class', value: `canvas.${firstClass}`, uniqueness: 1, priority: 3 });
        }
      }
    }

    const toolbarItem = el.closest && el.closest('.dxm-item, [id*="Toolbar_Menu"], .x-btn');
    if (toolbarItem && toolbarItem !== el) {
      const tbTitle = toolbarItem.getAttribute?.('title');
      if (tbTitle) {
        candidates.push({ strategy: 'attribute', value: `li[title="${tbTitle.replace(/"/g, '\\"')}"]`, uniqueness: 1, priority: 3 });
      }
      if (toolbarItem.id) {
        candidates.push({ strategy: 'id', value: `#${toolbarItem.id}`, uniqueness: 1, priority: 1 });
      }
    }

    const text = (el.textContent || '').trim();
    if (text && text.length < 60) {
      candidates.push({ strategy: 'text', value: `//${tagName}[normalize-space()='${text}']`, uniqueness: 1, priority: 4 });
    }

    let friendlyName = title || text || (id ? id.replace(/[_\-]+/g, ' ') : '') || tagName;
    if (tagName === 'button' && !friendlyName.toLowerCase().includes('button')) friendlyName += ' Button';
    else if (tagName === 'input' && !friendlyName.toLowerCase().includes('field') && !friendlyName.toLowerCase().includes('input')) friendlyName += ' Field';

    return {
      candidates,
      friendlyName,
      elementName: friendlyName,
      fingerprint: {
        tagName,
        id,
        name: el.getAttribute?.('name') || null,
        type: el.getAttribute?.('type') || null,
        role: el.getAttribute?.('role') || null,
        text: text.slice(0, 100),
        classes: Array.from(el.classList || []),
        attributes: title ? { title } : {},
        dimensions: {
          width: Math.round(el.getBoundingClientRect?.().width || 0),
          height: Math.round(el.getBoundingClientRect?.().height || 0)
        }
      }
    };
  }

  /**
   * Safe helper to emit action to Node.js bridge across main frames and iframes
   */
  function emitAction(type, targetElement, extra = {}) {
    if (isPaused || !targetElement) return;

    // Normalize container clicks (e.g. DevExpress .dxm-content or .dxm-item) to inner icon if present
    if (targetElement.querySelector && !targetElement.getAttribute?.('title')) {
      const innerImg = targetElement.querySelector('img[title], [title]');
      if (innerImg && (targetElement.closest?.('.dxm-item, .x-btn, .toolbar') || targetElement.classList?.contains('dxm-content'))) {
        targetElement = innerImg;
      }
    }

    try {
      let target = null;
      if (window.SelectorResolver && typeof window.SelectorResolver.captureTarget === 'function') {
        try {
          target = window.SelectorResolver.captureTarget(targetElement);
        } catch (err) {
          console.warn('[Workflow Capture] captureTarget threw:', err);
        }
      }

      if (!target || !target.candidates || target.candidates.length === 0) {
        target = buildFallbackTarget(targetElement);
      }

      // Attach canvas coordinates to target payload if present
      if (extra.canvasCoords) {
        target.canvasCoords = extra.canvasCoords;
      }

      const isInsideIframe = (typeof window !== 'undefined' && window.self !== window.top);
      let frameInfo = null;
      if (isInsideIframe) {
        frameInfo = {
          isIframe: true,
          location: window.location.href,
          title: document.title || ''
        };
      }

      const friendlyName = target?.friendlyName || target?.elementName ||
        (window.SelectorResolver && typeof window.SelectorResolver.generateFriendlyName === 'function' ? window.SelectorResolver.generateFriendlyName(targetElement, target?.fingerprint) : null) ||
        'Element';

      const actionUid = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const cleanExtra = { ...extra };
      delete cleanExtra.canvasCoords;
      delete cleanExtra.captureTimestamp;
      const actionTimestamp = Date.now();

      const payload = {
        uid: actionUid,
        type,
        name: friendlyName,
        elementName: friendlyName,
        timestamp: actionTimestamp,
        captureTimestamp: Number(extra.captureTimestamp) || actionTimestamp,
        target,
        ...(frameInfo ? { frame: frameInfo } : {}),
        ...cleanExtra
      };

      // 1. PRIMARY ZERO-DEPENDENCY TRANSPORT: Native console transport
      // Dispatches via CDP page.on('console') across all execution contexts, iframes, and after navigations
      try {
        const msgStr = '__WORKFLOW_CAPTURE_ACTION__:' + JSON.stringify(payload);
        console.debug(msgStr);
        console.info(msgStr);
      } catch { }

      // 2. Direct function on current window (if CDP binding is present)
      try {
        if (typeof window.__workflowCaptureEmitAction === 'function') {
          window.__workflowCaptureEmitAction(payload);
        }
      } catch { }

      // 3. Fallback: Route to top/parent window
      if (isInsideIframe) {
        try {
          if (window.top && window.top !== window && typeof window.top.__workflowCaptureEmitAction === 'function') {
            window.top.__workflowCaptureEmitAction(payload);
          }
        } catch { }

        try {
          if (window.parent && window.parent !== window && typeof window.parent.__workflowCaptureEmitAction === 'function') {
            window.parent.__workflowCaptureEmitAction(payload);
          }
        } catch { }

        try {
          if (window.top && window.top !== window) {
            window.top.postMessage({
              type: '__WORKFLOW_CAPTURE_EMIT_ACTION__',
              payload
            }, '*');
          }
        } catch { }
      }

      // 4. Reachable opener window function
      try {
        if (window.opener && typeof window.opener.__workflowCaptureEmitAction === 'function') {
          window.opener.__workflowCaptureEmitAction(payload);
        }
      } catch { }
    } catch (err) {
      console.error('[Workflow Capture] Failed to capture action:', err);
    }
  }

  /**
   * Flush any active typing buffer as a single consolidated TYPE action
   */
  function flushInputBuffer() {
    if (!activeInputBuffer) return;
    const { element, value, isPassword, startTime } = activeInputBuffer;
    activeInputBuffer = null;

    if (isPaused) return;

    if (!element || !document.body || !document.body.contains(element)) return;

    // Redact password value
    const finalValue = isPassword ? '[REDACTED]' : value;

    emitAction('TYPE', element, {
      value: finalValue,
      captureTimestamp: startTime,
      meta: {
        isPassword,
        charCount: (value || '').length
      }
    });
  }

  /**
   * Input event handler: Buffers text instead of spamming per-keystroke actions
   */
  function handleInput(event) {
    if (isPaused || isRecorderUiEvent(event)) return;
    const target = event.target;
    if (!target || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    const isPassword = target.tagName === 'INPUT' && (target.type || '').toLowerCase() === 'password';
    const currentValue = target.value || '';

    if (activeInputBuffer && activeInputBuffer.element === target) {
      activeInputBuffer.value = currentValue;
    } else {
      flushInputBuffer();
      activeInputBuffer = {
        element: target,
        value: currentValue,
        isPassword,
        startTime: Date.now()
      };
    }
  }

  /**
   * Flush on blur or focusout
   */
  function handleBlur(event) {
    if (isPaused || isRecorderUiEvent(event)) return;
    if (activeInputBuffer && activeInputBuffer.element === event.target) {
      flushInputBuffer();
    }
  }

  /**
   * Keydown listener to detect Enter/Tab/Escape submission & key actions
   */
  function handleKeyDown(event) {
    if (isPaused || isRecorderUiEvent(event)) return;
    flushPendingClick();
    const key = event.key;
    const target = event.target;
    const captureTimestamp = Date.now();

    if (key === 'Enter') {
      if (activeInputBuffer && activeInputBuffer.element === target) {
        flushInputBuffer();
      }

      emitAction('KEY_PRESS', target || document.activeElement || document.body, {
        key: 'Enter',
        captureTimestamp,
        code: event.code || 'Enter',
        keyCode: event.keyCode || 13,
        value: 'Enter',
        meta: {
          key: 'Enter',
          isSubmit: true
        }
      });
    } else if (key === 'Tab' || key === 'Escape') {
      if (activeInputBuffer && activeInputBuffer.element === target) {
        flushInputBuffer();
      }
      emitAction('KEY_PRESS', target || document.activeElement || document.body, {
        key: key,
        captureTimestamp,
        code: event.code || key,
        keyCode: event.keyCode,
        value: key,
        meta: {
          key: key
        }
      });
    }
  }

  /**
   * Helper to detect if an element is or is part of a checkbox control
   */
  function detectCheckbox(element) {
    if (!element || element.nodeType !== 1) return null;

    if (element.tagName === 'INPUT' && (element.type || '').toLowerCase() === 'checkbox') {
      return { element, input: element };
    }
    if (element.getAttribute?.('role') === 'checkbox' || element.hasAttribute?.('aria-checked')) {
      return { element, input: null };
    }
    if (element.tagName === 'MAT-PSEUDO-CHECKBOX' || (element.classList && element.classList.contains('mat-pseudo-checkbox'))) {
      return { element, input: null };
    }

    const container = element.closest?.('mat-checkbox, dx-check-box, [role="checkbox"], label, .mat-mdc-checkbox, .dx-checkbox');
    if (container) {
      const innerInput = container.querySelector?.('input[type="checkbox"]');
      return { element: container, input: innerInput };
    }

    const childInput = element.querySelector?.('input[type="checkbox"]');
    if (childInput) {
      return { element, input: childInput };
    }

    return null;
  }

  /**
   * Helper to inspect the current or post-interaction checked state of a checkbox
   */
  function readCheckboxChecked(cbInfo) {
    if (!cbInfo || !cbInfo.element) return false;
    const { element, input } = cbInfo;

    if (input && typeof input.checked === 'boolean') {
      return Boolean(input.checked);
    }
    if (element.tagName === 'INPUT' && typeof element.checked === 'boolean') {
      return Boolean(element.checked);
    }

    const aria = element.getAttribute?.('aria-checked') ?? element.querySelector?.('[aria-checked]')?.getAttribute?.('aria-checked');
    if (aria !== null && aria !== undefined) {
      return aria === 'true';
    }

    if (element.classList) {
      if (element.classList.contains('mat-mdc-checkbox-checked') ||
          element.classList.contains('mat-checkbox-checked') ||
          element.classList.contains('dx-checkbox-checked') ||
          element.classList.contains('mat-pseudo-checkbox-checked') ||
          element.classList.contains('checked') ||
          element.classList.contains('is-checked')) {
        return true;
      }
    }
    const pseudo = element.querySelector?.('.mat-pseudo-checkbox-checked');
    if (pseudo) return true;

    return false;
  }

  /**
   * Change event handler for SELECT dropdowns and checkboxes/radios
   */
  function handleChange(event) {
    if (isPaused || isRecorderUiEvent(event)) return;
    const target = event.target;
    if (!target) return;
    const captureTimestamp = Date.now();

    if (target.tagName === 'SELECT') {
      const selectedOption = target.options[target.selectedIndex];
      const selectedValue = selectedOption ? selectedOption.value : target.value;
      const selectedText = selectedOption ? selectedOption.text.trim() : '';

      emitAction('SELECT', target, {
        value: selectedValue,
        captureTimestamp,
        meta: {
          text: selectedText,
          selectedIndex: target.selectedIndex
        }
      });
    } else if (target.tagName === 'INPUT' && (target.type || '').toLowerCase() === 'checkbox') {
      const isChecked = Boolean(target.checked);
      emitAction('CLICK', target, {
        isCheckbox: true,
        captureTimestamp,
        desiredState: isChecked,
        checked: isChecked,
        meta: {
          triggerSignal: 'change',
          checked: isChecked
        }
      });
    } else if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      if (activeInputBuffer && activeInputBuffer.element === target) {
        flushInputBuffer();
      }
    }
  }

  /**
   * Core interaction event processor for CLICK actions across multiple signals:
   * pointerdown, mousedown, click, mouseup, pointerup.
   * Deduplicates rapid signals on the same target within 250ms,
   * so an action is captured even if frameworks swallow click or use mousedown-only.
   */
  function handleInteractionEvent(event, signalType) {
    if (isPaused || isRecorderUiEvent(event)) return;
    const rawTarget = event.target;
    if (!rawTarget) return;

    // Don't record CLICK on select elements (handled by change)
    if (rawTarget.tagName === 'SELECT' || rawTarget.tagName === 'OPTION') {
      return;
    }

    // Flush any pending typing if clicking on a different element
    if (activeInputBuffer && activeInputBuffer.element !== rawTarget) {
      flushInputBuffer();
    }

    // Normalize container clicks (e.g. DevExpress .dxm-content or .dxm-item) to inner icon if present
    let target = rawTarget;
    if (target.querySelector && !target.getAttribute?.('title')) {
      const innerImg = target.querySelector('img[title], [title]');
      if (innerImg && (target.closest?.('.dxm-item, .x-btn, .toolbar') || target.classList?.contains('dxm-content'))) {
        target = innerImg;
      }
    }

    const now = Date.now();
    const canvasCoords = buildCanvasCoordsIfApplicable(rawTarget, event);

    // Double-click detection via W3C event.detail
    if (event.detail === 2) {
      lastHandledEventTime = now;
      lastHandledTarget = target;
      emitAction('DOUBLE_CLICK', target, {
        detail: 2,
        triggerSignal: signalType,
        captureTimestamp: now,
        ...(canvasCoords ? { canvasCoords } : {})
      });
      return;
    }

    // Deduplicate rapid signals on same target within 250ms
    if (lastHandledTarget && isSameTarget(lastHandledTarget, target) && (now - lastHandledEventTime) < 250) {
      return;
    }

    lastHandledEventTime = now;
    lastHandledTarget = target;

    // Checkbox State Detection:
    // If the element is a checkbox or checkbox label, delay emit by 35ms so DOM updates
    // and framework event handlers finish toggling the checked state.
    const cbInfo = detectCheckbox(target);
    if (cbInfo) {
      setTimeout(() => {
        const finalChecked = readCheckboxChecked(cbInfo);
        emitAction('CLICK', target, {
          detail: event.detail || 1,
          triggerSignal: signalType,
          captureTimestamp: now,
          isCheckbox: true,
          desiredState: finalChecked,
          checked: finalChecked,
          ...(canvasCoords ? { canvasCoords } : {})
        });
      }, 35);
      return;
    }

    emitAction('CLICK', target, {
      detail: event.detail || 1,
      triggerSignal: signalType,
      captureTimestamp: now,
      ...(canvasCoords ? { canvasCoords } : {})
    });
  }

  const onPointerDown = (e) => {
    handlePointerDownDiag(e);
    handleInteractionEvent(e, 'pointerdown');
  };
  const onMouseDown = (e) => {
    handlePointerDownDiag(e);
    handleInteractionEvent(e, 'mousedown');
  };
  const onClick = (e) => {
    handleInteractionEvent(e, 'click');
  };
  const onPointerUp = (e) => {
    handleInteractionEvent(e, 'pointerup');
  };
  const onMouseUp = (e) => {
    handleInteractionEvent(e, 'mouseup');
  };

  /**
   * Optional visual badge to let the user know recording is active in Chrome
   * Strictly rendered only on the top window, NEVER in child iframes
   */
  function renderRecordingBadge() {
    try {
      if (typeof window !== 'undefined' && window.self !== window.top) return;
    } catch { }

    if (document.getElementById('__workflow_capture_badge__')) return;
    const container = document.body || document.documentElement;
    if (!container) return;

    const badge = document.createElement('div');
    badge.id = '__workflow_capture_badge__';
    const shadow = badge.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; position: fixed; top: 14px; right: 14px; z-index: 2147483647; pointer-events: auto; font-family: "Plus Jakarta Sans", Inter, "Segoe UI", sans-serif; color-scheme: light; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .root { display: flex; align-items: center; gap: 9px; }
        .panel { width: 208px; padding: 11px; border: 1px solid rgba(255,255,255,.12); border-radius: 15px; background: #111827; color: #f8fafc; box-shadow: 0 12px 32px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.18); transform-origin: top right; animation: panel-in 160ms ease-out; }
        .is-collapsed .panel { display: none; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .topline, .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .topline { margin-bottom: 9px; }
        .status { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: #cbd5e1; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.16); }
        .paused .dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.16); }
        .saved .dot { background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,.16); }
        .count { white-space: nowrap; border: 1px solid rgba(148,163,184,.24); border-radius: 7px; padding: 4px 7px; background: rgba(255,255,255,.05); color: #e2e8f0; font: 700 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
        .actions { justify-content: flex-start; }
        .saved-message { color: #cbd5e1; font-size: 12px; font-weight: 600; }
        button { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 9px; border: 1px solid rgba(148,163,184,.22); border-radius: 8px; background: rgba(255,255,255,.07); color: #f8fafc; font: 650 11px/1 "Plus Jakarta Sans", Inter, "Segoe UI", sans-serif; cursor: pointer; transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease; }
        button:hover { background: rgba(255,255,255,.13); border-color: rgba(148,163,184,.42); }
        button:active { transform: translateY(1px); }
        button:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
        .save { margin-left: auto; border-color: #4f46e5; background: #4f46e5; }
        .save:hover { border-color: #4338ca; background: #4338ca; }
        button:disabled { opacity: .6; cursor: wait; }
        svg { width: 14px; height: 14px; flex: none; }
        .mascot { width: 48px; height: 48px; position: relative; display: grid; place-items: center; padding: 4px; border: 1px solid rgba(199,210,254,.85); border-radius: 15px; background: linear-gradient(145deg,#fff,#dbeafe); box-shadow: 0 8px 24px rgba(15,23,42,.28), 0 0 0 4px rgba(99,102,241,.12); cursor: pointer; }
        .is-paused .mascot { border-color: #fbbf24; box-shadow: 0 8px 24px rgba(15,23,42,.28), 0 0 0 4px rgba(245,158,11,.16); }
        .mascot:hover { transform: translateY(-1px); border-color: #818cf8; }
        .mascot svg { width: 38px; height: 38px; }
        .mini-count { position: absolute; top: -7px; right: -8px; min-width: 20px; height: 20px; display: grid; place-items: center; padding: 0 5px; border: 2px solid #111827; border-radius: 10px; background: #4f46e5; color: #fff; font: 700 9px/1 ui-monospace, monospace; }
        .close { width: 23px; min-height: 23px; padding: 0; border: 0; background: transparent; color: #94a3b8; font-size: 15px; }
        .close:hover { background: rgba(255,255,255,.1); color: #fff; }
        @media (prefers-reduced-motion: reduce) { .panel, button { animation: none; transition: none; } }
      </style>
      <div class="root">
        <section class="panel" aria-label="Workflow recorder controls">
          <div class="topline">
            <div class="status"><span class="dot"></span><span id="statusText" role="status" aria-live="polite">CAPTURING</span></div>
            <span class="count" id="stepCount" aria-live="polite">0 steps</span>
            <button class="close" id="closeButton" type="button" aria-label="Collapse recorder controls" title="Minimize">−</button>
          </div>
          <div class="actions">
            <button id="pauseButton" type="button" aria-label="Pause workflow capture">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 3h3v10H4zm5 0h3v10H9z"/></svg><span>Pause</span>
            </button>
            <button id="resumeButton" type="button" aria-label="Resume workflow capture" hidden>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.8v10.4c0 .5.5.8.9.5l8-5.2a.6.6 0 0 0 0-1l-8-5.2a.6.6 0 0 0-.9.5Z"/></svg><span>Resume</span>
            </button>
            <button class="save" id="saveButton" type="button" aria-label="Stop recording and save workflow">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2h8l2 2v10H3V2Zm2 1v4h6V3H5Zm0 7v3h6v-3H5Z"/></svg><span>Save</span>
            </button>
          </div>
        </section>
        <button class="mascot" id="mascotButton" type="button" aria-label="Collapse recorder controls" title="Workflow recorder">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect x="7" y="18" width="50" height="34" rx="16" fill="#f8fafc" stroke="#a5b4fc" stroke-width="2"/>
            <rect x="14" y="23" width="36" height="19" rx="9" fill="#172033"/>
            <circle cx="24" cy="32" r="3" fill="#38bdf8"/><circle cx="40" cy="32" r="3" fill="#38bdf8"/>
            <path d="M20 47h24l-3 9H23z" fill="#e0e7ff" stroke="#a5b4fc" stroke-width="1.5"/>
            <circle cx="32" cy="51" r="2.5" fill="#6366f1"/>
            <path d="M5 30h4M55 30h4M32 11v6" stroke="#818cf8" stroke-width="2" stroke-linecap="round"/>
            <circle cx="32" cy="9" r="2.5" fill="#38bdf8"/>
          </svg>
          <span class="mini-count" id="miniCount" aria-hidden="true">0</span>
        </button>
      </div>`;
    const pauseButton = shadow.getElementById('pauseButton');
    const resumeButton = shadow.getElementById('resumeButton');
    const saveButton = shadow.getElementById('saveButton');
    const closeButton = shadow.getElementById('closeButton');
    const mascotButton = shadow.getElementById('mascotButton');
    const root = shadow.querySelector('.root');
    const toggleControls = () => {
      const isCollapsed = root.classList.toggle('is-collapsed');
      mascotButton.setAttribute('aria-label', isCollapsed ? 'Open recorder controls' : 'Collapse recorder controls');
      if (isCollapsed) mascotButton.focus();
    };
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleControls();
    });
    mascotButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleControls();
    });
    const ignoreControlEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    pauseButton.addEventListener('click', async (event) => {
      ignoreControlEvent(event);
      pauseButton.disabled = true;
      try {
        await window.__workflowCapturePause?.();
      } catch (error) {
        pauseButton.disabled = false;
        console.error('[Workflow Capture] Could not pause recording:', error);
      }
    });
    resumeButton.addEventListener('click', async (event) => {
      ignoreControlEvent(event);
      resumeButton.disabled = true;
      try {
        await window.__workflowCaptureResume?.();
      } catch (error) {
        resumeButton.disabled = false;
        console.error('[Workflow Capture] Could not resume recording:', error);
      }
    });
    saveButton.addEventListener('click', async (event) => {
      ignoreControlEvent(event);
      saveButton.disabled = true;
      saveButton.querySelector('span').textContent = 'Saving…';
      try {
        await window.__workflowCaptureSave?.();
      } catch (error) {
        saveButton.disabled = false;
        saveButton.querySelector('span').textContent = 'Save';
        console.error('[Workflow Capture] Could not save recording:', error);
      }
    });
    Object.assign(badge.style, {
      position: 'fixed',
      top: '14px',
      right: '14px',
      zIndex: '2147483647',
      pointerEvents: 'auto'
    });
    badge.style.setProperty('position', 'fixed', 'important');
    badge.style.setProperty('top', '14px', 'important');
    badge.style.setProperty('right', '14px', 'important');
    badge.style.setProperty('z-index', '2147483647', 'important');
    badge.style.setProperty('pointer-events', 'auto', 'important');
    container.appendChild(badge);
  }

  function setPaused(paused) {
    isPaused = Boolean(paused);
    window.__workflowCapturePaused = isPaused;
    if (isPaused) {
      activeInputBuffer = null;
      if (pendingClickTimer) clearTimeout(pendingClickTimer);
      pendingClickTimer = null;
      pendingClickTarget = null;
      pendingClickExtra = null;
    }
    const badge = document.getElementById('__workflow_capture_badge__');
    const shadow = badge?.shadowRoot;
    if (!shadow) return;
    const panel = shadow.querySelector('.panel');
    const root = shadow.querySelector('.root');
    const status = shadow.getElementById('statusText');
    const pauseButton = shadow.getElementById('pauseButton');
    const resumeButton = shadow.getElementById('resumeButton');
    if (panel) panel.classList.toggle('paused', isPaused);
    if (root) root.classList.toggle('is-paused', isPaused);
    if (status) status.textContent = isPaused ? 'PAUSED' : 'CAPTURING';
    if (pauseButton) {
      pauseButton.hidden = isPaused;
      pauseButton.disabled = false;
    }
    if (resumeButton) {
      resumeButton.hidden = !isPaused;
      resumeButton.disabled = false;
    }
  }

  function updateBadgeCount(count) {
    const countElement = document.getElementById('__workflow_capture_badge__')?.shadowRoot?.getElementById('stepCount');
    if (countElement) countElement.textContent = `${count} ${count === 1 ? 'step' : 'steps'}`;
    const miniCount = document.getElementById('__workflow_capture_badge__')?.shadowRoot?.getElementById('miniCount');
    if (miniCount) miniCount.textContent = count > 99 ? '99+' : String(count);
  }

  window.__workflowCaptureSetPaused = setPaused;
  window.__workflowCaptureUpdateUI = (state = {}) => {
    if (state.count !== undefined) updateBadgeCount(Number(state.count) || 0);
    if (state.isPaused !== undefined) setPaused(state.isPaused);
  };
  window.__workflowCaptureStopUI = () => {
    const badge = document.getElementById('__workflow_capture_badge__');
    if (badge?.shadowRoot) {
      const shadow = badge.shadowRoot;
      shadow.querySelector('.panel')?.classList.add('saved');
      const status = shadow.getElementById('statusText');
      if (status) status.textContent = 'SAVED';
      const actions = shadow.querySelector('.actions');
      if (actions) actions.innerHTML = '<span class="saved-message">Workflow saved successfully</span>';
      setTimeout(() => badge.remove(), 1400);
    }
    if (typeof window.__workflowCaptureCleanup === 'function') window.__workflowCaptureCleanup();
  };

  // Register capture-phase event listeners on window and document
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('input', handleInput, true);
  window.addEventListener('change', handleChange, true);
  window.addEventListener('blur', handleBlur, true);
  window.addEventListener('keydown', handleKeyDown, true);

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('blur', handleBlur, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  // Direct element listener binding for DevExpress / dynamic ERP toolbars
  function attachToolbarListeners() {
    if (typeof document === 'undefined') return;
    try {
      const selector = 'img[title*="Export"], img[title*="save" i], img[title*="export" i], .dxm-item, .dxm-content, .dxm-image, [id*="Toolbar_Menu"], canvas, button, [role="button"], [role="menuitem"]';
      const elements = document.querySelectorAll(selector);
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.__wfAttached) continue;
        el.__wfAttached = true;
        el.addEventListener('pointerdown', onPointerDown, true);
        el.addEventListener('mousedown', onMouseDown, true);
        el.addEventListener('click', onClick, true);
        el.addEventListener('mouseup', onMouseUp, true);
        el.addEventListener('pointerup', onPointerUp, true);
      }
    } catch { }
  }

  attachToolbarListeners();

  // MutationObserver to immediately bind newly rendered DevExpress toolbar items
  if (typeof MutationObserver !== 'undefined') {
    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      try {
        const observer = new MutationObserver(() => attachToolbarListeners());
        observer.observe(targetNode, { childList: true, subtree: true });
        window.__workflowCaptureObserver = observer;
      } catch { }
    }
  }

  // Periodic fallback to guarantee toolbar elements receive listeners even if MutationObserver missed them
  const toolbarPoll = setInterval(attachToolbarListeners, 250);
  window.__workflowCapturePoll = toolbarPoll;

  // Relay actions from child iframes via postMessage
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === '__WORKFLOW_CAPTURE_EMIT_ACTION__' && event.data.payload) {
      if (!isPaused && typeof window.__workflowCaptureEmitAction === 'function') {
        window.__workflowCaptureEmitAction(event.data.payload);
      } else if (window.top && window.top !== window && typeof window.top.__workflowCaptureEmitAction === 'function') {
        window.top.__workflowCaptureEmitAction(event.data.payload);
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderRecordingBadge);
  } else {
    renderRecordingBadge();
  }

  // Expose cleanup function to cleanly unbind on script upgrade
  window.__workflowCaptureCleanup = () => {
    if (window.__workflowCaptureObserver) {
      try { window.__workflowCaptureObserver.disconnect(); } catch { }
      window.__workflowCaptureObserver = null;
    }
    if (window.__workflowCapturePoll) {
      clearInterval(window.__workflowCapturePoll);
      window.__workflowCapturePoll = null;
    }
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('input', handleInput, true);
    window.removeEventListener('change', handleChange, true);
    window.removeEventListener('blur', handleBlur, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleChange, true);
      document.removeEventListener('blur', handleBlur, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    }
  };

  window.__workflowCaptureDocRef = typeof document !== 'undefined' ? document : null;
  if (typeof document !== 'undefined') {
    document.__workflowCaptureDocReady = true;
  }
  window.__workflowCaptureReady = true;
  console.log('[Workflow Capture] In-page recorder listeners attached successfully (v6).');
})();
