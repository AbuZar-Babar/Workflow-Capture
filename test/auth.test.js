/**
 * Test Suite: Authentication, Token Service & DB Persistence
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JsonDB } = require('../src/database/db');
const { hashPassword, verifyPassword } = require('../src/auth/password-util');
const { signToken, verifyToken } = require('../src/auth/token-service');
const { requireAuth } = require('../src/auth/auth-middleware');

async function runTests() {
  console.log('🧪 Starting Authentication & Database Unit Tests...\n');

  // --- 1. Database Storage Test ---
  console.log('🔹 Test 1: JsonDB CRUD operations');
  const testDbPath = path.join(__dirname, 'test-db.json');
  const testDb = new JsonDB(testDbPath);
  testDb.reset();

  const user = testDb.insert('users', {
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'dummyhash'
  });
  assert(user.id, 'User should have generated ID');
  assert.strictEqual(user.username, 'testuser');

  const found = testDb.findOne('users', u => u.email === 'test@example.com');
  assert(found, 'Should find user by email');

  const updated = testDb.update('users', user.id, { username: 'updateduser' });
  assert.strictEqual(updated.username, 'updateduser');

  const deleted = testDb.delete('users', user.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(testDb.findById('users', user.id), null);

  // Clean test db
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  console.log('  ✅ Database CRUD passed\n');

  // --- 2. Password Hashing Test ---
  console.log('🔹 Test 2: Password Hashing & Verification');
  const password = 'SuperSecretPassword2026!';
  const hash = await hashPassword(password);
  assert(hash.includes(':'), 'Hash format should be salt:key');

  const isMatch = await verifyPassword(password, hash);
  assert.strictEqual(isMatch, true, 'Correct password must verify');

  const isWrong = await verifyPassword('WrongPassword!', hash);
  assert.strictEqual(isWrong, false, 'Incorrect password must fail');
  console.log('  ✅ Password hashing and verification passed\n');

  // --- 3. JWT Token Service Test ---
  console.log('🔹 Test 3: JWT Token Signing & Verification');
  const payload = { userId: 'usr_123', email: 'test@example.com' };
  const token = signToken(payload, 3600);
  assert(typeof token === 'string' && token.split('.').length === 3, 'JWT must have 3 parts');

  const decoded = verifyToken(token);
  assert.strictEqual(decoded.valid, true);
  assert.strictEqual(decoded.payload.userId, 'usr_123');

  // Tampered token test
  const tamperedToken = token.slice(0, -5) + 'abcde';
  const tamperedResult = verifyToken(tamperedToken);
  assert.strictEqual(tamperedResult.valid, false, 'Tampered token must fail');

  // Expired token test
  const expiredToken = signToken(payload, -10);
  const expiredResult = verifyToken(expiredToken);
  assert.strictEqual(expiredResult.valid, false, 'Expired token must fail');
  console.log('  ✅ JWT token signing & security verification passed\n');

  console.log('🎉 ALL AUTHENTICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
