/**
 * Workflow Capture — Secret Utility
 * 
 * Uses aes-256-gcm for authenticated symmetric encryption of secrets (passwords).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const ENV_FILE = path.resolve(process.cwd(), '.env');

// Lazy load or generate master key
let MASTER_KEY = null;

function getMasterKey() {
  if (MASTER_KEY) return MASTER_KEY;

  if (process.env.MASTER_KEY) {
    MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'hex');
    if (MASTER_KEY.length === KEY_LENGTH) return MASTER_KEY;
  }

  // Check .env file
  if (fs.existsSync(ENV_FILE)) {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const match = envContent.match(/^MASTER_KEY=([a-f0-9]{64})$/m);
    if (match) {
      MASTER_KEY = Buffer.from(match[1], 'hex');
      return MASTER_KEY;
    }
  }

  // Generate new key and append to .env
  console.log('[SecretUtil] Generating new random MASTER_KEY for local development...');
  MASTER_KEY = crypto.randomBytes(KEY_LENGTH);
  const newEnvLine = `\nMASTER_KEY=${MASTER_KEY.toString('hex')}\n`;
  fs.appendFileSync(ENV_FILE, newEnvLine);
  
  return MASTER_KEY;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param {string} plaintext - The text to encrypt.
 * @returns {Object} { iv, authTag, encryptedHex }
 */
function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('Plaintext must be a non-empty string');
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    authTag,
    encryptedHex: encrypted
  };
}

/**
 * Decrypts an encrypted object using AES-256-GCM.
 * @param {Object} encryptedObj - { iv, authTag, encryptedHex }
 * @returns {string} The decrypted plaintext string.
 */
function decryptSecret(encryptedObj) {
  if (!encryptedObj || !encryptedObj.iv || !encryptedObj.authTag || !encryptedObj.encryptedHex) {
    throw new Error('Invalid encrypted object format');
  }

  const key = getMasterKey();
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const authTag = Buffer.from(encryptedObj.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedObj.encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  getMasterKey // Exported for testing purposes
};
