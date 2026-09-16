/**
 * CDP Browser Connector Utility
 * 
 * Attaches puppeteer-core to an already running Chrome instance via CDP (e.g. localhost:9222).
 * Automatically launches Chrome with remote debugging enabled if not already running.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { CDPConnectionError } = require('./errors');
const logger = require('./logger');

/**
 * Locate Google Chrome executable path for the current OS
 */
function getChromeExecutablePath() {
  const platform = process.platform;
  if (platform === 'darwin') {
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
    return macPaths.find(p => fs.existsSync(p)) || null;
  }
  if (platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    return winPaths.find(p => fs.existsSync(p)) || 'chrome.exe';
  }
  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  return linuxPaths.find(p => fs.existsSync(p)) || 'google-chrome';
}

/**
 * Quick check if CDP port is responding
 */
async function isCDPResponding(port = 9222) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Auto-launch Chrome with remote debugging enabled if not already running
 */
async function ensureChromeRunning(port = 9222, defaultUrl = 'about:blank') {
  const isUp = await isCDPResponding(port);
  if (isUp) return true;

  const chromePath = getChromeExecutablePath();
  if (!chromePath) {
    logger.warn('Could not locate Google Chrome executable for auto-launch.');
    return false;
  }

  const profileDir = path.join(os.tmpdir(), 'chrome-debug-profile');
  logger.info(`Auto-launching Google Chrome with CDP on port ${port}...`);

  try {
    const child = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      defaultUrl
    ], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Wait up to 6 seconds for Chrome CDP to become responsive
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isCDPResponding(port)) {
        logger.success(`Google Chrome launched and CDP is active on port ${port}!`);
        return true;
      }
    }
  } catch (launchErr) {
    logger.error('Failed to auto-launch Chrome process:', launchErr);
  }

  return false;
}

/**
 * Connect to an existing Chrome browser via CDP (auto-launches Chrome if needed)
 * @param {Object} options
 * @param {string} [options.browserURL='http://localhost:9222']
 * @param {string} [options.targetUrlSubstring]
 * @returns {Promise<{ browser: import('puppeteer-core').Browser, page: import('puppeteer-core').Page }>}
 */
async function connectToBrowser(options = {}) {
  const browserURL = options.browserURL || process.env.CHROME_DEBUG_URL || 'http://localhost:9222';
  const urlObj = new URL(browserURL);
  const port = parseInt(urlObj.port || '9222', 10);

  // 1. Ensure Chrome is running with CDP
  const isAvailable = await isCDPResponding(port);
  if (!isAvailable) {
    logger.info(`Chrome CDP not detected on port ${port}. Attempting auto-launch...`);
    await ensureChromeRunning(port);
  }

  logger.info(`Connecting to Chrome via CDP at ${browserURL}...`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL,
      defaultViewport: null // Keep existing browser viewport
    });
  } catch (err) {
    throw new CDPConnectionError(
      `Failed to connect to Chrome at ${browserURL}. Please ensure Chrome is running.\n` +
      `Original error: ${err.message}`,
      { originalError: err.message, browserURL }
    );
  }

  logger.success('Connected to Chrome via CDP.');

  const pages = await browser.pages();
  let targetPage = null;

  if (options.targetUrlSubstring) {
    targetPage = pages.find(p => p.url().includes(options.targetUrlSubstring));
    if (!targetPage) {
      logger.warn(`No tab found matching '${options.targetUrlSubstring}'. Falling back to active tab.`);
    }
  }

  if (!targetPage) {
    // Find first non-empty, non-devtools page or active page
    targetPage = pages.find(p => !p.url().startsWith('devtools://') && !p.url().startsWith('chrome-extension://'));
  }

  if (!targetPage) {
    if (pages.length > 0) {
      targetPage = pages[0];
    } else {
      logger.info('No open tabs found. Creating a new tab...');
      targetPage = await browser.newPage();
    }
  }

  logger.info(`Attached to tab: ${targetPage.url() || 'about:blank'}`);

  return { browser, page: targetPage };
}

module.exports = {
  connectToBrowser,
  ensureChromeRunning,
  getChromeExecutablePath,
  isCDPResponding
};
