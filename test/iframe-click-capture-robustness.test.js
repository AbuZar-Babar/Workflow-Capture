/**
 * Automated Verification Test Suite:
 * Iframe Click Capture Robustness & Non-DOM Canvas Targets
 * 
 * Verifies:
 * (a) Injection succeeds in nested iframes (recursive walking & dynamic discovery)
 * (b) Click capture on toolbar icons inside iframes with mousedown-only or canvas rendering
 * (c) Verification stamp (window.__workflowCaptureLastPointerDown) populated in all frames
 * (d) No regressions on standard DOM click, type, and select capture
 * (e) Replay engine execution on canvas targets with relative normalized coordinates
 */

const http = require('http');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const RecorderBridge = require('../src/recorder/recorder-bridge');
const { getChromeExecutablePath } = require('../src/utils/cdp-connector');
const { executeClick } = require('../src/replay/action-executors');

const PORT = 8991;

// HTML Content for Nested Iframe (Level 2)
const INNER_IFRAME_HTML = `
<!DOCTYPE html>
<html>
<head><title>Report Viewer Frame</title></head>
<body style="margin: 0; padding: 10px;">
  <h3>DevExpress Report Toolbar</h3>
  <div id="toolbar" style="display: flex; gap: 8px; align-items: center;">
    <!-- DevExpress style toolbar item -->
    <li class="dxm-item" id="Toolbar_Export_Item" title="Export a report and save it to the disk">
      <div class="dxm-content">
        <img id="Toolbar_Export_Img" class="dxm-image" title="Export a report and save it to the disk" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="16" height="16" />
      </div>
    </li>

    <!-- Framework button that stops propagation on mousedown and suppresses click -->
    <button id="mousedown-only-btn" style="padding: 4px 8px;">Mousedown Only Button</button>

    <!-- Canvas rendered toolbar -->
    <canvas id="toolbar-canvas" width="200" height="40" style="border: none; margin: 0; padding: 0; cursor: pointer;"></canvas>
  </div>

  <script>
    // Mousedown-only handler: stops immediate propagation and prevents default click
    const mousedownBtn = document.getElementById('mousedown-only-btn');
    mousedownBtn.addEventListener('mousedown', function(e) {
      window.__mousedownOnlyTriggered = true;
      e.stopImmediatePropagation();
    }, true);

    // Canvas click tracker
    const canvas = document.getElementById('toolbar-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 200, 40);
    ctx.fillStyle = '#1e293b';
    ctx.font = '12px sans-serif';
    ctx.fillText('Canvas Toolbar Button', 10, 25);

    canvas.addEventListener('click', function(e) {
      const rect = canvas.getBoundingClientRect();
      window.__canvasClickedAt = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: Date.now()
      };
    });
  </script>
</body>
</html>
`;

// HTML Content for Outer Iframe (Level 1)
const OUTER_IFRAME_HTML = `
<!DOCTYPE html>
<html>
<head><title>Outer Frame</title></head>
<body style="margin: 0; padding: 10px;">
  <h2>Outer Container Frame</h2>
  <iframe id="inner-report-frame" name="InvoiceMainReport_Inner" src="/inner-frame" width="500" height="250"></iframe>
</body>
</html>
`;

// HTML Content for Main Page (Level 0)
const MAIN_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Main Application</title></head>
<body style="font-family: sans-serif; padding: 20px;">
  <h1>Main Page with Nested Report Viewer</h1>

  <div id="form-section" style="margin-bottom: 20px;">
    <input id="username-input" type="text" placeholder="Enter username" />
    <select id="role-select">
      <option value="admin">Administrator</option>
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
    <button id="standard-btn">Standard Click</button>
  </div>

  <div id="iframe-container">
    <iframe id="outer-frame" name="ReportSplitter_ContentFrame" src="/outer-frame" width="600" height="350"></iframe>
  </div>

  <div id="late-iframe-container" style="margin-top: 20px;"></div>
  <script>
    // Simulate late dynamic iframe mounting after 1.5 seconds
    setTimeout(() => {
      const lateIframe = document.createElement('iframe');
      lateIframe.id = 'late-mounted-iframe';
      lateIframe.name = 'LateMountedReportViewer';
      lateIframe.src = '/inner-frame';
      lateIframe.width = '500';
      lateIframe.height = '150';
      document.getElementById('late-iframe-container').appendChild(lateIframe);
    }, 1200);
  </script>
