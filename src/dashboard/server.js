/**
 * Workflow Capture — Interactive Web Dashboard Server
 *
 * Zero-dependency native Node.js HTTP & SSE Server providing a visual control room
 * for recording workflows, replaying actions, inspecting selector candidates,
 * monitoring Chrome CDP connections, and viewing live execution logs.
 *
 * ============================================================================
 * SECURITY MODES & CONFIGURATION (Task 1: Secure Dashboard Local Mode)
 * ============================================================================
 *
 * 1. Local Development Mode (Default & Recommended):
 *    - Bind Address: Strictly binds to loopback interface ('127.0.0.1') by default.
 *    - Commands:
 *      * Standard Secure Mode: `node src/dashboard/server.js`
 *      * With Dev Opt-In:     `ALLOW_DEV_BYPASS=true node src/dashboard/server.js`
 *    - Authentication:
 *      * Default: Requires valid JWT Bearer token or HttpOnly cookie for all protected API/SSE endpoints.
 *      * Dev Opt-In: Requires explicit ALLOW_DEV_BYPASS=true. Only permitted on loopback.
 *    - CORS:
 *      * Default: Same-origin strictly enforced. Wildcard CORS (*) is NEVER emitted.
 *      * Cross-Origin: Explicit allowlist via ALLOWED_ORIGINS=http://localhost:5173,...
 *
 * 2. Network-Access Mode:
 *    - Bind Address: Set HOST=0.0.0.0 (or ALLOW_NETWORK_ACCESS=true).
 *    - Command: `HOST=0.0.0.0 node src/dashboard/server.js`
 *    - Security Invariant: Developer bypass (ALLOW_DEV_BYPASS=true) is STRICTLY PROHIBITED
 *      in network-access mode and will fail fast at startup to prevent accidental exposure.
 *    - Authentication & CORS: Requires valid tokens and rejects unlisted cross-origins.
 *
 * Environment Variables:
 *    - PORT: Listen port (default: 3000)
 *    - HOST: Bind IP address (default: 127.0.0.1)
 *    - ALLOW_NETWORK_ACCESS: Set to 'true' to bind to 0.0.0.0
 *    - ALLOW_DEV_BYPASS: Set to 'true' to enable tokenless developer bypass (loopback only)
 *    - ALLOWED_ORIGINS: Comma-separated list of allowed cross-origin origins
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
const {
  requireAuth,
  extractToken,
  handleCors,
  validateOrigin,
  isLoopbackAddress,
  isDevBypassEnabled,
  getAllowedOrigins
} = require('../auth/auth-middleware');
const { db } = require('../database/db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = (process.env.HOST || (process.env.ALLOW_NETWORK_ACCESS === 'true' ? '0.0.0.0' : '127.0.0.1')).trim();

const isLoopback = isLoopbackAddress(HOST);
const isDevBypassRequested = process.env.ALLOW_DEV_BYPASS === 'true' ||
                             process.env.ENABLE_DEV_BYPASS === 'true' ||
                             process.env.DEV_BYPASS === 'true';

// Safety Invariant: Developer bypass cannot silently become the network-access mode
if (isDevBypassRequested && !isLoopback) {
  const errMsg = `FATAL SECURITY CONFIGURATION ERROR: Developer bypass (ALLOW_DEV_BYPASS=true) cannot be enabled when server is bound to external/network interface ('${HOST}'). Developer bypass is strictly restricted to local loopback (127.0.0.1 / localhost).`;
  logger.error(errMsg);
  throw new Error(errMsg);
}

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
global.__flowmindBroadcast = broadcast;

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
let isStartingRecorder = false;
let isStoppingRecorder = false;
let activeReplay = null;
let isRunningTest = false;

async function stopActiveRecording() {
  if (isStoppingRecorder) throw new Error('The recording is already being saved');
  if (!activeRecorder || !activeRecorder.isRecording) {
    throw new Error('No active recording session to stop');
  }

  isStoppingRecorder = true;
  const recorder = activeRecorder;
  try {
    const filePath = await recorder.stop();
    const summary = {
      name: recorder.name,
      filePath,
      actionCount: recorder.actions.length
    };
    if (activeRecorder === recorder) activeRecorder = null;
    if (workflowController.syncWorkflowsFromDisk) {
      workflowController.syncWorkflowsFromDisk();
    }
    broadcast('recording_state', { isRecording: false, summary });
    broadcast('workflows_updated', summary);
    return summary;
  } catch (err) {
    if (activeRecorder === recorder) activeRecorder = null;
    logger.error('Error stopping recorder:', err);
    throw err;
  } finally {
    isStoppingRecorder = false;
  }
}

/**
 * Check CDP Status & fetch open tabs
 */
let cdpStatusCache = { timestamp: 0, data: null };

