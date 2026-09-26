/**
 * End-to-End Loop Replay & Batch Download Test
 * 
 * Verifies:
 * 1. Connecting to headless Chrome via CDP using an isolated Chrome fixture
 * 2. Navigating to the invoice table portal
 * 3. Detecting table row repeating pattern from a single row click
 * 4. Iterating over all 4 table rows and clicking Download
 * 5. CDP download interception capturing all 4 files
 * 6. Verifying manifest.json output and file integrity
 * 7. Ensuring clean, isolated profile and process lifecycle without port or profile collisions
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const logger = require('../src/utils/logger');
const { createChromeFixture } = require('./helpers/chrome-fixture');

const PORTAL_PATH = path.resolve(__dirname, 'invoices-portal.html');
const PORTAL_URL = `file://${PORTAL_PATH.replace(/\\/g, '/')}`;

async function runLoopE2E() {
  let fixture = null;
  const runSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const runId = `e2e_loop_${runSuffix}`;
  const workflowId = `wf_invoice_download_${runSuffix}`;
  const workflowName = `Invoice Downloader ${runSuffix}`;

  try {
    fixture = await createChromeFixture({
      initialUrl: PORTAL_URL,
      prefix: 'chrome-loop-profile',
      startupTimeoutMs: 15000,
      shutdownTimeoutMs: 8000
    });

    // 1. Mock a recorded single-item workflow with unique identity per run
    const mockWorkflow = {
      id: workflowId,
      name: workflowName,
      steps: [
        { type: 'NAVIGATE', url: PORTAL_URL },
        {
          type: 'CLICK',
          target: {
            candidates: [
              {
                strategy: 'css-path',
                value: 'table#invoices-table tbody > tr:nth-child(1) > td:nth-child(5) > button.btn-mark',
                uniqueness: 1,
                priority: 5
              }
            ],
            fingerprint: {
              tagName: 'button',
              text: 'Mark',
              classes: ['btn-mark']
            }
          }
        },
        {
          type: 'CLICK',
          target: {
            candidates: [
              {
                strategy: 'css-path',
                value: 'table#invoices-table tbody > tr:nth-child(1) > td:nth-child(5) > a.btn-download',
                uniqueness: 1,
                priority: 5
              }
            ],
            fingerprint: {
              tagName: 'a',
              id: null,
              name: null,
              type: null,
              role: null,
              placeholder: null,
              ariaLabel: null,
              text: 'Download',
              classes: ['btn-download'],
              attributes: {
                href: 'data:text/plain;charset=utf-8,Invoice%20INV-2026-001%20for%20Acme%20Corp%0AAmount:%20$1250.00'
              },
              isPassword: false,
              dimensions: { width: 0, height: 0 }
            }
          }
        }
      ]
    };

    logger.header(`Starting Intelligent Loop Replay on 4 Invoices [Port: ${fixture.port}]`);
    const runner = new LoopReplayRunner({
      cdpPort: fixture.port,
      runId,
      workflowId,
      workflowName
    });
    runner.replayEngine.browserURL = fixture.browserURL;

    // Headless automated test safeguard: auto-resume if synthetic keyboard/event triggers disturbance pause
    runner.replayEngine.on('paused', (event) => {
      logger.info(`[Test] Replay paused (${event?.reason || 'unknown'}), auto-resuming in test mode...`);
      runner.replayEngine.resume().catch(() => {});
    });

    const manifest = await runner.executeLoop(mockWorkflow, 1);

    // 2. Assert results
    assert.strictEqual(manifest.status, 'COMPLETED', 'Loop run should complete successfully');
    assert.strictEqual(manifest.itemsTotal, 4, 'Should detect all 4 invoice rows');
    assert.strictEqual(manifest.itemsSucceeded, 4, 'All 4 rows should succeed');
    assert.strictEqual(manifest.itemsFailed, 0, 'No rows should fail');
    assert.strictEqual(manifest.results.every(result => result.actions?.length === 2), true, 'Each item should execute both recorded actions');
    assert.strictEqual(manifest.downloadedFiles.length, 4, 'Should capture one downloaded file per invoice');
    assert.strictEqual(
      manifest.results.every(result => result.downloadedFiles?.length === 1),
      true,
      'Each invoice item should have one associated downloaded file'
    );
    for (const file of manifest.downloadedFiles) {
      assert(fs.existsSync(file.path), `Downloaded file should exist: ${file.filename}`);
      assert(file.sizeBytes > 0, `Downloaded file should not be empty: ${file.filename}`);
    }

    logger.success(`\n🎉 Verified: Loop runner successfully generalized 2 row actions to 4 table items with 100% success!`);

  } finally {
    if (fixture) {
      await fixture.cleanup();
      logger.info('Cleaned test Chrome instance and profile.');
    }
  }
}

runLoopE2E().catch(err => {
  console.error('❌ Loop E2E Test failed:', err);
  process.exit(1);
});
