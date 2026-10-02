/**
 * Workflow Capture — Intelligent Question Generator
 * 
 * Generates runtime clarifying questions dynamically from:
 * USER INTENT + LIVE PORTAL DATA + AVAILABLE FIELDS + WORKFLOW CAPABILITIES
 * 
 * Key Invariants:
 * 1. Never creates fixed, rigid questionnaires.
 * 2. If the user's intent is already complete, asks NOTHING (returns empty list).
 * 3. Only generates questions when necessary to prevent destructive or overly broad runs.
 * 4. Options are populated from REAL values discovered in the live portal.
 */

'use strict';

const FieldDetector = require('../shared/field-detector');

class QuestionGenerator {
  /**
   * Evaluates if questions are necessary and produces targeted interactive options.
   *
   * @param {object} intent - Result of IntentResolver.parse()
   * @param {object} portalData - Discovered collection metadata, item count, and sample items
   * @param {object} [workflow] - Workflow definition
   * @returns {Array<{
   *   id: string,
   *   question: string,
   *   options: Array<string|object>,
   *   defaultValue: string,
   *   field: string,
   *   concept: string
   * }>} List of necessary questions, or empty array if none needed.
   */
  static generateQuestions(intent = {}, portalData = {}, workflow = {}) {
    const questions = [];
    const itemCount = portalData.itemCount || portalData.items?.length || 0;
    const items = portalData.items || [];
    const availableFields = portalData.availableFields || [];

    // Rule 1: If 0 or 1 item found, no ambiguous choice to make
    if (itemCount <= 1) {
      return questions;
    }

    // Rule 2: If the user's intent already specifies concrete filter conditions, no clarification is needed
    const hasStatusCondition = (intent.conditions || []).some(c => c.concept === 'status');
    const hasDateCondition = (intent.conditions || []).some(c => c.concept === 'date');
    const hasExplicitFilter = (intent.conditions || []).length > 0;
    const isExplicitAll = intent.itemMode === 'all';

    if (hasStatusCondition && hasDateCondition) {
      // Fully specified intent
      return questions;
    }

    if (hasExplicitFilter || isExplicitAll) {
      // Filter or full-run already explicitly declared by user
      return questions;
    }

    // Rule 3: The user gave a broad intent (e.g. "Download invoices" or "Get transactions")
    // Inspect the live portal items to discover real status values
    const statusField = FieldDetector.resolveFieldForConcept(
      items[0]?.fields || {},
      'status'
    );

    if (statusField) {
      const statusCounts = new Map();
      for (const item of items) {
        const val = item.fields?.[statusField];
        if (val) {
          const cleanVal = String(val).trim();
          statusCounts.set(cleanVal, (statusCounts.get(cleanVal) || 0) + 1);
        }
      }

      if (statusCounts.size >= 2) {
        const entityName = intent.target || 'items';
        const options = ['All'];
        for (const [st, count] of statusCounts.entries()) {
          options.push(`${st} (${count})`);
        }

        questions.push({
          id: 'filter_status',
          concept: 'status',
          field: statusField,
          question: `I found ${itemCount} ${entityName}. Which ones should I process?`,
          options,
          defaultValue: 'All'
        });

        // One high-level question is sufficient
        return questions;
      }
    }

    return questions;
  }
}

module.exports = QuestionGenerator;
