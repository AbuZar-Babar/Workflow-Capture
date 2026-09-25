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
const { resolveTargetUrl } = require('../utils/url-helper');
const logger = require('../utils/logger');

class ReplayEngine extends EventEmitter {
  constructor(options = {}) {
    super();
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
    this.currentActionIndex = 0;
    this.isAutomatedActionActive = false;
    this.lastIntervention = null;
    this.isPaused = false;
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

  async _waitWhilePaused() {
    while (this.isPaused && !this.isAborted) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.isAborted) throw new Error('Execution stopped by user');
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
      const client = await this.page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir
      });
    } catch {}

    await this._initHumanDisturbanceDetection(this.page);

    return this.browser;
  }

  /**
   * Inject and initialize real-time human disturbance detection on the target page.
   * Tracks manual user mouse clicks, keystrokes, and touch events when automated replay is idle.
   */
  async _initHumanDisturbanceDetection(page) {
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
      ['__flowmindStopReplay', () => this.abort()]
    ]) {
      try { await page.exposeFunction(name, handler); } catch {}
    }

    const injectionScript = `
      (function() {
        window.__flowmindAutomatedActionActive = false;
        window.__flowmindAutomatedSince = 0;
        window.__flowmindReplayPaused = ${this.isPaused};
        if (window.__flowmindInterventionAttached) { window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard(); return; }
        window.__flowmindInterventionAttached = true;
        var host = null;
        if (window === window.top) {
          host = document.createElement('div');
          host.id = '__flowmind-replay-guard';
          host.style.cssText = 'all:initial;position:fixed;top:18px;right:18px;z-index:2147483647;font:13px/1.4 Inter,system-ui,sans-serif;color:#eef2ff;';
          var shadow = host.attachShadow({mode:'open'});
          shadow.innerHTML = '<style>*{box-sizing:border-box} .card{width:270px;padding:12px 14px;background:#20283a;border:1px solid #39445b;border-radius:15px;box-shadow:0 12px 34px #10162655;display:flex;gap:10px;align-items:center}.dot{width:9px;height:9px;border-radius:50%;background:#42d392;box-shadow:0 0 12px #42d39288;flex:none}.paused .dot{background:#f5a742;box-shadow:0 0 12px #f5a74288}.copy{flex:1;min-width:0}.title{font-weight:700;font-size:12px}.sub{color:#aab5ca;font-size:11px;margin-top:2px}.actions{display:flex;gap:6px;margin-top:9px}.actions[hidden]{display:none}button{border:1px solid #46536e;border-radius:7px;background:#2b354b;color:#eef2ff;padding:5px 9px;font:600 11px system-ui;cursor:pointer}button:hover{background:#394660}.stop{color:#ffb3b3}</style><div class="card"><i class="dot"></i><div class="copy"><div class="title"></div><div class="sub"></div><div class="actions" hidden><button class="resume">Resume</button><button class="stop">Stop</button></div></div></div>';
          document.documentElement.appendChild(host);
          shadow.querySelector('.resume').addEventListener('click', () => window.__flowmindResumeReplay && window.__flowmindResumeReplay());
          shadow.querySelector('.stop').addEventListener('click', () => window.__flowmindStopReplay && window.__flowmindStopReplay());
          window.__flowmindReplayGuardHost = host;
          window.__flowmindUpdateReplayGuard = function() {
            var card=shadow.querySelector('.card'), actions=shadow.querySelector('.actions');
            card.classList.toggle('paused', !!window.__flowmindReplayPaused);
            shadow.querySelector('.title').textContent=window.__flowmindReplayPaused?'Workflow paused':'Automation running';
            shadow.querySelector('.sub').textContent=window.__flowmindReplayPaused?'Interaction blocked. Resume when ready.':'Please don’t interact with this page';
            actions.hidden=!window.__flowmindReplayPaused;
          };
          window.__flowmindUpdateReplayGuard();
        }
        var onHumanInput = function(evt) {
          if (host && evt.composedPath().includes(host)) return;
          var expected=window.__flowmindAutomatedTarget;
          if (window.__flowmindAutomatedActionActive && expected && (expected===evt.target || expected.contains(evt.target))) return;
          if (evt.cancelable) evt.preventDefault();
          evt.stopImmediatePropagation(); evt.stopPropagation();
          if (window.__flowmindReplayPaused) return;
          window.__flowmindReplayPaused=true;
          window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard();
          var now=Date.now();
          if (typeof window.__flowmindReportIntervention==='function') window.__flowmindReportIntervention({type:evt.type,key:evt.key||null,tagName:evt.target&&evt.target.tagName||null,time:now});
        };
        window.__flowmindReplayInputHandler=onHumanInput;
        ['pointerdown','mousedown','click','pointerup','mouseup','keydown','keypress','keyup','wheel','touchstart','touchmove','contextmenu','dragstart'].forEach(function(type){window.addEventListener(type,onHumanInput,{capture:true,passive:false});});
        window.__flowmindStopReplayGuard=function(){
          ['pointerdown','mousedown','click','pointerup','mouseup','keydown','keypress','keyup','wheel','touchstart','touchmove','contextmenu','dragstart'].forEach(function(type){window.removeEventListener(type,onHumanInput,true);});
          if(host)host.remove(); window.__flowmindInterventionAttached=false;
        };
      })();
    `;

    try {
      const script = await page.evaluateOnNewDocument(injectionScript);
      this._guardScriptIds.set(page, script.identifier);
      this._guardPages.add(page);
      for (const frame of page.frames()) await frame.evaluate(injectionScript).catch(() => {});
    } catch {}
  }

  async _syncReplayGuard() {
    for (const page of this._guardPages) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) await frame.evaluate((paused) => {
        window.__flowmindReplayPaused=paused;
        window.__flowmindUpdateReplayGuard && window.__flowmindUpdateReplayGuard();
      }, this.isPaused).catch(() => {});
    }
  }

  async _teardownReplayGuard() {
    for (const page of this._guardPages) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) await frame.evaluate(() => window.__flowmindStopReplayGuard && window.__flowmindStopReplayGuard()).catch(() => {});
      const identifier = this._guardScriptIds.get(page);
      if (identifier) await page.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {});
    }
    this._guardPages.clear();
    this._guardScriptIds.clear();
  }

  /**
   * Set flag in browser indicating automated action in progress (prevents bot synthetic actions from triggering disturbance alerts)
   */
  async _setAutomatedAction(isActive, elementHandle = null) {
    this.isAutomatedActionActive = !!isActive;
    if (this.page && !this.page.isClosed()) {
      try {
        const target = elementHandle || null;
        await this.page.evaluate((active, expected) => {
          window.__flowmindAutomatedActionActive = active;
          window.__flowmindAutomatedTarget = active ? expected : null;
          if (active) window.__flowmindAutomatedSince = Date.now();
        }, !!isActive, target).catch(async () => {
          if (target) await target.evaluate((el, active) => { window.__flowmindAutomatedActionActive=active; window.__flowmindAutomatedTarget=active?el:null; }, !!isActive).catch(() => {});
        });
      } catch {}
    }
  }

  /**
   * Handle human disturbance reported from target page
   */
  _handleHumanIntervention(eventDetail) {
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

    // Look ahead to check if the next action targets an option inside a dropdown
    const nextAction = (this.recording && this.recording.actions)
      ? this.recording.actions[index + 1]
      : null;

    const isNextActionOption = Boolean(
      nextAction && (
        nextAction.target?.candidates?.some(c => c.value && (c.value.includes('option') || c.value.includes('pseudo-checkbox'))) ||
        nextAction.target?.fingerprint?.tagName === 'mat-option' ||
        nextAction.target?.fingerprint?.tagName === 'mat-pseudo-checkbox' ||
        nextAction.target?.fingerprint?.role === 'option'
      )
    );

      await this._waitWhilePaused();
      await this._setAutomatedAction(true, elementHandle);
      try {
        await dispatchAction(elementHandle, actionToDispatch, {
          page: this.page,
          botConfig: this.botConfig,
          isNextActionOption
        });
      } finally {
        await this._setAutomatedAction(false);
      }
      await elementHandle.dispose().catch(() => {});

    // If this action opened a combobox/dropdown, allow overlay animation to settle
    if (action.type === 'CLICK' && isNextActionOption) {
      await new Promise(r => setTimeout(r, 300));
    }

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
   * Execute a recorded action against an already-discovered collection item.
   * The original recorded target is not resolved globally; resolution is scoped
   * to the current item to avoid clicking the first matching record repeatedly.
   */
  async executeActionWithinItem(itemHandle, action, index = 0) {
    if (!this.page) throw new Error('ReplayEngine is not connected to a page.');
    if (!itemHandle) throw new Error('No collection item handle supplied.');

    await this._waitForLoadingMasks(6000);

    const targetHandle = await itemHandle.evaluateHandle((item, target) => {
      if (!item) return null;

      const visible = (el) => {
        if (!el || !(el instanceof Element)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const fingerprint = target?.fingerprint || {};
      const candidates = Array.isArray(target?.candidates) ? target.candidates : [];

      const score = (el) => {
        if (!visible(el)) return -1;
        let value = 0;
        if (fingerprint.tagName && el.tagName.toLowerCase() === String(fingerprint.tagName).toLowerCase()) value += 0.25;
        if (fingerprint.role && el.getAttribute('role') === fingerprint.role) value += 0.2;
        if (fingerprint.ariaLabel && el.getAttribute('aria-label') === fingerprint.ariaLabel) value += 0.2;
        const targetText = normalize(fingerprint.text);
        const elementText = normalize(el.textContent);
        if (targetText && elementText === targetText) value += 0.35;
        else if (targetText && elementText.includes(targetText)) value += 0.25;
        if (fingerprint.id && el.id === fingerprint.id) value += 0.2;
        return value;
      };

      // Prefer recorded CSS selectors, but only within this item.
      for (const candidate of candidates) {
        if (!candidate?.value) continue;
        const value = candidate.value;
        const looksXPath = value.startsWith('//') || value.startsWith('(');
        if (looksXPath) continue;

        // :scope represents the discovered item itself. querySelectorAll(':scope')
        // is not a reliable way to return the context element across browser
        // implementations, so handle it explicitly.
        if (value === ':scope') return visible(item) ? item : null;

        try {
          const matches = Array.from(item.querySelectorAll(value)).filter(visible);
          if (matches.length === 1) return matches[0];
          if (matches.length > 1) {
            return matches.sort((a, b) => score(b) - score(a))[0];
          }
        } catch {}
      }

      // Fingerprint fallback scoped to the item.
      const tag = fingerprint.tagName && fingerprint.tagName !== 'unknown'
        ? fingerprint.tagName.toLowerCase()
        : '*';
      let pool = Array.from(item.querySelectorAll(tag)).filter(visible);
      if (!pool.length) pool = Array.from(item.querySelectorAll('*')).filter(visible);

      // A generalized target may intentionally point at the item itself.
      // Include the context item in fingerprint fallback when it matches.
      if (tag === '*' || item.tagName.toLowerCase() === tag) {
        if (visible(item) && score(item) >= 0) pool.unshift(item);
      }

      if (fingerprint.ariaLabel) {
        const ariaMatches = pool.filter(el => el.getAttribute('aria-label') === fingerprint.ariaLabel);
        if (ariaMatches.length) pool = ariaMatches;
      }

      const targetText = normalize(fingerprint.text);
      if (targetText) {
        const textMatches = pool.filter(el => normalize(el.textContent) === targetText);
        if (textMatches.length) pool = textMatches;
      }

      pool.sort((a, b) => score(b) - score(a));
      return pool[0] || null;
    }, action.target || action.fingerprint);

    const elementHandle = targetHandle.asElement();
    if (!elementHandle) {
      await targetHandle.dispose().catch(() => {});
      throw new Error(`Could not resolve action target inside collection item #${index + 1}`);
    }

    try {
      const actionToDispatch = { ...action };
      if (actionToDispatch.type === 'TYPE' && typeof actionToDispatch.value === 'string') {
        const match = actionToDispatch.value.match(/^{{secret:([^}]+)}}$/);
        if (match && this.secretResolver) {
          actionToDispatch.value = await this.secretResolver(match[1]);
        }
      }

      const nextAction = this.recording?.actions?.[index + 1];
      const isNextActionOption = Boolean(
        nextAction && (
          nextAction.target?.candidates?.some(c => c.value && (c.value.includes('option') || c.value.includes('pseudo-checkbox'))) ||
          nextAction.target?.fingerprint?.tagName === 'mat-option' ||
          nextAction.target?.fingerprint?.tagName === 'mat-pseudo-checkbox' ||
          nextAction.target?.fingerprint?.role === 'option'
        )
      );

      await elementHandle.scrollIntoViewIfNeeded().catch(() => {});
      await this._waitWhilePaused();
      await this._setAutomatedAction(true, elementHandle);
      try {
        await dispatchAction(elementHandle, actionToDispatch, {
          page: this.page,
          botConfig: this.botConfig,
          isNextActionOption
        });
      } finally {
        await this._setAutomatedAction(false, elementHandle);
      }

      return { success: true, scoped: true };
    } finally {
      await elementHandle.dispose().catch(() => {});
    }
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
      await this._waitWhilePaused();
      try {
        const pagesToCheck = [this.page];
        if (this.browser) {
          const allPages = await this.browser.pages().catch(() => []);
          for (const p of allPages) {
            if (p !== this.page && !p.isClosed()) {
              pagesToCheck.push(p);
            }
          }
        }

        for (const candidatePage of pagesToCheck) {
          const frames = [candidatePage.mainFrame(), ...candidatePage.frames().filter(f => f !== candidatePage.mainFrame())];

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

                    if (candidatePage !== this.page) {
                      await candidatePage.bringToFront().catch(() => {});
                      this.page = candidatePage;
                      await this._initHumanDisturbanceDetection(candidatePage);
                      logger.info(`[ReplayEngine] Switched active tab/window to: ${candidatePage.url()}`);
                    }

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
    this.recording = recording;

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
    await this._initHumanDisturbanceDetection(this.page);

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
            // Same origin: Only navigate if targetStartUrl is an explicit login or separate path
            const currentPath = currentUrl.split('#')[0].replace(/\/+$/, '');
            const targetPath = targetStartUrl.split('#')[0].replace(/\/+$/, '');
            if (targetPath.endsWith('/login') && !currentPath.endsWith('/login')) {
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
      totalCount: recording.actions.length,
      failedAction: null
    };

    try {
      for (let i = 0; i < recording.actions.length; i++) {
        await this._waitWhilePaused();
        if (this.isAborted) {
          throw new Error('Execution stopped by user');
        }

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
        } else if (action.timeDeltaMs && this.speed > 0) {
          const maxPacing = (this.botConfig?.timing?.maxActionDelayMs && this.botConfig.timing.maxActionDelayMs > 1000)
            ? Math.max(this.botConfig.timing.maxActionDelayMs * 3, 15000)
            : 15000;
          const delay = Math.min(Math.round(action.timeDeltaMs / this.speed), maxPacing);
          if (delay > 0) {
            logger.info(`Pacing step #${action.index + 1}: waiting ${delay}ms for page/data to settle...`);
            const end = Date.now() + delay;
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
        await this._setAutomatedAction(true, elementHandle);
        try {
          await dispatchAction(elementHandle, actionToDispatch, {
            page: this.page,
            botConfig: this.botConfig
          });
        } finally {
          await this._setAutomatedAction(false);
        }

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
      await this._teardownReplayGuard();
      if (this.browser) {
        await this.browser.disconnect();
        logger.info('Disconnected from Chrome (session preserved).');
      }
    }

    return replayStats;
  }
}

module.exports = ReplayEngine;
