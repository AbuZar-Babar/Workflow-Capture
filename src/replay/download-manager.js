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

class DownloadManager {
  /**
   * @param {object} options
   * @param {string} options.workflowSlug - Sanitized workflow name
   * @param {string} options.executionId - Unique run / execution ID
   * @param {string} [options.workflowId] - Optional workflow ID
   * @param {string} [options.baseDownloadsDir] - Custom base downloads directory
   */
  constructor(options = {}) {
    const rawSlug = String(options.workflowSlug || options.workflowName || 'workflow').toLowerCase();
    this.workflowSlug = rawSlug.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
    this.executionId = options.executionId || options.runId || `exec_${Date.now()}`;
    this.workflowId = options.workflowId || null;

    const baseDir = options.baseDownloadsDir || path.resolve(process.cwd(), 'downloads');
    this.executionDirectory = path.resolve(baseDir, this.workflowSlug, this.executionId);
    this.manifestPath = path.join(this.executionDirectory, 'manifest.json');

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
    this._saveManifest();
  }

  /**
   * Get the isolated target directory for this execution.
   */
  getDirectory() {
    return this.executionDirectory;
  }

  /**
   * Save execution manifest metadata.
   */
  _saveManifest() {
    const metadata = {
      executionId: this.executionId,
      workflowId: this.workflowId,
      workflowSlug: this.workflowSlug,
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
