/**
 * Replay Action Executors
 * 
 * Performs simulated user interactions on validated Puppeteer ElementHandles
 */

const { DEFAULT_TIMEOUTS } = require('../shared/constants');
const { ActionExecutionError, ElementNotInteractableError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Ensure element is scrolled into view and interactable
 */
async function ensureInteractable(elementHandle, action) {
  // Check visibility, enabled status, and scroll into view natively
  const status = await elementHandle.evaluate((el) => {
    if (el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const isVisible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const isDisabled = el.disabled === true;
    return { isVisible, isDisabled };
  });

  if (!status.isVisible) {
    throw new ElementNotInteractableError('Target element is not visible in DOM', {
      actionIndex: action.index,
      actionType: action.type,
      target: action.target,
      reason: 'Element has 0 dimensions or display:none'
    });
  }

  if (status.isDisabled) {
    logger.warn(`Element for Action #${action.index + 1} has disabled attribute; attempting synthetic click dispatch.`);
  }
}

/**
 * Execute CLICK action
 */
async function executeClick(elementHandle, action) {
  await ensureInteractable(elementHandle, action);
  try {
    await elementHandle.evaluate((el) => {
      el.focus();
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
  } catch (err) {
    try {
      await elementHandle.click();
    } catch (fallbackErr) {
      throw new ActionExecutionError(`Failed to click element: ${err.message}`, {
        actionIndex: action.index,
        actionType: action.type,
        originalError: fallbackErr
      });
    }
  }
}

/**
 * Execute DOUBLE_CLICK action
 */
async function executeDoubleClick(elementHandle, action) {
  await ensureInteractable(elementHandle, action);
  try {
    await elementHandle.click({ clickCount: 2 });
  } catch (err) {
    throw new ActionExecutionError(`Failed to double-click element: ${err.message}`, {
      actionIndex: action.index,
      actionType: action.type,
      originalError: err
    });
  }
}

/**
 * Execute TYPE action
 */
async function executeType(elementHandle, action) {
  await ensureInteractable(elementHandle, action);
  const textToType = action.value || '';

  try {
    await elementHandle.focus().catch(() => {});

    // Set value and trigger all framework DOM events (input, change, blur)
    await elementHandle.evaluate((el, text) => {
      el.focus();
      if (text !== '[REDACTED]') {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, textToType);
  } catch (err) {
    throw new ActionExecutionError(`Failed to type into element: ${err.message}`, {
      actionIndex: action.index,
      actionType: action.type,
      originalError: err
    });
  }
}

/**
 * Execute SELECT dropdown action
 */
async function executeSelect(elementHandle, action) {
  await ensureInteractable(elementHandle, action);
  const targetValue = action.value;
  const targetText = (action.meta && action.meta.text) ? action.meta.text : null;

  try {
    let selected = false;

    // Try Puppeteer select method first
    if (targetValue !== undefined && targetValue !== null && typeof elementHandle.select === 'function') {
      try {
        const result = await elementHandle.select(String(targetValue));
        if (result && result.length > 0) {
          selected = true;
        }
      } catch {}
    }

    // In-page fallback: match by value or visible text
    if (!selected) {
      await elementHandle.evaluate((selectEl, val, txt) => {
        let matched = false;
        for (let i = 0; i < selectEl.options.length; i++) {
          const opt = selectEl.options[i];
          if (val !== undefined && opt.value === String(val)) {
            selectEl.selectedIndex = i;
            matched = true;
            break;
          }
          if (txt && opt.textContent.trim() === String(txt).trim()) {
            selectEl.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (matched) {
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, targetValue, targetText);
    }
  } catch (err) {
    throw new ActionExecutionError(`Failed to select dropdown option: ${err.message}`, {
      actionIndex: action.index,
      actionType: action.type,
      originalError: err
    });
  }
}

/**
 * Dispatcher to map action types to executor functions
 */
async function dispatchAction(elementHandle, action) {
  switch (action.type) {
    case 'CLICK':
      return executeClick(elementHandle, action);
    case 'DOUBLE_CLICK':
      return executeDoubleClick(elementHandle, action);
    case 'TYPE':
      return executeType(elementHandle, action);
    case 'SELECT':
      return executeSelect(elementHandle, action);
    default:
      throw new ActionExecutionError(`Unsupported action type: ${action.type}`, {
        actionIndex: action.index,
        actionType: action.type
      });
  }
}

module.exports = {
  executeClick,
  executeDoubleClick,
  executeType,
  executeSelect,
  dispatchAction
};
