/**
 * Replay Action Executors
 * 
 * Performs simulated user interactions on validated Puppeteer ElementHandles
 * with humanized Bezier mouse curves, randomized typing cadence, and stealth timing.
 */

const { DEFAULT_TIMEOUTS } = require('../shared/constants');
const { ActionExecutionError, ElementNotInteractableError } = require('../utils/errors');
const { moveMouseHumanlike, calculateDelay, calculateTypingDelay } = require('./human-mouse');
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
 * Perform human mouse movement to element if enabled
 */
async function simulateHumanMouseToElement(elementHandle, page, botConfig = {}) {
  if (!page || !botConfig.mouse?.enabled) return;

  try {
    const box = await elementHandle.boundingBox();
    if (!box) return;

    // Target center with natural human jitter offset within element boundaries
    const targetX = box.x + box.width * (0.35 + Math.random() * 0.3);
    const targetY = box.y + box.height * (0.35 + Math.random() * 0.3);

    // Get current cursor location or pick plausible starting point
    const fromPoint = {
      x: (page._lastMouseX ?? 100) + (Math.random() * 50 - 25),
      y: (page._lastMouseY ?? 100) + (Math.random() * 50 - 25)
    };

    await moveMouseHumanlike(page, fromPoint, { x: targetX, y: targetY }, botConfig.mouse);
    page._lastMouseX = targetX;
    page._lastMouseY = targetY;

    // Dwell / hover hesitation before click
    if (botConfig.mouse.hoverBeforeClickMs > 0) {
      const hoverDelay = calculateDelay(
        Math.round(botConfig.mouse.hoverBeforeClickMs * 0.7),
        Math.round(botConfig.mouse.hoverBeforeClickMs * 1.3),
        'gaussian'
      );
      await new Promise(r => setTimeout(r, hoverDelay));
    }
  } catch {}
}

/**
 * Execute CLICK action
 */
async function executeClick(elementHandle, action, options = {}) {
  await ensureInteractable(elementHandle, action);
  const { page, botConfig } = options;

  if (botConfig) {
    await simulateHumanMouseToElement(elementHandle, page, botConfig);
  }

  try {
    // Dispatch native click events
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
async function executeDoubleClick(elementHandle, action, options = {}) {
  await ensureInteractable(elementHandle, action);
  const { page, botConfig } = options;

  if (botConfig) {
    await simulateHumanMouseToElement(elementHandle, page, botConfig);
  }

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
 * Execute TYPE action with humanized stochastic typing rhythm
 */
async function executeType(elementHandle, action, options = {}) {
  await ensureInteractable(elementHandle, action);
  const { page, botConfig } = options;
  const textToType = action.value || '';

  if (botConfig) {
    await simulateHumanMouseToElement(elementHandle, page, botConfig);
  }

  try {
    await elementHandle.focus().catch(() => {});

    // If botConfig typing is active and page is available, type character by character
    const typingCfg = botConfig?.typing;
    if (typingCfg && textToType !== '[REDACTED]' && textToType.length > 0 && typeof elementHandle.type === 'function') {
      // Clear existing input value first
      await elementHandle.evaluate(el => { el.value = ''; });

      for (let i = 0; i < textToType.length; i++) {
        const char = textToType[i];
        const delay = calculateTypingDelay(char, typingCfg);
        
        await elementHandle.type(char, { delay: Math.min(delay, 500) });

        // Trigger input event to satisfy reactive frameworks
        await elementHandle.evaluate((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }

      await elementHandle.evaluate((el) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
    } else {
      // Fast fallback: bulk value injection
      await elementHandle.evaluate((el, text) => {
        el.focus();
        if (text !== '[REDACTED]') {
          el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, textToType);
    }
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
async function executeSelect(elementHandle, action, options = {}) {
  await ensureInteractable(elementHandle, action);
  const { page, botConfig } = options;
  const targetValue = action.value;
  const targetText = (action.meta && action.meta.text) ? action.meta.text : null;

  if (botConfig) {
    await simulateHumanMouseToElement(elementHandle, page, botConfig);
  }

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
 * Execute KEY_PRESS action (e.g. Enter, Tab, Escape)
 */
async function executeKeyPress(elementHandle, action, options = {}) {
  await ensureInteractable(elementHandle, action);
  const { page, botConfig } = options;
  const keyToPress = action.key || action.value || 'Enter';

  if (botConfig) {
    await simulateHumanMouseToElement(elementHandle, page, botConfig);
  }

  try {
    // Focus the target element first
    await elementHandle.focus().catch(() => {});

    // Use Puppeteer keyboard if available on page
    if (page && page.keyboard) {
      let puppeteerKey = keyToPress;
      if (keyToPress === 'Return' || keyToPress === 'enter') puppeteerKey = 'Enter';
      await page.keyboard.press(puppeteerKey);
    } else {
      // Fallback: dispatch synthetic keyboard event inside page context
      await elementHandle.evaluate((el, key) => {
        const keyCode = key === 'Enter' ? 13 : (key === 'Tab' ? 9 : (key === 'Escape' ? 27 : 0));
        const eventOpts = {
          key: key,
          code: key,
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
          view: window
        };
        el.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
        el.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
        el.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
      }, keyToPress);
    }
  } catch (err) {
    throw new ActionExecutionError(`Failed to press key "${keyToPress}": ${err.message}`, {
      actionIndex: action.index,
      actionType: action.type,
      originalError: err
    });
  }
}

/**
 * Dispatcher to map action types to executor functions
 */
async function dispatchAction(elementHandle, action, options = {}) {
  switch (action.type) {
    case 'CLICK':
      return executeClick(elementHandle, action, options);
    case 'DOUBLE_CLICK':
      return executeDoubleClick(elementHandle, action, options);
    case 'TYPE':
      return executeType(elementHandle, action, options);
    case 'SELECT':
      return executeSelect(elementHandle, action, options);
    case 'KEY_PRESS':
    case 'PRESS_KEY':
    case 'KEYDOWN':
    case 'KEY_DOWN':
    case 'ENTER':
      return executeKeyPress(elementHandle, action, options);
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
  executeKeyPress,
  dispatchAction
};
