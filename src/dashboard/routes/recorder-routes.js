/**
 * Recorder & Browser Management Routes
 *
 * Encapsulates:
 * - CDP Status checking (/api/status)
 * - Chrome browser automation (/api/browser/launch, /api/browser/open)
 * - Recording files CRUD (/api/recordings, /api/recordings/:id)
 * - Live workflow recording session control (/api/record/start, /api/record/stop)
 * - Action replay playback control (/api/replay/start, /api/replay/stop)
 * - Simulation & test triggers (/api/test/human-disturbance, /api/test/run)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RecorderBridge = require('../../recorder/recorder-bridge');
const ReplayEngine = require('../../replay/replay-engine');
const { ensureChromeRunning, connectToBrowser } = require('../../utils/cdp-connector');
const logger = require('../../utils/logger');
const runController = require('../../api/run-controller');
const botConfigController = require('../../api/bot-config-controller');
const workflowController = require('../../api/workflow-controller');
const sseManager = require('../sse/sse-event-manager');
const { requireAuth } = require('../../auth/auth-middleware');

const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

class RecorderRoutes {
  constructor(broadcastFn = null) {
    this.broadcastFn = broadcastFn;
    this.activeRecorder = null;
    this.isStartingRecorder = false;
    this.isStoppingRecorder = false;
    this.activeReplay = null;
    this.isRunningTest = false;
    this.cdpStatusCache = { timestamp: 0, data: null };
    this.serverPort = parseInt(process.env.PORT, 10) || 3000;

    this.stopActiveRecording = this.stopActiveRecording.bind(this);
    this.stopActiveReplay = this.stopActiveReplay.bind(this);
    this.broadcast = this.broadcast.bind(this);
  }

  broadcast(type, payload) {
    if (typeof this.broadcastFn === 'function') {
      return this.broadcastFn(type, payload);
    }
    if (typeof global.__flowmindBroadcast === 'function') {
      return global.__flowmindBroadcast(type, payload);
    }
    return sseManager.broadcast(type, payload);
  }

  getCurrentPort(req) {
    if (req && req.headers && req.headers.host) {
      const parts = req.headers.host.split(':');
      if (parts[1]) {
        const p = parseInt(parts[1], 10);
        if (!isNaN(p)) return p;
      }
    }
    return this.serverPort;
  }

  setServerPort(port) {
    this.serverPort = Number(port);
  }

  async stopActiveRecording() {
    if (this.isStoppingRecorder) throw new Error('The recording is already being saved');
    if (!this.activeRecorder || !this.activeRecorder.isRecording) {
      throw new Error('No active recording session to stop');
    }

    this.isStoppingRecorder = true;
    const recorder = this.activeRecorder;
    try {
      const filePath = await recorder.stop();
      const summary = {
        name: recorder.name,
        filePath,
        actionCount: recorder.actions.length
      };
      if (this.activeRecorder === recorder) this.activeRecorder = null;
      if (workflowController.syncWorkflowsFromDisk) {
        workflowController.syncWorkflowsFromDisk();
      }
      this.broadcast('recording_state', { isRecording: false, summary });
      this.broadcast('workflows_updated', summary);
      return summary;
    } catch (err) {
      if (this.activeRecorder === recorder) this.activeRecorder = null;
      logger.error('Error stopping recorder:', err);
      throw err;
    } finally {
      this.isStoppingRecorder = false;
    }
  }

  async stopActiveReplay() {
    if (!this.activeReplay) return false;
    try {
      if (this.activeReplay.engine && typeof this.activeReplay.engine.abort === 'function') {
        await this.activeReplay.engine.abort();
      }
    } catch (err) {
      logger.error(`Error aborting replay: ${err.message}`);
    }
    this.broadcast('replay_state', { isReplaying: false, stopped: true });
    this.activeReplay = null;
    return true;
  }

  async checkCDPStatus(port = 9222) {
    const now = Date.now();
    if (this.cdpStatusCache.data && (now - this.cdpStatusCache.timestamp) < 3000) {
      return this.cdpStatusCache.data;
    }

    return new Promise((resolve) => {
      const handleResolve = (val) => {
        this.cdpStatusCache = { timestamp: Date.now(), data: val };
        resolve(val);
      };

      const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1200 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const versionInfo = JSON.parse(data);
            http.get(`http://127.0.0.1:${port}/json/list`, { timeout: 1500 }, (resList) => {
              let listData = '';
              resList.on('data', c => { listData += c; });
              resList.on('end', () => {
                try {
                  const tabs = JSON.parse(listData).filter(t => t.type === 'page');
                  handleResolve({
                    online: true,
                    port,
                    browser: versionInfo.Browser,
                    protocol: versionInfo['Protocol-Version'],
                    tabs: tabs.map(t => ({ title: t.title, url: t.url, id: t.id }))
                  });
                } catch {
                  handleResolve({ online: true, port, browser: versionInfo.Browser, tabs: [] });
                }
              });
            }).on('error', () => {
              handleResolve({ online: true, port, browser: versionInfo.Browser, tabs: [] });
            });
          } catch {
            handleResolve({ online: false, port, error: 'Invalid response from Chrome' });
          }
        });
      });

      req.on('error', () => {
        handleResolve({ online: false, port, error: 'Cannot connect to Chrome on port ' + port });
      });

      req.on('timeout', () => {
        req.destroy();
        handleResolve({ online: false, port, error: 'Connection to Chrome timed out' });
      });
    });
  }

  async getStatus(req, res, urlObj) {
    if (!requireAuth(req, res)) return;
    const port = parseInt((urlObj && urlObj.searchParams ? urlObj.searchParams.get('port') : null) || '9222', 10);
    const cdp = await this.checkCDPStatus(port);
    return sendJson(res, 200, {
      cdp,
      recorder: {
        isRecording: !!(this.activeRecorder && this.activeRecorder.isRecording),
        isStarting: this.isStartingRecorder,
        name: this.activeRecorder ? this.activeRecorder.name : null,
        actionCount: this.activeRecorder ? this.activeRecorder.actions.length : 0,
        startedAt: this.activeRecorder ? this.activeRecorder.startedAt : null
      },
      replay: {
        isReplaying: !!this.activeReplay,
        currentAction: this.activeReplay ? this.activeReplay.currentAction : null,
        totalActions: this.activeReplay ? this.activeReplay.totalActions : null
      },
      runs: {
        hasActive: runController.hasActiveRuns ? runController.hasActiveRuns() : false,
        activeCount: runController.getActiveRunCount ? runController.getActiveRunCount() : 0
      },
      isRunningTest: this.isRunningTest
    });
  }

  async launchBrowser(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    const currentPort = this.getCurrentPort(req);
    const portal = body.portal || 'ecommerce';

    const portalUrls = {
      ecommerce: `http://localhost:${currentPort}/portal/ecommerce-portal.html`,
      sales: `http://localhost:${currentPort}/portal/sales-portal.html`,
      library: `http://localhost:${currentPort}/portal/library-portal.html`,
      'mock-portal': `http://localhost:${currentPort}/portal/ecommerce-portal.html`
    };
    const initialUrl = portalUrls[portal] || portalUrls.ecommerce;

    try {
      const launched = await ensureChromeRunning(9222, initialUrl);
      if (launched) {
        try {
          const { browser, page } = await connectToBrowser();
          await page.bringToFront();
          if (page.url() === 'about:blank' || page.url().startsWith('chrome://')) {
            await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          }
          await browser.disconnect();
        } catch {}
        return sendJson(res, 200, { success: true, message: 'Chrome launched with CDP on port 9222', url: initialUrl });
      } else {
        return sendJson(res, 500, { error: 'Could not auto-launch Chrome. Please launch Chrome manually.' });
      }
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  async openBrowser(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    const currentPort = this.getCurrentPort(req);
    let targetUrl = body.url;

    const portalUrls = {
      ecommerce: `http://localhost:${currentPort}/portal/ecommerce-portal.html`,
      sales: `http://localhost:${currentPort}/portal/sales-portal.html`,
      library: `http://localhost:${currentPort}/portal/library-portal.html`,
      'mock-portal': `http://localhost:${currentPort}/portal/ecommerce-portal.html`
    };

    if (portalUrls[targetUrl]) {
      targetUrl = portalUrls[targetUrl];
    } else if (!targetUrl) {
      targetUrl = portalUrls.ecommerce;
    } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
      const resolvedPath = path.resolve(process.cwd(), targetUrl);
      if (fs.existsSync(resolvedPath)) {
        targetUrl = `file:///${resolvedPath.replace(/\\/g, '/')}`;
      }
    }

    try {
      const { browser, page } = await connectToBrowser();
      logger.info(`Opening URL in Chrome: ${targetUrl}`);
      await page.bringToFront();
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await browser.disconnect();
      return sendJson(res, 200, { success: true, url: targetUrl });
    } catch (err) {
      logger.error(`Failed to navigate Chrome to ${targetUrl}:`, err.message);
      return sendJson(res, 500, { error: err.message });
    }
  }

  async listRecordings(req, res) {
    if (!requireAuth(req, res)) return;
    const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.json'));
    const list = [];

    for (const file of files) {
      const filePath = path.join(RECORDINGS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        list.push({
          filename: file,
          path: filePath,
          name: content.metadata ? content.metadata.name : file.replace('.json', ''),
          version: content.metadata ? content.metadata.version : '1.0.0',
          startedAt: content.metadata ? content.metadata.startedAt : stats.birthtime,
          completedAt: content.metadata ? content.metadata.completedAt : stats.mtime,
          startUrl: content.metadata ? content.metadata.startUrl : 'unknown',
          actionCount: Array.isArray(content.actions) ? content.actions.length : 0,
          fileSizeBytes: stats.size,
          actions: content.actions || []
        });
      } catch {}
    }

    list.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
    return sendJson(res, 200, { recordings: list });
  }

  async getRecording(req, res, filename) {
    if (!requireAuth(req, res)) return;
    const cleanFilename = path.basename(filename);
    const filePath = path.join(RECORDINGS_DIR, cleanFilename);

    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: 'Recording not found' });
    }

    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return sendJson(res, 200, content);
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to read recording JSON' });
    }
  }

  async deleteRecording(req, res, filename) {
    if (!requireAuth(req, res)) return;
    const cleanFilename = path.basename(filename);
    const filePath = path.join(RECORDINGS_DIR, cleanFilename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted recording: ${cleanFilename}`);
      this.broadcast('recording_deleted', { filename: cleanFilename });
      return sendJson(res, 200, { success: true, filename: cleanFilename });
    }
    return sendJson(res, 404, { error: 'Recording not found' });
  }

  async startRecording(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    if (this.isStartingRecorder || (this.activeRecorder && this.activeRecorder.isRecording)) {
      return sendJson(res, 400, { error: 'A recording session is already starting or active' });
    }

    this.isStartingRecorder = true;
    const name = body.name || `workflow-${Date.now()}`;
    const rawBrowserURL = body.browserURL || 'http://127.0.0.1:9222';
    const browserURL = rawBrowserURL.replace('//localhost:', '//127.0.0.1:');

    try {
      this.activeRecorder = new RecorderBridge({
        name,
        browserURL,
        outputDir: RECORDINGS_DIR,
        onSave: this.stopActiveRecording
      });

      const origHandle = this.activeRecorder._handleCapturedAction.bind(this.activeRecorder);
      this.activeRecorder._handleCapturedAction = (rawAction) => {
        const added = origHandle(rawAction);
        if (added && this.activeRecorder && this.activeRecorder.actions.length > 0) {
          const lastAction = this.activeRecorder.actions[this.activeRecorder.actions.length - 1];
          this.broadcast('action_captured', {
            action: lastAction,
            count: this.activeRecorder.actions.length
          });
        }
      };

      await this.activeRecorder.start();
      this.broadcast('recording_state', { isRecording: true, name, startedAt: this.activeRecorder.startedAt });
      return sendJson(res, 200, { success: true, name, startedAt: this.activeRecorder.startedAt });
    } catch (err) {
      if (this.activeRecorder) {
        this.activeRecorder.stop().catch(() => {});
        this.activeRecorder = null;
      }
      logger.error('Failed to start recorder:', err);
      return sendJson(res, 500, { error: err.message });
    } finally {
      this.isStartingRecorder = false;
    }
  }

  async stopRecording(req, res) {
    if (!requireAuth(req, res)) return;
    if (!this.activeRecorder || !this.activeRecorder.isRecording || this.isStoppingRecorder) {
      this.broadcast('recording_state', { isRecording: false, summary: { name: '', actionCount: 0 } });
      return sendJson(res, 200, {
        success: true,
        isRecording: false,
        summary: { name: '', actionCount: 0 },
        message: 'No active recording session to stop'
      });
    }

    try {
      const summary = await this.stopActiveRecording();
      return sendJson(res, 200, { success: true, summary });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  async startReplay(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    if (this.activeReplay) {
      return sendJson(res, 400, { error: 'A replay execution is already in progress' });
    }

    const filename = body.filename;
    const speed = parseFloat(body.speed) || 1.0;
    const activeBotCfg = botConfigController.getActiveBotConfig ? botConfigController.getActiveBotConfig() : null;
    const timeoutMs = parseInt(body.timeoutMs, 10) || activeBotCfg?.resolution?.timeoutMs || 5000;
    const pollIntervalMs = parseInt(body.pollIntervalMs, 10) || activeBotCfg?.resolution?.pollIntervalMs || 100;
    const browserURL = body.browserURL || 'http://localhost:9222';

    if (!filename) {
      return sendJson(res, 400, { error: 'Missing filename parameter' });
    }

    const filePath = path.join(RECORDINGS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: `File not found: ${filename}` });
    }

    const recording = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const replayEngine = new ReplayEngine({ browserURL, speed, timeoutMs, pollIntervalMs, botConfig: activeBotCfg });
    this.activeReplay = { engine: replayEngine, filename, currentAction: 0, totalActions: recording.actions.length };

    replayEngine.on('human_intervention', (intervention) => {
      this.broadcast('human_intervention', {
        workflowId: filename,
        stepIndex: intervention.stepIndex,
        action: intervention.action,
        detail: intervention.detail,
        timestamp: intervention.timestamp,
        message: `Input was blocked and replay paused on Step #${intervention.stepIndex}.`
      });
    });
    replayEngine.on('paused', () => {
      this.broadcast('replay_state', { isReplaying: true, isPaused: true, filename });
    });
    replayEngine.on('resumed', () => {
      this.broadcast('replay_state', { isReplaying: true, isPaused: false, filename });
    });

    this.broadcast('replay_state', { isReplaying: true, filename, total: recording.actions.length });

    (async () => {
      try {
        const origWait = replayEngine.waitForTargetElement.bind(replayEngine);
        replayEngine.waitForTargetElement = async (target, index, type) => {
          if (this.activeReplay) {
            this.activeReplay.currentAction = index + 1;
            this.broadcast('replay_progress', {
              index: index + 1,
              total: recording.actions.length,
              action: recording.actions[index]
            });
          }
          return origWait(target, index, type);
        };

        const stats = await replayEngine.replay(recording);
        this.broadcast('replay_state', { isReplaying: false, success: true, stats });
      } catch (err) {
        this.broadcast('replay_state', { isReplaying: false, success: false, error: err.message });
      } finally {
        this.activeReplay = null;
      }
    })();

    return sendJson(res, 200, { success: true, filename, totalActions: recording.actions.length });
  }

  async stopReplay(req, res) {
    if (!requireAuth(req, res)) return;
    let stoppedReplay = false;
    let stoppedRecorder = false;
    if (this.activeRecorder && this.activeRecorder.isRecording) {
      try {
        await this.stopActiveRecording();
        stoppedRecorder = true;
      } catch (err) {
        logger.error('Error stopping recorder in /api/replay/stop:', err);
      }
    }
    if (this.activeReplay) {
      stoppedReplay = true;
      try {
        if (this.activeReplay.engine && typeof this.activeReplay.engine.abort === 'function') {
          await this.activeReplay.engine.abort();
        }
      } catch (err) {
        logger.error(`Error aborting replay: ${err.message}`);
      }
      this.broadcast('replay_state', { isReplaying: false, stopped: true });
      this.activeReplay = null;
    }

    if (runController.hasActiveRuns && runController.hasActiveRuns()) {
      return runController.stopAllRuns(req, res);
    }

    return sendJson(res, 200, {
      success: true,
      message: stoppedRecorder
        ? 'Recording stopped and saved successfully'
        : (stoppedReplay ? 'Replay playback stopped successfully' : 'Execution stopped')
    });
  }

  async triggerDisturbance(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    const stepIndex = parseInt(body.stepIndex, 10) || (this.activeReplay ? this.activeReplay.currentAction || 2 : 2);
    const payload = {
      workflowId: this.activeReplay?.filename || body.workflowId || 'demo-workflow.json',
      stepIndex,
      action: { type: body.actionType || 'CLICK', target: { selector: '#submit-btn' } },
      detail: { type: body.eventType || 'mousedown', key: body.key || null, text: body.text || 'User physical mouse click' },
      timestamp: Date.now(),
      message: `Human disturbance detected on Step #${stepIndex}!`
    };
    logger.warn(`[Simulation] Human disturbance alert triggered on Step #${stepIndex}`);
    this.broadcast('human_intervention', payload);
    return sendJson(res, 200, { success: true, payload });
  }

  async runTests(req, res, body = {}) {
    if (!requireAuth(req, res)) return;
    if (this.isRunningTest) {
      return sendJson(res, 400, { error: 'A test is already running' });
    }

    const testType = body.type || 'unit';
    const testScript = testType === 'e2e' ? 'test/e2e-smoke.js' : 'test/selector-resolver.test.js';
    const scriptPath = path.resolve(process.cwd(), testScript);

    this.isRunningTest = true;
    this.broadcast('test_state', { isRunning: true, type: testType });
    logger.header(`Running ${testType.toUpperCase()} Tests from Dashboard`);

    const child = spawn('node', [scriptPath], { cwd: process.cwd() });

    let output = '';
    child.stdout.on('data', (d) => {
      const text = d.toString();
      output += text;
      this.broadcast('log', { level: 'INFO', text: text.trim(), time: new Date().toLocaleTimeString() });
    });

    child.stderr.on('data', (d) => {
      const text = d.toString();
      output += text;
      this.broadcast('log', { level: 'ERROR', text: text.trim(), time: new Date().toLocaleTimeString() });
    });

    child.on('close', (code) => {
      this.isRunningTest = false;
      const success = code === 0;
      if (success) {
        logger.success(`${testType.toUpperCase()} tests completed successfully!`);
      } else {
        logger.error(`${testType.toUpperCase()} tests failed with exit code ${code}`);
      }
      this.broadcast('test_state', { isRunning: false, type: testType, success, exitCode: code });
    });

    return sendJson(res, 200, { success: true, message: `Started ${testType} test` });
  }

  /**
   * Dispatch recorder/browser/replay/test routes.
   *
   * @returns {Promise<boolean>} True if route matched and handled
   */
  async handleRoute(req, res, pathname, urlObj, body) {
    if (pathname === '/api/status' && req.method === 'GET') {
      await this.getStatus(req, res, urlObj);
      return true;
    }
    if (pathname === '/api/browser/launch' && req.method === 'POST') {
      await this.launchBrowser(req, res, body);
      return true;
    }
    if (pathname === '/api/browser/open' && req.method === 'POST') {
      await this.openBrowser(req, res, body);
      return true;
    }
    if (pathname === '/api/recordings' && req.method === 'GET') {
      await this.listRecordings(req, res);
      return true;
    }
    if (pathname.startsWith('/api/recordings/') && req.method === 'GET') {
      const filename = pathname.replace('/api/recordings/', '');
      await this.getRecording(req, res, filename);
      return true;
    }
    if (pathname.startsWith('/api/recordings/') && req.method === 'DELETE') {
      const filename = pathname.replace('/api/recordings/', '');
      await this.deleteRecording(req, res, filename);
      return true;
    }
    if ((pathname === '/api/record/start' || pathname === '/api/recorder/start') && req.method === 'POST') {
      await this.startRecording(req, res, body);
      return true;
    }
    if ((pathname === '/api/record/stop' || pathname === '/api/recorder/stop') && req.method === 'POST') {
      await this.stopRecording(req, res);
      return true;
    }
    if ((pathname === '/api/replay/start' || pathname === '/api/recorder/replay/start') && req.method === 'POST') {
      await this.startReplay(req, res, body);
      return true;
    }
    if ((pathname === '/api/replay/stop' || pathname === '/api/recorder/replay/stop') && req.method === 'POST') {
      await this.stopReplay(req, res);
      return true;
    }
    if (pathname === '/api/test/human-disturbance' && req.method === 'POST') {
      await this.triggerDisturbance(req, res, body);
      return true;
    }
    if (pathname === '/api/test/run' && req.method === 'POST') {
      await this.runTests(req, res, body);
      return true;
    }
    return false;
  }
}

const recorderRoutes = new RecorderRoutes();

module.exports = recorderRoutes;
module.exports.RecorderRoutes = RecorderRoutes;
module.exports.recorderRoutes = recorderRoutes;
module.exports.sendJson = sendJson;
