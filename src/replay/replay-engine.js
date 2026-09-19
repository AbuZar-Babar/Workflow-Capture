/**
 * Replay Engine (Node.js)
 * 
 * Orchestrates condition-based playback of recorded actions against
 * an existing Chrome session via CDP, enhanced with humanized mouse trajectories,
 * stochastic keystroke dynamics, and anti-captcha stealth evasion.
 */

const fs = require('fs');
const path = require('path');
const { connectToBrowser } = require('../utils/cdp-connector');
const { DEFAULT_TIMEOUTS } = require('../shared/constants');
const {
  ElementResolutionTimeoutError,
  ActionExecutionError,
  AutomationError
} = require('../utils/errors');
const { dispatchAction } = require('./action-executors');
const { calculateDelay } = require('./human-mouse');
const { getActiveBotConfig } = require('../api/bot-config-controller');
const { resolveTargetUrl } = require('../utils/url-helper');
const logger = require('../utils/logger');

class ReplayEngine {
  constructor(options = {}) {
    this.browserURL = options.browserURL || 'http://localhost:9222';
    this.speed = options.speed || 1.0; // Speed multiplier (1.0 = real-time, 2.0 = 2x, etc.)
    this.botConfig = options.botConfig || getActiveBotConfig();
    this.timeoutMs = options.timeoutMs || this.botConfig?.resolution?.timeoutMs || DEFAULT_TIMEOUTS.RESOLUTION_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs || this.botConfig?.resolution?.pollIntervalMs || DEFAULT_TIMEOUTS.POLL_INTERVAL_MS;
    this.stepDelayMs = options.stepDelayMs || options.stepDelay || 0;
    this.secretResolver = options.secretResolver || null; // async function(secretId) => plaintext
    this.browser = null;
    this.page = null;
    this.isAborted = false;
  }

  /**
   * Signal abort to halt execution
   */
  async abort() {
    this.isAborted = true;
    logger.warn('[Replay Engine] Abort signal triggered.');
  }

  /**
   * Wait for any transient SPA/ExtJS loading masks or spinners to disappear
   */
  async _waitForLoadingMasks(timeoutMs = 8000) {
    if (!this.page) return;
    try {
      await this.page.waitForFunction(() => {
        const masks = Array.from(document.querySelectorAll('.x-mask, .x-mask-loading, .x-mask-msg, .loading-mask, .spinner-overlay, [aria-busy="true"]'));
        return !masks.some(m => {
          if (m.offsetParent === null) return false;
          const style = window.getComputedStyle(m);
          return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.05;
        });
      }, { timeout: timeoutMs }).catch(() => {});
    } catch {}
  }

