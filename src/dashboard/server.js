/**
 * Workflow Capture — Interactive Web Dashboard Server
 * 
 * Zero-dependency native Node.js HTTP & SSE Server providing a visual control room
 * for recording workflows, replaying actions, inspecting selector candidates,
 * monitoring Chrome CDP connections, and viewing live execution logs.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RecorderBridge = require('../recorder/recorder-bridge');
const ReplayEngine = require('../replay/replay-engine');
const LoopDetector = require('../shared/loop-detector');
const ItemDiscovery = require('../shared/item-discovery');
const { connectToBrowser } = require('../utils/cdp-connector');
const logger = require('../utils/logger');
const authController = require('../auth/auth-controller');
const workflowController = require('../api/workflow-controller');
const runController = require('../api/run-controller');
const secretController = require('../api/secret-controller');
const botConfigController = require('../api/bot-config-controller');
const { requireAuth: originalRequireAuth, extractToken } = require('../auth/auth-middleware');
const { db } = require('../database/db');

// In local dashboard mode, automatically provide developer session so dashboard opens directly without login
function requireAuth(req, res) {
  const token = extractToken(req);
  if (!token) {
    let user = db.findOne('users', () => true);
    if (!user) {
      user = db.insert('users', {
        username: 'Developer',
        email: 'developer@workflowcapture.local',
        passwordHash: 'dev_bypass'
      });
    }
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt
    };
    return true;
  }
  return originalRequireAuth(req, res);
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');

// Ensure recordings folder exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// SSE Clients
const sseClients = new Set();

function broadcast(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Intercept logger to broadcast to dashboard UI
const originalInfo = logger.info;
const originalSuccess = logger.success;
const originalWarn = logger.warn;
const originalError = logger.error;
const originalAction = logger.action;

logger.info = function (...args) {
  originalInfo.apply(logger, args);
  broadcast('log', { level: 'INFO', text: args.join(' '), time: new Date().toLocaleTimeString() });
};

logger.success = function (...args) {
  originalSuccess.apply(logger, args);
  broadcast('log', { level: 'SUCCESS', text: args.join(' '), time: new Date().toLocaleTimeString() });
};

logger.warn = function (...args) {
  originalWarn.apply(logger, args);
  broadcast('log', { level: 'WARN', text: args.join(' '), time: new Date().toLocaleTimeString() });
};

logger.error = function (...args) {
  originalError.apply(logger, args);
  broadcast('log', { level: 'ERROR', text: args.map(a => a && a.message ? a.message : String(a)).join(' '), time: new Date().toLocaleTimeString() });
};

logger.action = function (index, type, target, detail = '') {
  originalAction.call(logger, index, type, target, detail);
  broadcast('log', {
    level: 'ACTION',
    text: `#${index} [${type}] ${target} ${detail}`,
    time: new Date().toLocaleTimeString()
  });
};

// Global State
let activeRecorder = null;
let activeReplay = null;
let isRunningTest = false;

/**
 * Check CDP Status & fetch open tabs
 */
async function checkCDPStatus(port = 9222) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const versionInfo = JSON.parse(data);
          // Also fetch list of open pages
          http.get(`http://127.0.0.1:${port}/json/list`, { timeout: 1500 }, (resList) => {
            let listData = '';
            resList.on('data', c => { listData += c; });
            resList.on('end', () => {
              try {
                const tabs = JSON.parse(listData).filter(t => t.type === 'page');
                resolve({
                  online: true,
                  port,
                  browser: versionInfo.Browser,
                  protocol: versionInfo['Protocol-Version'],
                  tabs: tabs.map(t => ({ title: t.title, url: t.url, id: t.id }))
                });
              } catch {
                resolve({ online: true, port, browser: versionInfo.Browser, tabs: [] });
              }
            });
          }).on('error', () => {
            resolve({ online: true, port, browser: versionInfo.Browser, tabs: [] });
          });
        } catch {
          resolve({ online: false, port, error: 'Invalid response from Chrome' });
        }
      });
    });

    req.on('error', () => {
      resolve({ online: false, port, error: 'Cannot connect to Chrome on port ' + port });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ online: false, port, error: 'Connection to Chrome timed out' });
    });
  });
}

