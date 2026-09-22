/**
 * In-Page Recorder Script (Runs inside the browser context)
 * 
 * Injected on new document creation via CDP Page.addScriptToEvaluateOnNewDocument.
 * Captures user interactions (CLICK, DOUBLE_CLICK, TYPE, SELECT),
 * buffers text input to prevent per-keystroke noise, and streams actions
 * to Node.js via window.__workflowCaptureEmitAction.
 */

(function () {
  const CURRENT_RECORDER_VERSION = 5;

  // Clean up any listeners from a previous session
  if (typeof window.__workflowCaptureCleanup === 'function') {
    try { window.__workflowCaptureCleanup(); } catch { }
  }

  window.__workflowCaptureVersion = CURRENT_RECORDER_VERSION;
  window.__workflowCaptureInitialized = true;

  // Active input buffer to consolidate typing into a single TYPE action
  let activeInputBuffer = null;

  // Diagnostic stamp: records the last pointerdown target/time, regardless
  // of whether a click/action ever gets recorded for it. Lets you check,
  // after a session, whether the icon received input at all.
  function handlePointerDownDiag(event) {
    const target = event.target;
    if (!target) return;
    if (target.closest && target.closest('#__workflow_capture_badge__')) return;
    window.__workflowCaptureLastPointerDown = {
      tag: target.tagName,
      title: target.getAttribute?.('title') || null,
      classes: Array.from(target.classList || []),
      time: Date.now()
    };
  }
  let pendingClickTimer = null;
  let pendingClickTarget = null;
  let pendingClickExtra = null;
  const DBL_CLICK_THRESHOLD_MS = 280;

  // Deduplication & pointer-fallback tracking
  let lastHandledEventTime = 0;
  let lastHandledTarget = null;
  let pendingPointerTarget = null;
  let pointerTimer = null;

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
      const payload = {
        uid: actionUid,
        type,
        timestamp: Date.now(),
        target,
        ...(frameInfo ? { frame: frameInfo } : {}),
        ...extra
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
   * Click event handler
   */
  function handleClick(event) {
    const target = event.target;
    if (!target) return;

    // Ignore clicks on recorder UI badge itself
    if (target.closest && target.closest('#__workflow_capture_badge__')) return;

    // Flush any pending typing if clicking on a different element
    if (activeInputBuffer && activeInputBuffer.element !== target) {
      flushInputBuffer();
    }

    // Don't record CLICK on select elements (handled by change)
    if (target.tagName === 'SELECT' || target.tagName === 'OPTION') {
      return;
    }

    // Cancel any pending pointerup fallback timer since native click arrived
    if (pointerTimer) {
      clearTimeout(pointerTimer);
      pointerTimer = null;
    }
    pendingPointerTarget = null;

    // Prevent immediate duplicate firing on the same element within 80ms
    const now = Date.now();
    if (lastHandledTarget === target && (now - lastHandledEventTime) < 80) {
      return;
    }
    lastHandledEventTime = now;
    lastHandledTarget = target;

    // Double-click detection via W3C event.detail
    if (event.detail === 2) {
      emitAction('DOUBLE_CLICK', target, { detail: 2 });
      return;
    }

    // Emit single click immediately with full DOM fidelity
    emitAction('CLICK', target, { detail: event.detail || 1 });
  }

  /**
   * Pointerup / Mouseup fallback handler:
   * Captures actions on interactive buttons/icons where frameworks stopPropagation on mousedown/click,
   * or where file downloads terminate event bubbling before click completes.
   */
  function handlePointerUp(event) {
    const target = event.target;
    if (!target) return;
    if (target.closest && target.closest('#__workflow_capture_badge__')) return;
    if (['SELECT', 'OPTION', 'INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    // Check if target is an interactive element
    const isInteractive = target.closest && target.closest('button, a, img, [role="button"], [role="menuitem"], .dxm-item, .dxm-image, .dxm-content, .x-btn, .x-grid-cell-inner, [onclick], [title]');
    if (!isInteractive) return;

    pendingPointerTarget = target;
    if (pointerTimer) clearTimeout(pointerTimer);

    // If native click doesn't arrive within 160ms, emit as CLICK
    pointerTimer = setTimeout(() => {
      if (pendingPointerTarget) {
        const now = Date.now();
        if (lastHandledTarget !== pendingPointerTarget || (now - lastHandledEventTime) >= 160) {
          lastHandledEventTime = now;
          lastHandledTarget = pendingPointerTarget;
          emitAction('CLICK', pendingPointerTarget, { detail: 1, fallback: true });
        }
        pendingPointerTarget = null;
      }
    }, 160);
  }

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
  window.addEventListener('pointerdown', handlePointerDownDiag, true);
  window.addEventListener('click', handleClick, true);
  window.addEventListener('mouseup', handlePointerUp, true);
  window.addEventListener('input', handleInput, true);
  window.addEventListener('change', handleChange, true);
  window.addEventListener('blur', handleBlur, true);
  window.addEventListener('keydown', handleKeyDown, true);

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', handlePointerDownDiag, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mouseup', handlePointerUp, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('blur', handleBlur, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

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
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('mouseup', handlePointerUp, true);
    window.removeEventListener('input', handleInput, true);
    window.removeEventListener('change', handleChange, true);
    window.removeEventListener('blur', handleBlur, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mouseup', handlePointerUp, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleChange, true);
      document.removeEventListener('blur', handleBlur, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    }
  };

  window.__workflowCaptureReady = true;
  console.log('[Workflow Capture] In-page recorder listeners attached successfully (v4).');
})();
