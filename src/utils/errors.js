/**
 * Custom structured errors for Workflow Capture & Replay
 */

class AutomationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = new Date().toISOString();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

class CDPConnectionError extends AutomationError {}

class TargetTabNotFoundError extends AutomationError {}

class ElementResolutionTimeoutError extends AutomationError {
  constructor(message, { actionIndex, actionType, target, attempts, timeoutMs }) {
    super(message, { actionIndex, actionType, target, attempts, timeoutMs });
  }
}

class ElementNotInteractableError extends AutomationError {
  constructor(message, { actionIndex, actionType, target, reason }) {
    super(message, { actionIndex, actionType, target, reason });
  }
}

class ActionExecutionError extends AutomationError {
  constructor(message, { actionIndex, actionType, originalError }) {
    super(message, { actionIndex, actionType, originalError: originalError ? originalError.message : null });
  }
}

module.exports = {
  AutomationError,
  CDPConnectionError,
  TargetTabNotFoundError,
  ElementResolutionTimeoutError,
  ElementNotInteractableError,
  ActionExecutionError
};
