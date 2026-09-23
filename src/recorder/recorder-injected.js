/**
 * In-Page Recorder Script (Runs inside the browser context)
 * 
 * Injected on new document creation via CDP Page.addScriptToEvaluateOnNewDocument.
 * Captures user interactions (CLICK, DOUBLE_CLICK, TYPE, SELECT),
 * buffers text input to prevent per-keystroke noise, and streams actions
 * to Node.js via window.__workflowCaptureEmitAction.
 */

(function () {
  const CURRENT_RECORDER_VERSION = 6;

  // Clean up any listeners from a previous session
  if (typeof window.__workflowCaptureCleanup === 'function') {
    try { window.__workflowCaptureCleanup(); } catch { }
  }

  window.__workflowCaptureVersion = CURRENT_RECORDER_VERSION;
  window.__workflowCaptureInitialized = true;

  // Active input buffer to consolidate typing into a single TYPE action
  let activeInputBuffer = null;

  // Diagnostic stamp: records the last pointerdown/mousedown target/time/coordinates, regardless
  // of whether a click/action ever gets recorded for it. Lets you check,
  // after a session, whether the element/icon/canvas received input at all.
  function handlePointerDownDiag(event) {
    const target = event.target;
    if (!target) return;
    if (target.closest && target.closest('#__workflow_capture_badge__')) return;
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

    return {
      candidates,
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
    if (!targetElement) return;

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

      const actionUid = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const cleanExtra = { ...extra };
      delete cleanExtra.canvasCoords;

      const payload = {
        uid: actionUid,
        type,
        timestamp: Date.now(),
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
    const { element, value, isPassword } = activeInputBuffer;
    activeInputBuffer = null;

    if (!element || !document.body || !document.body.contains(element)) return;

    // Redact password value
    const finalValue = isPassword ? '[REDACTED]' : value;

    emitAction('TYPE', element, {
      value: finalValue,
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
    if (activeInputBuffer && activeInputBuffer.element === event.target) {
      flushInputBuffer();
    }
  }

  /**
   * Keydown listener to detect Enter/Tab/Escape submission & key actions
   */
  function handleKeyDown(event) {
    flushPendingClick();
    const key = event.key;
    const target = event.target;

    if (key === 'Enter') {
      if (activeInputBuffer && activeInputBuffer.element === target) {
        flushInputBuffer();
      }

      emitAction('KEY_PRESS', target || document.activeElement || document.body, {
        key: 'Enter',
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
   * Change event handler for SELECT dropdowns and checkboxes/radios
   */
  function handleChange(event) {
    const target = event.target;
    if (!target) return;

    if (target.tagName === 'SELECT') {
      const selectedOption = target.options[target.selectedIndex];
      const selectedValue = selectedOption ? selectedOption.value : target.value;
      const selectedText = selectedOption ? selectedOption.text.trim() : '';

      emitAction('SELECT', target, {
        value: selectedValue,
        meta: {
          text: selectedText,
          selectedIndex: target.selectedIndex
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
    const rawTarget = event.target;
    if (!rawTarget) return;

    // Ignore clicks on recorder UI badge itself
    if (rawTarget.closest && rawTarget.closest('#__workflow_capture_badge__')) return;

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

    emitAction('CLICK', target, {
      detail: event.detail || 1,
      triggerSignal: signalType,
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
    badge.innerHTML = '&#9679; REC (Workflow)';
    Object.assign(badge.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      backgroundColor: '#ef4444',
      color: '#ffffff',
      fontFamily: 'monospace, sans-serif',
      fontSize: '12px',
      fontWeight: 'bold',
      padding: '4px 10px',
      borderRadius: '9999px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      pointerEvents: 'none',
      letterSpacing: '0.5px'
    });
    container.appendChild(badge);
  }

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
      if (typeof window.__workflowCaptureEmitAction === 'function') {
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
