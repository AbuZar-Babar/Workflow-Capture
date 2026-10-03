/**
 * Workflow Capture — Centralized DOM & String Utilities
 */

/**
 * Escapes unsafe HTML characters to prevent XSS injection.
 * @param {*} str - String or value to escape
 * @returns {string} Safe HTML string
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/**
 * Formats a byte number into a human-readable size string.
 * @param {number} bytes 
 * @returns {string} e.g. "1.2 MB"
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Extracts clean domain name from URL string.
 * @param {string} urlStr 
 * @returns {string} e.g. "usoil.com"
 */
export function extractDomain(urlStr) {
  if (!urlStr) return 'General Portal';
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return urlStr;
  }
}

/**
 * Formats an ISO date string or timestamp into a localized relative or absolute date.
 * @param {string|number|Date} dateVal 
 * @returns {string} e.g. "2 hours ago" or "Oct 3, 2026"
 */
export function formatRelativeTime(dateVal) {
  if (!dateVal) return 'Never';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'Invalid date';

  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
