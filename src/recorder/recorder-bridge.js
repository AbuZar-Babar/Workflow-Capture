/**
 * Recorder Bridge (Node.js)
 * 
 * Attaches to Chrome CDP, injects the recorder and selector resolver,
 * collects emitted actions from the page, and persists them to recording.json.
 */

const fs = require('fs');
const path = require('path');
const { connectToBrowser } = require('../utils/cdp-connector');
const logger = require('../utils/logger');

class RecorderBridge {
  constructor(options = {}) {
    this.name = options.name || `recording-${Date.now()}`;
    this.browserURL = options.browserURL || 'http://localhost:9222';
    this.outputDir = options.outputDir || path.resolve(process.cwd(), 'recordings');
    this.browser = null;
    this.page = null;
    this.actions = [];
    this.isRecording = false;
    this.startedAt = null;
    this.startUrl = null;
  }

  /**
   * Initialize and start recording session
   */
  async start() {
    logger.header(`Starting Workflow Recorder: ${this.name}`);

    // Connect to Chrome
    const { browser, page } = await connectToBrowser({ browserURL: this.browserURL });
    this.browser = browser;
    this.page = page;

    this.startUrl = this.page.url();
    this.startedAt = new Date().toISOString();
    this.isRecording = true;
    this.actions = [];

    // 1. Expose action collector bridge function to window context
    try {
      await this.page.exposeFunction('__workflowCaptureEmitAction', (actionPayload) => {
        this._handleCapturedAction(actionPayload);
      });
    } catch (err) {
      // Ignore error if already exposed in this browser session
      if (!err.message.includes('already exists')) {
        throw err;
      }
    }

    // 2. Read selector-resolver.js and recorder-injected.js source code
    const resolverPath = path.resolve(__dirname, '../shared/selector-resolver.js');
    const recorderPath = path.resolve(__dirname, './recorder-injected.js');
    const resolverCode = fs.readFileSync(resolverPath, 'utf8');
    const recorderCode = fs.readFileSync(recorderPath, 'utf8');

    // 3. Register scripts to evaluate on every new document (persists across navigations/reloads)
    await this.page.evaluateOnNewDocument(resolverCode);
    await this.page.evaluateOnNewDocument(recorderCode);

    // 4. Also evaluate immediately on current document if already loaded
    await this.page.evaluate(resolverCode).catch(() => {});
    await this.page.evaluate(recorderCode).catch(() => {});

    logger.success(`Recorder successfully attached to tab: ${this.startUrl}`);
    logger.info('Perform your actions in the Chrome window. Press Enter or Ctrl+C in this terminal when finished.');
  }

  /**
   * Internal handler for actions emitted from in-page script
   */
  _handleCapturedAction(rawAction) {
    if (!this.isRecording) return;

    const actionIndex = this.actions.length;
    const prevTimestamp = actionIndex > 0 ? this.actions[actionIndex - 1].timestamp : rawAction.timestamp;
    const timeDeltaMs = rawAction.timestamp - prevTimestamp;

    const action = {
      id: `act_${actionIndex + 1}_${Date.now().toString(36)}`,
      index: actionIndex,
      type: rawAction.type,
      timestamp: rawAction.timestamp,
      timeDeltaMs,
      target: rawAction.target,
      ...(rawAction.key ? { key: rawAction.key } : {}),
      ...(rawAction.value !== undefined ? { value: rawAction.value } : {}),
      ...(rawAction.meta ? { meta: rawAction.meta } : {})
    };

    this.actions.push(action);

    // Terminal log
    const topCandidate = action.target.candidates[0] ? action.target.candidates[0].value : 'none';
    const tag = action.target.fingerprint.tagName || 'elem';
    const detail = action.key ? `key="${action.key}"` : (action.value ? `value="${action.value}"` : `tag=<${tag}>`);
    logger.action(actionIndex + 1, action.type, topCandidate, detail);
  }

  /**
   * Stop recording, flush in-page buffers, and write recording.json
   */
  async stop() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    logger.info('Stopping recording and flushing pending input buffers...');

    // Attempt to flush any active typing buffer in the page
    if (this.page && !this.page.isClosed()) {
      try {
        await this.page.evaluate(() => {
          if (typeof window.__workflowCaptureFlushBuffer === 'function') {
            window.__workflowCaptureFlushBuffer();
          }
        });
      } catch {
        // Page might be closed or navigating
      }
    }

    const completedAt = new Date().toISOString();
    let viewport = { width: 1280, height: 800 };
    let userAgent = 'unknown';

    if (this.page && !this.page.isClosed()) {
      try {
        viewport = await this.page.viewport() || viewport;
        userAgent = await this.page.evaluate(() => navigator.userAgent);
      } catch {}
    }

    const recording = {
      metadata: {
        recordingId: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        version: '1.0.0',
        name: this.name,
        startedAt: this.startedAt,
        completedAt,
        startUrl: this.startUrl,
        userAgent,
        viewport
      },
      actions: this.actions
    };

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const sanitizedName = this.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const filePath = path.join(this.outputDir, `${sanitizedName}.json`);

    fs.writeFileSync(filePath, JSON.stringify(recording, null, 2), 'utf8');

    logger.divider();
    logger.success(`Workflow recording saved: ${filePath}`);
    logger.info(`Total actions captured: ${this.actions.length}`);

    // Disconnect (do not close the user's Chrome session!)
    if (this.browser) {
      await this.browser.disconnect();
      logger.info('Disconnected from Chrome (Chrome instance remains running).');
    }

    return filePath;
  }
}

module.exports = RecorderBridge;
