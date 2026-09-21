/**
 * Workflow Capture — Intelligent Loop & Repeating Pattern Detector
 * 
 * Inspects recorded element fingerprints, tag hierarchies, and CSS selector paths
 * to detect if an action was performed on a repeating collection item (e.g. table row <tr>,
 * list item <li>, or repeating card item). Generalizes single element targets into
 * iterative loop execution blueprints.
 */

class LoopDetector {
  /**
   * Analyzes an action step or element fingerprint for loop generalization candidacy.
   * @param {object} step - The recorded action step with fingerprint metadata
   * @returns {object} Analysis result with isLoopCandidate, containerSelector, and itemSelector
   */
  static analyzeStep(step) {
    if (!step) return { isLoopCandidate: false };

    const fingerprint = step.fingerprint || step.target || {};
    const selectors = fingerprint.selectors || step.selectors || {};
    let cssPath = selectors.cssPath || selectors.hierarchical || '';

    if (!cssPath && step.target && Array.isArray(step.target.candidates)) {
      const cssCand = step.target.candidates.find(c => c && c.strategy === 'css-path' && c.value);
      if (cssCand) cssPath = cssCand.value;
    }

    const tagName = (fingerprint.tagName || '').toLowerCase();
    const parentTag = (fingerprint.parentTag || '').toLowerCase();

    // 0. Exclude Site Chrome, Navigation Toolbars, Tabs, Headers, Footers, and Form Inputs
    if (this.isNavigationOrChrome(cssPath, fingerprint)) {
      return {
        isLoopCandidate: false,
        patternType: 'single-element',
        role: 'SETUP',
        isNavigationOrChrome: true,
        originalCssPath: cssPath,
        description: 'Navigation, toolbar, or header control (executed once as setup)'
      };
    }

    // 1. Table Row Detection (<tr>, <td>, <th>)
    if (/(tr:nth-(?:child|of-type)|tbody\s*>\s*tr|\btr\b)/i.test(cssPath) || parentTag === 'tr' || parentTag === 'td' || tagName === 'tr' || tagName === 'td') {
      const tableMatch = cssPath.match(/(.*?tr)(?::(?:nth-child|nth-of-type)\(\d+\))?(.*)/i);
      if (tableMatch) {
        const containerSelector = tableMatch[1].replace(/:(?:nth-child|nth-of-type)\(\d+\)/g, '').trim();
        const relativeSelector = tableMatch[2].replace(/^(\s*>\s*)+/, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'table-row',
          role: 'LOOP',
          containerSelector: containerSelector || 'table tbody tr',
          relativeSelector: relativeSelector || '*',
          originalCssPath: cssPath,
          description: 'Repeated action across table rows'
        };
      }
    }

    // 2. Dropdown Option Detection (mat-option, [role="option"], mat-pseudo-checkbox)
    if (
      tagName === 'mat-option' ||
      parentTag === 'mat-option' ||
      tagName === 'mat-pseudo-checkbox' ||
      fingerprint.role === 'option' ||
      /(mat-option|\[role="option"\]|mat-pseudo-checkbox|\.mat-mdc-option)/i.test(cssPath)
    ) {
      return {
        isLoopCandidate: true,
        patternType: 'dropdown-option',
        role: 'LOOP',
        containerSelector: 'div[role="listbox"], mat-select, .cdk-overlay-pane',
        relativeSelector: 'mat-option, [role="option"]',
        originalCssPath: cssPath,
        description: 'Repeated action across dropdown option checkboxes'
      };
    }

    // 3. Ordered/Unordered List Items (<ul> / <ol> -> <li>) - only within content areas, not navigation menus
    if (/(li:nth-(?:child|of-type)|[uo]l\s*>\s*li)/i.test(cssPath) || parentTag === 'li' || tagName === 'li') {
      const listMatch = cssPath.match(/(.*?li)(?::(?:nth-child|nth-of-type)\(\d+\))?(.*)/i);
      if (listMatch) {
        const containerSelector = listMatch[1].replace(/:(?:nth-child|nth-of-type)\(\d+\)/g, '').trim();
        const relativeSelector = listMatch[2].replace(/^(\s*>\s*)+/, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'list-item',
          role: 'LOOP',
          containerSelector: containerSelector || 'ul > li',
          relativeSelector: relativeSelector || '*',
          originalCssPath: cssPath,
          description: 'Repeated action across list items'
        };
      }
    }

    // 4. Repeating Card or Grid Containers (.item, .card, [data-item-id])
    if (/:(?:nth-child|nth-of-type)\(\d+\)/i.test(cssPath)) {
      const parts = cssPath.split(/:(?:nth-child|nth-of-type)\(\d+\)/i);
      if (parts.length >= 2) {
        const containerSelector = parts[0].trim();
        const relativeSelector = parts.slice(1).join('').replace(/^(\s*>\s*)+/, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'card-grid',
          role: 'LOOP',
          containerSelector,
          relativeSelector: relativeSelector || '*',
          originalCssPath: cssPath,
          description: 'Repeated action across nth-child grid or card elements'
        };
      }
    }

    return {
      isLoopCandidate: false,
      patternType: 'single-element',
      role: 'SETUP',
      originalCssPath: cssPath
    };
  }

