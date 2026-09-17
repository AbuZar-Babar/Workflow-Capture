/**
 * Workflow Capture — Secret API Controller
 * 
 * Manages CRUD operations for the Credential Vault.
 */

const { db } = require('../database/db');
const { encryptSecret } = require('../auth/secret-util');
const { sendJson } = require('../auth/auth-controller');

/**
 * List all saved secrets for the current user (metadata only, no passwords)
 * GET /api/secrets
 */
function listSecrets(req, res) {
  const userId = req.user.id;
  const secrets = db.find('secrets', s => s.userId === userId);

  // Strip encrypted payloads before sending to client
  const safeSecrets = secrets.map(s => ({
    id: s.id,
    name: s.name,
    domain: s.domain,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }));

  return sendJson(res, 200, {
    success: true,
    count: safeSecrets.length,
    secrets: safeSecrets
  });
}

/**
 * Add a new secret to the vault
 * POST /api/secrets
 * Body: { name, domain, value }
 */
function createSecret(req, res, body) {
  const userId = req.user.id;
  const { name, domain, value } = body || {};

  if (!name || !value) {
    return sendJson(res, 400, { error: 'Name and secret value are required' });
  }

  try {
    const encrypted = encryptSecret(value);

    const secret = db.insert('secrets', {
      userId,
      name,
      domain: domain || 'global',
      encryptedData: encrypted,
      updatedAt: new Date().toISOString()
    });

    return sendJson(res, 201, {
      success: true,
      message: 'Secret stored securely',
      secret: {
        id: secret.id,
        name: secret.name,
        domain: secret.domain,
        createdAt: secret.createdAt
      }
    });
  } catch (err) {
    console.error('[Secret Controller] Encryption failed:', err);
    return sendJson(res, 500, { error: 'Failed to encrypt and store secret' });
  }
}

/**
 * Delete a secret
 * DELETE /api/secrets/:id
 */
function deleteSecret(req, res, secretId) {
  const userId = req.user.id;
  
  const secret = db.findOne('secrets', s => s.id === secretId && s.userId === userId);
  if (!secret) {
    return sendJson(res, 404, { error: 'Secret not found or unauthorized' });
  }

  const success = db.delete('secrets', secretId);
  if (success) {
    return sendJson(res, 200, { success: true, message: 'Secret deleted' });
  } else {
    return sendJson(res, 500, { error: 'Failed to delete secret' });
  }
}

module.exports = {
  listSecrets,
  createSecret,
  deleteSecret
};
