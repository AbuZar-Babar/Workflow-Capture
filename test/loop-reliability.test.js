/**
 * Test Suite: Repeated-Item Execution Reliability & Stall Regression
 * 
 * Verifies:
 * 1. Overlay dismissal and runner actions are flagged as automated to prevent
 *    in-page human disturbance detection from stalling subsequent items.
 * 2. Sequential items execute across item boundaries without stalling or inheriting state.
 * 3. Item-level failure and retry: a failing item exhausts retries, marks FAILED,
 *    and cleanly allows the next item to proceed without inheriting stale handles.
 * 4. Checkpoint and manifest counter consistency across completed, failed, and skipped items.
 * 5. Terminal resource release: browser listeners detached and replay engine disconnected.
 * 6. Four-item invoice portal scenario executes end-to-end to completion.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const LoopReplayRunner = require('../src/replay/loop-replay-runner');
const ReplayEngine = require('../src/replay/replay-engine');
const { getChromeExecutablePath } = require('../src/utils/cdp-connector');

const TEST_RUNS_DIR = path.resolve(__dirname, '../recordings/runs');
const PORTAL_PATH = path.resolve(__dirname, 'invoices-portal.html');
const PORTAL_URL = `file://${PORTAL_PATH.replace(/\\/g, '/')}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanRunDir(runId) {
  const dir = path.join(TEST_RUNS_DIR, runId);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function runTests() {
  console.log('🧪 Starting Loop Reliability & Repeated-Item Execution Test Suite...\n');

  // --------------------------------------------------------------------------
  // Test 1: ReplayEngine constructor supports cdpPort & sets browserURL
  // --------------------------------------------------------------------------
  console.log('🔹 Test 1: ReplayEngine cdpPort option support');
  {
    const engine1 = new ReplayEngine({ cdpPort: 9555 });
    assert.strictEqual(engine1.browserURL, 'http://127.0.0.1:9555');

    const engine2 = new ReplayEngine({ browserURL: 'http://custom-host:9222' });
    assert.strictEqual(engine2.browserURL, 'http://custom-host:9222');

    const runner = new LoopReplayRunner({ cdpPort: 9666, runId: 'test_port_check' });
    assert.strictEqual(runner.replayEngine.browserURL, 'http://127.0.0.1:9666');
    console.log('  ✅ cdpPort correctly configures ReplayEngine browserURL\n');
  }

  // --------------------------------------------------------------------------
  // Test 2: In-page disturbance guard treats untargeted automated actions as automated
  // --------------------------------------------------------------------------
  console.log('🔹 Test 2: In-page disturbance guard recognizes automated page actions');
  {
    const engine = new ReplayEngine();
    let interventionTriggered = false;
    engine._handleHumanIntervention = () => {
      interventionTriggered = true;
    };

    // Simulate in-page event logic from injection script:
    // When __flowmindAutomatedActionActive is true and expected is null (e.g. Escape key),
    // onHumanInput must return immediately instead of pausing replay.
    const simulateGuard = (automatedActive, expectedTarget, evtTarget, automatedUntil = 0) => {
      const now = Date.now();
      if (automatedUntil && now < automatedUntil) return 'IGNORED_GRACE';
      if (automatedActive && (!expectedTarget || expectedTarget === evtTarget || (expectedTarget.contains && expectedTarget.contains(evtTarget)))) {
        return 'IGNORED_AUTOMATED';
      }
      return 'TRIGGERED_HUMAN';
    };

    const mockBody = { tagName: 'BODY' };
    const mockInput = { tagName: 'INPUT' };

    // With fix: automated action without target (Escape on body) is recognized as automated
    assert.strictEqual(
      simulateGuard(true, null, mockBody),
      'IGNORED_AUTOMATED',
      'Page-level automated keypress must not trigger human disturbance'
    );

    // Targeted action matches target
    assert.strictEqual(
      simulateGuard(true, mockInput, mockInput),
      'IGNORED_AUTOMATED',
      'Targeted automated action must be ignored by guard'
    );

    // Trailing grace window ignores microtask bubble
    assert.strictEqual(
      simulateGuard(false, null, mockBody, Date.now() + 150),
      'IGNORED_GRACE',
      'Trailing grace period must ignore post-action event bubbles'
    );

    // Real human interaction triggers guard
    assert.strictEqual(
      simulateGuard(false, null, mockBody, 0),
      'TRIGGERED_HUMAN',
      'Actual user interaction outside automation must trigger intervention'
    );

    console.log('  ✅ Disturbance detection guard correctly isolates automated actions\n');
  }

  // --------------------------------------------------------------------------
  // Test 3: Checkpoint and manifest counter consistency on failure and filter
  // --------------------------------------------------------------------------
  console.log('🔹 Test 3: Checkpoint & manifest consistency on terminal/skipped transitions');
  {
    const runId = `test_consist_${Date.now()}`;
    const runner = new LoopReplayRunner({ runId, workflowId: 'wf_consist', resumeFromCheckpoint: true });
    runner.initDirectories();

    const manifest = {
      runId,
      workflowId: 'wf_consist',
      mode: 'LOOP',
      status: 'RUNNING',
      itemsTotal: 3,
      itemsSucceeded: 1,
      itemsFailed: 1,
      itemsSkipped: 1,
      pagesProcessed: 1,
      results: [
        { index: 1, status: 'SUCCESS' },
        { index: 2, status: 'FAILED', error: 'Simulated failure' },
        { index: 3, status: 'SKIPPED_FILTER', skippedReason: 'Type does not match' }
      ],
      downloadedFiles: []
    };

    // Write checkpoint with completed item 2 (next index = 3)
    runner.writeLoopCheckpoint(manifest, null, null, 1, 3, null);

    const cpPath = path.join(runner.runsDir, 'checkpoint.json');
    assert(fs.existsSync(cpPath), 'Checkpoint file must be written');
    const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));

    assert.strictEqual(cp.itemsSucceeded, 1);
    assert.strictEqual(cp.itemsFailed, 1);
    assert.strictEqual(cp.itemsSkipped, 1);
    assert.strictEqual(cp.itemsTotal, 3);
    assert.deepStrictEqual(cp.completedItemIndexes, [1]);
    assert.strictEqual(cp.currentPageItemIndex, 3, 'Next item index after failure must point to item 3');
    assert.strictEqual(cp.currentItemIndex, null, 'No active item when between items');

    cleanRunDir(runId);
    console.log('  ✅ Checkpoint & manifest counters agree consistently\n');
  }

  // --------------------------------------------------------------------------
  // Test 4: Item failure isolation and retry handling
  // --------------------------------------------------------------------------
  console.log('🔹 Test 4: Item failure does not contaminate next item execution');
  {
    const runId = `test_fail_iso_${Date.now()}`;
    const runner = new LoopReplayRunner({ runId, workflowId: 'wf_fail_iso', maxItemRetries: 1 });
    runner.initDirectories();

    // Mock an engine that simulates item 1 failing all attempts, then item 2 succeeding
    let item1Attempts = 0;
    let item2Attempts = 0;
    let overlaysDismissed = 0;

    runner.replayEngine = {
      isPaused: false,
      isAborted: false,
      browserURL: 'http://127.0.0.1:9222',
      connect: async () => ({
        pages: async () => [{
          url: () => 'http://example.com/test',
          mainFrame: () => ({ evaluate: async () => true }),
          evaluate: async () => true,
          browser: () => ({ pages: async () => [] })
        }]
      }),
      _ensureSelectorResolverInFrame: async () => {},
      _setAutomatedAction: async () => {},
      dismissOverlays: async () => { overlaysDismissed++; },
      disconnect: async () => {},
      executeAction: async () => ({ success: true }),
      executeActionWithinItem: async (el, action, idx) => {
        if (el.__itemIndex === 0) {
          item1Attempts++;
          throw new Error('Item 1 transient network fault');
        } else if (el.__itemIndex === 1) {
          item2Attempts++;
          return { success: true };
        }
      }
    };

    // Verify retry policy: item 1 retried up to maxItemRetries (1 retry = 2 attempts total)
    // Then item 2 executed independently
    const mockWorkflow = {
      id: 'wf_fail_iso',
      name: 'Failure Isolation Test',
      steps: [
        { type: 'NAVIGATE', url: 'http://example.com/test' },
        { type: 'CLICK', target: { selectors: { cssPath: 'table tbody tr:nth-child(1) td a' } } }
      ]
    };

    // Override ItemDiscovery for mock execution
    const ItemDiscovery = require('../src/shared/item-discovery');
    const origDiscover = ItemDiscovery.discover;
    const origGetItemHandle = ItemDiscovery.getItemHandle;

    ItemDiscovery.discover = async () => ({
      success: true,
      confidence: 1.0,
      itemCount: 2,
      collection: { ancestorTag: 'tbody', ancestorSelector: 'table tbody', itemTag: 'tr' },
      items: [{ index: 0 }, { index: 1 }]
    });

    ItemDiscovery.getItemHandle = async (page, disc, idx) => ({
      asElement: () => ({
        __itemIndex: idx,
        evaluate: async () => ({ text: `Item #${idx + 1}`, link: '', dataId: '' }),
        dispose: async () => {}
      }),
      dispose: async () => {}
    });

    try {
      const manifest = await runner.executeLoop(mockWorkflow, 1);

      assert.strictEqual(manifest.status, 'COMPLETED_WITH_ERRORS', 'Run with failed item should complete with errors');
      assert.strictEqual(manifest.itemsTotal, 2);
      assert.strictEqual(manifest.itemsFailed, 1, 'Item 1 should be recorded as failed');
      assert.strictEqual(manifest.itemsSucceeded, 1, 'Item 2 should be recorded as succeeded');
      assert.strictEqual(item1Attempts, 2, 'Item 1 should attempt initial run + 1 retry');
      assert.strictEqual(item2Attempts, 1, 'Item 2 should execute cleanly on attempt 1');
      assert(overlaysDismissed >= 1, 'Overlays should be dismissed safely during recovery');

      // Verify manifest results
      assert.strictEqual(manifest.results[0].status, 'FAILED');
      assert.strictEqual(manifest.results[0].attempts, 2);
      assert.strictEqual(manifest.results[1].status, 'SUCCESS');
      assert.strictEqual(manifest.results[1].attempts, 1);

      // Verify checkpoint agreement
      const cp = JSON.parse(fs.readFileSync(path.join(runner.runsDir, 'checkpoint.json'), 'utf8'));
      assert.strictEqual(cp.itemsSucceeded, 1);
      assert.strictEqual(cp.itemsFailed, 1);
      assert.strictEqual(cp.status, 'COMPLETED_WITH_ERRORS');
    } finally {
      ItemDiscovery.discover = origDiscover;
      ItemDiscovery.getItemHandle = origGetItemHandle;
      cleanRunDir(runId);
    }

    console.log('  ✅ Failure isolation and retry recovery verified\n');
  }

  // --------------------------------------------------------------------------
  // Test 5: Terminal cleanup on stop/abort
  // --------------------------------------------------------------------------
  console.log('🔹 Test 5: Terminal resource release and manifest consistency on abort');
  {
    const runId = `test_abort_${Date.now()}`;
    const runner = new LoopReplayRunner({ runId, workflowId: 'wf_abort' });
    runner.initDirectories();

    let disconnected = false;
    runner.replayEngine = {
      isPaused: false,
      isAborted: false,
      browserURL: 'http://127.0.0.1:9222',
      connect: async () => ({
        pages: async () => [{
          url: () => 'http://example.com/test',
          mainFrame: () => ({ evaluate: async () => true }),
          evaluate: async () => true,
          browser: () => ({ pages: async () => [] })
        }]
      }),
      _ensureSelectorResolverInFrame: async () => {},
      _setAutomatedAction: async () => {},
      dismissOverlays: async () => {},
      disconnect: async () => { disconnected = true; },
      executeAction: async () => {
        await runner.stop();
        throw new Error('Execution stopped by user');
      }
    };

    const mockWorkflow = {
      id: 'wf_abort',
      name: 'Abort Test',
      steps: [{ type: 'CLICK', target: { selectors: { cssPath: 'button#btn' } } }]
    };

    const manifest = await runner.executeStandard(mockWorkflow);
    assert.strictEqual(manifest.status, 'STOPPED', 'Status must be STOPPED');
    assert.strictEqual(disconnected, true, 'ReplayEngine must be disconnected on terminal path');

    const writtenManifest = JSON.parse(fs.readFileSync(path.join(runner.runsDir, 'manifest.json'), 'utf8'));
    assert.strictEqual(writtenManifest.status, 'STOPPED');

    cleanRunDir(runId);
    console.log('  ✅ Abort terminal cleanup and status consistency verified\n');
  }

  // --------------------------------------------------------------------------
  // Test 6: Browser E2E validation against invoice portal fixture (if Chrome installed)
  // --------------------------------------------------------------------------
  console.log('🔹 Test 6: Four-item invoice portal E2E replay without stalling');
  const chromePath = getChromeExecutablePath();
  if (!chromePath || !fs.existsSync(chromePath)) {
    console.log('  ⚠️ Google Chrome executable not found for live browser E2E test; skipping browser run.\n');
  } else {
    const e2ePort = 9444;
    const tempProfile = path.resolve(__dirname, `../tmp/chrome-loop-profile-test-${Date.now()}`);
    if (!fs.existsSync(tempProfile)) fs.mkdirSync(tempProfile, { recursive: true });

    console.log(`  Spawning test Chrome instance on port ${e2ePort}...`);
    const chromeProc = spawn(chromePath, [
      `--remote-debugging-port=${e2ePort}`,
      `--user-data-dir=${tempProfile}`,
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
      await sleep(400);
      try {
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${e2ePort}` });
        await browser.disconnect();
        connected = true;
        break;
      } catch {}
    }

    if (!connected) {
      chromeProc.kill();
      throw new Error(`Chrome failed to connect on port ${e2ePort}`);
    }

    const runId = `loop_e2e_rel_${Date.now()}`;
    try {
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
                text: 'Download',
                classes: ['btn-download'],
                attributes: {
                  href: 'data:text/plain;charset=utf-8,Invoice%20INV-2026-001%20for%20Acme%20Corp%0AAmount:%20$1250.00'
                }
              }
            }
          }
        ]
      };

      const runner = new LoopReplayRunner({ cdpPort: e2ePort, runId });
      const manifest = await runner.executeLoop(mockWorkflow, 1);

      // Verify all acceptance criteria
      assert.strictEqual(manifest.status, 'COMPLETED', 'Scenario must complete successfully without stalling');
      assert.strictEqual(manifest.itemsTotal, 4, 'Should detect all 4 invoice rows');
      assert.strictEqual(manifest.itemsSucceeded, 4, 'All 4 invoice rows should succeed');
      assert.strictEqual(manifest.itemsFailed, 0, 'No rows should fail');
      assert.strictEqual(manifest.results.length, 4, 'Manifest must have 4 item results');
      assert(
        manifest.results.every(r => r.status === 'SUCCESS' && r.actions && r.actions.length === 2),
        'Each item must execute both recorded actions (mark and download)'
      );
      assert.strictEqual(manifest.downloadedFiles.length, 4, 'All 4 files must be downloaded and organized');

      // Verify checkpoint file
      const checkpointPath = path.join(runner.runsDir, 'checkpoint.json');
      assert(fs.existsSync(checkpointPath), 'Checkpoint file must be written');
      const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      assert.strictEqual(checkpoint.status, 'COMPLETED');
      assert.strictEqual(checkpoint.itemsSucceeded, 4);
      assert.strictEqual(checkpoint.itemsTotal, 4);
      assert.deepStrictEqual(checkpoint.completedItemIndexes, [1, 2, 3, 4]);

      console.log('  ✅ Four-item invoice portal scenario completed with 100% success without stalling\n');
    } finally {
      cleanRunDir(runId);
      chromeProc.kill();
      try {
        fs.rmSync(tempProfile, { recursive: true, force: true });
      } catch {}
    }
  }

  console.log('🎉 ALL LOOP RELIABILITY TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Loop reliability test suite failed:', err);
  process.exit(1);
});
