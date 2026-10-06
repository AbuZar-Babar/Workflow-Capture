/**
 * Workflow Capture — Interactive Web Dashboard Server Bootstrap
 *
 * Zero-dependency native Node.js HTTP & SSE Server providing a visual control room
 * for recording workflows, replaying actions, inspecting selector candidates,
 * monitoring Chrome CDP connections, and viewing live execution logs.
 */

const http = require('http');
const logger = require('../utils/logger');
const {
  isLoopbackAddress,
  isDevBypassEnabled,
  getAllowedOrigins
} = require('../auth/auth-middleware');
const sseManager = require('./sse/sse-event-manager');
const recorderRoutes = require('./routes/recorder-routes');
const { dispatchRequest } = require('./routes/router');

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

// Attach logger to SSE event manager
sseManager.attachLogger(logger);

// Create HTTP server instance
const server = http.createServer((req, res) => dispatchRequest(req, res));
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
 * Retries on the next sequential port on EADDRINUSE.
 */
function startServer(port = currentPort, host = HOST, maxRetries = 10) {
  return new Promise((resolve, reject) => {
    let attemptPort = Number(port);
    let retriesLeft = maxRetries;

    function tryListen() {
      function onListening() {
        cleanup();
        currentPort = server.address() ? server.address().port : attemptPort;
        recorderRoutes.setServerPort(currentPort);
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
