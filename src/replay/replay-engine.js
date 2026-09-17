/**
 * Replay Engine (Node.js)
 * 
 * Orchestrates condition-based playback of recorded actions against
 * an existing Chrome session via CDP.
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
const logger = require('../utils/logger');

class ReplayEngine {
  constructor(options = {}) {
    this.browserURL = options.browserURL || 'http://localhost:9222';
    this.speed = options.speed || 1.0; // Speed multiplier (1.0 = real-time, 2.0 = 2x, etc.)
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUTS.RESOLUTION_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs || DEFAULT_TIMEOUTS.POLL_INTERVAL_MS;
    this.browser = null;
    this.page = null;
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
   * Connects to the browser via CDP and prepares active tab
   */
  async connect() {
    const { browser, page } = await connectToBrowser({
      browserURL: this.browserURL
    });
    this.browser = browser;
    this.page = page;
    return this.browser;
  }

  /**
   * Execute a single recorded action on the active page
   */
  async executeAction(action, index = 0) {
    if (!this.page) throw new Error('ReplayEngine is not connected to a page.');

    if (action.type === 'NAVIGATE' && action.url) {
      await this.page.goto(action.url, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 500));
      return { success: true, type: 'NAVIGATE' };
    }

    const { elementHandle, candidate, confidenceScore } = await this.waitForTargetElement(
      action.target || action.fingerprint,
      index,
      action.type
    );

    await dispatchAction(elementHandle, action);
    await elementHandle.dispose().catch(() => {});

    const scorePercent = Math.round(confidenceScore * 100);
    logger.action(index + 1, action.type, candidate.value, `score=${scorePercent}%`);
    await new Promise(r => setTimeout(r, DEFAULT_TIMEOUTS.POST_ACTION_DELAY_MS));

    return { success: true, confidenceScore, candidate };
  }

  /**
   * Ensure selector resolver is loaded inside the page context
   */
  async _ensureSelectorResolverInPage() {
    try {
      const isResolverLoaded = await this.page.evaluate(() => typeof window.SelectorResolver !== 'undefined').catch(() => false);

      if (!isResolverLoaded) {
        const resolverPath = path.resolve(__dirname, '../shared/selector-resolver.js');
        const resolverCode = fs.readFileSync(resolverPath, 'utf8');
        await this.page.evaluate(resolverCode).catch(() => {});
      }
    } catch {
      // Ignore transient detached frame errors while page is navigating
    }
  }

  /**
   * Condition-based in-page polling resolver loop
   * 
   * Waits until an element matching the recorded target is attached,
   * passes fingerprint validation, and is visible in the DOM.
   */
  async waitForTargetElement(target, actionIndex, actionType) {
    const startTime = Date.now();
    let lastResolutionResult = null;

    while (Date.now() - startTime < this.timeoutMs) {
      try {
        await this._ensureSelectorResolverInPage();

        // 1. Resolve and obtain direct JSHandle to the matched DOM element
        const handle = await this.page.evaluateHandle((targetData) => {
          if (!window.SelectorResolver) return null;
          const res = window.SelectorResolver.resolveElement(targetData);
          return res.success && res.element ? res.element : null;
        }, target).catch(() => null);

        const elementHandle = handle ? handle.asElement() : null;

        // 2. Also retrieve candidate and confidence metadata
        const resolutionResult = await this.page.evaluate((targetData) => {
          if (!window.SelectorResolver) {
            return { success: false, reason: 'SelectorResolver not loaded in window' };
          }
          const res = window.SelectorResolver.resolveElement(targetData);
          return {
            success: res.success,
            confidenceScore: res.confidenceScore,
            resolvedCandidate: res.resolvedCandidate,
            attempts: res.attempts
          };
        }, target).catch(() => ({ success: false, reason: 'Page evaluation error (navigating?)' }));

        lastResolutionResult = resolutionResult;

        if (elementHandle && resolutionResult && resolutionResult.success && resolutionResult.resolvedCandidate) {
          return {
            elementHandle,
            candidate: resolutionResult.resolvedCandidate,
            confidenceScore: resolutionResult.confidenceScore
          };
        } else if (handle) {
          await handle.dispose().catch(() => {});
        }
      } catch {
        // Frame navigation in progress, retry on next tick
      }

      // Condition not yet met; wait for poll interval
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }

    // Timeout exceeded: Throw structured error with complete candidate attempt trace
    throw new ElementResolutionTimeoutError(
      `Timed out after ${this.timeoutMs}ms waiting for element for Action #${actionIndex + 1} (${actionType}).`,
      {
        actionIndex,
        actionType,
        target,
        attempts: lastResolutionResult ? lastResolutionResult.attempts : [],
        timeoutMs: this.timeoutMs
      }
    );
  }

  /**
   * Replay a workflow recording
   */
  async replay(recordingPathOrObject) {
    const recording = typeof recordingPathOrObject === 'string'
      ? this.loadRecording(recordingPathOrObject)
      : recordingPathOrObject;

    logger.header(`Starting Replay: ${recording.metadata.name || 'Workflow'}`);
    logger.info(`Total actions to execute: ${recording.actions.length}`);

    // Resolve cross-platform file:/// URLs (e.g. recorded on Windows, replayed on Mac)
    let targetStartUrl = recording.metadata ? recording.metadata.startUrl : null;
    if (targetStartUrl && targetStartUrl.startsWith('file:')) {
      const baseName = path.basename(targetStartUrl);
      const localTestPath = path.resolve(process.cwd(), 'test', baseName);
      if (fs.existsSync(localTestPath)) {
        targetStartUrl = `file://${localTestPath}`;
      }
    }

    // Connect to Chrome via CDP
    const { browser, page } = await connectToBrowser({
      browserURL: this.browserURL
    });
    this.browser = browser;
    this.page = page;

    // 1. Auto-handle browser dialogs (alert, confirm, prompt) immediately
    this.page.on('dialog', async (dialog) => {
      logger.info(`Page dialog appeared: [${dialog.type()}] "${dialog.message()}". Auto-accepting...`);
      await dialog.accept().catch(() => {});
    });

    // 2. Dismiss any lingering dialog from previous runs via CDP session
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
          await this.page.goto(targetStartUrl, { waitUntil: 'load', timeout: 30000 });
          await new Promise(r => setTimeout(r, 500));
        } catch (navErr) {
          logger.warn(`Auto-navigation note: ${navErr.message}`);
        }
      } else {
        // Already on page: clean reset forms and dynamic containers without destroying execution context
        try {
          await this.page.evaluate(() => {
            document.querySelectorAll('form').forEach(f => f.reset());
            const asyncBtn = document.getElementById('trigger-delayed-btn');
            if (asyncBtn) {
              asyncBtn.textContent = 'Load Async Action';
              asyncBtn.disabled = false;
            }
            const delayed = document.getElementById('delayed-container');
            if (delayed) delayed.style.display = 'none';
            const banner = document.getElementById('status-banner');
            if (banner) banner.style.display = 'none';
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
        const action = recording.actions[i];

        // Simulate natural pacing if speed > 0, capped at 1000ms max between actions
        if (action.timeDeltaMs && this.speed > 0) {
          const delay = Math.min(Math.round(action.timeDeltaMs / this.speed), 1000);
          if (delay > 0) {
            await new Promise(r => setTimeout(r, delay));
          }
        }

        // 1. Condition-based wait & resolve element
        const { elementHandle, candidate, confidenceScore } = await this.waitForTargetElement(
          action.target,
          action.index,
          action.type
        );

        // 2. Perform action via Puppeteer
        await dispatchAction(elementHandle, action);

        // Clean up handle
        await elementHandle.dispose().catch(() => {});

        replayStats.executedCount++;

        // 3. Log progress
        const scorePercent = Math.round(confidenceScore * 100);
        const detail = `matched via [${candidate.strategy}] score=${scorePercent}%`;
        logger.action(action.index + 1, action.type, candidate.value, detail);

        // Short micro-wait for UI reactivity
        await new Promise(r => setTimeout(r, DEFAULT_TIMEOUTS.POST_ACTION_DELAY_MS));
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