  /**
   * Load and validate a recording JSON file from disk
   */
  loadRecording(recordingPath) {
    const fullPath = path.resolve(process.cwd(), recordingPath);
    if (!fs.existsSync(fullPath)) {
      throw new AutomationError(`Recording file not found: ${fullPath}`);
    }

    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const recording = JSON.parse(raw);

      if (!recording.metadata || !Array.isArray(recording.actions)) {
        throw new Error('Missing "metadata" or "actions" array in recording JSON');
      }

      return recording;
    } catch (err) {
      throw new AutomationError(`Failed to parse recording JSON: ${err.message}`, { path: fullPath });
    }
  }

  /**
   * Inject anti-detection / anti-captcha evasion scripts into page
   */
  async _applyStealthEvasion() {
    if (!this.page || !this.botConfig?.stealth) return;
    const stealth = this.botConfig.stealth;

    try {
      await this.page.evaluate((cfg) => {
        if (cfg.maskWebdriver) {
          // Remove navigator.webdriver flag
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
          });
        }

        if (cfg.emulateChromeRuntime) {
          // Emulate standard window.chrome
          if (!window.chrome) {
            window.chrome = {
              runtime: {},
              app: {},
              csi: () => {},
              loadTimes: () => {}
            };
          }
        }

        if (cfg.emulatePlugins) {
          // Mask empty plugins array commonly found in automated Headless Chrome
          if (navigator.plugins.length === 0) {
            const mockPlugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ];
            Object.defineProperty(navigator, 'plugins', {
              get: () => mockPlugins,
              configurable: true
            });
          }
        }
      }, stealth);
    } catch {}
  }

  /**
   * Connects to the browser via CDP and prepares active tab
   */
  async connect() {
    const { browser, page } = await connectToBrowser({
      browserURL: this.browserURL
    });
    this.browser = browser;
    this.page = page;
    await this._applyStealthEvasion();
    return this.browser;
  }

  /**
   * Execute a single recorded action on the active page
   */
  async executeAction(action, index = 0) {
    if (!this.page) throw new Error('ReplayEngine is not connected to a page.');

    // 1. Explicit step delay if requested
    if (this.stepDelayMs > 0) {
      await new Promise(r => setTimeout(r, this.stepDelayMs));
    }

    // 2. Wait for any active ExtJS/SPA loading masks or spinners to clear
    await this._waitForLoadingMasks(6000);

    if (this.isAborted) {
      throw new Error('Execution stopped by user');
    }

    // Apply pre-action delay if configured
    if (this.botConfig?.timing?.preActionDelayMs > 0) {
      const preDelay = calculateDelay(
        Math.round(this.botConfig.timing.preActionDelayMs * 0.7),
        Math.round(this.botConfig.timing.preActionDelayMs * 1.3)
      );
      await new Promise(r => setTimeout(r, preDelay));
    }

    if (action.type === 'NAVIGATE' && action.url) {
      const navUrl = resolveTargetUrl(action.url) || action.url;
      await this.page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this._applyStealthEvasion();
      await new Promise(r => setTimeout(r, 500));
      return { success: true, type: 'NAVIGATE' };
    }

    const { elementHandle, candidate, confidenceScore } = await this.waitForTargetElement(
      action.target || action.fingerprint,
      index,
      action.type
    );

    // Deep clone the action so we don't mutate the original recording
    const actionToDispatch = { ...action };
    if (actionToDispatch.type === 'TYPE' && typeof actionToDispatch.value === 'string') {
      const match = actionToDispatch.value.match(/^{{secret:([^}]+)}}$/);
      if (match && this.secretResolver) {
        logger.info(`Injecting secret [${match[1]}] for action #${index + 1}...`);
        actionToDispatch.value = await this.secretResolver(match[1]);
      }
    }

    await dispatchAction(elementHandle, actionToDispatch, {
      page: this.page,
      botConfig: this.botConfig
    });
    await elementHandle.dispose().catch(() => {});

    const scorePercent = Math.round(confidenceScore * 100);
    logger.action(index + 1, action.type, candidate.value, `score=${scorePercent}%`);

    // Calculate humanized post-action timing delay
    let postDelay = DEFAULT_TIMEOUTS.POST_ACTION_DELAY_MS;
    if (this.botConfig?.timing) {
      const minD = this.botConfig.timing.minActionDelayMs || 200;
      const maxD = this.botConfig.timing.maxActionDelayMs || 600;
      postDelay = calculateDelay(minD, maxD, 'gaussian');
    }

    await new Promise(r => setTimeout(r, postDelay));

    return { success: true, confidenceScore, candidate };
  }

  /**
   * Ensure selector resolver is loaded inside a specific frame or page context
   */
  async _ensureSelectorResolverInFrame(frame) {
    try {
      const targetFrame = frame || this.page;
      const isResolverLoaded = await targetFrame.evaluate(() => typeof window.SelectorResolver !== 'undefined').catch(() => false);

      if (!isResolverLoaded) {
        const resolverPath = path.resolve(__dirname, '../shared/selector-resolver.js');
        const resolverCode = fs.readFileSync(resolverPath, 'utf8');
        await targetFrame.evaluate(resolverCode).catch(() => {});
      }
    } catch {
      // Ignore transient detached frame errors
    }
  }

  /**
   * Condition-based in-page polling resolver loop across main page and all child frames (iframes)
   */
  async waitForTargetElement(target, actionIndex, actionType) {
    const startTime = Date.now();
    let lastResolutionResult = null;

    while (Date.now() - startTime < this.timeoutMs) {
      if (this.isAborted) {
        throw new Error('Execution stopped by user');
      }
      try {
        const frames = [this.page.mainFrame(), ...this.page.frames().filter(f => f !== this.page.mainFrame())];

        for (const frame of frames) {
          try {
            await this._ensureSelectorResolverInFrame(frame);

            // 1. Resolve and obtain direct JSHandle to the matched DOM element in this frame
            const handle = await frame.evaluateHandle((targetData) => {
              if (!window.SelectorResolver) return null;
              const res = window.SelectorResolver.resolveElement(targetData);
              return res.success && res.element ? res.element : null;
            }, target).catch(() => null);

            // 2. Fetch resolution report
            const report = await frame.evaluate((targetData) => {
              if (!window.SelectorResolver) return null;
              return window.SelectorResolver.resolveElement(targetData);
            }, target).catch(() => null);

            if (report && report.success) {
              lastResolutionResult = report;
            }

            // 3. Validate element and check interactability
            if (handle) {
              const element = handle.asElement();
              if (element) {
                const isAttached = await element.evaluate(el => el.isConnected && el.ownerDocument.contains(el)).catch(() => false);

                if (isAttached) {
                  const matchedCandidate = (report && report.candidate) ? report.candidate : (target.candidates && target.candidates[0]) || { strategy: 'css_id', value: target.targetId || 'unknown' };
                  const confidenceScore = (report && report.confidenceScore) || 1.0;

                  return {
                    elementHandle: element,
                    frame,
                    candidate: matchedCandidate,
                    confidenceScore
                  };
                }
                await element.dispose().catch(() => {});
              } else {
                await handle.dispose().catch(() => {});
              }
            }
          } catch {
            // Continue searching remaining frames
          }
        }
      } catch {
        // Retry polling on frame detach
      }

      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }

    // Timeout exceeded
    const failureReport = lastResolutionResult || {
      bestScore: 0,
      candidatesTried: (target && target.candidates) ? target.candidates.length : 0,
      reason: 'No candidate matched within timeout'
    };

    throw new ElementResolutionTimeoutError(
      `Condition-based resolution timed out after ${this.timeoutMs}ms for Action #${actionIndex + 1} [${actionType}]`,
      {
        actionIndex,
        actionType,
        target,
        timeoutMs: this.timeoutMs,
        resolutionReport: failureReport
      }
    );
  }

  /**
   * Main replay execution entry point
   */
  async replay(recordingPathOrObject) {
    let recording;
    if (typeof recordingPathOrObject === 'string') {
      recording = this.loadRecording(recordingPathOrObject);
      logger.info(`Loaded recording from: ${recordingPathOrObject}`);
    } else if (recordingPathOrObject) {
      const actions = Array.isArray(recordingPathOrObject.actions)
        ? recordingPathOrObject.actions
        : (Array.isArray(recordingPathOrObject.steps) ? recordingPathOrObject.steps : []);
      recording = {
        metadata: recordingPathOrObject.metadata || {
          name: recordingPathOrObject.name || 'Workflow',
          startUrl: recordingPathOrObject.targetUrl || (recordingPathOrObject.metadata && recordingPathOrObject.metadata.startUrl) || ''
        },
        actions,
        targetUrl: recordingPathOrObject.targetUrl
      };
    } else {
      throw new AutomationError('Invalid recording parameter passed to ReplayEngine');
    }

    logger.info(`Initializing replay session: "${recording.metadata ? recording.metadata.name : 'workflow'}" (${recording.actions.length} actions)`);

    // Resolve cross-platform file:/// URLs or web URLs
    let rawStartUrl = (recording.metadata && recording.metadata.startUrl) || recording.targetUrl || (recording.actions && recording.actions[0] && recording.actions[0].url) || null;
    let targetStartUrl = resolveTargetUrl(rawStartUrl);

    // Connect to Chrome via CDP
    const { browser, page } = await connectToBrowser({
      browserURL: this.browserURL
    });
    this.browser = browser;
    this.page = page;

    // Apply anti-bot stealth scripts
    await this._applyStealthEvasion();

    // 1. Auto-handle browser dialogs
    this.page.on('dialog', async (dialog) => {
      logger.info(`Page dialog appeared: [${dialog.type()}] "${dialog.message()}". Auto-accepting...`);
      await dialog.accept().catch(() => {});
    });

    // 2. Dismiss any lingering dialog from previous runs
    try {
      const client = await this.page.target().createCDPSession();
      await client.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      await client.detach().catch(() => {});
    } catch {}

    // 3. Auto-navigate or reset DOM state
    if (targetStartUrl) {
      const currentUrl = this.page.url();
      if (currentUrl === 'about:blank' || currentUrl.startsWith('chrome://') || currentUrl !== targetStartUrl) {
        logger.info(`Navigating tab to workflow starting URL: ${targetStartUrl}`);
        try {
          await this.page.goto(targetStartUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this._applyStealthEvasion();
          await new Promise(r => setTimeout(r, 500));
        } catch (navErr) {
          logger.warn(`Auto-navigation note: ${navErr.message}`);
        }
      } else {
        // Reset forms cleanly
        try {
          await this.page.evaluate(() => {
            document.querySelectorAll('form').forEach(f => f.reset());
          });
          await new Promise(r => setTimeout(r, 200));
        } catch {}
      }
    }

    logger.success(`Replay attached to tab: ${this.page.url()}`);
    logger.divider();

    const replayStats = {
      startTime: Date.now(),
      executedCount: 0,
      totalCount: recording.actions.length,
      failedAction: null
    };

    try {
      for (let i = 0; i < recording.actions.length; i++) {
        if (this.isAborted) {
          throw new Error('Execution stopped by user');
        }

        const action = recording.actions[i];

        // Apply explicit step delay or natural pacing from recording (up to 15s)
        if (this.stepDelayMs > 0) {
          logger.info(`Explicit step delay: waiting ${this.stepDelayMs}ms before step #${action.index + 1}...`);
          const end = Date.now() + this.stepDelayMs;
          while (Date.now() < end) {
            if (this.isAborted) throw new Error('Execution stopped by user');
            await new Promise(r => setTimeout(r, 100));
          }
        } else if (action.timeDeltaMs && this.speed > 0) {
          const maxPacing = (this.botConfig?.timing?.maxActionDelayMs && this.botConfig.timing.maxActionDelayMs > 1000)
            ? Math.max(this.botConfig.timing.maxActionDelayMs * 3, 15000)
            : 15000;
          const delay = Math.min(Math.round(action.timeDeltaMs / this.speed), maxPacing);
          if (delay > 0) {
            logger.info(`Pacing step #${action.index + 1}: waiting ${delay}ms for page/data to settle...`);
            const end = Date.now() + delay;
            while (Date.now() < end) {
              if (this.isAborted) throw new Error('Execution stopped by user');
              await new Promise(r => setTimeout(r, 100));
            }
          }
        }

        if (this.isAborted) {
          throw new Error('Execution stopped by user');
        }

        // 1. Condition-based wait & resolve element
        const { elementHandle, candidate, confidenceScore } = await this.waitForTargetElement(
          action.target,
          action.index,
          action.type
        );

        // Deep clone the action to safely inject secrets
        const actionToDispatch = { ...action };
        if (actionToDispatch.type === 'TYPE' && typeof actionToDispatch.value === 'string') {
          const match = actionToDispatch.value.match(/^{{secret:([^}]+)}}$/);
          if (match && this.secretResolver) {
            logger.info(`Injecting secret [${match[1]}] for action #${actionToDispatch.index + 1}...`);
            actionToDispatch.value = await this.secretResolver(match[1]);
          }
        }

        // 2. Perform action via Puppeteer with humanization config
        await dispatchAction(elementHandle, actionToDispatch, {
          page: this.page,
          botConfig: this.botConfig
        });

        // Clean up handle
        await elementHandle.dispose().catch(() => {});

        replayStats.executedCount++;

        // 3. Log progress
        const scorePercent = Math.round(confidenceScore * 100);
        const detail = `matched via [${candidate.strategy}] score=${scorePercent}%`;
        logger.action(action.index + 1, action.type, candidate.value, detail);

        // Calculate humanized post-action timing delay
        let postDelay = DEFAULT_TIMEOUTS.POST_ACTION_DELAY_MS;
        if (this.botConfig?.timing) {
          const minD = this.botConfig.timing.minActionDelayMs || 200;
          const maxD = this.botConfig.timing.maxActionDelayMs || 600;
          postDelay = calculateDelay(minD, maxD, 'gaussian');
        }

        await new Promise(r => setTimeout(r, postDelay));
      }

      const elapsed = ((Date.now() - replayStats.startTime) / 1000).toFixed(1);
      logger.divider();
      logger.success(`Replay completed successfully! ${replayStats.executedCount}/${replayStats.totalCount} actions reproduced in ${elapsed}s.`);

    } catch (err) {
      replayStats.failedAction = recording.actions[replayStats.executedCount];
      logger.divider();
      logger.error(`Replay halted at action #${replayStats.executedCount + 1}:`, err);
      throw err;
    } finally {
      if (this.browser) {
        await this.browser.disconnect();
        logger.info('Disconnected from Chrome (session preserved).');
      }
    }

    return replayStats;
  }
}

module.exports = ReplayEngine;
