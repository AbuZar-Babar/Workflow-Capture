/**
 * Workflow Capture — Execution State Machine
 * 
 * Formal state machine managing the end-to-end autonomous execution lifecycle
 * defined in Part 24:
 * 
 * INITIALIZING
 *   ↓
 * UNDERSTANDING_INTENT
 *   ↓
 * INSPECTING_PAGE
 *   ↓
 * DISCOVERING_COLLECTION
 *   ↓
 * DISCOVERING_FIELDS
 *   ↓
 * RESOLVING_CONDITIONS
 *   ↓
 * FILTERING
 *   ↓
 * PREVIEW
 *   ↓
 * EXECUTING
 *   ↓
 * VALIDATING
 *   ↓
 * PAGINATION
 *   ↓
 * COMPLETED (or RECOVERABLE_ERROR / FATAL_ERROR)
 */

'use strict';

const EventEmitter = require('events');
const logger = require('../utils/logger');

const EXECUTION_STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  UNDERSTANDING_INTENT: 'UNDERSTANDING_INTENT',
  INSPECTING_PAGE: 'INSPECTING_PAGE',
  DISCOVERING_COLLECTION: 'DISCOVERING_COLLECTION',
  DISCOVERING_FIELDS: 'DISCOVERING_FIELDS',
  RESOLVING_CONDITIONS: 'RESOLVING_CONDITIONS',
  FILTERING: 'FILTERING',
  PREVIEW: 'PREVIEW',
  EXECUTING: 'EXECUTING',
  VALIDATING: 'VALIDATING',
  PAGINATION: 'PAGINATION',
  COMPLETED: 'COMPLETED',
  RECOVERABLE_ERROR: 'RECOVERABLE_ERROR',
  FATAL_ERROR: 'FATAL_ERROR'
});

class ExecutionStateMachine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.runId = options.runId || `run_${Date.now()}`;
    this.currentState = EXECUTION_STATES.INITIALIZING;
    this.history = [];
    this.context = {};
    this.transitionTo(EXECUTION_STATES.INITIALIZING, { startedAt: new Date().toISOString() });
  }

  /**
   * Transition to a new execution state.
   *
   * @param {string} newState - Must be one of EXECUTION_STATES
   * @param {object} [data] - Optional state data or diagnostics
   */
  transitionTo(newState, data = {}) {
    if (!EXECUTION_STATES[newState]) {
      throw new Error(`Invalid execution state: ${newState}`);
    }

    const previousState = this.currentState;
    this.currentState = newState;
    const transitionRecord = {
      from: previousState,
      to: newState,
      timestamp: new Date().toISOString(),
      data
    };

    this.history.push(transitionRecord);
    this.context = { ...this.context, ...data };

    logger.info(`[StateMachine][${this.runId}] ${previousState} → ${newState}`);
    this.emit('transition', transitionRecord);
    this.emit(newState, data);

    return transitionRecord;
  }

  getState() {
    return this.currentState;
  }

  getHistory() {
    return this.history;
  }

  isTerminal() {
    return [EXECUTION_STATES.COMPLETED, EXECUTION_STATES.FATAL_ERROR].includes(this.currentState);
  }
}

module.exports = {
  ExecutionStateMachine,
  EXECUTION_STATES
};
