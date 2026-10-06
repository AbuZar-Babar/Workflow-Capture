/**
 * Replay Engine (Node.js)
 * 
 * Orchestrates condition-based playback of recorded actions against
 * an existing Chrome session via CDP, enhanced with humanized mouse trajectories,
 * stochastic keystroke dynamics, and anti-captcha stealth evasion.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
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
const { resolveTargetUrl, extractWorkflowStartUrl, isInternalBrowserUrl } = require('../utils/url-helper');
const logger = require('../utils/logger');
const { detectLoginSequence, isSessionAuthenticated } = require('../shared/auth-detector');
const ActionDispatcher = require('./action-dispatcher');

class ReplayEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.browserURL = options.browserURL || (options.cdpPort ? `http://127.0.0.1:${options.cdpPort}` : 'http://localhost:9222');
    this.speed = options.speed || 1.0; // Speed multiplier (1.0 = real-time, 2.0 = 2x, etc.)
    this.botConfig = options.botConfig || getActiveBotConfig();
    this.timeoutMs = options.timeoutMs || this.botConfig?.resolution?.timeoutMs || DEFAULT_TIMEOUTS.RESOLUTION_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs || this.botConfig?.resolution?.pollIntervalMs || DEFAULT_TIMEOUTS.POLL_INTERVAL_MS;
    this.stepDelayMs = options.stepDelayMs || options.stepDelay || 0;
    this.secretResolver = options.secretResolver || null; // async function(secretId) => plaintext
    this.actionDispatcher = new ActionDispatcher({
      botConfig: this.botConfig,
      secretResolver: this.secretResolver,
      timeoutMs: this.timeoutMs,
      pollIntervalMs: this.pollIntervalMs
    });
    this.browser = null;
    this.page = null;
    this.isAborted = false;
    this.currentActionIndex = 0;
    this.isAutomatedActionActive = false;
    this.lastIntervention = null;
    this.isPaused = false;
    this.isLocked = false;
    this.enableDisturbanceDetection = options.enableDisturbanceDetection === true;
    this._guardPages = new Set();
    this._guardScriptIds = new Map();
  }

  /**
   * Signal abort to halt execution
   */
  async abort() {
    this.isAborted = true;
    this.isPaused = false;
    await this._syncReplayGuard();
    logger.warn('[Replay Engine] Abort signal triggered.');
  }

  async pause(reason = 'manual') {
    if (this.isAborted || this.isPaused) return;
    this.isPaused = true;
    this.emit('paused', { reason });
    await this._syncReplayGuard();
  }

  async resume() {
    if (this.isAborted || !this.isPaused) return;
    this.isPaused = false;
    this.emit('resumed');
    await this._syncReplayGuard();
  }

  async setLocked(locked) {
    this.isLocked = !!locked;
    await this._syncReplayGuard();
  }

  async _waitWhilePaused() {
    while (this.isPaused && !this.isAborted) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.isAborted) throw new Error('Execution stopped by user');
  }

  /**
   * Safely dismiss open popups, overlays, or dropdowns via Escape key without triggering disturbance detection.
   * Only presses Escape if an actual ephemeral backdrop, dropdown, or context menu is present in the DOM.
   */
  async dismissOverlays() {
    if (!this.page || this.page.isClosed()) return;
    try {
      const hasDismissibleOverlay = await this.page.evaluate(() => {
        const overlaySelectors = [
          '.cdk-overlay-backdrop',
          '.modal-backdrop',
          '.mat-select-panel',
          '[role="listbox"]',
          '.x-menu:not(.x-hidden)',
          '.dropdown-menu.show',
          '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
          '.dx-overlay-content:not([style*="display: none"])'
        ];
        return overlaySelectors.some(sel => {
          const els = Array.from(document.querySelectorAll(sel));
          return els.some(el => {
            if (el.offsetParent === null && el.tagName.toLowerCase() !== 'body') return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          });
        });
      }).catch(() => false);

      if (!hasDismissibleOverlay) return;

      await this._setAutomatedAction(true, { key: 'Escape' });
      await this.page.keyboard.press('Escape').catch(() => {});
      await new Promise(r => setTimeout(r, 200));
    } finally {
      await this._setAutomatedAction(false);
    }
  }

  /**
   * Clean up guard listeners, teardown in-page scripts, and disconnect from browser
   */
  async disconnect() {
    try {
      await this._teardownReplayGuard();
    } catch {}
    if (this.browser) {
      try {
        await this.browser.disconnect();
        logger.info('Disconnected from Chrome (session preserved).');
      } catch {}
      this.browser = null;
      this.page = null;
    }
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

    // Enable automated background file downloads to ./downloads
    try {
      const downloadDir = path.resolve(process.cwd(), 'downloads');
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
      if (this.browser) {
        try {
          const browserTarget = (typeof this.browser.targets === 'function' ? this.browser.targets().find(t => t.type() === 'browser') : null) || (typeof this.browser.target === 'function' ? this.browser.target() : null);
          if (browserTarget && typeof browserTarget.createCDPSession === 'function') {
            const browserClient = await browserTarget.createCDPSession();
            await browserClient.send('Browser.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath: downloadDir,
              eventsEnabled: true
            }).catch(() => {});
          }
        } catch {}
      }
      const client = await this.page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir
      }).catch(() => {});
    } catch {}

    if (this.enableDisturbanceDetection) {
      await this._initHumanDisturbanceDetection(this.page);
    } else {
      await this._cleanupLingeringReplayGuard(this.page);
    }

    return this.browser;
  }

  /**
   * Helper to cleanup lingering replay guard UI and attached handlers from a page.
   */
  async _cleanupLingeringReplayGuard(page) {
    if (!page || page.isClosed()) return;
    try {
      await page.evaluate(() => {
        if (typeof window.__flowmindStopReplayGuard === 'function') {
          window.__flowmindStopReplayGuard();
        }
        const host = document.getElementById('__flowmind-replay-guard');
        if (host) host.remove();
        window.__flowmindInterventionAttached = false;
        window.__flowmindReplayPaused = false;
        window.__flowmindReplayLocked = false;
      }).catch(() => {});
    } catch {}
  }

  /**
   * Inject and initialize real-time human disturbance detection on the target page.
   * Tracks manual user mouse clicks, keystrokes, and touch events when automated replay is idle.
   */
  async _initHumanDisturbanceDetection(page) {
    if (!this.enableDisturbanceDetection) {
      await this._cleanupLingeringReplayGuard(page);
      return;
    }
    if (!page || page.isClosed() || this._guardPages.has(page)) return;

    try {
      await page.exposeFunction('__flowmindReportIntervention', (eventDetail) => {
        this._handleHumanIntervention(eventDetail);
      });
    } catch (err) {
      if (!err.message || !err.message.includes('already exists')) {
        logger.warn(`[ReplayEngine] Intervention binding warning: ${err.message}`);
      }
    }

    for (const [name, handler] of [
      ['__flowmindResumeReplay', () => this.resume()],
      ['__flowmindStopReplay', () => this.abort()],
      ['__flowmindSetReplayLock', (locked) => this.setLocked(locked)]
    ]) {
      try { await page.exposeFunction(name, handler); } catch {}
    }

    const injectionScript = `
      (function() {
        window.__flowmindAutomatedActionActive = false;
        window.__flowmindAutomatedSince = 0;
        window.__flowmindReplayPaused = ${this.isPaused};
        window.__flowmindReplayLocked = ${this.isLocked};
        if (window.__flowmindInterventionAttached) { window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard(); return; }
        window.__flowmindInterventionAttached = true;
        var host = null;
        if (window === window.top) {
          host = document.createElement('div');
          host.id = '__flowmind-replay-guard';
          host.style.cssText = 'all:initial;position:fixed;top:18px;right:18px;z-index:2147483647;font:13px/1.4 Inter,system-ui,sans-serif;color:#eef2ff;';
          var shadow = host.attachShadow({mode:'open'});
          shadow.innerHTML = '<style>*{box-sizing:border-box} .card{width:270px;padding:12px 14px;background:#20283a;border:1px solid #39445b;border-radius:15px;box-shadow:0 12px 34px #10162655;display:flex;gap:10px;align-items:center}.dot{width:9px;height:9px;border-radius:50%;background:#42d392;box-shadow:0 0 12px #42d39288;flex:none}.paused .dot{background:#f5a742;box-shadow:0 0 12px #f5a74288}.copy{flex:1;min-width:0}.title{font-weight:700;font-size:12px}.sub{color:#aab5ca;font-size:11px;margin-top:2px}.actions{display:flex;gap:6px;margin-top:9px}.actions[hidden]{display:none}button{border:1px solid #46536e;border-radius:7px;background:#2b354b;color:#eef2ff;padding:5px 9px;font:600 11px system-ui;cursor:pointer}button:hover{background:#394660}.lock{margin-top:8px}.lock.on{border-color:#ed7777;color:#ffb3b3}.stop{color:#ffb3b3}</style><div class="card"><i class="dot"></i><div class="copy"><div class="title"></div><div class="sub"></div><button class="lock"></button><div class="actions" hidden><button class="resume">Resume</button><button class="stop">Stop</button></div></div></div>';
          if (document.documentElement) document.documentElement.appendChild(host);
          else document.addEventListener('DOMContentLoaded', function(){ if(document.documentElement) document.documentElement.appendChild(host); }, {once:true});
          shadow.querySelector('.resume').addEventListener('click', () => window.__flowmindResumeReplay && window.__flowmindResumeReplay());
          shadow.querySelector('.stop').addEventListener('click', () => window.__flowmindStopReplay && window.__flowmindStopReplay());
          shadow.querySelector('.lock').addEventListener('click', () => window.__flowmindSetReplayLock && window.__flowmindSetReplayLock(!window.__flowmindReplayLocked));
          window.__flowmindReplayGuardHost = host;
          window.__flowmindUpdateReplayGuard = function() {
            var card=shadow.querySelector('.card'), actions=shadow.querySelector('.actions');
            card.classList.toggle('paused', !!window.__flowmindReplayPaused);
            shadow.querySelector('.title').textContent=window.__flowmindReplayPaused?'Workflow paused':'Automation running';
            shadow.querySelector('.sub').textContent=window.__flowmindReplayPaused
              ? (window.__flowmindReplayLocked?'Input blocked. Resume when ready.':'Workflow paused. Resume when ready.')
              : (window.__flowmindReplayLocked?'Input lock is on':'Interact with the site to pause');
            var lock=shadow.querySelector('.lock');
            lock.textContent=window.__flowmindReplayLocked?'Input lock: On':'Input lock: Off';
            lock.classList.toggle('on', !!window.__flowmindReplayLocked);
            actions.hidden=!window.__flowmindReplayPaused;
          };
          window.__flowmindUpdateReplayGuard();
        }
        var onHumanInput = function(evt) {
          if (host && evt.composedPath().includes(host)) return;
          var expected = window.__flowmindAutomatedTarget;
          var expectedKey = window.__flowmindAutomatedKey;
          var now = Date.now();

          var isAutomated = false;
          if (window.__flowmindAutomatedActionActive) {
            if (expected && (expected === evt.target || (expected.contains && expected.contains(evt.target)))) {
              isAutomated = true;
            } else if (!expected && expectedKey && (evt.key === expectedKey || evt.code === expectedKey)) {
              isAutomated = true;
            }
          }

          if (!isAutomated && window.__flowmindAutomatedUntil && now < window.__flowmindAutomatedUntil) {
            var recentTarget = window.__flowmindAutomatedRecentTarget;
            var recentKey = window.__flowmindAutomatedRecentKey;
            if (recentTarget && (recentTarget === evt.target || (recentTarget.contains && recentTarget.contains(evt.target)))) {
              isAutomated = true;
            } else if (!recentTarget && recentKey && (evt.key === recentKey || evt.code === recentKey)) {
              isAutomated = true;
            }
          }

          if (isAutomated) return;

          if (window.__flowmindReplayLocked) {
            if (evt.cancelable) evt.preventDefault();
            evt.stopImmediatePropagation(); evt.stopPropagation();
          }
          if (window.__flowmindReplayPaused) return;
          window.__flowmindReplayPaused = true;
          window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard();
          var now = Date.now();
          if (typeof window.__flowmindReportIntervention === 'function') {
            window.__flowmindReportIntervention({
              type: evt.type,
              key: evt.key || null,
              tagName: evt.target && evt.target.tagName || null,
              locked: !!window.__flowmindReplayLocked,
              time: now
            });
          }
        };
        window.__flowmindReplayInputHandler=onHumanInput;
        ['pointerdown','mousedown','click','pointerup','mouseup','keydown','keypress','keyup','wheel','touchstart','touchmove','contextmenu','dragstart','dragover','drop'].forEach(function(type){window.addEventListener(type,onHumanInput,{capture:true,passive:false});});
        window.__flowmindStopReplayGuard=function(){
          ['pointerdown','mousedown','click','pointerup','mouseup','keydown','keypress','keyup','wheel','touchstart','touchmove','contextmenu','dragstart','dragover','drop'].forEach(function(type){window.removeEventListener(type,onHumanInput,true);});
          if(host)host.remove(); window.__flowmindInterventionAttached=false;
        };
      })();
    `;

    try {
      const script = await page.evaluateOnNewDocument(injectionScript);
      this._guardScriptIds.set(page, script.identifier);
      this._guardPages.add(page);
      for (const frame of page.frames()) {
        if (!frame || (typeof frame.isDetached === 'function' && frame.isDetached())) continue;
        await frame.evaluate(injectionScript).catch(() => {});
      }
    } catch {}
  }

  async _syncReplayGuard() {
    if (!this.enableDisturbanceDetection) return;
    for (const page of this._guardPages) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) {
        if (!frame || (typeof frame.isDetached === 'function' && frame.isDetached())) continue;
        await frame.evaluate((state) => {
          window.__flowmindReplayPaused=state.paused;
          window.__flowmindReplayLocked=state.locked;
          window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard();
        }, { paused: this.isPaused, locked: this.isLocked }).catch(() => {});
      }
    }
  }

  async _teardownReplayGuard() {
    for (const page of this._guardPages) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) {
        if (!frame || (typeof frame.isDetached === 'function' && frame.isDetached())) continue;
        await frame.evaluate(() => window.__flowmindStopReplayGuard && window.__flowmindStopReplayGuard()).catch(() => {});
      }
      const identifier = this._guardScriptIds.get(page);
      if (identifier) await page.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {});
    }
    this._guardPages.clear();
    this._guardScriptIds.clear();
  }

  /**
   * Set flag in browser indicating automated action in progress (prevents bot synthetic actions from triggering disturbance alerts)
   */
  async _setAutomatedAction(isActive, targetOrOptions = null) {
    this.isAutomatedActionActive = !!isActive;
    if (!this.enableDisturbanceDetection) return;
    if (this.page && !this.page.isClosed()) {
      try {
        let targetHandle = null;
        let expectedKey = null;

        if (targetOrOptions) {
          if (typeof targetOrOptions === 'string') {
            expectedKey = targetOrOptions;
          } else if (typeof targetOrOptions === 'object') {
            if (typeof targetOrOptions.asElement === 'function') {
              targetHandle = targetOrOptions.asElement();
            } else if (targetOrOptions.nodeType) {
              targetHandle = targetOrOptions;
            } else {
              if (targetOrOptions.key) expectedKey = targetOrOptions.key;
              if (targetOrOptions.target) {
                targetHandle = typeof targetOrOptions.target.asElement === 'function'
                  ? targetOrOptions.target.asElement()
                  : targetOrOptions.target;
              }
            }
          }
        }

        await this.page.evaluate((active, target, key) => {
          window.__flowmindAutomatedActionActive = active;
          if (active) {
            window.__flowmindAutomatedTarget = target || null;
            window.__flowmindAutomatedKey = key || null;
            window.__flowmindAutomatedSince = Date.now();
          } else {
            window.__flowmindAutomatedUntil = Date.now() + 150;
            window.__flowmindAutomatedRecentTarget = window.__flowmindAutomatedTarget || null;
            window.__flowmindAutomatedRecentKey = window.__flowmindAutomatedKey || null;
            window.__flowmindAutomatedTarget = null;
            window.__flowmindAutomatedKey = null;
          }
        }, !!isActive, targetHandle, expectedKey).catch(async () => {
          if (targetHandle) {
            await targetHandle.evaluate((el, active) => {
              window.__flowmindAutomatedActionActive = active;
              if (active) {
                window.__flowmindAutomatedTarget = el;
                window.__flowmindAutomatedKey = null;
                window.__flowmindAutomatedSince = Date.now();
              } else {
                window.__flowmindAutomatedUntil = Date.now() + 150;
                window.__flowmindAutomatedRecentTarget = el;
                window.__flowmindAutomatedRecentKey = null;
                window.__flowmindAutomatedTarget = null;
                window.__flowmindAutomatedKey = null;
              }
            }, !!isActive).catch(() => {});
          }
        });
      } catch {}
    }
  }

  /**
   * Handle human disturbance reported from target page
   */
  _handleHumanIntervention(eventDetail) {
    if (!this.enableDisturbanceDetection) return;
    if (this.isPaused || this.isAborted) return;
    this.isPaused = true;
    this._syncReplayGuard();
    this.emit('paused', { reason: 'human_input' });
    const stepNumber = this.currentActionIndex + 1;
    const currentAction = (this.recording && this.recording.actions)
      ? this.recording.actions[this.currentActionIndex]
      : null;

    logger.warn(`⚠️ [Human Disturbance Detected] Manual user interaction (${eventDetail.type}${eventDetail.key ? ` '${eventDetail.key}'` : ''}) intercepted on Step #${stepNumber}!`);

    const payload = {
      stepIndex: stepNumber,
      action: currentAction,
      detail: eventDetail,
      timestamp: Date.now()
    };

    this.lastIntervention = payload;
    this.emit('human_intervention', payload);
  }

  /**
   * Execute a single recorded action on the active page
   */
  async executeAction(action, index = 0) {
    this.currentActionIndex = index;
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
    const preDelay = ActionDispatcher.calculatePreActionDelay(this.botConfig);
    if (preDelay > 0) {
      await new Promise(r => setTimeout(r, preDelay));
    }

    if (action.type === 'NAVIGATE' && action.url) {
      return await ActionDispatcher.executeNavigation(this.page, action, {
        applyStealthEvasion: () => this._applyStealthEvasion()
      });
    }

    const { elementHandle, candidate, confidenceScore } = await this.waitForTargetElement(
      action.target || action.fingerprint,
      index,
      action.type
    );

    const isNextActionOption = ActionDispatcher.isNextActionOption(this.recording, index + 1);

    await this._waitWhilePaused();
    try {
      await ActionDispatcher.dispatchToElement(elementHandle, action, {
        page: this.page,
        botConfig: this.botConfig,
        isNextActionOption,
        setAutomatedAction: (active, target) => this._setAutomatedAction(active, target),
        secretResolver: this.secretResolver,
        actionIndex: index
      });
    } finally {
      await elementHandle.dispose().catch(() => {});
    }

    const scorePercent = Math.round(confidenceScore * 100);
    logger.action(index + 1, action.type, candidate.value, `score=${scorePercent}%`);

    // Calculate humanized post-action timing delay
    const postDelay = ActionDispatcher.calculatePostActionDelay(this.botConfig);
    await new Promise(r => setTimeout(r, postDelay));

    return { success: true, confidenceScore, candidate };
  }

  /**
   * Execute a recorded action against an already-discovered collection item.
   * The original recorded target is not resolved globally; resolution is scoped
   * to the current item to avoid clicking the first matching record repeatedly.
   */
  async executeActionWithinItem(itemHandle, action, index = 0) {
    if (!this.page) throw new Error('ReplayEngine is not connected to a page.');
    if (!itemHandle) throw new Error('No collection item handle supplied.');

    await this._waitWhilePaused();
    await this._waitForLoadingMasks(6000);

    const targetHandle = await ActionDispatcher.resolveTargetWithinItem(
      itemHandle,
      action.target || action.fingerprint
    );

    const elementHandle = targetHandle ? targetHandle.asElement() : null;
    if (!elementHandle) {
      if (targetHandle) await targetHandle.dispose().catch(() => {});
      throw new Error(`Could not resolve action target inside collection item #${index + 1}`);
    }

    try {
      const isNextActionOption = ActionDispatcher.isNextActionOption(this.recording, index + 1);

      await ActionDispatcher.dispatchToElement(elementHandle, action, {
        page: this.page,
        botConfig: this.botConfig,
        isNextActionOption,
        setAutomatedAction: (active, target) => this._setAutomatedAction(active, target),
        secretResolver: this.secretResolver,
        actionIndex: index,
        scrollIfNeeded: true
      });

      return { success: true, scoped: true };
    } finally {
      await elementHandle.dispose().catch(() => {});
    }
  }

  /**
   * Ensure selector resolver is loaded inside a specific frame or page context
   */
  async _ensureSelectorResolverInFrame(frame) {
    return ActionDispatcher.ensureSelectorResolverInFrame(frame, this.page);
  }

  /**
   * Condition-based in-page polling resolver loop across main page and all child frames (iframes)
   */
  async waitForTargetElement(target, actionIndex, actionType) {
    return ActionDispatcher.waitForTargetElement(this, target, actionIndex, actionType);
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
    this.recording = recording;

    // Resolve cross-platform file:/// URLs or web URLs
    let targetStartUrl = extractWorkflowStartUrl(recording);

    // Connect to Chrome via CDP
    const { browser, page } = await connectToBrowser({
      browserURL: this.browserURL
    });
    this.browser = browser;
    this.page = page;

    // Apply anti-bot stealth scripts
    await this._applyStealthEvasion();
    if (this.enableDisturbanceDetection) {
      await this._initHumanDisturbanceDetection(this.page);
    } else {
      await this._cleanupLingeringReplayGuard(this.page);
    }

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
      let needsNavigation = currentUrl === 'about:blank' || currentUrl.startsWith('chrome://');
      try {
        if (!needsNavigation) {
          const currentOrigin = new URL(currentUrl).origin;
          const targetOrigin = new URL(targetStartUrl).origin;
          if (currentOrigin !== targetOrigin) {
            needsNavigation = true;
          } else {
            // Same origin: do NOT navigate back to /login if current page is already authenticated past login
            const currentPath = currentUrl.split('#')[0].replace(/\/+$/, '');
            const targetPath = targetStartUrl.split('#')[0].replace(/\/+$/, '');
            const isTargetLogin = /\/login\b|\/signin\b|\/auth\b/i.test(targetStartUrl) || /#(.*)\/(login|signin)/i.test(targetStartUrl);
            const isCurrentLogin = /\/login\b|\/signin\b|\/auth\b/i.test(currentUrl) || /#(.*)\/(login|signin)/i.test(currentUrl);
            if (isTargetLogin && !isCurrentLogin) {
              needsNavigation = false;
              logger.info(`Session already active at "${currentUrl}". Skipping navigation to login URL: ${targetStartUrl}`);
            } else if (currentPath !== targetPath && isCurrentLogin) {
              needsNavigation = true;
            }
          }
        }
      } catch {
        needsNavigation = (currentUrl !== targetStartUrl);
      }

      if (needsNavigation) {
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
      skippedCount: 0,
      totalCount: recording.actions.length,
      failedAction: null
    };

    // Conditional Login Skip: If the portal is already authenticated, skip initial login steps
    let startIndex = 0;
    const loginSeq = detectLoginSequence(recording.actions);
    if (loginSeq.hasLoginSequence) {
      const isAuth = await isSessionAuthenticated(this.page, loginSeq);
      if (isAuth) {
        logger.info(`[ReplayEngine] Active session detected at "${this.page.url()}". Skipping ${loginSeq.loginActionCount} login step(s) (Steps 1-${loginSeq.firstPostLoginIndex}) and resuming at Step #${loginSeq.firstPostLoginIndex + 1}.`);
        startIndex = loginSeq.firstPostLoginIndex;
        replayStats.skippedCount = loginSeq.loginActionCount;
        this.emit('login_skipped', { count: loginSeq.loginActionCount, firstPostLoginIndex: startIndex });
      }
    }

    try {
      for (let i = startIndex; i < recording.actions.length; i++) {
        await this._waitWhilePaused();
        if (this.isAborted) {
          throw new Error('Execution stopped by user');
        }

        this.currentActionIndex = i;
        const action = recording.actions[i];

        // Apply explicit step delay or natural pacing from recording (up to 15s)
        if (this.stepDelayMs > 0) {
          logger.info(`Explicit step delay: waiting ${this.stepDelayMs}ms before step #${action.index + 1}...`);
          const end = Date.now() + this.stepDelayMs;
          while (Date.now() < end) {
            await this._waitWhilePaused();
            if (this.isAborted) throw new Error('Execution stopped by user');
            await new Promise(r => setTimeout(r, 100));
          }
        } else {
          const pacingDelay = ActionDispatcher.calculatePacingDelay(action, this.speed, this.botConfig);
          if (pacingDelay > 0) {
            logger.info(`Pacing step #${action.index + 1}: waiting ${pacingDelay}ms for page/data to settle...`);
            const end = Date.now() + pacingDelay;
            while (Date.now() < end) {
              await this._waitWhilePaused();
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
        await this._waitWhilePaused();

        // 2. Perform action via Puppeteer with humanization config & secret injection
        try {
          await ActionDispatcher.dispatchToElement(elementHandle, action, {
            page: this.page,
            botConfig: this.botConfig,
            setAutomatedAction: (active, target) => this._setAutomatedAction(active, target),
            secretResolver: this.secretResolver,
            actionIndex: action.index ?? i
          });
        } finally {
          await elementHandle.dispose().catch(() => {});
        }

        replayStats.executedCount++;

        // 3. Log progress
        const scorePercent = Math.round(confidenceScore * 100);
        const detail = `matched via [${candidate.strategy}] score=${scorePercent}%`;
        logger.action(action.index + 1, action.type, candidate.value, detail);

        // Calculate humanized post-action timing delay
        const postDelay = ActionDispatcher.calculatePostActionDelay(this.botConfig);
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
      await this.disconnect().catch(() => {});
    }

    return replayStats;
  }
}

module.exports = ReplayEngine;
