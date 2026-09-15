/**
 * JSDoc Type Definitions for Workflow Capture & Replay
 * 
 * @typedef {'CLICK' | 'DOUBLE_CLICK' | 'TYPE' | 'SELECT'} ActionType
 * 
 * @typedef {'id' | 'data-attr' | 'attribute' | 'text' | 'css-path' | 'xpath'} SelectorStrategy
 * 
 * @typedef {Object} SelectorCandidate
 * @property {SelectorStrategy} strategy - The strategy used to produce this selector
 * @property {string} value - The selector string (CSS, text expression, or XPath)
 * @property {number} uniqueness - Count of elements matching this selector at capture time
 * @property {number} priority - Ranking priority (1 = highest)
 * 
 * @typedef {Object} ElementFingerprint
 * @property {string} tagName - Lowercase tag name (e.g. 'button', 'input')
 * @property {string|null} id - Element ID attribute
 * @property {string|null} name - Element name attribute
 * @property {string|null} type - Input type attribute (e.g. 'text', 'submit')
 * @property {string|null} role - ARIA role attribute
 * @property {string|null} placeholder - Placeholder text
 * @property {string|null} ariaLabel - aria-label attribute value
 * @property {string} text - Visible text content (trimmed, max 120 chars)
 * @property {string[]} classes - Cleaned static CSS class list
 * @property {Object.<string, string>} attributes - Map of key attributes (href, title, value for select, etc.)
 * @property {boolean} isPassword - Whether this is a sensitive/password field
 * @property {{ width: number, height: number }} dimensions - Bounding client rect dimensions
 * 
 * @typedef {Object} ElementTarget
 * @property {SelectorCandidate[]} candidates - Ranked list of selector candidates
 * @property {ElementFingerprint} fingerprint - Snapshot of element identity and semantics
 * 
 * @typedef {Object} Action
 * @property {string} id - Unique action UUID or sequential identifier
 * @property {number} index - 0-indexed execution order
 * @property {ActionType} type - Action type
 * @property {number} timestamp - Epoch timestamp in milliseconds
 * @property {number} timeDeltaMs - Milliseconds elapsed since the previous action
 * @property {ElementTarget} target - Target element description
 * @property {string} [value] - Required for TYPE (text typed) and SELECT (value selected)
 * @property {Object} [meta] - Optional metadata (e.g., coordinates, key modifier)
 * 
 * @typedef {Object} RecordingMetadata
 * @property {string} recordingId - Unique ID of the recording session
 * @property {string} version - Schema version (e.g. '1.0.0')
 * @property {string} name - Friendly recording name
 * @property {string} startedAt - ISO timestamp of start
 * @property {string} [completedAt] - ISO timestamp of completion
 * @property {string} startUrl - Initial URL where recording began
 * @property {string} userAgent - Browser user agent
 * @property {{ width: number, height: number }} viewport - Dimensions of recorded tab
 * 
 * @typedef {Object} WorkflowRecording
 * @property {RecordingMetadata} metadata - Session metadata
 * @property {Action[]} actions - Ordered list of actions
 */

module.exports = {};
