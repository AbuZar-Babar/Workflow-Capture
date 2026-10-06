/**
 * Dashboard Central Request Router
 *
 * Dispatches incoming HTTP requests to specialized controllers and route handlers:
 * - CORS origin enforcement and OPTIONS preflight
 * - SSE streaming (sseManager)
 * - Authentication (authController)
 * - Workflows & discovery (workflowController, discoveryRoutes)
 * - Secrets vault (secretController)
 * - Execution & downloads (runController)
 * - Bot configuration (botConfigController)
 * - Recorder, browser, replay & tests (recorderRoutes)
 * - Static asset serving & video streaming (staticRoutes)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const authController = require('../../auth/auth-controller');
const workflowController = require('../../api/workflow-controller');
const runController = require('../../api/run-controller');
const secretController = require('../../api/secret-controller');
const botConfigController = require('../../api/bot-config-controller');
const { requireAuth, handleCors } = require('../../auth/auth-middleware');
const { db } = require('../../database/db');
const sseManager = require('../sse/sse-event-manager');
const staticRoutes = require('./static-routes');
const recorderRoutes = require('./recorder-routes');
const discoveryRoutes = require('./discovery-routes');

/**
 * Parse JSON Request Body Helper
 */
function parseJsonBody(req) {
  if (req.body !== undefined) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        req.body = body ? JSON.parse(body) : {};
        resolve(req.body);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
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
 * Main HTTP Request Dispatcher
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
async function dispatchRequest(req, res) {
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
      return sseManager.handleConnection(req, res);
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
      const body = await parseJsonBody(req).catch(() => ({}));
      return discoveryRoutes.handleDiscoverWorkflow(req, res, workflowId, body);
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
      if (recorderRoutes.activeRecorder && recorderRoutes.activeRecorder.isRecording) {
        await recorderRoutes.stopActiveRecording().catch(() => {});
      }
      if (recorderRoutes.activeReplay) {
        await recorderRoutes.stopActiveReplay().catch(() => {});
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

    const dlFileMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/file$/);
    if (dlFileMatch && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const downloadId = dlFileMatch[1];
      const record = db.findOne('downloads', d => d.id === downloadId);
      if (!record) {
        return sendJson(res, 404, { error: 'Download not found' });
      }
      const targetRel = record.runPath || record.relativeFilePath || record.filePath;
      const fullPath = path.resolve(process.cwd(), targetRel);
      if (!fs.existsSync(fullPath)) {
        return sendJson(res, 404, { error: 'File not found on disk' });
      }
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes = {
        '.pdf': 'application/pdf',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.txt': 'text/plain',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const stat = fs.statSync(fullPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Content-Disposition': `inline; filename="${encodeURIComponent(record.filename || path.basename(fullPath))}"`
      });
      return fs.createReadStream(fullPath).pipe(res);
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
    // Recorder, Browser, Replay & Test REST APIs
    // -------------------------------------------------------------
    const recorderBody = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseJsonBody(req).catch(() => ({})) : {};
    const handledRecorder = await recorderRoutes.handleRoute(req, res, pathname, urlObj, recorderBody);
    if (handledRecorder) return;

    // -------------------------------------------------------------
    // Static File Serving (HTML, CSS, JS, Assets, Test Portals)
    // -------------------------------------------------------------
    return staticRoutes.handleStatic(req, res, pathname, urlObj);

  } catch (err) {
    logger.error('Dashboard Server Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  dispatchRequest,
  parseJsonBody,
  sendJson
};
