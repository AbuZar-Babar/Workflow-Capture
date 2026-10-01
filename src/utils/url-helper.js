/**
 * URL Resolution and Normalization Utility
 */

const fs = require('fs');
const path = require('path');

/**
 * Checks if a given URL is an internal browser URL (not a navigable web/file page)
 * @param {string} url
 * @returns {boolean}
 */
function isInternalBrowserUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed === 'about:blank' ||
    trimmed === 'about:newtab' ||
    trimmed.startsWith('chrome://') ||
    trimmed.startsWith('chrome-search://') ||
    trimmed.startsWith('chrome-extension://') ||
    trimmed.startsWith('about:') ||
    trimmed.startsWith('edge://') ||
    trimmed.startsWith('brave://') ||
    trimmed.startsWith('devtools://')
  );
}

/**
 * Resolves a workflow target URL to a valid navigable browser URL
 * @param {string} targetUrl - Raw target URL or file path from workflow metadata
 * @returns {string|null} Resolved navigable URL
 */
function resolveTargetUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  targetUrl = targetUrl.trim();
  if (!targetUrl || isInternalBrowserUrl(targetUrl)) return null;

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

/**
 * Robustly extracts the best starting URL from a workflow, recording, or action list
 * @param {Object} workflow
 * @returns {string|null}
 */
function extractWorkflowStartUrl(workflow) {
  if (!workflow) return null;

  const directCandidates = [
    workflow.targetUrl,
    workflow.recordingData?.metadata?.startUrl,
    workflow.metadata?.startUrl,
    workflow.startUrl
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === 'string' && !isInternalBrowserUrl(candidate)) {
      const resolved = resolveTargetUrl(candidate);
      if (resolved) return resolved;
    }
  }

  // Fall back to scanning actions/steps for a valid URL or href attribute
  const actions = workflow.actions || workflow.steps || workflow.recordingData?.actions || [];
  for (const act of actions) {
    if (!act) continue;
    const actionUrl = act.url || act.pageUrl || act.frame?.location;
    if (actionUrl && typeof actionUrl === 'string' && !isInternalBrowserUrl(actionUrl)) {
      const resolved = resolveTargetUrl(actionUrl);
      if (resolved) return resolved;
    }
    const href = act.target?.fingerprint?.attributes?.href;
    if (href && typeof href === 'string' && (href.startsWith('http://') || href.startsWith('https://'))) {
      const resolved = resolveTargetUrl(href);
      if (resolved) return resolved;
    }
  }

  return null;
}

module.exports = {
  isInternalBrowserUrl,
  resolveTargetUrl,
  extractWorkflowStartUrl
};
