/**
 * Workflow Capture — Intelligent Loop & Repeating Pattern Detector
 * 
 * Inspects recorded element fingerprints, tag hierarchies, ARIA roles, and CSS selector paths
 * to detect if an action was performed on a repeating collection item (e.g. table row <tr>,
 * list item <li>, repeating card item, or grid element). Generalizes single element targets into
 * iterative loop execution blueprints with multi-signal confidence evaluation.
 */

'use strict';

const LoopConfidenceEngine = require('./loop-confidence-engine');

class LoopDetector {
  /**
   * Analyzes an action step or element fingerprint for loop generalization candidacy.
   * @param {object} step - The recorded action step with fingerprint metadata
   * @returns {object} Analysis result with isLoopCandidate, containerSelector, and itemSelector
   */
  static analyzeStep(step) {
    if (!step) return { isLoopCandidate: false, role: 'SETUP' };

    const fingerprint = step.fingerprint || step.target?.fingerprint || step.target || {};
    const selectors = fingerprint.selectors || step.selectors || step.target?.selectors || {};
    let cssPath = selectors.cssPath || selectors.hierarchical || '';

    if (!cssPath && step.target && Array.isArray(step.target.candidates)) {
      const cssCand = step.target.candidates.find(c => c && c.strategy === 'css-path' && c.value);
      if (cssCand) cssPath = cssCand.value;
    }

    const tagName = (fingerprint.tagName || '').toLowerCase();
    const parentTag = (fingerprint.parentTag || '').toLowerCase();
    const role = (fingerprint.role || '').toLowerCase();

    // 0. Exclude Site Chrome, Navigation Toolbars, Tabs, Headers, Footers, and Form Inputs
    if (this.isNavigationOrChrome(cssPath, fingerprint)) {
      return {
        isLoopCandidate: false,
        patternType: 'single-element',
        role: 'SETUP',
        isNavigationOrChrome: true,
        originalCssPath: cssPath,
        fingerprint,
        description: 'Navigation, toolbar, or header control (executed once as setup)'
      };
    }

    // 1. Table Row Detection (<tr>, <td>, <th>, [role="row"], [role="gridcell"])
    if (
      /(tr:nth-(?:child|of-type)|tbody\s*>\s*tr|\btr\b|x-grid-row|dxgvDataRow)/i.test(cssPath) ||
      parentTag === 'tr' || parentTag === 'td' || tagName === 'tr' || tagName === 'td' ||
      role === 'row' || role === 'gridcell'
    ) {
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
          fingerprint,
          description: 'Repeated action across table rows'
        };
      }