async function checkCDPStatus(port = 9222) {
  const now = Date.now();
  if (cdpStatusCache.data && (now - cdpStatusCache.timestamp) < 3000) {
    return cdpStatusCache.data;
  }

  return new Promise((resolve) => {
    const handleResolve = (val) => {
      cdpStatusCache = { timestamp: Date.now(), data: val };
      resolve(val);
    };

    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1200 }, (res) => {
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
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime'
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
function sendJson(res, statusCode, data, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

/**
 * HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  // Enforce CORS origin policy (same-origin by default, explicit allowlist, reject unlisted)
  // Also handles preflight OPTIONS (204)
  if (!handleCors(req, res)) {
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // -------------------------------------------------------------
    // SSE Stream
    // -------------------------------------------------------------
    if (pathname === '/api/events') {
      if (!requireAuth(req, res)) return;

      const sseHeaders = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      };
      res.writeHead(200, sseHeaders);
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
      if (!requireAuth(req, res)) return;
      if (activeRecorder && activeRecorder.isRecording) {
        await stopActiveRecording().catch(() => {});
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
      if (req.method === 'GET') {
        return botConfigController.getBotConfig(req, res);
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req).catch(() => ({}));
        return botConfigController.updateBotConfig(req, res, body);
      }
    }

    if (pathname === '/api/bot-config/presets' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      return botConfigController.getPresets(req, res);
    }

    if (pathname === '/api/bot-config/reset' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req).catch(() => ({}));
      return botConfigController.resetBotConfig(req, res, body);
    }

    // -------------------------------------------------------------
    // API: System & CDP Status
    // -------------------------------------------------------------
    if (pathname === '/api/status' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const port = parseInt(urlObj.searchParams.get('port') || '9222', 10);
      const cdp = await checkCDPStatus(port);
      return sendJson(res, 200, {
        cdp,
        recorder: {
          isRecording: !!(activeRecorder && activeRecorder.isRecording),
          isStarting: isStartingRecorder,
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
      if (isStartingRecorder || (activeRecorder && activeRecorder.isRecording)) {
        return sendJson(res, 400, { error: 'A recording session is already starting or active' });
      }

      isStartingRecorder = true;
      const body = await parseJsonBody(req);
      const name = body.name || `workflow-${Date.now()}`;
      const rawBrowserURL = body.browserURL || 'http://127.0.0.1:9222';
      const browserURL = rawBrowserURL.replace('//localhost:', '//127.0.0.1:');

      try {
        activeRecorder = new RecorderBridge({
          name,
          browserURL,
          outputDir: RECORDINGS_DIR,
          onSave: stopActiveRecording
        });

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

        await activeRecorder.start();
        broadcast('recording_state', { isRecording: true, name, startedAt: activeRecorder.startedAt });
        return sendJson(res, 200, { success: true, name, startedAt: activeRecorder.startedAt });
      } catch (err) {
        if (activeRecorder) {
          activeRecorder.stop().catch(() => {});
          activeRecorder = null;
        }
        logger.error('Failed to start recorder:', err);
        return sendJson(res, 500, { error: err.message });
      } finally {
        isStartingRecorder = false;
      }
    }

    // -------------------------------------------------------------
    // API: Stop Recording
    // -------------------------------------------------------------
    if (pathname === '/api/record/stop' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!activeRecorder || !activeRecorder.isRecording || isStoppingRecorder) {
        return sendJson(res, 400, { error: 'No active recording session to stop' });
      }

      try {
        const summary = await stopActiveRecording();
        return sendJson(res, 200, { success: true, summary });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // API: Start Replay
    // -------------------------------------------------------------
    if (pathname === '/api/replay/start' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
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

      // Disturbance detection: forward human intervention alerts to connected dashboard & floating bot
      replayEngine.on('human_intervention', (intervention) => {
        broadcast('human_intervention', {
          workflowId: filename,
          stepIndex: intervention.stepIndex,
          action: intervention.action,
          detail: intervention.detail,
          timestamp: intervention.timestamp,
          message: `Input was blocked and replay paused on Step #${intervention.stepIndex}.`
        });
      });
      replayEngine.on('paused', () => {
        broadcast('replay_state', { isReplaying: true, isPaused: true, filename });
      });
      replayEngine.on('resumed', () => {
        broadcast('replay_state', { isReplaying: true, isPaused: false, filename });
      });

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
      if (!requireAuth(req, res)) return;
      let stoppedReplay = false;
      let stoppedRecorder = false;
      if (activeRecorder && activeRecorder.isRecording) {
        try {
          await stopActiveRecording();
          stoppedRecorder = true;
        } catch (err) {
          logger.error('Error stopping recorder in /api/replay/stop:', err);
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
    // API: Trigger/Simulate Human Disturbance Event for Floating Bot UI
    // -------------------------------------------------------------
    if (pathname === '/api/test/human-disturbance' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req).catch(() => ({}));
      const stepIndex = parseInt(body.stepIndex, 10) || (activeReplay ? activeReplay.currentAction || 2 : 2);
      const payload = {
        workflowId: activeReplay?.filename || body.workflowId || 'demo-workflow.json',
        stepIndex,
        action: { type: body.actionType || 'CLICK', target: { selector: '#submit-btn' } },
        detail: { type: body.eventType || 'mousedown', key: body.key || null, text: body.text || 'User physical mouse click' },
        timestamp: Date.now(),
        message: `Human disturbance detected on Step #${stepIndex}!`
      };
      logger.warn(`[Simulation] Human disturbance alert triggered on Step #${stepIndex}`);
      broadcast('human_intervention', payload);
      return sendJson(res, 200, { success: true, payload });
    }

    // -------------------------------------------------------------
    // API: Run Tests (Unit or E2E)
    // -------------------------------------------------------------
    if (pathname === '/api/test/run' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
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
    } else if (pathname === '/' || pathname === '/landing' || pathname === '/landing.html') {
      filePath = path.join(PUBLIC_DIR, 'landing.html');
    } else if (pathname === '/app' || pathname === '/dashboard') {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    } else {
      filePath = path.join(PUBLIC_DIR, pathname);
    }

    const extname = String(path.extname(filePath)).toLowerCase();

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stat = fs.statSync(filePath);
      const totalSize = stat.size;
      const contentType = MIME_TYPES[extname] || 'application/octet-stream';

      // Support HTTP 206 Range Requests for video files (essential for Chrome & Safari video streaming)
      const range = req.headers.range;
      if (range && (extname === '.mp4' || extname === '.webm' || extname === '.ogg' || extname === '.mov')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        return fileStream.pipe(res);
      }

      const headers = {
        'Content-Type': contentType,
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': extname === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
        'Pragma': 'no-cache',
        'Expires': '0'
      };
      if (urlObj.searchParams.get('download') === '1') {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      const fileStream = fs.createReadStream(filePath);
      return fileStream.pipe(res);
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

function logStartupBanner(port, host) {
  logger.divider();
  logger.success(`🚀 Workflow Capture Dashboard is live at: http://${host}:${port}`);
  logger.info(`Bind Address: ${host} (${isLoopback ? 'Local Loopback Only' : 'Network Accessible'})`);
  logger.info(`Authentication: ${isDevBypassEnabled() ? 'DEVELOPER BYPASS OPT-IN ACTIVE (UNRESTRICTED)' : 'Strict Authentication Required (Default)'}`);
  logger.info(`CORS Policy: ${getAllowedOrigins().length ? `Allowlist (${getAllowedOrigins().join(', ')})` : 'Strict Same-Origin (No Wildcard)'}`);
  logger.info(`Connected to Chrome CDP at: http://localhost:9222`);
  logger.info(`Open http://${host}:${port} in your browser to manage workflows.`);
  logger.divider();
}

/**
 * Start the dashboard server on the configured or fallback port.
 *
 * If EADDRINUSE occurs, it automatically retries on the next sequential port
 * (up to maxRetries times) so the fallback retry can complete cleanly instead
 * of rejecting and triggering process exit.
 */
function startServer(port = currentPort, host = HOST, maxRetries = 10) {
  return new Promise((resolve, reject) => {
    let attemptPort = Number(port);
    let retriesLeft = maxRetries;

    function tryListen() {
      function onListening() {
        cleanup();
        currentPort = server.address() ? server.address().port : attemptPort;
        logStartupBanner(currentPort, host);
        resolve(server);
      }

      function onError(err) {
        cleanup();
        if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
          retriesLeft--;
          attemptPort = Number(attemptPort) + 1;
          logger.warn(`Port in use. Attempting to start on fallback port: http://${host}:${attemptPort}...`);
          setTimeout(tryListen, 100);
        } else {
          reject(err);
        }
      }

      function cleanup() {
        server.removeListener('listening', onListening);
        server.removeListener('error', onError);
      }

      server.once('listening', onListening);
      server.once('error', onError);
      server.listen(attemptPort, host);
    }

    tryListen();
  });
}

// Fallback runtime error logger for post-startup errors
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    logger.error('Dashboard server runtime error:', err);
  }
});

// Automatically start listening when executed directly from CLI/npm
if (require.main === module) {
  startServer().catch(err => {
    logger.error('Failed to start server:', err);
    process.exit(1);
  });
}

server.startServer = startServer;
server.HOST = HOST;
server.PORT = PORT;
server.isLoopback = isLoopback;

module.exports = server;
