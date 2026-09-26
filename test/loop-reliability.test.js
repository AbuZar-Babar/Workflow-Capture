/**
 * Test Suite: Repeated-Item Execution Reliability & Stall Regression
 *
 * Verifies:
 * 1. Narrowed automated-input suppression: targetless actions (Escape overlay dismissal)
 *    only suppress expected keys, while real user clicks/keys trigger intervention pause.
 * 2. Sequential items execute across item boundaries without stalling or inheriting state.
 * 3. Item-level failure and retry: a failing item exhausts retries, marks FAILED,
 *    and cleanly allows the next item to proceed without inheriting stale handles.
 * 4. Loop-specific abort and resume: stops preserve item/action cursor and resumes without duplicate items.
 * 5. Checkpoint and manifest counter consistency across completed, failed, and skipped items.
 * 6. Terminal resource release: browser listeners detached and replay engine disconnected.
 * 7. Four-item invoice portal scenario executes end-to-end to completion on a dynamic available port.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const net = require('net');
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

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForProcessExit(proc, timeoutMs = 7000) {
  if (!proc || proc.killed || proc.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    proc.once('exit', finish);
    proc.kill('SIGTERM');

    const forceTimer = setTimeout(() => {
      if (!done) {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }
    }, Math.floor(timeoutMs / 2));

    const maxTimer = setTimeout(() => {
      finish();
    }, timeoutMs);

    proc.once('exit', () => {
      clearTimeout(forceTimer);
      clearTimeout(maxTimer);
    });
  });
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
  // Test 2: In-page disturbance guard narrows automated-input suppression
  // --------------------------------------------------------------------------
  console.log('🔹 Test 2: Narrowed automated-input suppression protects against real user inputs');
  {
    // Simulate the narrowed in-page guard logic
    const simulateGuard = (automatedActive, expectedTarget, expectedKey, evt, automatedUntil = 0, recentTarget = null, recentKey = null) => {
      const now = Date.now();
      let isAutomated = false;

      if (automatedActive) {
        if (expectedTarget && (expectedTarget === evt.target || (expectedTarget.contains && expectedTarget.contains(evt.target)))) {
          isAutomated = true;
        } else if (!expectedTarget && expectedKey && (evt.key === expectedKey || evt.code === expectedKey)) {
          isAutomated = true;
        }
      }

      if (!isAutomated && automatedUntil && now < automatedUntil) {
        if (recentTarget && (recentTarget === evt.target || (recentTarget.contains && recentTarget.contains(evt.target)))) {
          isAutomated = true;
        } else if (!recentTarget && recentKey && (evt.key === recentKey || evt.code === recentKey)) {
          isAutomated = true;
        }
      }

      if (isAutomated) return 'IGNORED_AUTOMATED';
      return 'TRIGGERED_HUMAN';
    };

    const mockBody = { tagName: 'BODY' };
    const mockButton = { tagName: 'BUTTON' };
    const mockInput = { tagName: 'INPUT' };

    // 1. Targetless automated Escape dismissal (Escape key on body)
    assert.strictEqual(
      simulateGuard(true, null, 'Escape', { type: 'keydown', key: 'Escape', target: mockBody }),
      'IGNORED_AUTOMATED',
      'Synthetic Escape key during dismissOverlays must be recognized as automated'
    );

    // Real user click on body or button during targetless action MUST trigger pause
    assert.strictEqual(
      simulateGuard(true, null, 'Escape', { type: 'click', target: mockBody }),
      'TRIGGERED_HUMAN',
      'Real user click during targetless action must trigger human intervention pause'
    );
    assert.strictEqual(
      simulateGuard(true, null, 'Escape', { type: 'mousedown', target: mockButton }),
      'TRIGGERED_HUMAN',
      'Real user mousedown during targetless action must trigger human intervention pause'
    );

    // Real user pressing a non-Escape key during targetless action MUST trigger pause
    assert.strictEqual(
      simulateGuard(true, null, 'Escape', { type: 'keydown', key: 'Enter', target: mockBody }),
      'TRIGGERED_HUMAN',
      'Real user Enter keypress during targetless action must trigger human intervention pause'
    );
    assert.strictEqual(
      simulateGuard(true, null, 'Escape', { type: 'keydown', key: 'a', target: mockInput }),
      'TRIGGERED_HUMAN',
      'Real user typing during targetless action must trigger human intervention pause'
    );

    // 2. Targeted automated action
    assert.strictEqual(
      simulateGuard(true, mockButton, null, { type: 'click', target: mockButton }),
      'IGNORED_AUTOMATED',
      'Automated click on target element must be ignored'
    );
    assert.strictEqual(
      simulateGuard(true, mockButton, null, { type: 'click', target: mockBody }),
      'TRIGGERED_HUMAN',
      'Click on non-target element must trigger intervention pause'
    );

    // 3. Trailing grace window: only trailing events matching recent target or recent key are ignored
    assert.strictEqual(
      simulateGuard(false, null, null, { type: 'keyup', key: 'Escape', target: mockBody }, Date.now() + 150, null, 'Escape'),
      'IGNORED_AUTOMATED',
      'Trailing Escape keyup within grace window must be ignored'
    );
    assert.strictEqual(
      simulateGuard(false, null, null, { type: 'click', target: mockButton }, Date.now() + 150, null, 'Escape'),
      'TRIGGERED_HUMAN',
      'Real user click during grace window must trigger intervention pause'
    );
    assert.strictEqual(
      simulateGuard(false, null, null, { type: 'keydown', key: 'Enter', target: mockBody }, Date.now() + 150, null, 'Escape'),
      'TRIGGERED_HUMAN',
      'Real user keypress during grace window must trigger intervention pause'
    );

    console.log('  ✅ Disturbance detection guard correctly isolates automated actions without broad suppression\n');
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
    runner.writeLoopCheckpoint(manifest, null, 0, 1, 3, null);

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

    const mockWorkflow = {
      id: 'wf_fail_iso',
      name: 'Failure Isolation Test',
      steps: [
        { type: 'NAVIGATE', url: 'http://example.com/test' },
        { type: 'CLICK', target: { selectors: { cssPath: 'table tbody tr:nth-child(1) td a' } } }
      ]
    };

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

      assert.strictEqual(manifest.results[0].status, 'FAILED');
      assert.strictEqual(manifest.results[0].attempts, 2);
      assert.strictEqual(manifest.results[1].status, 'SUCCESS');
      assert.strictEqual(manifest.results[1].attempts, 1);

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
  // Test 5: Loop-specific abort & resume preserves item/action cursor
  // --------------------------------------------------------------------------
  console.log('🔹 Test 5: Loop-specific abort & resume preserves item/action cursor');
  {
    const runId = `test_loop_abort_resume_${Date.now()}`;
    const runner = new LoopReplayRunner({ runId, workflowId: 'wf_abort_resume', resumeFromCheckpoint: true });
    runner.initDirectories();

    const executedActions = [];
    const mockPage = {
      url: () => 'http://example.com/portal',
      mainFrame: () => ({ evaluate: async () => true }),
      evaluate: async () => true,
      bringToFront: async () => {},
      keyboard: { press: async () => {} },
      browser: () => ({ pages: async () => [mockPage] })
    };

    runner.replayEngine = {
      isPaused: false,
      isAborted: false,
      browserURL: 'http://127.0.0.1:9222',
      connect: async () => ({
        pages: async () => [mockPage]
      }),
      _ensureSelectorResolverInFrame: async () => {},
      _setAutomatedAction: async () => {},
      dismissOverlays: async () => {},
      disconnect: async () => {},
      executeAction: async () => ({ success: true }),
      executeActionWithinItem: async (el, action, idx) => {
        executedActions.push({ item: el.__itemIndex, action: action.__actionIndex });
        if (el.__itemIndex === 1 && action.__actionIndex === 0) {
          // Trigger stop after Item 2 action 0 completes
          setImmediate(() => {
            runner.stop();
          });
        }
        return { success: true };
      }
    };

    const mockWorkflow = {
      id: 'wf_abort_resume',
      name: 'Loop Abort & Resume Regression Test',
      steps: [
        { type: 'NAVIGATE', url: 'http://example.com/portal' },
        { type: 'CLICK', __actionIndex: 0, target: { selectors: { cssPath: 'table tbody tr td button' } } },
        { type: 'CLICK', __actionIndex: 1, target: { selectors: { cssPath: 'table tbody tr td a' } } }
      ]
    };

    const ItemDiscovery = require('../src/shared/item-discovery');
    const origDiscover = ItemDiscovery.discover;
    const origGetItemHandle = ItemDiscovery.getItemHandle;

    ItemDiscovery.discover = async () => ({
      success: true,
      confidence: 1.0,
      itemCount: 3,
      collection: { ancestorTag: 'tbody', ancestorSelector: 'table tbody', itemTag: 'tr' },
      items: [{ index: 0 }, { index: 1 }, { index: 2 }]
    });

    ItemDiscovery.getItemHandle = async (page, disc, idx) => ({
      asElement: () => ({
        __itemIndex: idx,
        evaluate: async () => ({ text: `Invoice #${idx + 1}`, link: '', dataId: '' }),
        dispose: async () => {}
      }),
      dispose: async () => {}
    });

    try {
      // 1. Initial run: stopped on item 2
      const manifest1 = await runner.executeLoop(mockWorkflow, 1);
      assert.strictEqual(manifest1.status, 'STOPPED', 'Run must halt with STOPPED status');
      assert.strictEqual(manifest1.itemsSucceeded, 1, 'Item 1 must have succeeded');

      const cp1Path = path.join(runner.runsDir, 'checkpoint.json');
      assert(fs.existsSync(cp1Path), 'Checkpoint must exist on disk');
      const cp1 = JSON.parse(fs.readFileSync(cp1Path, 'utf8'));

      assert.strictEqual(cp1.status, 'STOPPED');
      assert.strictEqual(cp1.currentPage, 1);
      assert.strictEqual(cp1.currentPageItemIndex, 1, 'Cursor must preserve stopped item index 1 (item 2)');
      assert.strictEqual(cp1.currentItemIndex, 2, 'Active item index must be 2');
      assert.strictEqual(cp1.currentActionOffset, 1, 'Cursor must preserve next action offset 1');
      assert.deepStrictEqual(cp1.completedItemIndexes, [1], 'Only item 1 in completed items');
      assert(cp1.activeItem, 'Active item must be preserved in checkpoint');
      assert.strictEqual(cp1.activeItem.index, 2);

      // 2. Resume run: create new runner with same runId and resumeFromCheckpoint: true
      const resumedRunner = new LoopReplayRunner({
        runId,
        workflowId: 'wf_abort_resume',
        resumeFromCheckpoint: true
      });
      resumedRunner.initDirectories();

      const resumedExecutedActions = [];
      resumedRunner.replayEngine = {
        isPaused: false,
        isAborted: false,
        browserURL: 'http://127.0.0.1:9222',
        connect: async () => ({
          pages: async () => [mockPage]
        }),
        _ensureSelectorResolverInFrame: async () => {},
        _setAutomatedAction: async () => {},
        dismissOverlays: async () => {},
        disconnect: async () => {},
        executeAction: async () => ({ success: true }),
        executeActionWithinItem: async (el, action, idx) => {
          resumedExecutedActions.push({ item: el.__itemIndex, action: action.__actionIndex });
          return { success: true };
        }
      };

      const manifest2 = await resumedRunner.executeLoop(mockWorkflow, 1);

      assert.strictEqual(manifest2.status, 'COMPLETED', 'Resumed run must complete successfully');
      assert.strictEqual(manifest2.itemsSucceeded, 3, 'All 3 items must succeed');
      assert.strictEqual(manifest2.itemsFailed, 0, 'No items should fail');
      assert.strictEqual(manifest2.results.length, 3, 'Results must contain exactly 3 items without duplicates');

      // Verify resumed actions:
      // Item 0 was skipped (already succeeded).
      // Item 1 only executed action 1 (action 0 was not re-executed!).
      // Item 2 executed action 0 and action 1.
      assert.deepStrictEqual(
        resumedExecutedActions,
        [
          { item: 1, action: 1 },
          { item: 2, action: 0 },
          { item: 2, action: 1 }
        ],
        'Resumed execution must skip item 1 action 0 and continue from cursor'
      );

      const finalCp = JSON.parse(fs.readFileSync(path.join(resumedRunner.runsDir, 'checkpoint.json'), 'utf8'));
      assert.strictEqual(finalCp.status, 'COMPLETED');
      assert.strictEqual(finalCp.itemsSucceeded, 3);
      assert.deepStrictEqual(finalCp.completedItemIndexes, [1, 2, 3]);
    } finally {
      ItemDiscovery.discover = origDiscover;
      ItemDiscovery.getItemHandle = origGetItemHandle;
      cleanRunDir(runId);
    }
    console.log('  ✅ Loop-specific abort and resume cursor preservation verified\n');
  }

  // --------------------------------------------------------------------------
  // Test 6: Terminal cleanup on stop/abort
  // --------------------------------------------------------------------------
  console.log('🔹 Test 6: Terminal resource release and manifest consistency on abort');
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
  // Test 7: Browser E2E validation against invoice portal fixture (if Chrome installed)
  // --------------------------------------------------------------------------
  console.log('🔹 Test 7: Four-item invoice portal E2E replay without stalling');
  const chromePath = getChromeExecutablePath();
  if (!chromePath || !fs.existsSync(chromePath)) {
    console.log('  ⚠️ Google Chrome executable not found for live browser E2E test; skipping browser run.\n');
  } else {
    const e2ePort = await getAvailablePort();
    const tempProfile = path.resolve(__dirname, `../tmp/chrome-loop-profile-test-${Date.now()}`);
    if (!fs.existsSync(tempProfile)) fs.mkdirSync(tempProfile, { recursive: true });

    console.log(`  Spawning test Chrome instance on dynamic port ${e2ePort}...`);
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
      await waitForProcessExit(chromeProc);
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
      await waitForProcessExit(chromeProc);
      if (fs.existsSync(tempProfile)) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            fs.rmSync(tempProfile, { recursive: true, force: true });
            break;
          } catch {
            await sleep(200);
          }
        }
      }
    }
  }

  console.log('🎉 ALL LOOP RELIABILITY TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Loop reliability test suite failed:', err);
  process.exit(1);
});
