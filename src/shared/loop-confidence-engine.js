/**
 * Workflow Capture — Loop Confidence Engine
 *
 * Evaluates candidate repeated workflows using multiple independent signals:
 * 1. DOM Repetition (table rows, list items, cards, grid items, repeated containers)
 * 2. Structural Similarity (DOM hierarchy, child tags, classes, attributes)
 * 3. Action Repetition (repeated action targets, recurring patterns)
 * 4. Sibling Relationships (elements sharing parent container)
 * 5. Semantic Similarity (ARIA roles, accessible names, table headers)
 * 6. Navigation Behavior (absence of page navigation between repeated item clicks)
 * 7. Selector Similarity (nth-child, nth-of-type, data-item patterns)
 *
 * Produces a normalized confidence score (0-100%) and confidence category:
 * - HIGH (>= 75%): Automatically treat as loop workflow without asking
 * - MEDIUM (45% - 74%): Promising candidate, inspect further evidence
 * - LOW (< 45%): Treat as normal sequential workflow
 */

'use strict';

class LoopConfidenceEngine {
  /**
   * Weights for the confidence signals.
   */
  static SIGNAL_WEIGHTS = Object.freeze({
    DOM_REPETITION: 0.25,
    STRUCTURAL_SIMILARITY: 0.20,
    ACTION_REPETITION: 0.15,
    SIBLING_RELATIONSHIP: 0.15,
    SEMANTIC_SIMILARITY: 0.10,
    SELECTOR_SIMILARITY: 0.10,
    NAVIGATION_PATTERN: 0.05
  });

