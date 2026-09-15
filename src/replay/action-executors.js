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
  try {
    await elementHandle.scrollIntoViewIfNeeded();
  } catch {
    // Some elements or shadow DOM may not support scrollIntoViewIfNeeded
  }

  // Check visibility and enabled status
  const status = await elementHandle.evaluate((el) => {
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
    throw new ElementNotInteractableError('Target element is disabled', {
      actionIndex: action.index,
      actionType: action.type,
      target: action.target,
      reason: 'Element has disabled attribute'
    });
  }
}

/**
 * Execute CLICK action
 */
async function executeClick(elementHandle, action) {
  await ensureInteractable(elementHandle, action);
  try {
    await elementHandle.click();
  } catch (err) {
    throw new ActionExecutionError(`Failed to click element: ${err.message}`, {
      actionIndex: action.index,
      actionType: action.type,
      originalError: err
    });
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
    await elementHandle.focus();

    // Select all existing text and delete it before typing new text
    await elementHandle.click({ clickCount: 3 }).catch(() => {});
    await elementHandle.press('Backspace').catch(() => {});

    // Also clear value directly if backspace didn't wipe it
    await elementHandle.evaluate(el => {
      if (el.value !== undefined) el.value = '';
    });

    if (textToType.length > 0 && textToType !== '[REDACTED]') {
      await elementHandle.type(textToType, {
        delay: DEFAULT_TIMEOUTS.TYPE_KEYSTROKE_DELAY_MS
      });
    }

    // Trigger blur/change to notify framework listeners (React/Vue/Angular)
    await elementHandle.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });
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

    // Try selecting by value first
    if (targetValue !== undefined && targetValue !== null) {
      try {
        const result = await elementHandle.select(String(targetValue));
        if (result && result.length > 0) {
          selected = true;
        }
      } catch {}
    }

    // Fallback: select by visible text in options
    if (!selected && targetText) {
      selected = await elementHandle.evaluate((selectEl, text) => {
        for (let i = 0; i < selectEl.options.length; i++) {
          if (selectEl.options[i].text.trim() === text.trim()) {
            selectEl.selectedIndex = i;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, targetText);
    }

    if (!selected) {
      throw new Error(`Could not find matching option for value "${targetValue}" or text "${targetText}"`);
    }
  } catch (err) {
    throw new ActionExecutionError(`Failed to select option in dropdown: ${err.message}`, {
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
