/**
 * CDP Browser Connector Utility
 * 
 * Attaches puppeteer-core to an already running Chrome instance via CDP (e.g. localhost:9222)
 */

const puppeteer = require('puppeteer-core');
const { CDPConnectionError, TargetTabNotFoundError } = require('./errors');
const logger = require('./logger');

/**
 * Connect to an existing Chrome browser via CDP
 * @param {Object} options
 * @param {string} [options.browserURL='http://localhost:9222']
 * @param {string} [options.targetUrlSubstring]
 * @returns {Promise<{ browser: import('puppeteer-core').Browser, page: import('puppeteer-core').Page }>}
 */
async function connectToBrowser(options = {}) {
  const browserURL = options.browserURL || process.env.CHROME_DEBUG_URL || 'http://localhost:9222';

  logger.info(`Connecting to Chrome via CDP at ${browserURL}...`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL,
      defaultViewport: null // Keep existing browser viewport
    });
  } catch (err) {
    throw new CDPConnectionError(
      `Failed to connect to Chrome at ${browserURL}. Please ensure Chrome is running with '--remote-debugging-port=9222'.\n` +
      `Command: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\temp\\chrome-debug-profile"`,
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
  connectToBrowser
};
