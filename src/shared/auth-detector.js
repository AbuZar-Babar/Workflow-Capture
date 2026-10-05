/**
 * Workflow Capture — Session Authentication & Login Sequence Detector
 * 
 * Inspects recorded workflow steps to identify initial authentication/login sequences,
 * and probes the active browser tab to detect whether an authenticated session is already active.
 * Allows workflow replay to skip redundant login steps and advance directly to post-login actions.
 */

/**
 * Checks if a single action appears to be part of a login/authentication flow
 * @param {object} action - Recorded action object
 * @returns {boolean}
 */
function isLoginAction(action) {
  if (!action) return false;

  const type = (action.type || '').toUpperCase();
  const name = String(action.name || action.elementName || '').toLowerCase();
  const target = action.target || {};
  const fingerprint = target.fingerprint || action.fingerprint || {};
  const candidates = Array.isArray(target.candidates) ? target.candidates : [];

  // 1. Password input action
  if (type === 'TYPE') {
    if (action.meta?.isPassword || fingerprint.isPassword) return true;
    if (fingerprint.type === 'password') return true;
    if (candidates.some(c => c.value && /password|pwd/i.test(c.value))) return true;
  }

  // 2. Username / Email input action (click or type)
  if (type === 'TYPE' || type === 'CLICK') {
    const isUserField = /user(name)?|email|login|user_id|userid/i.test(name) ||
      /user(name)?|email|login|user_id|userid/i.test(fingerprint.name || '') ||
      /user(name)?|email|login|user_id|userid/i.test(fingerprint.placeholder || '') ||
      /user(name)?|email|login|user_id|userid/i.test(fingerprint.id || '');
    if (isUserField) return true;
    if (candidates.some(c => c.value && /(username|user_name|user-name|email|login_id)/i.test(c.value))) return true;
  }

  // 3. Login / Sign In / Submit button click
  if (type === 'CLICK') {
    const isLoginButton = /(log ?in|sign ?in|submit|continue|auth)/i.test(name) ||
      /(log ?in|sign ?in|submit|continue|auth)/i.test(fingerprint.text || '') ||
      /(log ?in|sign ?in|submit|continue|auth)/i.test(fingerprint.ariaLabel || '') ||
      /(log ?in|sign ?in|submit|continue|auth)/i.test(fingerprint.id || '');
    if (isLoginButton) return true;
    if (candidates.some(c => c.value && /(log ?in|sign ?in|btn-login|login-button|signin)/i.test(c.value))) return true;
  }

  // 4. Navigate to explicit login/auth URL
  if (type === 'NAVIGATE' && action.url) {
    if (/\/(login|signin|auth)\b/i.test(action.url) || /#(.*)\/(login|signin)/i.test(action.url)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects an initial login sequence within a workflow's action list.
 * Identifies the range [startIndex, endIndex] and the firstPostLoginIndex.
 * 
 * @param {Array<object>} actions - List of workflow actions
 * @returns {object} Login sequence metadata
 */
function detectLoginSequence(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      hasLoginSequence: false,
      startIndex: -1,
      endIndex: -1,
      firstPostLoginIndex: 0,
      loginActions: [],
      firstPostLoginAction: null
    };
  }

  let passwordIndex = -1;
  let submitIndex = -1;
  let hasUsername = false;

  // Search within the first 10 actions for an authentication sequence
  const searchLimit = Math.min(actions.length, 10);
  for (let i = 0; i < searchLimit; i++) {
    const action = actions[i];
    const type = (action.type || '').toUpperCase();
    const name = String(action.name || action.elementName || '').toLowerCase();
    const fp = action.target?.fingerprint || action.fingerprint || {};
    const candidates = Array.isArray(action.target?.candidates) ? action.target.candidates : [];

    const isPassword = (type === 'TYPE' && (action.meta?.isPassword || fp.type === 'password' || /password/i.test(name))) ||
      candidates.some(c => c.value && /password/i.test(c.value));
    if (isPassword) {
      passwordIndex = i;
    }

    const isUser = /user(name)?|email|login/i.test(name) || /user(name)?|email|login/i.test(fp.name || '') ||
      candidates.some(c => c.value && /(username|email)/i.test(c.value));
    if (isUser) {
      hasUsername = true;
    }

    const isSubmit = type === 'CLICK' && (
      /(log ?in|sign ?in)/i.test(name) ||
      /(log ?in|sign ?in)/i.test(fp.text || '') ||
      candidates.some(c => c.value && /(log ?in|sign ?in)/i.test(c.value))
    );
    if (isSubmit && (passwordIndex >= 0 || hasUsername)) {
      submitIndex = i;
      break; // Found the end of the login block
    }
  }

  // If we found a password step and/or a submit step
  if (passwordIndex >= 0 || (hasUsername && submitIndex >= 0)) {
    const endIndex = submitIndex >= 0 ? submitIndex : passwordIndex;
    const startIndex = 0;
    const firstPostLoginIndex = endIndex + 1;

    return {
      hasLoginSequence: true,
      startIndex,
      endIndex,
      loginActionCount: endIndex - startIndex + 1,
      firstPostLoginIndex,
      loginActions: actions.slice(startIndex, firstPostLoginIndex),
      firstPostLoginAction: actions[firstPostLoginIndex] || null
    };
  }

  return {
    hasLoginSequence: false,
    startIndex: -1,
    endIndex: -1,
    firstPostLoginIndex: 0,
    loginActions: [],
    firstPostLoginAction: actions[0] || null
  };
}

/**
 * Evaluates whether the active browser tab currently has an authenticated session.
 * Probes the page URL, absence of login forms, and presence of post-login targets.
 * 
 * @param {object} page - Puppeteer page instance
 * @param {object} loginSeq - Result from detectLoginSequence()
 * @param {object} [options] - Options (timeoutMs, etc.)
 * @returns {Promise<boolean>} True if the page appears already logged in
 */
async function isSessionAuthenticated(page, loginSeq = {}, options = {}) {
  if (!page || page.isClosed()) return false;

  try {
    const currentUrl = page.url();
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('chrome://')) {
      return false;
    }

    // 1. Check if the page currently has a visible password input
    const hasVisiblePassword = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i]'));
      return inputs.some(el => {
        if (el.offsetParent === null && el.tagName.toLowerCase() !== 'body') return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.1;
      });
    }).catch(() => false);

    // If a visible password field is right in front of the browser, it is NOT logged in
    if (hasVisiblePassword) {
      return false;
    }

    // 2. Check URL: if the current URL clearly is on an authenticated route vs login route
    const isLoginUrl = /\/(login|signin|auth)\b/i.test(currentUrl) || /#(.*)\/(login|signin)/i.test(currentUrl);
    const isAuthenticatedUrl = /\/(home|dashboard|my-reports|reports|invoices|portal|app|workspace|overview)\b/i.test(currentUrl) ||
      /#\/(home|dashboard|my-reports|reports|invoices|portal|app|workspace|overview)/i.test(currentUrl);

    if (isAuthenticatedUrl && !isLoginUrl) {
      return true;
    }

    // 3. Check for common authenticated DOM indicators (Logout button, User profile, main nav toolbar)
    const hasAuthIndicator = await page.evaluate(() => {
      const authSelectors = [
        'a[href*="logout" i]',
        'button:has-text("Log out")',
        'button:has-text("Sign out")',
        '.user-avatar',
        '.user-profile',
        'mat-toolbar',
        '.app-header .user-info',
        'app-my-reports',
        '.x-grid',
        '[role="navigation"]'
      ];
      for (const sel of authSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && (el.offsetParent !== null || el.tagName.toLowerCase() === 'body')) return true;
        } catch {}
      }
      return false;
    }).catch(() => false);

    if (hasAuthIndicator) {
      return true;
    }

    // 4. Target Element Probe: Can we already find the target of firstPostLoginAction?
    if (loginSeq.firstPostLoginAction && loginSeq.firstPostLoginAction.target) {
      const targetCandidates = loginSeq.firstPostLoginAction.target.candidates || [];
      const hasTarget = await page.evaluate((candidates) => {
        const visible = (el) => {
          if (!el) return false;
          if (el.offsetParent === null && el.tagName.toLowerCase() !== 'body') return false;
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden';
        };

        for (const c of candidates) {
          if (!c || !c.value) continue;
          if (c.strategy === 'css-path' || c.strategy === 'id' || c.strategy === 'attribute') {
            try {
              const el = document.querySelector(c.value);
              if (el && visible(el)) return true;
            } catch {}
          }
        }
        return false;
      }, targetCandidates).catch(() => false);

      if (hasTarget) {
        return true;
      }
    }

    // If URL is not a login URL and password field is absent, consider authenticated if on same origin
    if (!isLoginUrl && !hasVisiblePassword) {
      return true;
    }

    return false;
  } catch (err) {
    return false;
  }
}

module.exports = {
  isLoginAction,
  detectLoginSequence,
  isSessionAuthenticated
};
