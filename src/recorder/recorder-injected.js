/**
 * In-Page Recorder Script (Runs inside the browser context)
 * 
 * Injected on new document creation via CDP Page.addScriptToEvaluateOnNewDocument.
 * Captures user interactions (CLICK, DOUBLE_CLICK, TYPE, SELECT),
 * buffers text input to prevent per-keystroke noise, and streams actions
 * to Node.js via window.__workflowCaptureEmitAction.
 */

(function () {
  // Prevent duplicate injection
  if (window.__workflowCaptureInitialized) return;
  window.__workflowCaptureInitialized = true;

  // Active input buffer to consolidate typing into a single TYPE action
  let activeInputBuffer = null;
  let lastClickTime = 0;
  let lastClickTarget = null;
  const DBL_CLICK_THRESHOLD_MS = 350;

  /**
   * Safe helper to emit action to Node.js bridge
   */
  function emitAction(type, targetElement, extra = {}) {
    if (!targetElement) return;

    // Check if SelectorResolver is ready
    if (!window.SelectorResolver) {
      console.warn('[Workflow Capture] SelectorResolver not yet initialized in page.');
      return;
    }

    try {
      const target = window.SelectorResolver.captureTarget(targetElement);
      const payload = {
        type,
        timestamp: Date.now(),
        target,
        ...extra
      };

      if (typeof window.__workflowCaptureEmitAction === 'function') {
        window.__workflowCaptureEmitAction(payload);
      } else {
        console.warn('[Workflow Capture] Bridge function __workflowCaptureEmitAction not available.');
      }
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

    if (!element || !document.body.contains(element)) return;

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
   * Keydown listener to detect Enter/Tab submission
   */
  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (activeInputBuffer && activeInputBuffer.element === event.target) {
        flushInputBuffer();
      }
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
      // Form change event on input, flush typing
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

    const now = Date.now();
    const isDoubleClick = (lastClickTarget === target) && (now - lastClickTime < DBL_CLICK_THRESHOLD_MS);

    lastClickTime = now;
    lastClickTarget = target;

    // Don't record CLICK on select elements (handled by change)
    if (target.tagName === 'SELECT' || target.tagName === 'OPTION') {
      return;
    }

    if (isDoubleClick) {
      emitAction('DOUBLE_CLICK', target);
    } else {
      // Delay single click slightly to disambiguate from double click
      setTimeout(() => {
        if (lastClickTarget === target && Date.now() - lastClickTime >= DBL_CLICK_THRESHOLD_MS) {
          emitAction('CLICK', target);
        }
      }, DBL_CLICK_THRESHOLD_MS);
    }
  }

  /**
   * Optional visual badge to let the user know recording is active in Chrome
   */
  function renderRecordingBadge() {
    if (document.getElementById('__workflow_capture_badge__')) return;
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
    (document.body || document.documentElement).appendChild(badge);
  }

  // Register capture-phase event listeners
  window.addEventListener('click', handleClick, true);
  window.addEventListener('input', handleInput, true);
  window.addEventListener('change', handleChange, true);
  window.addEventListener('blur', handleBlur, true);
  window.addEventListener('keydown', handleKeyDown, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderRecordingBadge);
  } else {
    renderRecordingBadge();
  }

  // Expose manual flush
  window.__workflowCaptureFlushBuffer = flushInputBuffer;

  console.log('[Workflow Capture] In-page recorder listeners attached successfully.');
})();
