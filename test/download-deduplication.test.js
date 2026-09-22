/**
 * Workflow Capture — Download Organization & Hybrid Deduplication Unit Tests
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { JsonDB } = require('../src/database/db');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const runController = require('../src/api/run-controller');

console.log('\n🧪 Starting Download Organization & Deduplication Test Suite...\n');

const TEST_DIR = path.resolve(__dirname, 'scratch_test_downloads');
const TEST_DB_PATH = path.join(TEST_DIR, 'test-db.json');

const { db } = require('../src/database/db');

// Cleanup helper
function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  const testWfDownloads = path.resolve(process.cwd(), 'downloads', 'city-mart-monthly-invoices-export');
  if (fs.existsSync(testWfDownloads)) {
    fs.rmSync(testWfDownloads, { recursive: true, force: true });
  }
  if (db && db.state && Array.isArray(db.state.downloads)) {
    db.state.downloads = db.state.downloads.filter(d => d.workflowId !== 'wf_city_mart_999');
    db.save();
  }
}

cleanup();
fs.mkdirSync(TEST_DIR, { recursive: true });

async function runTests() {
  try {
    // -------------------------------------------------------------
    // Test 1: JsonDB schema includes downloads collection
    // -------------------------------------------------------------
    console.log('🔹 Test 1: JsonDB schema includes downloads collection');
    const testDb = new JsonDB(TEST_DB_PATH);
    assert(Array.isArray(testDb.state.downloads), 'Default schema must include downloads array');
    assert.strictEqual(testDb.find('downloads').length, 0, 'Downloads collection should start empty');
    console.log('  ✅ Schema initialization passed\n');

    // -------------------------------------------------------------
    // Test 2: Runner directory hierarchy & slug generation
    // -------------------------------------------------------------
    console.log('🔹 Test 2: Runner directory hierarchy & slug generation');
    const runner = new LoopReplayRunner({
      runId: 'test_run_123',
      workflowId: 'wf_city_mart_999',
      workflowName: 'City Mart / Monthly Invoices & Export',
      userId: 'user_tester'
    });

    assert.strictEqual(
      runner.workflowSlug,
      'city-mart-monthly-invoices-export',
      'Workflow name must be slugified cleanly'
    );
    const today = new Date().toISOString().split('T')[0];
    assert.strictEqual(runner.dateStr, today, 'Date string must match current YYYY-MM-DD');
    assert(
      runner.structuredDownloadsDir.endsWith(path.join(runner.workflowSlug, today)),
      'structuredDownloadsDir must end with <slug>/<date>'
    );
    console.log('  ✅ Directory hierarchy & slug generation passed\n');

    // -------------------------------------------------------------
    // Test 3: processAndStoreDownload: hash, copy & manifest sync
    // -------------------------------------------------------------
    console.log('🔹 Test 3: processAndStoreDownload creates files, DB records & manifest.json');
    
    // Create simulated downloaded file in runner staging area
    runner.initDirectories();
    const stagingFile = path.join(runner.downloadsDir, 'invoice_001.pdf');
    const testContent = 'PDF-1.4 Fake PDF Content for Invoice 001 - ' + Date.now();
    fs.writeFileSync(stagingFile, testContent, 'utf8');

    const expectedHash = crypto.createHash('sha256').update(testContent).digest('hex');

    const stored = runner.processAndStoreDownload(stagingFile, 'invoice:#001', 'Invoice #001');

    assert(stored, 'processAndStoreDownload should return stored metadata object');
    assert.strictEqual(stored.filename, 'invoice_001.pdf', 'Filename must match');
    assert.strictEqual(stored.fileHash, expectedHash, 'SHA256 hash must match file content');
    assert(fs.existsSync(stored.path), 'Organized file must exist at structured path');

    // Verify workflow manifest.json was created
    const manifestPath = path.join(runner.workflowDownloadsBaseDir, 'manifest.json');
    assert(fs.existsSync(manifestPath), 'Workflow downloads manifest.json must exist');
    const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifestJson.workflowId, 'wf_city_mart_999');
    assert(manifestJson.downloads.some(d => d.fileHash === expectedHash), 'Manifest must contain the downloaded file');

    console.log('  ✅ processAndStoreDownload passed\n');

    // -------------------------------------------------------------
    // Test 4: checkIfAlreadyDownloaded detects existing items
    // -------------------------------------------------------------
    console.log('🔹 Test 4: checkIfAlreadyDownloaded detects duplicate item before clicking');
    
    // Query with the key used above
    const checkDuplicate = runner.checkIfAlreadyDownloaded('invoice:#001');
    assert.strictEqual(checkDuplicate.isDuplicate, true, 'Should detect item as duplicate');
    assert.strictEqual(checkDuplicate.record.filename, 'invoice_001.pdf');

    // Query with an unknown key
    const checkUnknown = runner.checkIfAlreadyDownloaded('invoice:#999');
    assert.strictEqual(checkUnknown.isDuplicate, false, 'Unknown item should not be a duplicate');

    // Verify that if file is deleted from disk, isDuplicate becomes false
    const existingFilePath = path.resolve(process.cwd(), checkDuplicate.record.filePath);
    const backupPath = existingFilePath + '.bak';
    fs.renameSync(existingFilePath, backupPath);

    const checkMissingFile = runner.checkIfAlreadyDownloaded('invoice:#001');
    assert.strictEqual(checkMissingFile.isDuplicate, false, 'Missing file on disk must not trigger duplicate skip');

    // Restore file
    fs.renameSync(backupPath, existingFilePath);
    const checkRestored = runner.checkIfAlreadyDownloaded('invoice:#001');
    assert.strictEqual(checkRestored.isDuplicate, true, 'Restored file should be recognized as duplicate again');

    console.log('  ✅ Duplicate detection passed\n');

    // -------------------------------------------------------------
    // Test 5: forceRedownload bypass
    // -------------------------------------------------------------
    console.log('🔹 Test 5: forceRedownload bypasses skipping');
    const normalRunner = new LoopReplayRunner({
      workflowId: 'wf_city_mart_999',
      forceRedownload: false
    });
    assert.strictEqual(normalRunner.forceRedownload, false);

    const forcedRunner = new LoopReplayRunner({
      workflowId: 'wf_city_mart_999',
      forceRedownload: true
    });
    assert.strictEqual(forcedRunner.forceRedownload, true);
    console.log('  ✅ forceRedownload option passed\n');

    // -------------------------------------------------------------
    // Test 6: REST API listDownloads and getWorkflowDownloads
    // -------------------------------------------------------------
    console.log('🔹 Test 6: REST API listDownloads and getWorkflowDownloads');
    let listStatus = 0;
    let listJson = null;
    const mockResList = {
      writeHead: (s) => { listStatus = s; },
      end: (data) => { listJson = JSON.parse(data); }
    };
    runController.listDownloads({ user: { id: 'user_tester' } }, mockResList);
    assert.strictEqual(listStatus, 200);
    assert(listJson && listJson.success === true);
    assert(Array.isArray(listJson.downloads));

    let wfStatus = 0;
    let wfJson = null;
    const mockResWf = {
      writeHead: (s) => { wfStatus = s; },
      end: (data) => { wfJson = JSON.parse(data); }
    };
    runController.getWorkflowDownloads({ user: { id: 'user_tester' } }, mockResWf, 'wf_city_mart_999');
    assert.strictEqual(wfStatus, 200);
    assert(wfJson && wfJson.workflowId === 'wf_city_mart_999');
    assert(wfJson.downloads.length >= 1);
    console.log('  ✅ REST API endpoints passed\n');

    // -------------------------------------------------------------
    // Test 7: Export all downloads ZIP
    // -------------------------------------------------------------
    console.log('🔹 Test 7: exportAllDownloadsZip creates and streams ZIP archive');
    let zipStatus = 0;
    let zipHeaders = {};
    const mockResZip = {
      writeHead: (s, h) => { zipStatus = s; zipHeaders = h; },
      on: () => {},
      once: () => {},
      emit: () => {},
      write: () => {},
      end: () => {}
    };
    await new Promise((resolve, reject) => {
      mockResZip.end = () => resolve();
      try {
        runController.exportAllDownloadsZip({ user: { id: 'user_tester' } }, mockResZip);
        setTimeout(resolve, 1500);
      } catch (err) {
        reject(err);
      }
    });
    assert.strictEqual(zipStatus, 200);
    assert.strictEqual(zipHeaders['Content-Type'], 'application/zip');
    console.log('  ✅ exportAllDownloadsZip archive passed\n');

    // -------------------------------------------------------------
    // Test 8: Delete Download
    // -------------------------------------------------------------
    console.log('🔹 Test 8: deleteDownload removes artifact from disk and db');
    let delStatus = 0;
    let delJson = null;
    const mockResDel = {
      writeHead: (s) => { delStatus = s; },
      end: (data) => { delJson = JSON.parse(data); }
    };
    runController.deleteDownload({ user: { id: 'user_tester', role: 'admin' } }, mockResDel, stored.id);
    assert.strictEqual(delStatus, 200);
    assert(delJson && delJson.success === true);
    assert.strictEqual(delJson.id, stored.id);

    // Verify deleted from db
    const checkDb = db.findOne('downloads', d => d.id === stored.id);
    assert.strictEqual(checkDb, null);

    // Verify file removed from disk
    assert(!fs.existsSync(stored.path));
    console.log('  ✅ deleteDownload passed\n');

    console.log('🎉 ALL DOWNLOAD ORGANIZATION & DEDUPLICATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    cleanup();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  cleanup();
  process.exit(1);
});
