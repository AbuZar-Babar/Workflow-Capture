/**
 * URL Resolution and Normalization Utility
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolves a workflow target URL to a valid navigable browser URL
 * @param {string} targetUrl - Raw target URL or file path from workflow metadata
 * @returns {string|null} Resolved navigable URL
 */
function resolveTargetUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  targetUrl = targetUrl.trim();
  if (!targetUrl || targetUrl === 'about:blank') return null;

  // Handle local mock test files with file: protocol
  if (targetUrl.startsWith('file:')) {
    try {
      const parsed = new URL(targetUrl);
      const baseName = path.basename(parsed.pathname);
      const localTestPath = path.resolve(process.cwd(), 'test', baseName);
      if (fs.existsSync(localTestPath)) {
        return `file:///${localTestPath.replace(/\\/g, '/')}`;
      }
    } catch {
      const baseName = path.basename(targetUrl.replace(/^file:\/\/\/?/, ''));
      const localTestPath = path.resolve(process.cwd(), 'test', baseName);
      if (fs.existsSync(localTestPath)) {
        return `file:///${localTestPath.replace(/\\/g, '/')}`;
      }
    }
    return targetUrl;
  }

  // Handle local HTML filenames or relative test paths (e.g. test/ecommerce-portal.html)
  if (targetUrl.endsWith('.html') && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    const directPath = path.resolve(process.cwd(), targetUrl);
    if (fs.existsSync(directPath)) {
      return `file:///${directPath.replace(/\\/g, '/')}`;
    }
    const testPath = path.resolve(process.cwd(), 'test', path.basename(targetUrl));
    if (fs.existsSync(testPath)) {
      return `file:///${testPath.replace(/\\/g, '/')}`;
    }
  }

  // Handle bare domain without protocol (e.g. google.com or news.ycombinator.com)
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
    if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
      return `https://${targetUrl}`;
    }
  }

  return targetUrl;
}

module.exports = {
  resolveTargetUrl
};