</body>
</html>
`;

async function runTestSuite() {
  console.log('🧪 Starting Iframe Click Capture Robustness & Canvas Test Suite...\n');

  // 1. Start Mock HTTP Server
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(MAIN_PAGE_HTML);
    } else if (req.url === '/outer-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(OUTER_IFRAME_HTML);
    } else if (req.url === '/inner-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(INNER_IFRAME_HTML);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(r => server.listen(PORT, r));

  const chromePath = getChromeExecutablePath();
  assert(chromePath, 'Google Chrome executable must be present on system');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });

    // 2. Initialize RecorderBridge and attach to the page
    const recorder = new RecorderBridge({
      name: 'test-iframe-capture-robustness',
      browserURL: null
    });
    recorder.browser = browser;
    recorder.page = page;
    recorder.isRecording = true;
    recorder.actions = [];
    recorder.startUrl = page.url();
    recorder.startedAt = new Date().toISOString();
    recorder._sessionId = `test_sess_${Date.now()}`;
    RecorderBridge._activeInstances.add(recorder);

    const pathMod = require('path');
    const fs = require('fs');
    recorder._resolverCode = fs.readFileSync(pathMod.resolve(__dirname, '../src/shared/selector-resolver.js'), 'utf8');
    recorder._recorderCode = fs.readFileSync(pathMod.resolve(__dirname, '../src/recorder/recorder-injected.js'), 'utf8');
    recorder._unifiedScript = `${recorder._resolverCode}\n;\nwindow.__workflowCaptureSessionId = "${recorder._sessionId}";\n${recorder._recorderCode}`;
    recorder._attachedPages = new Set();
    recorder._pageCleanups = [];
    recorder._handledUids = new Set();

    await recorder._attachToPage(page);
    recorder._startFrameSweepLoop();

    // Give bridge and sweep loop time to discover and inject all frames
    await new Promise(r => setTimeout(r, 600));

    // =========================================================================
    // Test 1: Nested Iframe Injection Verification
    // =========================================================================
    console.log('🔹 Test 1: Nested iframe injection & recursive readiness');
    const frames = page.frames();
    const innerFrame = frames.find(f => f.name() === 'InvoiceMainReport_Inner' || f.url().includes('inner-frame'));
    assert(innerFrame, 'Inner nested iframe must be discovered');

    const isInnerReady = await innerFrame.evaluate(() => (
      window.__workflowCaptureReady === true &&
      document.__workflowCaptureDocReady === true
    ));
    assert.strictEqual(isInnerReady, true, 'Inner iframe must have recorder initialized');
    console.log('  ✅ Nested iframe successfully injected and ready!\n');

    // =========================================================================
    // Test 2: Mousedown-Only Button Capture inside Nested Iframe
    // =========================================================================
    console.log('🔹 Test 2: Mousedown-only button capture (stopImmediatePropagation)');
    const mousedownBtn = await innerFrame.$('#mousedown-only-btn');
    assert(mousedownBtn, '#mousedown-only-btn must exist in inner frame');

    const actionsBeforeMousedown = recorder.actions.length;
    // Dispatch mousedown directly (simulating custom framework capture)
    await innerFrame.evaluate(() => {
      const btn = document.getElementById('mousedown-only-btn');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await new Promise(r => setTimeout(r, 100));

    const mousedownActions = recorder.actions.slice(actionsBeforeMousedown);
    assert.strictEqual(mousedownActions.length, 1, 'Exactly one CLICK action should be emitted for mousedown button');
    assert.strictEqual(mousedownActions[0].type, 'CLICK', 'Action type must be CLICK');
    assert(mousedownActions[0].target.candidates.some(c => c.value.includes('mousedown-only-btn')), 'Target selector must resolve mousedown button');
    console.log('  ✅ Mousedown-only button captured as CLICK action!\n');

    // =========================================================================
    // Test 3: Verification Stamp (__workflowCaptureLastPointerDown) in Frame
    // =========================================================================
    console.log('🔹 Test 3: Diagnostic stamp window.__workflowCaptureLastPointerDown');
    const lastPointerDown = await innerFrame.evaluate(() => window.__workflowCaptureLastPointerDown);
    assert(lastPointerDown, 'window.__workflowCaptureLastPointerDown must be stamped');
    assert.strictEqual(lastPointerDown.tag, 'BUTTON');
    assert.strictEqual(lastPointerDown.id, 'mousedown-only-btn');
    assert.strictEqual(lastPointerDown.isIframe, true);
    console.log('  ✅ Diagnostic pointerdown stamp verified:', lastPointerDown);
    console.log('  ✅ PointerDown stamp successfully verified!\n');

    // =========================================================================
    // Test 4: Canvas Target Capture with Normalized Relative Coordinates
    // =========================================================================
    console.log('🔹 Test 4: Canvas target click with relative coordinates (0-1 normalized)');
    const canvasElem = await innerFrame.$('#toolbar-canvas');
    assert(canvasElem, 'Canvas toolbar element must exist in inner frame');

    const actionsBeforeCanvas = recorder.actions.length;
    // Simulate pointerdown and click on canvas at (50, 20) -> relative (50/200 = 0.25, 20/40 = 0.50)
    await innerFrame.evaluate(() => {
      const cvs = document.getElementById('toolbar-canvas');
      const rect = cvs.getBoundingClientRect();
      const evt = new MouseEvent('pointerdown', {
        clientX: rect.left + 50,
        clientY: rect.top + 20,
        bubbles: true
      });
      cvs.dispatchEvent(evt);
    });
    await new Promise(r => setTimeout(r, 100));

    const canvasActions = recorder.actions.slice(actionsBeforeCanvas);
    assert.strictEqual(canvasActions.length, 1, 'Exactly one CLICK action should be captured on canvas');
    const canvasAction = canvasActions[0];
    assert.strictEqual(canvasAction.type, 'CLICK');
    assert(canvasAction.target.canvasCoords, 'Target must have canvasCoords payload');
    assert(Math.abs(canvasAction.target.canvasCoords.relX - 0.25) <= 0.02, `relX should be ~0.25 (got ${canvasAction.target.canvasCoords.relX})`);
    assert(Math.abs(canvasAction.target.canvasCoords.relY - 0.5) <= 0.02, `relY should be ~0.5 (got ${canvasAction.target.canvasCoords.relY})`);
    assert(canvasAction.target.canvasCoords.canvasWidth >= 200, 'canvasWidth should be >= 200');
    assert(canvasAction.target.canvasCoords.canvasHeight >= 40, 'canvasHeight should be >= 40');
    console.log('  ✅ Canvas click captured with normalized coords:', canvasAction.target.canvasCoords);
    console.log('  ✅ Canvas relative coordinate capture passed!\n');

    // =========================================================================
    // Test 5: DevExpress Toolbar Icon Capture inside Nested Iframe
    // =========================================================================
    console.log('🔹 Test 5: DevExpress Toolbar Save Icon capture inside nested iframe');
    const actionsBeforeToolbar = recorder.actions.length;
    const exportIcon = await innerFrame.$('img[title="Export a report and save it to the disk"]');
    assert(exportIcon, 'Export icon must exist');
    await exportIcon.click();
    await new Promise(r => setTimeout(r, 100));

    const toolbarActions = recorder.actions.slice(actionsBeforeToolbar);
    assert.strictEqual(toolbarActions.length, 1, 'Exactly one CLICK action captured for toolbar icon');
    const tbAction = toolbarActions[0];
    assert(tbAction.target.candidates.some(c => c.value.includes('Export') && c.value.includes('save')), 'Selector must identify export title');
    console.log('  ✅ Toolbar icon click captured:', tbAction.target.candidates[0].value);
    console.log('  ✅ DevExpress toolbar icon capture passed!\n');

    // =========================================================================
    // Test 6: Standard DOM Element Capture & Deduplication (No Regressions)
    // =========================================================================
    console.log('🔹 Test 6: Standard DOM elements (CLICK, TYPE, SELECT) regression verification');
    
    // (a) Normal button click deduplication
    const actionsBeforeStdBtn = recorder.actions.length;
    const stdBtn = await page.$('#standard-btn');
    await stdBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const btnActions = recorder.actions.slice(actionsBeforeStdBtn);
    assert.strictEqual(btnActions.length, 1, 'Standard button click must emit exactly one CLICK action (no duplicates)');

    // (b) Normal typing
    const actionsBeforeType = recorder.actions.length;
    const usernameInput = await page.$('#username-input');
    await usernameInput.type('testuser');
    await page.keyboard.press('Tab'); // Trigger blur / flush
    await new Promise(r => setTimeout(r, 100));
    const typeActions = recorder.actions.slice(actionsBeforeType);
    assert(typeActions.some(a => a.type === 'TYPE' && a.value === 'testuser'), 'TYPE action must be captured with typed value');

    // (c) Normal select dropdown
    const actionsBeforeSelect = recorder.actions.length;
    await page.select('#role-select', 'editor');
    await new Promise(r => setTimeout(r, 100));
    const selectActions = recorder.actions.slice(actionsBeforeSelect);
    assert(selectActions.some(a => a.type === 'SELECT' && a.value === 'editor'), 'SELECT action must be captured');

    console.log('  ✅ Normal DOM elements (click, type, select) all captured with 0 regressions!\n');

    // =========================================================================
    // Test 7: Late-Mounted Dynamic Iframe Injection (10s Schedule & Sweep)
    // =========================================================================
    console.log('🔹 Test 7: Late-mounted dynamic iframe discovery & injection');
    // Wait for late-mounted iframe (mounted at 1200ms) to be swept and injected
    let lateFrameInjected = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const lateFrame = page.frames().find(f => f.name() === 'LateMountedReportViewer');
      if (lateFrame) {
        lateFrameInjected = await lateFrame.evaluate(() => window.__workflowCaptureReady === true).catch(() => false);
        if (lateFrameInjected) break;
      }
    }
    assert.strictEqual(lateFrameInjected, true, 'Late mounted iframe must be discovered and injected by sweep loop');
    console.log('  ✅ Late mounted iframe automatically detected and injected!\n');

    // =========================================================================
    // Test 8: Replay Execution on Canvas Target with canvasCoords
    // =========================================================================
    console.log('🔹 Test 8: Replay execution on Canvas target using canvasCoords');
    const mockCanvasAction = {
      index: 0,
      type: 'CLICK',
      target: {
        canvasCoords: { relX: 0.25, relY: 0.5 }
      }
    };
    await executeClick(canvasElem, mockCanvasAction, { page, botConfig: null });
    const clickedAt = await innerFrame.evaluate(() => window.__canvasClickedAt);
    assert(clickedAt, 'Canvas click event listener should have received replay click');
    assert(Math.abs(clickedAt.x - 50) <= 2, `Clicked X should be ~50 (got ${clickedAt.x})`);
    assert(Math.abs(clickedAt.y - 20) <= 2, `Clicked Y should be ~20 (got ${clickedAt.y})`);
    console.log(`  ✅ Replay successfully clicked canvas at (${clickedAt.x}, ${clickedAt.y})!`);

    await recorder.stop();
    console.log('\n🎉 ALL IFRAME CAPTURE ROBUSTNESS TESTS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
    server.close();
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
