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

/**
 * Recursively collect all frames within a page or frame hierarchy at any nesting depth
 */
function getAllFramesRecursive(pageOrFrame) {
  const result = [];
  const visited = new Set();
  const walk = (item) => {
    if (!item || visited.has(item)) return;
    visited.add(item);
    result.push(item);
    const children = typeof item.childFrames === 'function' ? item.childFrames() : [];
    for (const child of children) {
      walk(child);
    }
  };
  if (!pageOrFrame) return result;
  if (typeof pageOrFrame.frames === 'function') {
    for (const f of pageOrFrame.frames()) {
      walk(f);
    }
  } else {
    walk(pageOrFrame);
  }
  return result;
}

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

    // Register this instance with static shared registry for action routing
    RecorderBridge._activeInstances.add(this);

    this._sessionId = `rec_sess_${Date.now()}`;

    // 1. Read selector-resolver.js and recorder-injected.js source code
    const resolverPath = path.resolve(__dirname, '../shared/selector-resolver.js');
    const recorderPath = path.resolve(__dirname, './recorder-injected.js');
    this._resolverCode = fs.readFileSync(resolverPath, 'utf8');
    this._recorderCode = fs.readFileSync(recorderPath, 'utf8');
    this._unifiedScript = `${this._resolverCode}\n;\nwindow.__workflowCaptureSessionId = "${this._sessionId}";\n${this._recorderCode}`;

    this._attachedPages = new Set();
    this._pageCleanups = [];
    this._handledUids = new Set();

    // 2. Attach to the primary page
    await this._attachToPage(this.page);

    // 3. Also attach to any other already-open pages/tabs
    const existingPages = await this.browser.pages().catch((err) => {
      logger.warn(`[Recorder] Failed to list browser pages: ${err?.message || err}`);
      return [];
    });
    for (const p of existingPages) {
      if (p !== this.page) {
        await this._attachToPage(p);
      }
    }

    // 4. Auto-attach to newly opened tabs, popups, or auxiliary windows
    this._onTargetCreated = async (target) => {
      if (!this.isRecording) return;
      if (target.type() === 'page') {
        try {
          const newPage = await target.page();
          if (newPage) {
            logger.info(`[Recorder] New window/popup detected: ${newPage.url() || target.url()}`);
            await this._attachToPage(newPage);
          }
        } catch (err) {
          logger.warn(`[Recorder] Failed to attach to new target: ${err.message}`);
        }
      }
    };
    this.browser.on('targetcreated', this._onTargetCreated);

    // 5. Start safe, non-overlapping frame sweep loop to guarantee all dynamic iframes (e.g. DevExpress ReportViewer) are continuously injected
    this._startFrameSweepLoop();

    logger.success(`Recorder successfully attached to tab: ${this.startUrl}`);
    logger.info('Perform your actions in the Chrome window. Press Enter or Ctrl+C in this terminal when finished.');
  }

  /**
   * Continuous, non-overlapping async frame sweep loop that inspects and injects into newly mounted iframes
   */
  _startFrameSweepLoop() {
    this._sweepRunning = true;
    const sweep = async () => {
      while (this.isRecording && this._sweepRunning) {
        try {
          if (this._attachedPages) {
            for (const p of this._attachedPages) {
              if (!this.isRecording || !this._sweepRunning) break;
              if (!p || p.isClosed()) continue;

              const frames = getAllFramesRecursive(p);
              for (const frame of frames) {
                if (!this.isRecording || !this._sweepRunning) break;
                if (!frame || frame.isDetached()) continue;

                const fName = frame.name() || frame.url() || 'unnamed';
                try {
                  const isLoaded = await Promise.race([
                    frame.evaluate((sessId) => (
                      window.__workflowCaptureSessionId === sessId &&
                      window.__workflowCaptureReady === true &&
                      window.__workflowCaptureDocRef === document &&
                      typeof document !== 'undefined' &&
                      document.__workflowCaptureDocReady === true &&
                      typeof window.SelectorResolver !== 'undefined'
                    ), this._sessionId),
                    new Promise((resolve) => setTimeout(() => resolve(false), 800))
                  ]).catch((err) => {
                    logger.warn(`[Recorder][Sweep] Readiness check evaluate failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
                    return false;
                  });

                  if (!isLoaded && this.isRecording && this._sweepRunning) {
                    await Promise.race([
                      frame.evaluate(this._unifiedScript),
                      new Promise((resolve) => setTimeout(() => resolve(null), 2500))
                    ]).catch((err) => {
                      logger.warn(`[Recorder][Sweep] Script injection evaluate failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
                    });

                    let nowReady = false;
                    for (const delay of [0, 60, 180]) {
                      if (delay > 0) await new Promise(r => setTimeout(r, delay));
                      nowReady = await frame.evaluate(() => (
                        window.__workflowCaptureReady === true &&
                        window.__workflowCaptureDocRef === document &&
                        typeof document !== 'undefined' &&
                        document.__workflowCaptureDocReady === true
                      )).catch((err) => {
                        logger.warn(`[Recorder][Sweep] Verification check evaluate failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
                        return false;
                      });
                      if (nowReady) break;
                    }

                    if (nowReady) {
                      const fname = frame.name() || (frame._id ? `frame-${frame._id.slice(0, 8)}` : null) || frame.url().slice(0, 50);
                      if (fname) {
                        if (!this._reportedFrames) this._reportedFrames = new Set();
                        if (!this._reportedFrames.has(fname)) {
                          this._reportedFrames.add(fname);
                          logger.info(`[Recorder] Toolbar / child iframe ready for capture: ${fname}`);
                        }
                      }
                    }
                  }
                } catch (err) {
                  logger.warn(`[Recorder][Sweep] Frame loop error on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
                }
              }
            }
          }
        } catch (err) {
          logger.warn(`[Recorder][Sweep] Sweep iteration error: ${err?.message || err}`);
        }

        if (!this.isRecording || !this._sweepRunning) break;
        await new Promise(r => setTimeout(r, 200));
      }
    };
    sweep().catch((err) => {
      logger.warn(`[Recorder] Frame sweep loop crashed: ${err?.message || err}`);
    });
  }

  _stopFrameSweepLoop() {
    this._sweepRunning = false;
  }

  /**
   * Attach recorder and selector resolver to a specific Page instance and all its frames
   */
  async _attachToPage(page) {
    if (!page || page.isClosed() || this._attachedPages.has(page)) return;
    this._attachedPages.add(page);

    // 1. PRIMARY BULLETPROOF TRANSPORT: Listen for actions emitted via console
    // Works reliably from any frame, child frame, iframe, or execution context
    const onConsoleMessage = (msg) => {
      const text = msg.text();
      if (text && text.includes('__WORKFLOW_CAPTURE_ACTION__:')) {
        try {
          const idx = text.indexOf('__WORKFLOW_CAPTURE_ACTION__:');
          const jsonStr = text.slice(idx + '__WORKFLOW_CAPTURE_ACTION__:'.length).trim();
          const payload = JSON.parse(jsonStr);
          for (const inst of RecorderBridge._activeInstances) {
            if (inst && inst.isRecording) {
              inst._handleCapturedAction(payload);
            }
          }
        } catch (e) {
          logger.warn(`[Recorder] Failed to parse console action: ${e.message}`);
        }
      }
    };
    page.on('console', onConsoleMessage);
    this._pageCleanups.push(() => {
      if (!page.isClosed()) page.off('console', onConsoleMessage);
    });

    // 2. Expose action collector bridge function to window context with routing to active instance
    try {
      await page.exposeFunction('__workflowCaptureEmitAction', (actionPayload) => {
        for (const inst of RecorderBridge._activeInstances) {
          if (inst && inst.isRecording) {
            inst._handleCapturedAction(actionPayload);
          }
        }
      });
    } catch (err) {
      if (!err.message.includes('already exists')) {
        logger.warn(`[Recorder] Bridge expose warning on page: ${err.message}`);
      }
    }

    // Register unified script to evaluate on every new document (persists across navigations/reloads)
    await page.evaluateOnNewDocument(this._unifiedScript).catch((err) => {
      logger.warn(`[Recorder][Attach] evaluateOnNewDocument failed on page (${page.url()}): ${err?.message || err}`);
    });

    // Evaluate immediately on current document if already loaded
    await page.evaluate(this._unifiedScript).catch((err) => {
      logger.warn(`[Recorder][Attach] Immediate injection failed on ${page.url()}: ${err.message}`);
    });

    // Helper to inject unified recorder script into any child frame (including nested iframes)
    const injectIntoFrame = async (frame) => {
      if (!this.isRecording || !frame || frame.isDetached()) return;
      const fName = frame.name() || frame.url() || 'unnamed';
      try {
        const isLoaded = await Promise.race([
          frame.evaluate((sessId) => (
            window.__workflowCaptureSessionId === sessId &&
            window.__workflowCaptureReady === true &&
            window.__workflowCaptureDocRef === document &&
            typeof document !== 'undefined' &&
            document.__workflowCaptureDocReady === true &&
            typeof window.SelectorResolver !== 'undefined'
          ), this._sessionId),
          new Promise((resolve) => setTimeout(() => resolve(false), 800))
        ]).catch((err) => {
          logger.warn(`[Recorder][Frame] Readiness check failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
          return false;
        });

        if (!isLoaded) {
          await Promise.race([
            frame.evaluate(this._unifiedScript),
            new Promise((resolve) => setTimeout(() => resolve(null), 2500))
          ]).catch((err) => {
            logger.warn(`[Recorder][Frame] Script injection failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
          });

          // Confirm injection actually succeeded by reading back readiness, retrying with backoff if still false
          let verified = false;
          for (const delay of [0, 80, 200, 450]) {
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
            verified = await frame.evaluate(() => (
              window.__workflowCaptureReady === true &&
              window.__workflowCaptureDocRef === document &&
              typeof document !== 'undefined' &&
              document.__workflowCaptureDocReady === true
            )).catch((err) => {
              logger.warn(`[Recorder][Frame] Post-injection verify failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
              return false;
            });
            if (verified) break;
            // Retry injection on failure
            await frame.evaluate(this._unifiedScript).catch((err) => {
              logger.warn(`[Recorder][Frame] Retry script injection failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
            });
          }

          if (verified) {
            const fname = frame.name() || (frame._id ? `frame-${frame._id.slice(0, 8)}` : null) || frame.url().slice(0, 50);
            if (fname) {
              if (!this._reportedFrames) this._reportedFrames = new Set();
              if (!this._reportedFrames.has(fname)) {
                this._reportedFrames.add(fname);
                logger.info(`[Recorder] Toolbar / child iframe ready for capture: ${fname}`);
              }
            }
          }
        }

        // Recursively ensure all child frames are also walked and injected
        const children = typeof frame.childFrames === 'function' ? frame.childFrames() : [];
        for (const child of children) {
          await injectIntoFrame(child);
        }
      } catch (err) {
        logger.warn(`[Recorder][Frame] injectIntoFrame threw on frame "${fName}" (${frame?.url?.()}): ${err?.message || err}`);
      }
    };

    // DevExpress and ExtJS dynamically create iframes and populate scripts asynchronously.
    // Retry injection across 10 seconds after frame attach/navigation and recursively across all nesting levels.
    const scheduleFrameInjection = (targetFrame) => {
      const allFrames = getAllFramesRecursive(targetFrame);
      for (const f of allFrames) {
        const delays = [0, 80, 200, 500, 1000, 2000, 3500, 5000, 7500, 10000];
        for (const d of delays) {
          if (d === 0) {
            injectIntoFrame(f);
          } else {
            setTimeout(() => {
              if (this.isRecording && !f.isDetached()) {
                injectIntoFrame(f);
              }
            }, d);
          }
        }
      }
    };

    const onFrameAttached = (frame) => scheduleFrameInjection(frame);
    const onFrameNavigated = (frame) => scheduleFrameInjection(frame);
    page.on('frameattached', onFrameAttached);
    page.on('framenavigated', onFrameNavigated);

    this._pageCleanups.push(() => {
      if (!page.isClosed()) {
        page.off('frameattached', onFrameAttached);
        page.off('framenavigated', onFrameNavigated);
      }
    });

    const initialFrames = getAllFramesRecursive(page);
    await Promise.allSettled(initialFrames.map(f => injectIntoFrame(f)));
    for (const frame of initialFrames) {
      scheduleFrameInjection(frame);
    }
  }

  /**
   * Internal handler for actions emitted from in-page script.
   * Returns true if action was captured and stored, false if ignored or deduplicated.
   */
  _handleCapturedAction(rawAction) {
    if (!this.isRecording || !rawAction) return false;

    // Deduplicate actions emitted via both console transport and direct binding
    if (rawAction.uid) {
      if (!this._handledUids) this._handledUids = new Set();
      if (this._handledUids.has(rawAction.uid)) return false;
      this._handledUids.add(rawAction.uid);
    }

    const actionIndex = this.actions.length;
    const prevTimestamp = actionIndex > 0 ? this.actions[actionIndex - 1].timestamp : rawAction.timestamp;
    const timeDeltaMs = rawAction.timestamp - prevTimestamp;

    // Consolidate rapid double-clicks on the same target element within 450ms
    if (this.actions.length > 0 && (rawAction.type === 'DOUBLE_CLICK' || rawAction.detail === 2)) {
      const lastAction = this.actions[this.actions.length - 1];
      const isSameTarget = lastAction.target && rawAction.target &&
        ((lastAction.target.fingerprint?.id && lastAction.target.fingerprint.id === rawAction.target.fingerprint?.id) ||
          (lastAction.target.candidates[0]?.value === rawAction.target.candidates[0]?.value) ||
          (lastAction.target.fingerprint?.tagName === rawAction.target.fingerprint?.tagName));

      if (isSameTarget && timeDeltaMs < 450) {
        lastAction.type = 'DOUBLE_CLICK';
        lastAction.timestamp = rawAction.timestamp;
        logger.info(`[Recorder] Consolidated rapid clicks into DOUBLE_CLICK for step #${lastAction.index + 1}`);
        return true;
      }
    }

    // Discard duplicate rapid single clicks on the same target within 150ms (event bubbling or dual trigger)
    if (this.actions.length > 0 && rawAction.type === 'CLICK') {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction.type === 'CLICK' && timeDeltaMs < 150) {
        const isSameTarget = lastAction.target && rawAction.target &&
          ((lastAction.target.fingerprint?.id && lastAction.target.fingerprint.id === rawAction.target.fingerprint?.id) ||
            (lastAction.target.candidates[0]?.value === rawAction.target.candidates[0]?.value) ||
            (lastAction.target.fingerprint?.tagName === rawAction.target.fingerprint?.tagName &&
              lastAction.target.fingerprint?.text === rawAction.target.fingerprint?.text));
        if (isSameTarget) {
          logger.warn(`[Recorder] Discarded duplicate click event within ${timeDeltaMs}ms on <${lastAction.target.fingerprint?.tagName}>`);
          return false;
        }
      }
    }

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
    const topCandidate = action.target && action.target.candidates[0] ? action.target.candidates[0].value : 'none';
    const tag = (action.target && action.target.fingerprint && action.target.fingerprint.tagName) || 'elem';
    const detail = action.key ? `key="${action.key}"` : (action.value ? `value="${action.value}"` : `tag=<${tag}>`);
    logger.action(actionIndex + 1, action.type, topCandidate, detail);
    return true;
  }

  /**
   * Stop recording, flush in-page buffers, and write recording.json
   */
  async stop() {
    if (!this.isRecording) return null;

    logger.info('Stopping recording and flushing pending input buffers...');

    this._stopFrameSweepLoop();

    if (this._onTargetCreated && this.browser) {
      this.browser.off('targetcreated', this._onTargetCreated);
      this._onTargetCreated = null;
    }

    if (this._pageCleanups) {
      for (const cleanup of this._pageCleanups) {
        try { cleanup(); } catch (err) {
          logger.warn(`[Recorder] Page cleanup error: ${err?.message || err}`);
        }
      }
      this._pageCleanups = [];
    }

    // 1. Attempt to flush any active typing buffers across all frames in all attached pages WHILE isRecording is still true
    if (this._attachedPages) {
      for (const p of this._attachedPages) {
        if (!p || p.isClosed()) continue;
        const allFrames = getAllFramesRecursive(p);
        for (const frame of allFrames) {
          const fName = frame.name() || frame.url() || 'unnamed';
          try {
            await frame.evaluate(() => {
              if (typeof window.__workflowCaptureFlushBuffer === 'function') {
                window.__workflowCaptureFlushBuffer();
              }
            }).catch((err) => {
              logger.warn(`[Recorder] Flush buffer evaluate failed on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
            });
          } catch (err) {
            logger.warn(`[Recorder] Flush buffer threw on frame "${fName}" (${frame.url()}): ${err?.message || err}`);
          }
        }
      }
    }

    // 2. Allow short breather for in-flight postMessage events to reach Node.js bridge
    await new Promise(r => setTimeout(r, 150));

    // 3. Mark recording as finished
    this.isRecording = false;
    RecorderBridge._activeInstances.delete(this);

    const completedAt = new Date().toISOString();
    let viewport = { width: 1280, height: 800 };
    let userAgent = 'unknown';

    if (this.page && !this.page.isClosed()) {
      try {
        viewport = await this.page.viewport() || viewport;
        userAgent = await this.page.evaluate(() => navigator.userAgent).catch((err) => {
          logger.warn(`[Recorder] Failed to read userAgent: ${err?.message || err}`);
          return 'unknown';
        });
      } catch (err) {
        logger.warn(`[Recorder] Failed to get page viewport: ${err?.message || err}`);
      }
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

RecorderBridge._activeInstances = new Set();

module.exports = RecorderBridge;
