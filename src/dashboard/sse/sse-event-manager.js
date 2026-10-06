/**
 * SSE Event Manager
 *
 * Encapsulates Server-Sent Events (SSE) client connections,
 * heartbeat handling, message broadcasting, and logger integration.
 */

const { requireAuth } = require('../../auth/auth-middleware');

class SSEEventManager {
  constructor() {
    this.clients = new Set();
    this.sseClients = this.clients;
    this.broadcast = this.broadcast.bind(this);
    this.handleConnection = this.handleConnection.bind(this);
    global.__flowmindBroadcast = this.broadcast;
  }

  /**
   * Broadcast an event to all connected SSE clients.
   *
   * @param {string} type - Event type name
   * @param {any} payload - Event payload to be JSON-stringified
   */
  broadcast(type, payload) {
    const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Handle an incoming HTTP request for SSE streaming.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {boolean} Whether connection was accepted
   */
  handleConnection(req, res) {
    if (!requireAuth(req, res)) return false;

    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    };
    res.writeHead(200, sseHeaders);
    res.write('\n');
    this.clients.add(res);

    const heartbeatInterval = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeatInterval);
        this.clients.delete(res);
      }
    }, 30000);
    if (heartbeatInterval.unref) {
      heartbeatInterval.unref();
    }

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      this.clients.delete(res);
    });

    return true;
  }

  /**
   * Intercept logger methods to broadcast logs to dashboard SSE clients.
   *
   * @param {object} logger - System logger instance
   */
  attachLogger(logger) {
    if (!logger || logger.__sseAttached) return;
    logger.__sseAttached = true;

    const originalInfo = logger.info;
    const originalSuccess = logger.success;
    const originalWarn = logger.warn;
    const originalError = logger.error;
    const originalAction = logger.action;

    logger.info = (...args) => {
      originalInfo.apply(logger, args);
      this.broadcast('log', { level: 'INFO', text: args.join(' '), time: new Date().toLocaleTimeString() });
    };

    logger.success = (...args) => {
      originalSuccess.apply(logger, args);
      this.broadcast('log', { level: 'SUCCESS', text: args.join(' '), time: new Date().toLocaleTimeString() });
    };

    logger.warn = (...args) => {
      originalWarn.apply(logger, args);
      this.broadcast('log', { level: 'WARN', text: args.join(' '), time: new Date().toLocaleTimeString() });
    };

    logger.error = (...args) => {
      originalError.apply(logger, args);
      this.broadcast('log', {
        level: 'ERROR',
        text: args.map(a => (a && a.message ? a.message : String(a))).join(' '),
        time: new Date().toLocaleTimeString()
      });
    };

    logger.action = (index, type, target, detail = '') => {
      originalAction.call(logger, index, type, target, detail);
      this.broadcast('log', {
        level: 'ACTION',
        text: `#${index} [${type}] ${target} ${detail}`,
        time: new Date().toLocaleTimeString()
      });
    };
  }

  /**
   * Returns current count of connected SSE clients.
   *
   * @returns {number}
   */
  getClientCount() {
    return this.clients.size;
  }
}

const sseManager = new SSEEventManager();

module.exports = sseManager;
module.exports.SSEEventManager = SSEEventManager;
module.exports.sseManager = sseManager;
