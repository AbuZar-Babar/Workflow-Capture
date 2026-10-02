/**
 * Workflow Capture — Generalized Workflow Knowledge Model
 * 
 * Compiles a raw recording into a structured, semantic, and reusable
 * Workflow Knowledge representation as required by Part 25.
 * 
 * Works across:
 * - Different records
 * - Different dates
 * - Different item counts
 * - Different pages
 * - Minor DOM changes
 */

'use strict';

const LoopDetector = require('../shared/loop-detector');
const ActionGeneralizer = require('../shared/action-generalizer');
const FieldDetector = require('../shared/field-detector');

class WorkflowKnowledge {
  /**
   * Compiles recorded workflow actions and metadata into a generalized knowledge model.
   *
   * @param {object} workflow - Raw workflow or recording
   * @returns {object} Generalized Workflow Knowledge
   */
  static compile(workflow = {}) {
    const actions = Array.isArray(workflow.actions || workflow.steps) ? (workflow.actions || workflow.steps) : [];
    const metadata = workflow.metadata || {};
    const workflowId = workflow.id || metadata.recordingId || `wf_${Date.now()}`;
    const name = workflow.name || metadata.name || 'Workflow';

    // 1. Automatic loop & boundary analysis
    const loopAnalysis = LoopDetector.analyzeWorkflow(actions);

    // 2. Classify setup steps vs loop steps
    const setup = loopAnalysis.setupSteps.map((s, idx) => ({
      index: idx,
      type: s.type || s.action || 'CLICK',
      targetText: s.target?.fingerprint?.text || null,
      safety: ActionGeneralizer.classifySafety(s)
    }));

    // 3. Classify item actions vs page actions in the loop segment
    const itemActions = [];
    const pageActions = [];
    let downloadAction = null;

    if (loopAnalysis.isLoop) {
      const generalized = ActionGeneralizer.generalizeActions(loopAnalysis.loopSteps, {
        itemTag: loopAnalysis.patternType === 'list-item' ? 'li' : (loopAnalysis.patternType === 'dropdown-option' ? 'mat-option' : 'tr')
      });

      for (const a of generalized) {
        const safety = ActionGeneralizer.classifySafety(a);
        if (safety.category === 'download' && !downloadAction) {
          downloadAction = {
            type: a.type || 'CLICK',
            scope: a.scope,
            selector: a.target?.candidates?.[0]?.value || null
          };
        }

        if (a.scope === 'item') {
          itemActions.push({
            type: a.type || 'CLICK',
            scope: 'item',
            relativeSelector: a.target?.candidates?.[0]?.value || ':scope',
            safety
          });
        } else {
          pageActions.push({
            type: a.type || 'CLICK',
            scope: 'page',
            selector: a.target?.candidates?.[0]?.value || null,
            safety
          });
        }
      }
    }

    // 4. Infer workflow purpose from name and actions
    let purpose = 'General Workflow Automation';
    if (downloadAction || /download|export/i.test(name)) {
      purpose = 'Collection Document / Data Download';
    } else if (/search|filter/i.test(name)) {
      purpose = 'Data Search and Inspection';
    }

    return {
      workflowId,
      name,
      purpose,
      isLoop: loopAnalysis.isLoop,
      loopStepIndex: loopAnalysis.loopStepIndex,
      confidence: {
        score: loopAnalysis.confidence,
        category: loopAnalysis.confidenceCategory,
        signals: loopAnalysis.signals,
        reasons: loopAnalysis.reasons
      },
      setup,
      collectionPattern: {
        patternType: loopAnalysis.patternType,
        isLoopCandidate: loopAnalysis.isLoop
      },
      itemActions,
      pageActions,
      downloadAction,
      fallbackStrategies: [
        'accessibility_semantics',
        'role_accessible_name',
        'stable_attributes',
        'semantic_relationships',
        'text_matching'
      ],
      compiledAt: new Date().toISOString()
    };
  }
}

module.exports = WorkflowKnowledge;
