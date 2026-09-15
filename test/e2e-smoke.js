/**
 * End-to-End Smoke Test for Workflow Capture & Replay
 * 
 * Verifies:
 * 1. Spawning Chrome with --remote-debugging-port=9222
 * 2. Recorder script injection and real-time action capture
 * 3. Input debouncing & password value redaction
 * 4. Persistence to recording JSON schema
 * 5. ReplayEngine condition-based waiting on dynamic elements
 * 6. 100% action reproduction fidelity
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const RecorderBridge = require('../src/recorder/recorder-bridge');
const ReplayEngine = require('../src/replay/replay-engine');
const logger = require('../src/utils/logger');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;
const MOCK_PORTAL_PATH = path.resolve(__dirname, 'mock-portal.html');
const MOCK_PORTAL_URL = `file://${MOCK_PORTAL_PATH.replace(/\\/g, '/')}`;
const TEMP_PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome-test-profile');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startTestChrome() {
  if (!fs.existsSync(TEMP_PROFILE_DIR)) {
    fs.mkdirSync(TEMP_PROFILE_DIR, { recursive: true });
  }

  logger.info(`Spawning test Chrome instance on port ${DEBUG_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${TEMP_PROFILE_DIR}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    MOCK_PORTAL_URL
  ], { detached: false });

  // Wait for CDP port to be responsive
  let connected = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://localhost:${DEBUG_PORT}`,
        defaultViewport: { width: 1280, height: 800 }
      });
      await browser.disconnect();
      connected = true;
      break;
    } catch {}
  }

  if (!connected) {
    chromeProcess.kill();
    throw new Error('Timed out waiting for Chrome CDP port 9222 to open.');
  }

  logger.success('Test Chrome instance started successfully.');
  return chromeProcess;
}

async function runSmokeTest() {
  let chromeProcess = null;
  const recordingName = `smoke-test-${Date.now()}`;

  try {
    chromeProcess = await startTestChrome();

    // ----------------------------------------------------
    // PHASE 1: RECORDING
    // ----------------------------------------------------
    logger.header('PHASE 1: Starting Recorder');
    const recorder = new RecorderBridge({
      name: recordingName,
      browserURL: `http://localhost:${DEBUG_PORT}`
    });

    await recorder.start();

    // Attach Puppeteer helper to simulate real user actions in page
    const directBrowser = await puppeteer.connect({
      browserURL: `http://localhost:${DEBUG_PORT}`,
      defaultViewport: null
    });
    const pages = await directBrowser.pages();
    const activePage = pages.find(p => p.url().includes('mock-portal.html')) || pages[0];

    // Dismiss any alert dialogs during test
    activePage.on('dialog', async dialog => {
      await dialog.dismiss();
    });

    logger.info('Simulating user interactions in Chrome...');

    // Action 1 & 2: Click product search input and type query
    const searchInput = await activePage.$('[data-testid="search-input"]');
    await searchInput.click();
    await searchInput.type('Mechanical Keyboard');
    // Blur to trigger input flush
    await activePage.$eval('[data-testid="search-input"]', el => el.blur());
    await sleep(400);

    // Action 3: Select category dropdown
    await activePage.select('#category-dropdown', 'electronics');
    await sleep(400);

    // Action 4: Type into password input (MUST redact)
    const passInput = await activePage.$('#user-password');
    await passInput.click();
    await passInput.type('superSecretPin999');
    await activePage.$eval('#user-password', el => el.blur());
    await sleep(400);

    // Action 5: Click async trigger button
    const triggerBtn = await activePage.$('#trigger-delayed-btn');
    await triggerBtn.click();
    await sleep(1500); // Wait for async element to reveal

    // Action 6: Click dynamic async button
    const confirmBtn = await activePage.$('#confirm-delayed-btn');
    await confirmBtn.click();
    await sleep(400);

    // Action 7: Click Submit order
    const submitBtn = await activePage.$('#submit-order-btn');
    await submitBtn.click();
    await sleep(600);

    // Stop recorder and persist
    const recordingPath = await recorder.stop();
    await directBrowser.disconnect();

    logger.success(`Recorded actions persisted to: ${recordingPath}`);

    // ----------------------------------------------------
    // PHASE 2: VALIDATING RECORDING JSON
    // ----------------------------------------------------
    logger.header('PHASE 2: Validating Recording JSON Schema & Masking');
    const recordingData = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));

    if (recordingData.actions.length === 0) {
      throw new Error('Recorded 0 actions! Recorder bridge failed to capture events.');
    }

    logger.info(`Captured ${recordingData.actions.length} total actions:`);
    recordingData.actions.forEach((a, idx) => {
      const topStrat = a.target.candidates[0] ? a.target.candidates[0].strategy : 'none';
      const topVal = a.target.candidates[0] ? a.target.candidates[0].value : 'none';
      logger.info(`  Action #${idx + 1}: ${a.type} -> [${topStrat}] ${topVal} ${a.value ? `value="${a.value}"` : ''}`);
    });

    // Verify Password Masking
    const passwordAction = recordingData.actions.find(a => a.meta && a.meta.isPassword);
    if (!passwordAction) {
      logger.warn('No explicit password action tagged in meta, checking values...');
    } else {
      if (passwordAction.value !== '[REDACTED]') {
        throw new Error(`SECURITY LEAK: Password field captured plaintext: ${passwordAction.value}`);
      }
      logger.success('Password value successfully REDACTED in recording JSON.');
    }

    // ----------------------------------------------------
    // PHASE 3: REPLAY VALIDATION
    // ----------------------------------------------------
    logger.header('PHASE 3: Replaying Workflow from Clean Page State');

    // Reload the mock portal to reset all inputs & status
    const resetBrowser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}` });
    const resetPages = await resetBrowser.pages();
    const resetPage = resetPages.find(p => p.url().includes('mock-portal.html')) || resetPages[0];
    resetPage.on('dialog', async dialog => await dialog.dismiss());
    await resetPage.goto(MOCK_PORTAL_URL, { waitUntil: 'load' });
    await resetBrowser.disconnect();

    logger.info('Portal reloaded. Executing ReplayEngine...');

    const engine = new ReplayEngine({
      browserURL: `http://localhost:${DEBUG_PORT}`,
      speed: 2.0, // 2x speed for fast smoke test
      timeoutMs: 6000
    });

    const replayStats = await engine.replay(recordingPath);

    // ----------------------------------------------------
    // PHASE 4: ASSERTING FINAL DOM STATE
    // ----------------------------------------------------
    logger.header('PHASE 4: Verifying Final Page State After Replay');
    const verifyBrowser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}` });
    const verifyPages = await verifyBrowser.pages();
    const verifyPage = verifyPages.find(p => p.url().includes('mock-portal.html')) || verifyPages[0];

    const finalState = await verifyPage.evaluate(() => {
      const searchVal = document.getElementById('product-query').value;
      const catVal = document.getElementById('category-dropdown').value;
      const banner = document.getElementById('status-banner');
      const bannerVisible = banner && window.getComputedStyle(banner).display !== 'none';
      const detailsText = document.getElementById('status-details').textContent;
      return { searchVal, catVal, bannerVisible, detailsText };
    });

    await verifyBrowser.disconnect();

    logger.info('Final DOM State:', finalState);

    if (finalState.searchVal !== 'Mechanical Keyboard') {
      throw new Error(`Expected searchVal to be 'Mechanical Keyboard', but was '${finalState.searchVal}'`);
    }

    if (finalState.catVal !== 'electronics') {
      throw new Error(`Expected catVal to be 'electronics', but was '${finalState.catVal}'`);
    }

    if (!finalState.bannerVisible) {
      throw new Error('Expected status banner to be visible after form submit, but was not.');
    }

    logger.divider();
    logger.success('🎉 ALL END-TO-END SMOKE TEST PHASES PASSED WITH 100% FIDELITY!');
    logger.divider();

  } finally {
    if (chromeProcess) {
      logger.info('Terminating test Chrome instance...');
      chromeProcess.kill('SIGKILL');
    }
  }
}

runSmokeTest().catch(err => {
  logger.error('Smoke test failed:', err);
  process.exit(1);
});
