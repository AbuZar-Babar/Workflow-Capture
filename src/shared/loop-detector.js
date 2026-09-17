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
    const cssPath = selectors.cssPath || selectors.hierarchical || '';
    const tagName = (fingerprint.tagName || '').toLowerCase();
    const parentTag = (fingerprint.parentTag || '').toLowerCase();

    // 1. Table Row Detection (<tr>, <td>, <th>)
    if (cssPath.includes('tr:nth-child') || cssPath.includes('tbody > tr') || parentTag === 'tr' || parentTag === 'td' || tagName === 'tr') {
      const tableMatch = cssPath.match(/(.*?tr)(?::nth-child\(\d+\))?(.*)/i);
      if (tableMatch) {
        const containerSelector = tableMatch[1].replace(/:nth-child\(\d+\)/g, '').trim();
        const relativeSelector = tableMatch[2].replace(/^ > /, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'table-row',
          containerSelector: containerSelector || 'table tbody tr',
          relativeSelector: relativeSelector || '*',
          originalCssPath: cssPath,
          description: 'Repeated action across table rows'
        };
      }
    }

    // 2. Ordered/Unordered List Items (<ul> / <ol> -> <li>)
    if (cssPath.includes('li:nth-child') || cssPath.includes('ul > li') || cssPath.includes('ol > li') || parentTag === 'li' || tagName === 'li') {
      const listMatch = cssPath.match(/(.*?li)(?::nth-child\(\d+\))?(.*)/i);
      if (listMatch) {
        const containerSelector = listMatch[1].replace(/:nth-child\(\d+\)/g, '').trim();
        const relativeSelector = listMatch[2].replace(/^ > /, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'list-item',
          containerSelector: containerSelector || 'ul > li',
          relativeSelector: relativeSelector || '*',
          originalCssPath: cssPath,
          description: 'Repeated action across list items'
        };
      }
    }

    // 3. Repeating Card or Grid Containers (.item, .card, [data-item-id])
    if (/(:nth-child\(\d+\))/.test(cssPath)) {
      const parts = cssPath.split(/:nth-child\(\d+\)/);
      if (parts.length >= 2) {
        const containerSelector = parts[0].trim();
        const relativeSelector = parts.slice(1).join('').replace(/^ > /, '').trim() || null;
        return {
          isLoopCandidate: true,
          patternType: 'card-grid',
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
      originalCssPath: cssPath
    };
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

    const setupSteps = steps.slice(0, loopStepIndex);
    const loopSteps = [steps[loopStepIndex]];
    const teardownSteps = steps.slice(loopStepIndex + 1);

    return {
      setupSteps,
      loopSteps,
      teardownSteps
    };
  }
}

module.exports = LoopDetector;
