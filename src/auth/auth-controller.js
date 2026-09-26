/**
 * Workflow Capture — Authentication Controller
 * 
 * Handles registration, login, profile queries, and token management.
 */

const { db } = require('../database/db');
const { hashPassword, verifyPassword } = require('./password-util');
const { signToken } = require('./token-service');
const { isDevBypassEnabled } = require('./auth-middleware');

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

/**
 * Register a new user
 * POST /api/auth/register
 * Body: { username, email, password }
 */
async function register(req, res, body) {
  try {
    const { username, email, password } = body || {};

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return sendJson(res, 400, { error: 'Username must be at least 3 characters long' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return sendJson(res, 400, { error: 'A valid email address is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return sendJson(res, 400, { error: 'Password must be at least 6 characters long' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    // Check if email or username already exists
    const existingUser = db.findOne('users', u => u.email === cleanEmail || u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existingUser) {
      return sendJson(res, 409, { error: 'An account with that email or username already exists' });
    }

    // Hash password with salt
    const passwordHash = await hashPassword(password);

    // Persist user record
    const newUser = db.insert('users', {
      username: cleanUsername,
      email: cleanEmail,
      passwordHash
    });

    // Generate JWT token
    const token = signToken({
      userId: newUser.id,
      email: newUser.email,
      username: newUser.username
    });

    return sendJson(res, 201, {
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        createdAt: newUser.createdAt
      },
      token
    }, {
      'Set-Cookie': `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`
    });
  } catch (err) {
    console.error('[Auth Error] Registration failure:', err);
    return sendJson(res, 500, { error: 'Internal server error during registration' });
  }
}

/**
 * Log in an existing user
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res, body) {
  try {
    const { email, username, password } = body || {};
    const identifier = (email || username || '').trim().toLowerCase();

    if (!identifier || !password) {
      return sendJson(res, 400, { error: 'Email/Username and password are required' });
    }

    // Find user by email or username
    const user = db.findOne('users', u => u.email === identifier || u.username.toLowerCase() === identifier);
    if (!user) {
      return sendJson(res, 401, { error: 'Invalid email/username or password' });
    }

    // Verify password hash
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return sendJson(res, 401, { error: 'Invalid email/username or password' });
    }

    // Generate JWT token
    const token = signToken({
      userId: user.id,
      email: user.email,
      username: user.username
    });

    return sendJson(res, 200, {
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    }, {
      'Set-Cookie': `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`
    });
  } catch (err) {
    console.error('[Auth Error] Login failure:', err);
    return sendJson(res, 500, { error: 'Internal server error during login' });
  }
}

/**
 * Quick Bypass / Dummy Login for Development & Testing
 * POST /api/auth/dummy-login
 * Strictly gated behind explicit development bypass on loopback.
 */
async function dummyLogin(req, res) {
  try {
    if (!isDevBypassEnabled()) {
      return sendJson(res, 403, { error: 'Forbidden: Developer dummy login is disabled in secure mode' });
    }

    let user = db.findOne('users', u => u.email === 'abuzarbabar53@gmail.com');
    if (!user) {
      const allUsers = db.findAll('users');
      user = allUsers && allUsers.length > 0 ? allUsers[0] : null;
    }

    if (!user) {
      user = db.insert('users', {
        username: 'Abuzar Babar',
        email: 'abuzarbabar53@gmail.com',
        passwordHash: 'dummy'
      });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      username: user.username
    });

    return sendJson(res, 200, {
      success: true,
      message: 'Dummy login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    }, {
      'Set-Cookie': `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`
    });
  } catch (err) {
    console.error('[Auth Error] Dummy login failure:', err);
    return sendJson(res, 500, { error: 'Internal server error during dummy login' });
  }
}

/**
 * Fetch authenticated user profile
 * GET /api/auth/me
 */
async function getProfile(req, res) {
  if (!req.user) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }
  return sendJson(res, 200, {
    success: true,
    user: req.user
  });
}

/**
 * Invalidate / logout
 * POST /api/auth/logout
 */
async function logout(req, res) {
  return sendJson(res, 200, {
    success: true,
    message: 'Logged out successfully'
  }, {
    'Set-Cookie': 'token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict'
  });
}

module.exports = {
  register,
  login,
  dummyLogin,
  getProfile,
  logout,
  sendJson
};
