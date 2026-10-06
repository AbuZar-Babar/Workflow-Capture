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
const staticRoutes = require('./routes/static-routes');
const recorderRoutes = require('./routes/recorder-routes');
const discoveryRoutes = require('./routes/discovery-routes');

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

// SSE Event Manager
const sseManager = require('./sse/sse-event-manager');
sseManager.attachLogger(logger);
const broadcast = sseManager.broadcast;



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
