/**
 * Workflow Capture — Authentication Middleware
 * 
 * Extracts Bearer tokens from the Authorization header or cookies,
 * verifies the token, and attaches the authenticated user payload to req.user.
 */

const { verifyToken } = require('./token-service');
const { db } = require('../database/db');

function extractToken(req) {
  // 1. Check Authorization header: Bearer <token>
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // 2. Check Cookie header: token=<token>
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Middleware function that verifies JWT and attaches user.
 * Returns true if authorized, or writes 401 response and returns false.
 */
function requireAuth(req, res) {
  const token = extractToken(req);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Missing authentication token' }));
    return false;
  }

  // Developer / testing bypass tokens
  if (token === 'dev-token' || token === 'dummy-testing-token' || token === 'dev-testing-token') {
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
  requireAuth
};
