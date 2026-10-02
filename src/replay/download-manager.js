/**
 * Workflow Capture — Dedicated Download Manager & Validation Engine
 * 
 * Enforces strict per-execution folder isolation:
 * downloads/<workflow-name>/<execution-id>/
 * 
 * Never mixes files across executions.
 * Validates actual file receipt (existence, size > 0, completion of .crdownload/.tmp).
 * Maintains execution metadata and per-item download receipts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { db } = require('../database/db');

function formatRunTimestamp(date = new Date()) {
  if (typeof date === 'string') {
    const s = date.trim();
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
      return s.replace('T', '_').replace(/:/g, '-').split('.')[0];
    }
  }
  const d = (date instanceof Date) ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

function extractPortalDomain(inputUrl) {
  if (!inputUrl) return 'customerportal.usoil.com';
  const str = String(inputUrl).trim();
  try {
    const parsed = new URL(str.startsWith('http://') || str.startsWith('https://') ? str : `https://${str}`);
    if (parsed.hostname && parsed.hostname !== 'localhost') {
      return parsed.hostname;
    }
    if (parsed.hostname === 'localhost' && !str.includes('localhost')) {
      const domainPart = str.split('/')[0];
      if (domainPart.includes('.')) return domainPart;
    }
    return parsed.hostname || 'customerportal.usoil.com';
  } catch {
    const match = str.match(/([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z0-9]{2,}/);
    return match ? match[0] : 'customerportal.usoil.com';
  }
}

class DownloadManager {
  /**
   * @param {object} options
   * @param {string} options.workflowSlug - Sanitized workflow name
   * @param {string} options.executionId - Unique run / execution ID
   * @param {string} [options.workflowId] - Optional workflow ID
   * @param {string} [options.baseDownloadsDir] - Custom base downloads directory
   * @param {string} [options.portalDomain] - Portal domain / hostname (e.g. customerportal.usoil.com)
   * @param {string} [options.portalUrl] - Portal URL to extract domain from
   * @param {string} [options.runTimestamp] - Formatted execution timestamp (YYYY-MM-DD_HH-mm-ss)
   * @param {string} [options.baseRunDir] - Custom base Run/ directory
   */
  constructor(options = {}) {
    const rawSlug = String(options.workflowSlug || options.workflowName || 'workflow').toLowerCase();
    this.workflowSlug = rawSlug.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
    this.executionId = options.executionId || options.runId || `exec_${Date.now()}`;
    this.workflowId = options.workflowId || null;

    // Dedicated per-execution downloads isolation: downloads/<workflow-slug>/<execution-id>/
    const baseDir = options.baseDownloadsDir || path.resolve(process.cwd(), 'downloads');
    this.executionDirectory = path.resolve(baseDir, this.workflowSlug, this.executionId);
    this.manifestPath = path.join(this.executionDirectory, 'manifest.json');

    // Structured Run/ hierarchy: Run/<YYYY-MM-DD_HH-mm-ss>/<portal_domain>/<Category>/
    this.runTimestamp = options.runTimestamp || formatRunTimestamp(options.startedAt || new Date());
    this.portalDomain = extractPortalDomain(options.portalDomain || options.portalUrl || options.targetUrl || options.startUrl || 'customerportal.usoil.com');
    this.baseRunDir = options.baseRunDir || path.resolve(process.cwd(), 'Run');
    this.runTimestampDir = path.resolve(this.baseRunDir, this.runTimestamp);
    this.runDomainDir = path.resolve(this.runTimestampDir, this.portalDomain);

    this.startedAt = new Date().toISOString();
    this.completedAt = null;
    this.files = [];
    this.successCount = 0;
    this.failureCount = 0;

    this._initDirectory();
  }

  _initDirectory() {
    if (!fs.existsSync(this.executionDirectory)) {
      fs.mkdirSync(this.executionDirectory, { recursive: true });
    }
    if (!fs.existsSync(this.runDomainDir)) {
      fs.mkdirSync(this.runDomainDir, { recursive: true });
    }
    this._saveManifest();
  }

  /**
   * Get the isolated target directory for this execution.
   */
  getDirectory() {
    return this.executionDirectory;
  }

  /**
   * Get the Run/ category directory (ensuring it exists)
   * e.g. Run/2026-10-02_03-42-18/customerportal.usoil.com/Invoices/
   */
  getRunCategoryDirectory(category = 'Invoices') {
    const cat = category || 'Invoices';
    const catDir = path.join(this.runDomainDir, cat);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
    return catDir;
  }

  /**
   * Infer category folder name (e.g. "Invoices", "Payments", "Receipts") from item metadata
   */
  inferCategory(filename = '', itemFields = {}, defaultCategory = 'Invoices') {
    const rawType = (
      itemFields.category ||
      itemFields.Category ||
      itemFields['Document Type'] ||
      itemFields['Type'] ||
      itemFields.type ||
      itemFields.documentType ||
      ''
    ).trim();

    if (/invoice/i.test(rawType)) return 'Invoices';
    if (/payment/i.test(rawType)) return 'Payments';
    if (/receipt/i.test(rawType)) return 'Receipts';
    if (/statement/i.test(rawType)) return 'Statements';
    if (/voucher/i.test(rawType)) return 'Vouchers';
    if (/bill/i.test(rawType)) return 'Bills';
    if (/credit\s*memo/i.test(rawType)) return 'Credit Memos';
    if (/order/i.test(rawType)) return 'Orders';
    if (/report/i.test(rawType)) return 'Reports';

    const fn = String(filename || '');
    if (/^PAY-|^PAYMENT|payment/i.test(fn)) return 'Payments';
    if (/^INV-|^INVOICE|invoice/i.test(fn)) return 'Invoices';
    if (/^REC-|^RECEIPT|receipt/i.test(fn)) return 'Receipts';
    if (/^STMT-|^STATEMENT|statement/i.test(fn)) return 'Statements';
    if (/^VOUCH-|^VOUCHER|voucher/i.test(fn)) return 'Vouchers';
    if (/^BILL-|bill/i.test(fn)) return 'Bills';

    if (/payment/i.test(this.workflowSlug)) return 'Payments';
    if (/invoice/i.test(this.workflowSlug)) return 'Invoices';
    if (/voucher/i.test(this.workflowSlug)) return 'Vouchers';

    if (rawType) {
      const cleaned = rawType.replace(/[^a-zA-Z0-9_\s]/g, '').trim();
      if (cleaned) {
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
    }

    return defaultCategory;
  }

  /**
   * Format meaningful artifact filename from item fields:
   * e.g. INV-10234_ACME_2026-09-30.pdf, PAY-88321_2026-09-30.pdf
   */
  formatItemFilename(originalFilename = '', itemFields = {}, fallbackItemKey = '') {
    const raw = String(originalFilename || '').trim();
    const ext = path.extname(raw) || '.pdf';
    const base = path.basename(raw, ext);

    // If filename already matches the structured format <ID>_<ENTITY>_<DATE>.pdf or <ID>_<DATE>.pdf
    if (/^[A-Z0-9]+-[A-Z0-9]+(?:_[A-Z0-9]+)?_\d{4}-\d{2}-\d{2}$/i.test(base)) {
      return `${base}${ext}`;
    }

    // 1. Extract ID (e.g. INV-10234, PAY-88321, etc.)
    let docId = (
      itemFields['Invoice Number'] ||
      itemFields['Invoice No'] ||
      itemFields['Invoice'] ||
      itemFields['Payment ID'] ||
      itemFields['Payment No'] ||
      itemFields['Payment'] ||
      itemFields['Voucher ID'] ||
      itemFields['Voucher No'] ||
      itemFields['ID'] ||
      itemFields['id'] ||
      itemFields['Item ID'] ||
      itemFields['Number'] ||
      ''
    ).trim();

    if (!docId) {
      const match = (raw + ' ' + (fallbackItemKey || '')).match(/\b((?:INV|PAY|REC|STMT|VOUCH|SI|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
      if (match) {
        docId = match[1].toUpperCase();
      }
    }

    // 2. Extract Customer / Account / Vendor
    let customer = (
      itemFields['Customer'] ||
      itemFields['Customer Name'] ||
      itemFields['Account'] ||
      itemFields['Account Name'] ||
      itemFields['Vendor'] ||
      itemFields['Client'] ||
      itemFields['Company'] ||
      ''
    ).trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();

    // 3. Extract or format Date (YYYY-MM-DD)
    let dateStr = (
      itemFields['Date'] ||
      itemFields['Invoice Date'] ||
      itemFields['Payment Date'] ||
      itemFields['Due Date'] ||
      ''
    ).trim();

    if (dateStr) {
      const dMatch = dateStr.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/) ||
                     dateStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (dMatch) {
        if (dMatch[1].length === 4) {
          dateStr = `${dMatch[1]}-${String(dMatch[2]).padStart(2, '0')}-${String(dMatch[3]).padStart(2, '0')}`;
        } else {
          dateStr = `${dMatch[3]}-${String(dMatch[1]).padStart(2, '0')}-${String(dMatch[2]).padStart(2, '0')}`;
        }
      }
    }

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateStr = this.runTimestamp.split('_')[0] || new Date().toISOString().split('T')[0];
    }

    // 4. Assemble clean structured filename
    if (docId) {
      const cleanDocId = docId.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
      if (customer) {
        return `${cleanDocId}_${customer}_${dateStr}${ext}`;
      } else {
        return `${cleanDocId}_${dateStr}${ext}`;
      }
    }

    return raw || `artifact_${Date.now()}${ext}`;
  }

  /**
   * Organize downloaded file into the exact Run/ hierarchy:
   * Run/<runTimestamp>/<portalDomain>/<Category>/<formattedFilename>
   */
  organizeRunArtifact(sourcePath, itemKey = null, itemLabel = null, itemFields = {}) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;

    const originalFilename = path.basename(sourcePath);
    if (originalFilename.endsWith('.crdownload') || originalFilename.endsWith('.tmp')) return null;

    const category = this.inferCategory(originalFilename, itemFields);
    const targetFilename = this.formatItemFilename(originalFilename, itemFields, itemKey);
    const categoryDir = path.join(this.runDomainDir, category);

    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const destPath = path.join(categoryDir, targetFilename);
    fs.copyFileSync(sourcePath, destPath);

    const relativeRunPath = path.relative(process.cwd(), destPath).replace(/\\/g, '/');

    return {
      targetFilename,
      category,
      categoryDir,
      fullPath: destPath,
      relativeRunPath
    };
  }

  /**
   * Save execution manifest metadata.
   */
  _saveManifest() {
    const metadata = {
      executionId: this.executionId,
      workflowId: this.workflowId,
      workflowSlug: this.workflowSlug,
      runTimestamp: this.runTimestamp,
      portalDomain: this.portalDomain,
      runDirectory: this.runDomainDir,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      directory: this.executionDirectory,
      successCount: this.successCount,
      failureCount: this.failureCount,
      files: this.files
    };

    try {
      fs.writeFileSync(this.manifestPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (err) {
      logger.warn(`[DownloadManager] Failed to write manifest: ${err.message}`);
    }
  }

  /**
   * Reads existing files in the execution directory.
   */
  listExistingFiles() {
    try {
      if (!fs.existsSync(this.executionDirectory)) return new Set();
      return new Set(fs.readdirSync(this.executionDirectory).filter(f => f !== 'manifest.json'));
    } catch {
      return new Set();
    }
  }

  /**
   * Waits for a download to complete after an action trigger and validates the downloaded file.
   * Handles .crdownload, .tmp, empty files, and timeouts.
   *
   * @param {object} options
   * @param {Set<string>} [options.knownFilesBefore] - Snapshot of directory before trigger
   * @param {number} [options.timeoutMs] - Timeout in milliseconds (default: 15000)
   * @param {string} [options.expectedName] - Optional expected filename
   * @returns {Promise<{
   *   success: boolean,
   *   filename: string|null,
   *   filePath: string|null,
   *   size: number,
   *   error: string|null
   * }>}
   */
  async waitForDownloadCompletion(options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const knownFiles = options.knownFilesBefore || new Set();
    const startTime = Date.now();
    const pollInterval = 250;

    let targetFile = null;

    while (Date.now() - startTime < timeoutMs) {
      let currentFiles = [];
      try {
        currentFiles = fs.readdirSync(this.executionDirectory).filter(f => f !== 'manifest.json');
      } catch {
        currentFiles = [];
      }

      // Check for temporary / in-progress browser download files
      const hasTempFiles = currentFiles.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp') || f.endsWith('.download'));

      // Find any newly appeared file that is NOT temporary
      const newCompletedFiles = currentFiles.filter(f =>
        !knownFiles.has(f) &&
        !f.endsWith('.crdownload') &&
        !f.endsWith('.tmp') &&
        !f.endsWith('.download')
      );

      if (newCompletedFiles.length > 0 && !hasTempFiles) {
        // Pick the newest file
        targetFile = newCompletedFiles[newCompletedFiles.length - 1];
        const fullPath = path.join(this.executionDirectory, targetFile);

        try {
          const stats = fs.statSync(fullPath);
          if (stats.size > 0) {
            return {
              success: true,
              filename: targetFile,
              filePath: fullPath,
              size: stats.size,
              error: null
            };
          }
        } catch {}
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    return {
      success: false,
      filename: null,
      filePath: null,
      size: 0,
      error: 'Download timeout: No completed non-temporary file detected within time limit'
    };
  }

  /**
   * Record a validated successful download for an item.
   *
   * @param {string} itemId
   * @param {object} fileInfo - { filename, size, filePath }
   * @param {object} [sourceData] - Item fields
   */
  recordSuccess(itemId, fileInfo = {}, sourceData = {}) {
    this.successCount++;
    const record = {
      itemId: String(itemId),
      filename: fileInfo.filename || 'unknown',
      size: fileInfo.size || 0,
      filePath: fileInfo.filePath || path.join(this.executionDirectory, fileInfo.filename || ''),
      runPath: fileInfo.runPath || null,
      portalDomain: this.portalDomain,
      runTimestamp: this.runTimestamp,
      category: fileInfo.category || null,
      status: 'success',
      downloadedAt: new Date().toISOString(),
      sourceData: sourceData || {}
    };

    this.files.push(record);
    this._saveManifest();

    // Also persist to JsonDB downloads collection if available
    try {
      if (db && typeof db.insert === 'function') {
        db.insert('downloads', {
          id: `dl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          runId: this.executionId,
          workflowId: this.workflowId,
          filename: record.filename,
          size: record.size,
          path: record.filePath,
          runPath: record.runPath,
          portalDomain: this.portalDomain,
          runTimestamp: this.runTimestamp,
          category: record.category,
          status: 'COMPLETED',
          itemId: record.itemId,
          createdAt: record.downloadedAt
        });
      }
    } catch {}

    logger.success(`[DownloadManager] Download verified: "${record.filename}" (${record.size} bytes)`);
    return record;
  }

  /**
   * Record a failed download attempt for an item.
   *
   * @param {string} itemId
   * @param {string} reason
   * @param {object} [sourceData]
   */
  recordFailure(itemId, reason = '', sourceData = {}) {
    this.failureCount++;
    const record = {
      itemId: String(itemId),
      filename: null,
      size: 0,
      status: 'failed',
      error: reason,
      failedAt: new Date().toISOString(),
      sourceData: sourceData || {}
    };

    this.files.push(record);
    this._saveManifest();
    logger.warn(`[DownloadManager] Download failed for item #${itemId}: ${reason}`);
    return record;
  }

  /**
   * Finalize the download session and produce a summary report.
   */
  finalize() {
    this.completedAt = new Date().toISOString();
    this._saveManifest();

    return {
      executionId: this.executionId,
      workflowId: this.workflowId,
      directory: this.executionDirectory,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      successCount: this.successCount,
      failureCount: this.failureCount,
      totalDownloads: this.files.length,
      files: this.files
    };
  }
}

module.exports = DownloadManager;