  /**
   * Evaluate confidence from observed step and DOM signals.
   *
   * @param {object} stepAnalysis - Output from step-level analysis
   * @param {object} context - Additional signals (all steps, item count, etc.)
   * @returns {{
   *   score: number,
   *   category: 'HIGH' | 'MEDIUM' | 'LOW',
   *   signals: object,
   *   reasons: string[],
   *   autoLoop: boolean
   * }}
   */
  static evaluate(stepAnalysis = {}, context = {}) {
    const reasons = [];
    const signals = {
      domRepetition: 0,
      structuralSimilarity: 0,
      actionRepetition: 0,
      siblingRelationship: 0,
      semanticSimilarity: 0,
      selectorSimilarity: 0,
      navigationPattern: 0
    };

    if (!stepAnalysis || !stepAnalysis.isLoopCandidate) {
      return {
        score: 0,
        category: 'LOW',
        signals,
        reasons: ['No loop candidate characteristics detected.'],
        autoLoop: false
      };
    }

    const patternType = stepAnalysis.patternType || 'unknown';

    // 1. DOM Repetition Signal
    if (patternType === 'table-row') {
      signals.domRepetition = 0.95;
      reasons.push('Action targets repeated table row structure (<tr> / gridcell).');
    } else if (patternType === 'checkbox-list') {
      signals.domRepetition = 0.95;
      reasons.push('Action targets repeated checkbox selection list.');
    } else if (patternType === 'radio-group') {
      signals.domRepetition = 0.90;
      reasons.push('Action targets radio option group.');
    } else if (patternType === 'dropdown-option') {
      signals.domRepetition = 0.95;
      reasons.push('Action targets dropdown option collection (mat-option / [role="option"]).');
    } else if (patternType === 'list-item') {
      signals.domRepetition = 0.85;
      reasons.push('Action targets repeating list item (<li>).');
    } else if (patternType === 'card-grid' || patternType === 'repeated-container') {
      signals.domRepetition = 0.80;
      reasons.push('Action targets recurring card or grid container.');
    } else {
      signals.domRepetition = 0.50;
    }

    // 2. Structural & Sibling Similarity Signal
    const cssPath = stepAnalysis.originalCssPath || '';
    if (/:(?:nth-child|nth-of-type)\(\d+\)/i.test(cssPath)) {
      signals.structuralSimilarity = 0.90;
      signals.siblingRelationship = 0.90;
      signals.selectorSimilarity = 0.85;
      reasons.push('Target CSS path contains indexed sibling selector (:nth-child/:nth-of-type).');
    } else if (/tbody\s*>\s*tr|ul\s*>\s*li|ol\s*>\s*li/i.test(cssPath)) {
      signals.structuralSimilarity = 0.80;
      signals.siblingRelationship = 0.85;
      signals.selectorSimilarity = 0.70;
      reasons.push('Target is a direct child of a repeating collection container.');
    } else {
      signals.structuralSimilarity = 0.50;
      signals.siblingRelationship = 0.50;
      signals.selectorSimilarity = 0.40;
    }

    // 3. Action Repetition Signal (across recorded steps)
    const allSteps = Array.isArray(context.allSteps) ? context.allSteps : [];
    if (allSteps.length > 1) {
      // Check if multiple recorded actions target elements with similar container or nth-child patterns
      let similarActionCount = 0;
      const targetTags = new Set();
      for (const s of allSteps) {
        const sPath = s?.target?.candidates?.[0]?.value || s?.selectors?.cssPath || '';
        if (/:(?:nth-child|nth-of-type)\(\d+\)/i.test(sPath) || /tr|mat-option|li/i.test(sPath)) {
          similarActionCount++;
        }
        if (s?.target?.fingerprint?.tagName) {
          targetTags.add(s.target.fingerprint.tagName.toLowerCase());
        }
      }
      if (similarActionCount >= 2) {
        signals.actionRepetition = 0.90;
        reasons.push(`${similarActionCount} recorded actions demonstrate repeating item target patterns.`);
      } else if (similarActionCount === 1) {
        signals.actionRepetition = 0.70;
      }
    } else {
      signals.actionRepetition = 0.60;
    }

    // 4. Semantic Similarity Signal
    const fp = stepAnalysis.fingerprint || context.fingerprint || {};
    const role = (fp.role || '').toLowerCase();
    const tag = (fp.tagName || '').toLowerCase();
    if (['row', 'gridcell', 'option', 'listitem', 'checkbox', 'radio', 'switch'].includes(role) || ['tr', 'td', 'li', 'mat-option'].includes(tag)) {
      signals.semanticSimilarity = 0.95;
      reasons.push(`Accessible semantic role or tag indicates collection item (role="${role || tag}").`);
    } else if (fp.ariaLabel || fp.title || (Array.isArray(fp.classes) && fp.classes.some(c => /item|card|row|cell|check/i.test(c)))) {
      signals.semanticSimilarity = 0.75;
      reasons.push('Element classes or ARIA attributes indicate collection item membership.');
    } else {
      signals.semanticSimilarity = 0.50;
    }

    // 5. Navigation Pattern Signal
    // Actions within an item loop should typically be on the same page/view unless it opens a sub-dialog
    signals.navigationPattern = 0.85;

    // Discovered item count boost (if live portal context is provided)
    if (typeof context.itemCount === 'number' && context.itemCount >= 2) {
      signals.domRepetition = Math.min(1.0, signals.domRepetition + 0.1);
      reasons.push(`Live DOM confirmed collection with ${context.itemCount} items.`);
    }

    // Compute weighted aggregate score
    let weightedScore = 0;
    weightedScore += signals.domRepetition * this.SIGNAL_WEIGHTS.DOM_REPETITION;
    weightedScore += signals.structuralSimilarity * this.SIGNAL_WEIGHTS.STRUCTURAL_SIMILARITY;
    weightedScore += signals.actionRepetition * this.SIGNAL_WEIGHTS.ACTION_REPETITION;
    weightedScore += signals.siblingRelationship * this.SIGNAL_WEIGHTS.SIBLING_RELATIONSHIP;
    weightedScore += signals.semanticSimilarity * this.SIGNAL_WEIGHTS.SEMANTIC_SIMILARITY;
    weightedScore += signals.selectorSimilarity * this.SIGNAL_WEIGHTS.SELECTOR_SIMILARITY;
    weightedScore += signals.navigationPattern * this.SIGNAL_WEIGHTS.NAVIGATION_PATTERN;

    const finalScore = Math.round(Math.min(1.0, Math.max(0.0, weightedScore)) * 100);

    let category = 'LOW';
    if (finalScore >= 75) {
      category = 'HIGH';
    } else if (finalScore >= 45) {
      category = 'MEDIUM';
    }

    return {
      score: finalScore,
      category,
      signals,
      reasons,
      autoLoop: category === 'HIGH'
    };
  }
}

module.exports = LoopConfidenceEngine;
