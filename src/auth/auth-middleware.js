/**
 * Workflow Capture — Authentication & Security Middleware
 * 
 * Extracts Bearer tokens from the Authorization header, cookies, or query parameters,
 * verifies tokens against the JWT service and database, and attaches req.user.
 * 
 * Also provides centralized CORS origin validation and developer-bypass policies:
 * - Local loopback detection (127.0.0.1, localhost, ::1)
 * - Explicit development bypass gating (ALLOW_DEV_BYPASS=true on loopback only)
 * - Strict same-origin CORS by default with configurable allowlist (ALLOWED_ORIGINS)
 */

const { verifyToken } = require('./token-service');
const { db } = require('../database/db');

/**
 * Check if the given hostname/host header represents a loopback interface.
 */
function isLoopbackAddress(host) {
  if (!host || typeof host !== 'string') return false;
  const trimmed = host.trim().toLowerCase();
  if (trimmed === '::1' || trimmed === '[::1]') return true;
  if (trimmed.startsWith('[')) {
    const endBracket = trimmed.indexOf(']');
    if (endBracket !== -1) {
      const ipv6 = trimmed.substring(1, endBracket);
      return ipv6 === '::1';
    }
  }
  const hostname = trimmed.split(':')[0];
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

/**
 * Check if developer authentication bypass is explicitly permitted.
 * 
 * Safety invariants:
 * 1. Must be explicitly requested via ALLOW_DEV_BYPASS=true (or ENABLE_DEV_BYPASS / DEV_BYPASS).
 * 2. Cannot silently become network-access mode: strictly disallowed if HOST is not a loopback interface.
 */
function isDevBypassEnabled() {
  const optIn = process.env.ALLOW_DEV_BYPASS === 'true' ||
                process.env.ENABLE_DEV_BYPASS === 'true' ||
                process.env.DEV_BYPASS === 'true';
  if (!optIn) return false;

  const host = (process.env.HOST || '127.0.0.1').trim().toLowerCase();
  return isLoopbackAddress(host);
}

/**
 * Parse configured allowed origins from ALLOWED_ORIGINS environment variable.
 * Returns an array of normalized lowercase origins (without trailing slashes).
 */
function getAllowedOrigins() {
  const envVal = process.env.ALLOWED_ORIGINS;
  if (!envVal || typeof envVal !== 'string') return [];
  return envVal
    .split(',')
    .map(s => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Check if origin matches the host header (same-origin).
 */
function isSameOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false;
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host.toLowerCase();
    const requestHost = hostHeader.trim().toLowerCase();
    return originHost === requestHost;
  } catch {
    return false;
  }
}

/**
 * Validate request origin against same-origin policy or explicit allowlist.
 * Returns { allowed: boolean, isCrossOrigin: boolean, origin: string | null }
 */
function validateOrigin(req) {
  const origin = req.headers['origin'] || req.headers['Origin'];
  // If no Origin header is present (direct browser navigation, curl, same-origin GET),
  // this is not a cross-origin request.
  if (!origin) {
    return { allowed: true, isCrossOrigin: false, origin: null };
  }

  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  const host = req.headers['host'] || req.headers['Host'];

  // Check 1: Same origin
  if (isSameOrigin(normalizedOrigin, host)) {
    return { allowed: true, isCrossOrigin: false, origin: normalizedOrigin };
  }

  // Check 2: Explicit allowlist
  const allowedList = getAllowedOrigins();
  const lowerOrigin = normalizedOrigin.toLowerCase();
  if (allowedList.includes(lowerOrigin)) {
    return { allowed: true, isCrossOrigin: true, origin: normalizedOrigin };
  }

  // Otherwise rejected
  return { allowed: false, isCrossOrigin: true, origin: normalizedOrigin };
}

/**
 * Centralized CORS Handler.
 * Returns true if request should proceed, or writes response (204 for OPTIONS, 403 for disallowed origin)
 * and returns false if request processing is complete.
 */
function handleCors(req, res) {
  const { allowed, origin } = validateOrigin(req);

  if (!allowed) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Forbidden: Cross-origin request from unlisted origin '${origin}' rejected` }));
    return false;
  }

  // Apply specific allowed origin header (never wildcard '*')
  if (origin && typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    res.writeHead(204);
    res.end();
    return false;
  }

  return true;
}

function extractToken(req) {
  // 1. Check Authorization header: Bearer <token>
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // 2. Check Cookie header: token=<token>
  const cookieHeader = req.headers['cookie'] || req.headers['Cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) return decodeURIComponent(match[1].trim());
  }

  // 3. Check query param: ?token=<token>
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const queryToken = parsedUrl.searchParams.get('token');
      if (queryToken) return queryToken.trim();
    } catch {}
  }

  return null;
}

/**
 * Middleware function that verifies JWT and attaches user.
 * Returns true if authorized, or writes 401 response and returns false.
 */
function requireAuth(req, res) {
  const token = extractToken(req);

  // When no token is provided
  if (!token) {
    // If developer bypass is explicitly enabled on loopback, assign developer identity
    if (isDevBypassEnabled()) {
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

    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Missing authentication token' }));
    return false;
  }

  // Developer / testing bypass tokens
  if (token === 'dev-token' || token === 'dummy-testing-token' || token === 'dev-testing-token') {
    if (!isDevBypassEnabled()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Developer bypass tokens are disabled in secure mode' }));
      return false;
    }

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

  const { valid, payload, error } = verifyToken(token);
  if (!valid || !payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unauthorized: ${error || 'Invalid token'}` }));
    return false;
  }

  // Verify user still exists in DB
  const user = db.findById('users', payload.userId);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: User account no longer exists' }));
    return false;
  }

  // Attach sanitized user profile to request
  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt
  };

  return true;
}

module.exports = {
  extractToken,
  requireAuth,
  isDevBypassEnabled,
  isLoopbackAddress,
  getAllowedOrigins,
  isSameOrigin,
  validateOrigin,
  handleCors
};
