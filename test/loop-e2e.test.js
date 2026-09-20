/**
 * End-to-End Loop Replay & Batch Download Test
 * 
 * Verifies:
 * 1. Connecting to headless Chrome via CDP
 * 2. Navigating to the invoice table portal
 * 3. Detecting table row repeating pattern from a single row click
 * 4. Iterating over all 4 table rows and clicking Download
 * 5. CDP download interception capturing all 4 files
 * 6. Verifying manifest.json output and file integrity
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const assert = require('assert');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const logger = require('../src/utils/logger');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;
const PORTAL_PATH = path.resolve(__dirname, 'invoices-portal.html');
const PORTAL_URL = `file://${PORTAL_PATH.replace(/\\/g, '/')}`;
const TEMP_PROFILE = path.resolve(__dirname, '../tmp/chrome-loop-profile');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function startChrome() {
  if (!fs.existsSync(TEMP_PROFILE)) {
    fs.mkdirSync(TEMP_PROFILE, { recursive: true });
  }

  logger.info(`Starting Headless Chrome on port ${DEBUG_PORT}...`);
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    PORTAL_URL
  ], { detached: false });

  let connected = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}` });
      await browser.disconnect();
      connected = true;
      break;
    } catch {}
  }

  if (!connected) {
    chromeProc.kill();
    throw new Error('Chrome failed to start on port 9222');
  }

  return chromeProc;
}

async function runLoopE2E() {
  let chromeProc = null;
  const runId = `e2e_loop_${Date.now()}`;

  try {
    chromeProc = await startChrome();

    // 1. Mock a recorded single-item workflow
    const mockWorkflow = {
      id: 'wf_invoice_download',
      name: 'Invoice Downloader',
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

    logger.header(`Starting Intelligent Loop Replay on 4 Invoices`);
    const runner = new LoopReplayRunner({ cdpPort: DEBUG_PORT, runId });
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
    if (chromeProc) {
      chromeProc.kill();
      logger.info('Closed test Chrome instance.');
    }
  }
}

runLoopE2E().catch(err => {
  console.error('❌ Loop E2E Test failed:', err);
  process.exit(1);
});
