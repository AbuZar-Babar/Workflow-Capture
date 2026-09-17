/**
 * Workflow Capture — Password Hashing & Verification
 * 
 * Uses Node.js native crypto.scrypt with cryptographically random 16-byte salts.
 * Provides protection against timing attacks via crypto.timingSafeEqual.
 */

const crypto = require('crypto');

const KEY_LEN = 64;

/**
 * Hashes a plaintext password using scrypt with a unique random salt.
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Format: "salt:hash" (hex encoded)
 */
async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string.
 * @param {string} password - Plain text password input
 * @param {string} storedHash - Stored "salt:hash"
 * @returns {Promise<boolean>} True if password matches, false otherwise
 */
async function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      const keyBuffer = Buffer.from(key, 'hex');
      const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
      resolve(match);
    });
  });
}

module.exports = {
  hashPassword,
  verifyPassword
};
