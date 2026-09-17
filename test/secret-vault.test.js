const assert = require('assert');
const { encryptSecret, decryptSecret, getMasterKey } = require('../src/auth/secret-util');
const { db } = require('../src/database/db');
const ReplayEngine = require('../src/replay/replay-engine');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');

async function runTests() {
  console.log('--- Starting Secret Vault Tests ---');

  // Test 1: Encryption and Decryption logic
  console.log('Testing encryption & decryption...');
  const masterKey = getMasterKey();
  assert.ok(masterKey.length === 32, 'Master key must be 32 bytes');

  const plaintext = 'SuperSecretP@ssword!';
  const encrypted = encryptSecret(plaintext);

  assert.ok(encrypted.iv, 'Encrypted object must have IV');
  assert.ok(encrypted.authTag, 'Encrypted object must have authTag');
  assert.ok(encrypted.encryptedHex, 'Encrypted object must have encryptedHex');

  const decrypted = decryptSecret(encrypted);
  assert.strictEqual(decrypted, plaintext, 'Decrypted text must match original plaintext');
  console.log('✅ Encryption/Decryption passed');

  // Test 2: Database Secret CRUD
  console.log('Testing Secret Database Operations...');
  const userId = 'test_user_123';
  
  const secret = db.insert('secrets', {
    userId,
    name: 'test_db_password',
    domain: 'global',
    encryptedData: encryptSecret('my_db_secret')
  });

  assert.ok(secret.id, 'Inserted secret must have an ID');
  
  const fetchedSecrets = db.find('secrets', s => s.userId === userId);
  assert.strictEqual(fetchedSecrets.length, 1, 'Should fetch 1 secret for user');
  
  const fetchedSecret = fetchedSecrets[0];
  assert.strictEqual(fetchedSecret.name, 'test_db_password');
  
  const dec = decryptSecret(fetchedSecret.encryptedData);
  assert.strictEqual(dec, 'my_db_secret', 'Secret decrypted from DB should match');
  console.log('✅ Database CRUD passed');

  // Test 3: Secret Injection in ReplayEngine
  console.log('Testing ReplayEngine secret injection...');
  
  const runner = new LoopReplayRunner({ runId: 'test_run' });
  const engine = runner.replayEngine;
  
  // Create a fake workflow to satisfy the secretResolver closure
  const workflow = { userId: userId };
  
  engine.secretResolver = async (secretId) => {
    const s = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
    if (s && s.encryptedData) {
      return decryptSecret(s.encryptedData);
    }
    return `{{secret:${secretId}}}`;
  };

  // Resolve an existing secret
  const resolved = await engine.secretResolver(secret.id);
  assert.strictEqual(resolved, 'my_db_secret', 'Resolver should fetch and decrypt correct secret');

  // Resolve a non-existent secret
  const notFound = await engine.secretResolver('unknown_id');
  assert.strictEqual(notFound, '{{secret:unknown_id}}', 'Resolver should fallback to placeholder for missing secrets');
  
  console.log('✅ ReplayEngine Resolver passed');

  // Cleanup
  db.delete('secrets', secret.id);

  console.log('--- All Secret Vault Tests Passed! ---');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
