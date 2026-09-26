/**
 * Test Suite: Repeated-Item Execution Reliability & Stall Regression
 *
 * Verifies:
 * 1. Narrowed automated-input suppression: targetless actions (Escape overlay dismissal)
 *    only suppress expected keys, while real user clicks/keys trigger intervention pause.
 * 2. Real in-page human-interaction guard installed by ReplayEngine ignores automated actions,
 *    leaves mouse movement unguarded, pauses on human clicks/keys, and tears down cleanly.
 * 3. Process exit verification and startup-failure profile cleanup: confirmed exit before deletion,
 *    and profile preservation + PID reporting if process remains alive.
 * 4. Sequential items execute across item boundaries without stalling or inheriting state.
 * 5. Item-level failure and retry: a failing item exhausts retries, marks FAILED,
 *    and cleanly allows the next item to proceed without inheriting stale handles.
 * 6. Loop-specific abort and resume: stops preserve item/action cursor and resumes without duplicate items.
 * 7. Checkpoint and manifest counter consistency across completed, failed, and skipped items.
 * 8. Terminal resource release: browser listeners detached and replay engine disconnected.
 * 9. Four-item invoice portal scenario executes end-to-end to completion on a dynamic available port.
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

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(proc, timeoutMs = 7000) {
  if (!proc || typeof proc.pid !== 'number') return;
  const pid = proc.pid;

  // Do not treat ChildProcess.killed as proof that the process exited:
  // it only indicates a kill request was sent. Verify actual process exit.
  if ((proc.exitCode !== null || proc.signalCode !== null) && !isProcessAlive(pid)) {
    return;
  }

  if (isProcessAlive(pid)) {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }

  const startTime = Date.now();
  const halfTimeout = Math.floor(timeoutMs / 2);

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid) || proc.exitCode !== null || proc.signalCode !== null) {
      if (!isProcessAlive(pid)) return;
      await sleep(20);
      if (!isProcessAlive(pid) || proc.exitCode !== null || proc.signalCode !== null) return;
    }

    if (Date.now() - startTime >= halfTimeout && isProcessAlive(pid)) {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }

    await sleep(50);
  }

  if (!isProcessAlive(pid)) return;

  // Fail clearly with the PID rather than reporting cleanup as successful
  throw new Error(`Child process PID ${pid} failed to exit within ${timeoutMs}ms`);
}

async function withTestChrome(options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }

  const chromePath = getChromeExecutablePath();
  if (!chromePath || !fs.existsSync(chromePath)) {
    console.log('  ⚠️ Google Chrome executable not found; skipping live browser test.\n');
    return null;
  }

  const port = options.port || await getAvailablePort();
  const tempProfile = path.resolve(__dirname, `../tmp/chrome-test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tempProfile, { recursive: true });

  let chromeProc = null;
  let exitConfirmed = false;

  try {
    const chromeArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tempProfile}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      ...(options.args || [PORTAL_URL])
    ];

    chromeProc = spawn(chromePath, chromeArgs, { detached: false });

    const maxRetries = options.maxConnectRetries !== undefined ? options.maxConnectRetries : 25;
    const retryDelay = options.connectRetryDelayMs || 200;
    let connected = false;

    for (let i = 0; i < maxRetries; i++) {
      await sleep(retryDelay);
      try {
        const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
        await b.disconnect();
        connected = true;
        break;
      } catch {}
    }

    if (!connected) {
      throw new Error(`Chrome failed to connect on port ${port} during startup`);
    }

    return await fn({ port, chromeProc, tempProfile });
  } finally {
    if (chromeProc) {
      try {
        await waitForProcessExit(chromeProc, options.killTimeoutMs || 7000);
        exitConfirmed = true;
      } catch (exitErr) {
        console.error(`⚠️ Child process PID ${chromeProc.pid} failed to exit: ${exitErr.message}. Preserving temporary profile at: ${tempProfile}`);
        throw exitErr;
      }
    } else {
      exitConfirmed = true;
    }

    // Clean temporary profiles only in finally-style flow and only after confirmed process exit
    if (exitConfirmed && fs.existsSync(tempProfile)) {
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
  // Test 2: Real in-page disturbance guard installed by ReplayEngine
  // --------------------------------------------------------------------------
  console.log('🔹 Test 2: Real in-page disturbance guard installed by ReplayEngine');
  {
    const chromePath = getChromeExecutablePath();
    if (!chromePath || !fs.existsSync(chromePath)) {
      console.log('  ⚠️ Google Chrome executable not found; skipping live guard tests.\n');
    } else {
      await withTestChrome({ args: [PORTAL_URL] }, async ({ port }) => {
        const engine = new ReplayEngine({ browserURL: `http://127.0.0.1:${port}` });
        await engine.connect();
        const page = engine.page;
        assert(page, 'Engine must connect to page');

        // 1. Verify guard is installed on the page
        const attached = await page.evaluate(() => window.__flowmindInterventionAttached);
        assert.strictEqual(attached, true, 'Replay guard should be attached to target page');
        const hostExists = await page.evaluate(() => !!document.getElementById('__flowmind-replay-guard'));
        assert.strictEqual(hostExists, true, 'Replay guard host element should be in DOM');

        // 2. Mouse movement remains unguarded
        assert.strictEqual(engine.isPaused, false);
        await page.mouse.move(50, 50);
        await page.mouse.move(100, 100);
        await page.mouse.move(150, 150);
        await sleep(60);
        assert.strictEqual(engine.isPaused, false, 'Mouse movement must remain unguarded');

        // 3. Automated targetless action (Escape key) is ignored
        await engine._setAutomatedAction(true, 'Escape');
        await page.keyboard.press('Escape');
        await sleep(60);
        assert.strictEqual(engine.isPaused, false, 'Automated Escape keypress must NOT pause replay');

        // Unrelated human click during targetless action triggers pause
        await page.mouse.click(20, 20);
        await sleep(100);
        assert.strictEqual(engine.isPaused, true, 'Human click during targetless action must trigger pause');
        engine.resume();
        assert.strictEqual(engine.isPaused, false);

        // Unrelated human non-Escape keypress during targetless action triggers pause
        await engine._setAutomatedAction(true, 'Escape');
        await page.keyboard.press('KeyZ');
        await sleep(100);
        assert.strictEqual(engine.isPaused, true, 'Human non-Escape key during targetless action must trigger pause');
        engine.resume();
        assert.strictEqual(engine.isPaused, false);

        // Ending automated action: trailing Escape in grace window is ignored
        await engine._setAutomatedAction(false);
        await page.keyboard.press('Escape');
        await sleep(60);
        assert.strictEqual(engine.isPaused, false, 'Trailing Escape in grace window must NOT pause replay');
        await sleep(160); // Wait for grace window to expire

        // 4. Automated targeted action is ignored
        const markBtn = await page.$('table#invoices-table tbody tr:first-child button.btn-mark');
        assert(markBtn, 'Mark button must exist');
        await engine._setAutomatedAction(true, markBtn);
        await markBtn.click();
        await sleep(60);
        assert.strictEqual(engine.isPaused, false, 'Automated click on target element must NOT pause replay');
        await engine._setAutomatedAction(false);
        await sleep(160); // Wait for grace window to expire

        // 5. Unrelated human click triggers pause
        assert.strictEqual(engine.isPaused, false);
        await page.mouse.click(20, 20);
        await sleep(100);
        assert.strictEqual(engine.isPaused, true, 'Unrelated human click must trigger intervention pause');
        engine.resume();
        assert.strictEqual(engine.isPaused, false);

        // 6. Unrelated human keyboard input triggers pause
        await page.keyboard.press('KeyA');
        await sleep(100);
        assert.strictEqual(engine.isPaused, true, 'Unrelated human keyboard input must trigger intervention pause');
        engine.resume();
        assert.strictEqual(engine.isPaused, false);

        // 7. Guard teardown occurs on terminal paths
        await engine.disconnect();
        assert.strictEqual(engine.browser, null, 'Engine browser should be null after disconnect');
        assert.strictEqual(engine.page, null, 'Engine page should be null after disconnect');

        // Verify guard removed in page DOM and listeners detached
        const verifyBrowser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
        try {
          const verifyPage = (await verifyBrowser.pages())[0];
          const attachedAfter = await verifyPage.evaluate(() => window.__flowmindInterventionAttached);
          const hostAfter = await verifyPage.evaluate(() => !!document.getElementById('__flowmind-replay-guard'));
          assert.strictEqual(attachedAfter, false, 'Guard attached flag must be false after disconnect');
          assert.strictEqual(hostAfter, false, 'Guard host element must be removed after disconnect');
        } finally {
          await verifyBrowser.disconnect();
        }

        console.log('  ✅ Real ReplayEngine disturbance detection guard verified under live browser events\n');
      });
    }
  }

  // --------------------------------------------------------------------------
  // Test 3: Process exit verification & startup-failure profile cleanup
  // --------------------------------------------------------------------------
  console.log('🔹 Test 3: Process exit verification & startup-failure profile cleanup');
  {
    // 1. waitForProcessExit does not treat ChildProcess.killed as exit; fails clearly with PID if still alive
    const mockHangingProc = {
      pid: process.pid,
      exitCode: null,
      signalCode: null,
      kill: function() { this.killed = true; } // sets killed = true, but process is still alive!
    };
    let threwWithPid = false;
    try {
      await waitForProcessExit(mockHangingProc, 200);
    } catch (err) {
      threwWithPid = true;
      assert(
        err.message.includes(`Child process PID ${process.pid} failed to exit`),
        `Error message must report PID, got: ${err.message}`
      );
    }
    assert.strictEqual(threwWithPid, true, 'waitForProcessExit must throw with PID when process remains alive');

    // 2. Normal process termination confirms exit
    const normalProc = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']);
    const normalPid = normalProc.pid;
    assert.strictEqual(isProcessAlive(normalPid), true);
    await waitForProcessExit(normalProc, 3000);
    assert.strictEqual(isProcessAlive(normalPid), false, 'Process must be confirmed exited');

    // 3. Startup-failure path cleans temporary profile in a finally-style flow only after confirmed exit
    const failProfileDir = path.resolve(__dirname, `../tmp/test-startup-fail-${Date.now()}`);
    fs.mkdirSync(failProfileDir, { recursive: true });
    const failProc = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']);
    const failPid = failProc.pid;
    let exitConfirmedOnFail = false;
    let startupErrThrown = false;

    try {
      try {
        throw new Error('Simulated startup failure: CDP port unreachable');
      } finally {
        if (failProc) {
          try {
            await waitForProcessExit(failProc, 3000);
            exitConfirmedOnFail = true;
          } catch (exitErr) {
            console.error(`⚠️ Process PID ${failPid} remained alive: ${exitErr.message}. Preserving profile at ${failProfileDir}`);
          }
        }
        if (exitConfirmedOnFail && fs.existsSync(failProfileDir)) {
          fs.rmSync(failProfileDir, { recursive: true, force: true });
        }
      }
    } catch (err) {
      startupErrThrown = true;
      assert.strictEqual(err.message, 'Simulated startup failure: CDP port unreachable');
    }

    assert.strictEqual(startupErrThrown, true, 'Startup failure error must bubble up');
    assert.strictEqual(exitConfirmedOnFail, true, 'Process exit must be confirmed before profile cleanup');
    assert.strictEqual(fs.existsSync(failProfileDir), false, 'Temporary profile must be cleaned after confirmed exit');

    // 4. If child process remains alive on failure, profile is preserved and PID + path reported
    const aliveProfileDir = path.resolve(__dirname, `../tmp/test-alive-fail-${Date.now()}`);
    fs.mkdirSync(aliveProfileDir, { recursive: true });
    let reportedPid = null;
    let reportedPath = null;
    let exitConfirmedWhenAlive = false;

    try {
      try {
        throw new Error('Simulated startup failure with unkillable process');
      } finally {
        if (mockHangingProc) {
          try {
            await waitForProcessExit(mockHangingProc, 150);
            exitConfirmedWhenAlive = true;
          } catch (exitErr) {
            reportedPid = mockHangingProc.pid;
            reportedPath = aliveProfileDir;
          }
        }
        if (exitConfirmedWhenAlive && fs.existsSync(aliveProfileDir)) {
          fs.rmSync(aliveProfileDir, { recursive: true, force: true });
        }
      }
    } catch {}

    assert.strictEqual(exitConfirmedWhenAlive, false, 'Exit must NOT be confirmed if process remains alive');
    assert.strictEqual(fs.existsSync(aliveProfileDir), true, 'Profile must be preserved when process remains alive');
    assert.strictEqual(reportedPid, process.pid, 'Must report the PID of un-exited process');
    assert.strictEqual(reportedPath, aliveProfileDir, 'Must report the preserved profile path');
    fs.rmSync(aliveProfileDir, { recursive: true, force: true });

    console.log('  ✅ Process exit verification and startup-failure profile cleanup verified\n');
  }

  // --------------------------------------------------------------------------
  // Test 4: Checkpoint and manifest counter consistency on failure and filter
  // --------------------------------------------------------------------------
  console.log('🔹 Test 4: Checkpoint & manifest consistency on terminal/skipped transitions');
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
  // Test 5: Item failure isolation and retry handling
  // --------------------------------------------------------------------------
  console.log('🔹 Test 5: Item failure does not contaminate next item execution');
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
  // Test 6: Loop-specific abort & resume preserves item/action cursor
  // --------------------------------------------------------------------------
  console.log('🔹 Test 6: Loop-specific abort & resume preserves item/action cursor');
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
  // Test 7: Terminal cleanup on stop/abort
  // --------------------------------------------------------------------------
  console.log('🔹 Test 7: Terminal resource release and manifest consistency on abort');
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
  // Test 8: Browser E2E validation against invoice portal fixture (if Chrome installed)
  // --------------------------------------------------------------------------
  console.log('🔹 Test 8: Four-item invoice portal E2E replay without stalling');
  await withTestChrome({ args: [PORTAL_URL] }, async ({ port }) => {
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

      const runner = new LoopReplayRunner({ cdpPort: port, runId });
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
    }
  });

  console.log('🎉 ALL LOOP RELIABILITY TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Loop reliability test suite failed:', err);
  process.exit(1);
});