      return {
        isLoopCandidate: true,
        patternType: 'table-row',
        role: 'LOOP',
        containerSelector: 'table tbody tr, [role="grid"] [role="row"]',
        relativeSelector: '*',
        originalCssPath: cssPath,
        fingerprint,
        description: 'Repeated action across table rows'
      };
    }

    // 2. Dropdown Option Detection (mat-option, [role="option"], mat-pseudo-checkbox)
    if (
      tagName === 'mat-option' ||
      parentTag === 'mat-option' ||
      tagName === 'mat-pseudo-checkbox' ||
      role === 'option' ||
      /(mat-option|\[role="option"\]|mat-pseudo-checkbox|\.mat-mdc-option)/i.test(cssPath)
    ) {
      return {
        isLoopCandidate: true,
        patternType: 'dropdown-option',
        role: 'LOOP',
        containerSelector: 'div[role="listbox"], mat-select, .cdk-overlay-pane',
        relativeSelector: 'mat-option, [role="option"]',
        originalCssPath: cssPath,
        fingerprint,
        description: 'Repeated action across dropdown option checkboxes'
      };
    }

    // 3. Ordered/Unordered List Items (<ul> / <ol> -> <li>, [role="listitem"])
    if (
      /(li:nth-(?:child|of-type)|[uo]l\s*>\s*li)/i.test(cssPath) ||
      parentTag === 'li' || tagName === 'li' || role === 'listitem'
    ) {
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
          fingerprint,
          description: 'Repeated action across list items'
        };
      }

      return {
        isLoopCandidate: true,
        patternType: 'list-item',
        role: 'LOOP',
        containerSelector: 'ul > li, [role="list"] > [role="listitem"]',
        relativeSelector: '*',
        originalCssPath: cssPath,
        fingerprint,
        description: 'Repeated action across list items'
      };
    }

    // 4. Repeating Card or Grid Containers (.item, .card, [data-item-id], [data-testid*="item"])
    if (
      /:(?:nth-child|nth-of-type)\(\d+\)/i.test(cssPath) ||
      /\b(card|grid-item|card-item|product-item|document-card|data-card)\b/i.test(cssPath) ||
      role === 'article'
    ) {
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
          fingerprint,
          description: 'Repeated action across nth-child grid or card elements'
        };
      }

      if (/\b(card|grid-item|item)\b/i.test(cssPath) || role === 'article') {
        return {
          isLoopCandidate: true,
          patternType: 'card-grid',
          role: 'LOOP',
          containerSelector: '.card, .grid-item, [role="article"]',
          relativeSelector: '*',
          originalCssPath: cssPath,
          fingerprint,
          description: 'Repeated action across card or grid items'
        };
      }
    }

    return {
      isLoopCandidate: false,
      patternType: 'single-element',
      role: 'SETUP',
      originalCssPath: cssPath,
      fingerprint
    };
  }

  /**
   * Identifies if a selector or element belongs to navigation chrome (tabs, toolbars, headers)
   */
  static isNavigationOrChrome(cssPath = '', fingerprint = {}) {
    const combined = [
      cssPath,
      fingerprint.id,
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
    if (/\b(navbar|nav-tabs|nav-item|nav-link|top-bar|app-bar|sidebar-nav|sidebar|site-header|main-nav|page-header|pager|header-nav|menu-item|menu-link|i21-menu-link|x-menu|x-tree|mat-list-item)\b/i.test(combined) ||
        /(#menu-|\.x-menu|\.menu\b|nav\s*>\s*ul|sidebar\s*>\s*ul|\/menu-|\bmenu-\d+)/i.test(cssPath) ||
        /(^|#|\b)menu-\d+/i.test(fingerprint.id || '')) {
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
   * Prioritizes data table rows and dropdown options over generic list items.
   * 
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

    // 2. Prioritize Data Table Rows and Dropdown Options (Primary batch processing targets)
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || step.role === 'SETUP') continue;

      const analysis = this.analyzeStep(step);
      if (analysis && analysis.isLoopCandidate && !analysis.isNavigationOrChrome) {
        if (analysis.patternType === 'table-row' || analysis.patternType === 'dropdown-option') {
          return i;
        }
      }
    }

    // 3. Fallback to generic card-grid or content list items
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || step.role === 'SETUP') continue;

      const analysis = this.analyzeStep(step);
      if (analysis && analysis.isLoopCandidate && !analysis.isNavigationOrChrome) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Comprehensive workflow analysis that automatically discovers repeated structures,
   * performs dynamic setup/loop separation, and calculates multi-signal loop confidence.
   *
   * @param {Array<object>} steps - The recorded sequence of workflow actions
   * @param {object} context - Optional runtime / DOM context
   * @returns {{
   *   isLoop: boolean,
   *   loopStepIndex: number,
   *   confidence: number,
   *   confidenceCategory: 'HIGH' | 'MEDIUM' | 'LOW',
   *   patternType: string,
   *   reasons: string[],
   *   signals: object,
   *   setupSteps: Array<object>,
   *   loopSteps: Array<object>,
   *   teardownSteps: Array<object>
   * }}
   */
  static analyzeWorkflow(steps = [], context = {}) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return {
        isLoop: false,
        loopStepIndex: -1,
        confidence: 0,
        confidenceCategory: 'LOW',
        patternType: 'none',
        reasons: ['No workflow steps to analyze.'],
        signals: {},
        setupSteps: [],
        loopSteps: [],
        teardownSteps: []
      };
    }

    const loopStepIndex = this.findLoopCandidateIndex(steps);
    if (loopStepIndex < 0) {
      return {
        isLoop: false,
        loopStepIndex: -1,
        confidence: 0,
        confidenceCategory: 'LOW',
        patternType: 'single-element',
        reasons: ['No repeating structure detected in workflow actions.'],
        signals: {},
        setupSteps: steps,
        loopSteps: [],
        teardownSteps: []
      };
    }

    const candidateStep = steps[loopStepIndex];
    const stepAnalysis = this.analyzeStep(candidateStep);

    // Run multi-signal confidence engine
    const confidenceResult = LoopConfidenceEngine.evaluate(stepAnalysis, {
      allSteps: steps,
      loopStepIndex,
      fingerprint: candidateStep?.target?.fingerprint || candidateStep?.fingerprint,
      ...context
    });

    const isLoop = confidenceResult.autoLoop || confidenceResult.score >= 50;
    const partition = this.partitionWorkflow(steps, loopStepIndex);

    return {
      isLoop,
      loopStepIndex,
      confidence: confidenceResult.score,
      confidenceCategory: confidenceResult.category,
      patternType: stepAnalysis.patternType || 'table-row',
      reasons: confidenceResult.reasons,
      signals: confidenceResult.signals,
      setupSteps: partition.setupSteps,
      loopSteps: partition.loopSteps,
      teardownSteps: partition.teardownSteps
    };
  }

  /**
   * Partitions a recording's step sequence into:
   * 1. setupSteps: steps before the repeating interaction (e.g. login, navigate, open tab)
   * 2. loopSteps: steps to be repeated per collection item
   * 3. teardownSteps: optional cleanup steps at the end of the workflow
   */
  static partitionWorkflow(steps, loopStepIndex) {
    if (!Array.isArray(steps) || loopStepIndex < 0 || loopStepIndex >= steps.length) {
      return {
        setupSteps: steps || [],
        loopSteps: [],
        teardownSteps: []
      };
    }

    const setupSteps = steps.slice(0, loopStepIndex);
    const loopCandidateSteps = steps.slice(loopStepIndex);

    // Look for explicit teardown steps at the end (e.g. logout or global close)
    let teardownIdx = -1;
    for (let i = loopCandidateSteps.length - 1; i > 0; i--) {
      const s = loopCandidateSteps[i];
      if (s && (s.role === 'TEARDOWN' || s.isTeardown === true)) {
        teardownIdx = i;
        break;
      }
    }

    let loopSteps = loopCandidateSteps;
    let teardownSteps = [];
    if (teardownIdx > 0) {
      loopSteps = loopCandidateSteps.slice(0, teardownIdx);
      teardownSteps = loopCandidateSteps.slice(teardownIdx);
    }

    return {
      setupSteps,
      loopSteps,
      teardownSteps
    };
  }
}

module.exports = LoopDetector;