  /**
   * Identifies if a selector or element belongs to navigation chrome (tabs, toolbars, headers)
   */
  static isNavigationOrChrome(cssPath = '', fingerprint = {}) {
    const combined = [
      cssPath,
      fingerprint.tagName,
      fingerprint.parentTag,
      fingerprint.role,
      fingerprint.ariaLabel,
      Array.isArray(fingerprint.classes) ? fingerprint.classes.join(' ') : ''
    ].join(' ').toLowerCase();

    // 1. Navigation tags & component patterns
    if (/\b(mat-toolbar|mat-toolbar-row|mat-tab-header|mat-tab-group|mat-tab-nav-bar|mat-tab-link|mat-sidenav|mat-sidenav-container|app-header|app-nav|navbar)\b/i.test(combined) ||
        /(^|>|\s)(nav|header|footer|mat-toolbar|mat-toolbar-row)(\s|>|$)/i.test(cssPath)) {
      return true;
    }

    // 2. Navigation roles
    if (/\b(navigation|menubar|tablist|tab|banner|contentinfo|toolbar|breadcrumb|pagination)\b/i.test(combined)) {
      return true;
    }

    // 3. Navigation class names & UI patterns
    if (/\b(navbar|nav-tabs|nav-item|nav-link|top-bar|app-bar|sidebar-nav|site-header|main-nav|page-header|pager|header-nav|menu-item)\b/i.test(combined)) {
      return true;
    }

    // 4. Form inputs that are not repetitive data records (e.g. login username/password fields)
    if (/(form\s*>\s*div.*input|input\[type=(?:password|email|text)\])/i.test(combined)) {
      return true;
    }

    // 5. Authentication and login controls
    if (/\b(login|signin|sign-in|auth|password|username|credential)\b/i.test(combined)) {
      return true;
    }

    return false;
  }

  /**
   * Automatically finds the best starting loopStepIndex from a workflow's steps.
   * Skips all navigation, header, and toolbar controls.
   * @param {Array<object>} steps
   * @returns {number} Index of the first repeating loop candidate step, or -1 if none found.
   */
  static findLoopCandidateIndex(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return -1;

    // 1. First, check if any step was explicitly marked as LOOP or sequential iteration by user
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] && (steps[i].role === 'LOOP' || steps[i].isLoopCandidate === true || steps[i].isLoop === true || steps[i].loopMode === 'sequential_iteration')) {
        return i;
      }
    }

    // 2. Next, analyze each step: skip anything that is marked SETUP or is navigation chrome
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;
      if (step.role === 'SETUP') continue;

      const analysis = this.analyzeStep(step);
      if (analysis && analysis.isLoopCandidate && !analysis.isNavigationOrChrome) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Partitions a recording's step sequence into:
   * 1. setupSteps: steps before the repeating interaction (e.g. login, navigate)
   * 2. loopSteps: steps to be repeated per collection item
   * 3. teardownSteps: optional cleanup steps
   */
  static partitionWorkflow(steps, loopStepIndex) {
    if (!Array.isArray(steps) || loopStepIndex < 0 || loopStepIndex >= steps.length) {
      return {
        setupSteps: steps || [],
        loopSteps: [],
        teardownSteps: []
      };
    }

    // MVP loop boundary: every recorded action from the first repeating
    // interaction onward is treated as part of the per-item procedure.
    // Explicit teardown boundaries can be added once the workflow schema records
    // them separately.
    const setupSteps = steps.slice(0, loopStepIndex);
    const loopSteps = steps.slice(loopStepIndex);

    return {
      setupSteps,
      loopSteps,
      teardownSteps: []
    };
  }
}

module.exports = LoopDetector;