/**
 * MIME type resolver
 */
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
  '.zip': 'application/zip'
};

/**
 * Parse JSON Request Body Helper
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Send JSON Response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

/**
 * HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // -------------------------------------------------------------
    // SSE Stream
    // -------------------------------------------------------------
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // -------------------------------------------------------------
    // Authentication REST APIs
    // -------------------------------------------------------------
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      return authController.register(req, res, body);
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      return authController.login(req, res, body);
    }

    if (pathname === '/api/auth/dummy-login' && req.method === 'POST') {
      return authController.dummyLogin(req, res);
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      return authController.logout(req, res);
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return authController.getProfile(req, res);
    }

    // -------------------------------------------------------------
    // Workflow Management REST APIs
    // -------------------------------------------------------------
    if (pathname === '/api/workflows' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return workflowController.listWorkflows(req, res);
    }

    if (pathname === '/api/workflows' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req).catch(() => ({}));
      return workflowController.createWorkflow(req, res, body);
    }

    // Workflow /:id routes
    const wfMatch = pathname.match(/^\/api\/workflows\/([^/]+)$/);
    if (wfMatch) {
      const workflowId = wfMatch[1];
      if (!requireAuth(req, res)) return;

      if (req.method === 'GET') {
        return workflowController.getWorkflowById(req, res, workflowId);
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req).catch(() => ({}));
        return workflowController.updateWorkflow(req, res, workflowId, body);
      }
      if (req.method === 'DELETE') {
        return workflowController.deleteWorkflow(req, res, workflowId);
      }
    }

    // -------------------------------------------------------------
    // Secrets Vault REST APIs
    // -------------------------------------------------------------
    if (pathname === '/api/secrets') {
      if (!requireAuth(req, res)) return;
      if (req.method === 'GET') {
        return secretController.listSecrets(req, res);
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req).catch(() => ({}));
        return secretController.createSecret(req, res, body);
      }
    }

    const secretMatch = pathname.match(/^\/api\/secrets\/([^/]+)$/);
    if (secretMatch && req.method === 'DELETE') {
      const secretId = secretMatch[1];
      if (!requireAuth(req, res)) return;
      return secretController.deleteSecret(req, res, secretId);
    }

    // -------------------------------------------------------------
    // Item Discovery REST API
    // -------------------------------------------------------------
    const discoverMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/discover$/);
    if (discoverMatch && req.method === 'POST') {
      const workflowId = discoverMatch[1];
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req).catch(() => ({}));
      if (body.loopStepIndex !== undefined && body.loopStepIndex !== null && !Number.isInteger(body.loopStepIndex)) {
        return sendJson(res, 400, { error: 'loopStepIndex must be an integer' });
      }

      try {
        workflowController.syncWorkflowsFromDisk(req.user.id);
        let workflow = require('../database/db').db.findOne('workflows', wf =>
          wf.id === workflowId && (wf.userId === req.user.id || !wf.userId || wf.userId === 'system' || wf.isGlobal)
        );
        if (!workflow) workflow = require('../database/db').db.findOne('workflows', wf => wf.id === workflowId);
        if (!workflow) return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });

        const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
        if (!steps.length) return sendJson(res, 400, { error: 'Workflow contains no recorded actions' });

        let loopStepIndex = Number.isInteger(body.loopStepIndex) ? body.loopStepIndex : null;
        if (loopStepIndex === null) {
          if (Number.isInteger(workflow.loopStepIndex) && workflow.loopStepIndex >= 0) {
            loopStepIndex = workflow.loopStepIndex;
          } else {
            const candidateIdx = LoopDetector.findLoopCandidateIndex(steps);
            loopStepIndex = candidateIdx >= 0 ? candidateIdx : 0;
          }
        }
        const partition = LoopDetector.partitionWorkflow(steps, loopStepIndex);
        const targetStep = partition.loopSteps[0];
        if (!targetStep) return sendJson(res, 400, { error: 'No loop target action could be identified' });

        const { browser, page } = await connectToBrowser();
        try {
          await page.bringToFront().catch(() => {});
          const currentUrl = page.url();
          const targetUrl = workflow.targetUrl || (workflow.recordingData?.metadata?.startUrl) || targetStep.url;
          let shouldNavigate = false;
          if (targetUrl) {
            try {
              const currentOrigin = new URL(currentUrl).origin;
              const targetOrigin = new URL(targetUrl).origin;
              if (currentUrl === 'about:blank' || currentOrigin !== targetOrigin) {
                shouldNavigate = true;
              }
            } catch {
              if (currentUrl === 'about:blank') shouldNavigate = true;
            }
          }

          if (shouldNavigate && targetUrl) {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 600));
          }

          const engine = new ReplayEngine({ cdpPort: 9222 });
          engine.page = page;
          await engine._ensureSelectorResolverInFrame(page.mainFrame());
          let discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
            minItems: 2,
            minScore: 0.55
          });

          if (!discovery.success && discovery.reason?.includes('could not be resolved') && partition.setupSteps.length > 0) {
            logger.info(`[Discovery] Target not immediately visible in DOM. Running ${partition.setupSteps.length} setup steps to reveal it...`);
            try {
              for (let i = 0; i < partition.setupSteps.length; i++) {
                await engine.executeAction(partition.setupSteps[i], i);
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
                minItems: 2,
                minScore: 0.55
              });
            } catch (setupErr) {
              logger.warn(`[Discovery] Setup execution encountered warning: ${setupErr.message}`);
            }
          }

          return sendJson(res, discovery.success ? 200 : 422, {
            success: discovery.success,
            workflowId,
            workflowName: workflow.name,
            loopStepIndex,
            actionsPerItem: partition.loopSteps.length,
            setupActionCount: partition.setupSteps.length,
            targetAction: targetStep.type || targetStep.action || 'ACTION',
            targetUrl: page.url(),
            discovery
          });
        } finally {
          await browser.disconnect().catch(() => {});
        }
      } catch (err) {
        logger.error('[Discovery] Failed:', err.message);
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // Run Execution REST APIs
    // -------------------------------------------------------------
    const execMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/execute$/);
    if (execMatch && req.method === 'POST') {
      const workflowId = execMatch[1];
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req).catch(() => ({}));
      return runController.executeWorkflow(req, res, workflowId, body);
    }

    if (pathname === '/api/runs' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return runController.listRuns(req, res);
    }

    if (pathname === '/api/runs/active' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return runController.getActiveRuns(req, res);
    }

    if (pathname === '/api/runs/stop' && req.method === 'POST') {
      if (activeRecorder && activeRecorder.isRecording) {
        try {
          const savedFilePath = await activeRecorder.stop();
          const summary = {
            name: activeRecorder.name,
            filePath: savedFilePath,
            actionCount: activeRecorder.actions.length
          };
          activeRecorder = null;
          if (workflowController.syncWorkflowsFromDisk) {
            workflowController.syncWorkflowsFromDisk();
          }
          broadcast('recording_state', { isRecording: false, summary });
          broadcast('workflows_updated', summary);
        } catch (err) {
          logger.error('Error stopping recorder in /api/runs/stop:', err);
          activeRecorder = null;
        }
      }
      if (activeReplay) {
        try {
          if (activeReplay.engine && typeof activeReplay.engine.abort === 'function') {
            await activeReplay.engine.abort();
          }
        } catch {}
        broadcast('replay_state', { isReplaying: false, stopped: true });
        activeReplay = null;
      }
      return runController.stopAllRuns(req, res);
    }

    const runStopMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (runStopMatch && req.method === 'POST') {
      const runId = runStopMatch[1];
      return runController.stopRun(req, res, runId);
    }

    const runStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runStatusMatch && req.method === 'GET') {
      const runId = runStatusMatch[1];
      if (!requireAuth(req, res)) return;
      return runController.getRunStatus(req, res, runId);
    }

    // -------------------------------------------------------------
    // Downloaded Files & Deduplication REST APIs
    // -------------------------------------------------------------
    if (pathname === '/api/downloads' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return runController.listDownloads(req, res);
    }

    if (pathname === '/api/downloads/export' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return runController.exportAllDownloadsZip(req, res);
    }

    const dlDeleteMatch = pathname.match(/^\/api\/downloads\/([^/]+)$/);
    if (dlDeleteMatch && req.method === 'DELETE') {
      const downloadId = dlDeleteMatch[1];
      if (!requireAuth(req, res)) return;
      return runController.deleteDownload(req, res, downloadId);
    }

    const wfDownloadsMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/downloads$/);
    if (wfDownloadsMatch && req.method === 'GET') {
      const workflowId = wfDownloadsMatch[1];
      if (!requireAuth(req, res)) return;
      return runController.getWorkflowDownloads(req, res, workflowId);
    }

    // -------------------------------------------------------------
    // Bot Profile & Stealth Evasion REST APIs
    // -------------------------------------------------------------
    if (pathname === '/api/bot-config') {
      if (req.method === 'GET') {
        return botConfigController.getBotConfig(req, res);
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req).catch(() => ({}));
        return botConfigController.updateBotConfig(req, res, body);
      }
    }

    if (pathname === '/api/bot-config/presets' && req.method === 'GET') {
      return botConfigController.getPresets(req, res);
    }

    if (pathname === '/api/bot-config/reset' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      return botConfigController.resetBotConfig(req, res, body);
    }

    // -------------------------------------------------------------
    // API: System & CDP Status
    // -------------------------------------------------------------
    if (pathname === '/api/status' && req.method === 'GET') {
      const port = parseInt(urlObj.searchParams.get('port') || '9222', 10);
      const cdp = await checkCDPStatus(port);
      return sendJson(res, 200, {
        cdp,
        recorder: {
          isRecording: !!(activeRecorder && activeRecorder.isRecording),
          name: activeRecorder ? activeRecorder.name : null,
          actionCount: activeRecorder ? activeRecorder.actions.length : 0,
          startedAt: activeRecorder ? activeRecorder.startedAt : null
        },
        replay: {
          isReplaying: !!activeReplay,
          currentAction: activeReplay ? activeReplay.currentAction : null,
          totalActions: activeReplay ? activeReplay.totalActions : null
        },
        runs: {
          hasActive: runController.hasActiveRuns ? runController.hasActiveRuns() : false,
          activeCount: runController.getActiveRunCount ? runController.getActiveRunCount() : 0
        },
        isRunningTest
      });
    }

    // -------------------------------------------------------------
    // API: Launch Chrome with CDP
    // -------------------------------------------------------------
    if (pathname === '/api/browser/launch' && req.method === 'POST') {
      const { ensureChromeRunning, connectToBrowser } = require('../utils/cdp-connector');
      const body = await parseJsonBody(req).catch(() => ({}));
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
          // If Chrome was already up, ensure active tab navigates to the portal
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

    // -------------------------------------------------------------
    // API: Open URL in Chrome Browser
    // -------------------------------------------------------------
    if (pathname === '/api/browser/open' && req.method === 'POST') {
      const body = await parseJsonBody(req);
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

    // -------------------------------------------------------------
    // API: List Recordings
    // -------------------------------------------------------------
    if (pathname === '/api/recordings' && req.method === 'GET') {
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
        } catch {
          // ignore corrupted json files
        }
      }

      list.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
      return sendJson(res, 200, { recordings: list });
    }

    // -------------------------------------------------------------
    // API: Get Single Recording Details
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/recordings/') && req.method === 'GET') {
      const filename = path.basename(pathname.replace('/api/recordings/', ''));
      const filePath = path.join(RECORDINGS_DIR, filename);

      if (!fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'Recording not found' });
      }

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return sendJson(res, 200, content);
    }

    // -------------------------------------------------------------
    // API: Delete Recording
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/recordings/') && req.method === 'DELETE') {
      const filename = path.basename(pathname.replace('/api/recordings/', ''));
      const filePath = path.join(RECORDINGS_DIR, filename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted recording: ${filename}`);
        broadcast('recording_deleted', { filename });
        return sendJson(res, 200, { success: true, filename });
      }
      return sendJson(res, 404, { error: 'Recording not found' });
    }

    // -------------------------------------------------------------
    // API: Start Recording
    // -------------------------------------------------------------
    if (pathname === '/api/record/start' && req.method === 'POST') {
      if (activeRecorder && activeRecorder.isRecording) {
        return sendJson(res, 400, { error: 'A recording session is already active' });
      }

      const body = await parseJsonBody(req);
      const name = body.name || `workflow-${Date.now()}`;
      const browserURL = body.browserURL || 'http://localhost:9222';

      activeRecorder = new RecorderBridge({ name, browserURL, outputDir: RECORDINGS_DIR });

      // Wrap raw action handler to broadcast to UI
      const origHandle = activeRecorder._handleCapturedAction.bind(activeRecorder);
      activeRecorder._handleCapturedAction = (rawAction) => {
        const added = origHandle(rawAction);
        if (added && activeRecorder && activeRecorder.actions.length > 0) {
          const lastAction = activeRecorder.actions[activeRecorder.actions.length - 1];
          broadcast('action_captured', {
            action: lastAction,
            count: activeRecorder.actions.length
          });
        }
      };

      try {
        await activeRecorder.start();
        broadcast('recording_state', { isRecording: true, name, startedAt: activeRecorder.startedAt });
        return sendJson(res, 200, { success: true, name, startedAt: activeRecorder.startedAt });
      } catch (err) {
        activeRecorder = null;
        logger.error('Failed to start recorder:', err);
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // API: Stop Recording
    // -------------------------------------------------------------
    if (pathname === '/api/record/stop' && req.method === 'POST') {
      if (!activeRecorder || !activeRecorder.isRecording) {
        return sendJson(res, 400, { error: 'No active recording session to stop' });
      }

      try {
        const savedFilePath = await activeRecorder.stop();
        const summary = {
          name: activeRecorder.name,
          filePath: savedFilePath,
          actionCount: activeRecorder.actions.length
        };
        activeRecorder = null;
        if (workflowController.syncWorkflowsFromDisk) {
          workflowController.syncWorkflowsFromDisk();
        }
        broadcast('recording_state', { isRecording: false, summary });
        broadcast('workflows_updated', summary);
        return sendJson(res, 200, { success: true, summary });
      } catch (err) {
        logger.error('Error stopping recorder:', err);
        activeRecorder = null;
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // API: Start Replay
    // -------------------------------------------------------------
    if (pathname === '/api/replay/start' && req.method === 'POST') {
      if (activeReplay) {
        return sendJson(res, 400, { error: 'A replay execution is already in progress' });
      }

      const body = await parseJsonBody(req);
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
      activeReplay = { engine: replayEngine, filename, currentAction: 0, totalActions: recording.actions.length };

      broadcast('replay_state', { isReplaying: true, filename, total: recording.actions.length });

      // Run replay asynchronously
      (async () => {
        try {
          // Hook into target waiting / progress
          const origWait = replayEngine.waitForTargetElement.bind(replayEngine);
          replayEngine.waitForTargetElement = async (target, index, type) => {
            if (activeReplay) {
              activeReplay.currentAction = index + 1;
              broadcast('replay_progress', {
                index: index + 1,
                total: recording.actions.length,
                action: recording.actions[index]
              });
            }
            return origWait(target, index, type);
          };

          const stats = await replayEngine.replay(recording);
          broadcast('replay_state', { isReplaying: false, success: true, stats });
        } catch (err) {
          broadcast('replay_state', { isReplaying: false, success: false, error: err.message });
        } finally {
          activeReplay = null;
        }
      })();

      return sendJson(res, 200, { success: true, filename, totalActions: recording.actions.length });
    }

    // -------------------------------------------------------------
    // API: Stop Replay
    // -------------------------------------------------------------
    if (pathname === '/api/replay/stop' && req.method === 'POST') {
      let stoppedReplay = false;
      let stoppedRecorder = false;
      if (activeRecorder && activeRecorder.isRecording) {
        try {
          const savedFilePath = await activeRecorder.stop();
          const summary = {
            name: activeRecorder.name,
            filePath: savedFilePath,
            actionCount: activeRecorder.actions.length
          };
          activeRecorder = null;
          stoppedRecorder = true;
          if (workflowController.syncWorkflowsFromDisk) {
            workflowController.syncWorkflowsFromDisk();
          }
          broadcast('recording_state', { isRecording: false, summary });
          broadcast('workflows_updated', summary);
        } catch (err) {
          logger.error('Error stopping recorder in /api/replay/stop:', err);
          activeRecorder = null;
        }
      }
      if (activeReplay) {
        stoppedReplay = true;
        try {
          if (activeReplay.engine && typeof activeReplay.engine.abort === 'function') {
            await activeReplay.engine.abort();
          }
        } catch (err) {
          logger.error(`Error aborting replay: ${err.message}`);
        }
        broadcast('replay_state', { isReplaying: false, stopped: true });
        activeReplay = null;
      }

      if (runController.hasActiveRuns && runController.hasActiveRuns()) {
        return runController.stopAllRuns(req, res);
      }

      return sendJson(res, 200, {
        success: true,
        message: stoppedRecorder ? 'Recording stopped and saved successfully' : (stoppedReplay ? 'Replay playback stopped successfully' : 'Execution stopped')
      });
    }

    // -------------------------------------------------------------
    // API: Run Tests (Unit or E2E)
    // -------------------------------------------------------------
    if (pathname === '/api/test/run' && req.method === 'POST') {
      if (isRunningTest) {
        return sendJson(res, 400, { error: 'A test is already running' });
      }

      const body = await parseJsonBody(req);
      const testType = body.type || 'unit'; // 'unit' or 'e2e'
      const testScript = testType === 'e2e' ? 'test/e2e-smoke.js' : 'test/selector-resolver.test.js';
      const scriptPath = path.resolve(process.cwd(), testScript);

      isRunningTest = true;
      broadcast('test_state', { isRunning: true, type: testType });
      logger.header(`Running ${testType.toUpperCase()} Tests from Dashboard`);

      const child = spawn('node', [scriptPath], { cwd: process.cwd() });

      let output = '';
      child.stdout.on('data', (d) => {
        const text = d.toString();
        output += text;
        broadcast('log', { level: 'INFO', text: text.trim(), time: new Date().toLocaleTimeString() });
      });

      child.stderr.on('data', (d) => {
        const text = d.toString();
        output += text;
        broadcast('log', { level: 'ERROR', text: text.trim(), time: new Date().toLocaleTimeString() });
      });

      child.on('close', (code) => {
        isRunningTest = false;
        const success = code === 0;
        if (success) {
          logger.success(`${testType.toUpperCase()} tests completed successfully!`);
        } else {
          logger.error(`${testType.toUpperCase()} tests failed with exit code ${code}`);
        }
        broadcast('test_state', { isRunning: false, type: testType, success, exitCode: code });
      });

      return sendJson(res, 200, { success: true, message: `Started ${testType} test` });
    }

    // -------------------------------------------------------------
    // Static File Serving (HTML, CSS, JS, Assets, Test Portals)
    // -------------------------------------------------------------
    let filePath;
    if (pathname.startsWith('/downloads/')) {
      const downloadFile = pathname.replace('/downloads/', '');
      filePath = path.join(process.cwd(), 'downloads', downloadFile);
    } else if (pathname.startsWith('/portal/')) {
      const portalFile = pathname.replace('/portal/', '');
      filePath = path.join(process.cwd(), 'test', portalFile);
    } else if (pathname.startsWith('/test/')) {
      const testFile = pathname.replace('/test/', '');
      filePath = path.join(process.cwd(), 'test', testFile);
    } else {
      filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    }

    const extname = String(path.extname(filePath)).toLowerCase();

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const contentType = MIME_TYPES[extname] || 'application/octet-stream';
      const fileContent = fs.readFileSync(filePath);
      const headers = { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      };
      if (urlObj.searchParams.get('download') === '1') {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      return res.end(fileContent);
    }

    // Fallback: 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');

  } catch (err) {
    logger.error('Dashboard Server Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

let currentPort = PORT;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    currentPort = Number(currentPort) + 1;
    logger.warn(`Port in use. Attempting to start on fallback port: http://localhost:${currentPort}...`);
    setTimeout(() => {
      server.listen(currentPort);
    }, 200);
  } else {
    logger.error('Dashboard server error:', err);
  }
});

server.listen(currentPort, () => {
  logger.divider();
  logger.success(`🚀 Workflow Capture Dashboard is live at: http://localhost:${currentPort}`);
  logger.info(`Connected to Chrome CDP at: http://localhost:9222`);
  logger.info(`Open http://localhost:${currentPort} in your browser to manage workflows visually.`);
  logger.divider();
});

module.exports = server;
