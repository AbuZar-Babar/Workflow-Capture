/**
 * src/replay/loop/artifact-download-manager.js
 * Manages CDP download interception, SHA-256 deduplication, structured directory
 * hierarchies, duplicate detection, and manifest synchronization.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { db } = require('../../database/db');
const DownloadManager = require('../download-manager');
const logger = require('../../utils/logger');

class ArtifactDownloadManager {
  constructor(options = {}) {
    this.runId = options.runId || `run_${Date.now()}`;
    this.workflowId = options.workflowId || null;
    this.workflowName = options.workflowName || 'workflow';
    this.userId = options.userId || null;
    this.forceRedownload = options.forceRedownload === true;

    this.runsDir = options.runsDir || path.resolve(process.cwd(), 'recordings', 'runs', this.runId);
    this.downloadsDir = path.join(this.runsDir, 'downloads');

    // Structured downloads hierarchy: downloads/<workflow-slug>/<YYYY-MM-DD>/
    const rawSlug = (this.workflowName || this.workflowId || 'workflow').toLowerCase();
    this.workflowSlug = rawSlug.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
    this.dateStr = new Date().toISOString().split('T')[0];
    this.workflowDownloadsBaseDir = path.resolve(process.cwd(), 'downloads', this.workflowSlug);
    this.structuredDownloadsDir = path.resolve(this.workflowDownloadsBaseDir, this.dateStr);

    // Primary Run/ hierarchy: Run/<YYYY-MM-DD_HH-mm-ss>/<portalDomain>/<Category>/
    const targetUrl = options.targetUrl || options.portalUrl || '';
    let extractedDomain = options.portalDomain || '';
    if (!extractedDomain && targetUrl) {
      try {
        const u = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
        extractedDomain = u.hostname;
      } catch {
        extractedDomain = targetUrl.replace(/https?:\/\//, '').split('/')[0];
      }
    }
    this.portalDomain = extractedDomain || 'customerportal.usoil.com';

    this.downloadManager = new DownloadManager({
      workflowSlug: this.workflowSlug,
      executionId: this.runId,
      workflowId: this.workflowId,
      portalDomain: this.portalDomain,
      portalUrl: targetUrl,
      runTimestamp: options.runTimestamp,
      startedAt: options.startedAt
    });

    this.runTimestamp = this.downloadManager.runTimestamp;
    this.runDomainDir = this.downloadManager.runDomainDir;
    this.executionDownloadsDir = this.downloadManager.getDirectory();
    this._replayTargetCreatedListener = null;
    this._activeItemContext = null;
  }

  setPortalDomain(domain) {
    if (!domain) return;
    this.portalDomain = domain;
    if (this.downloadManager) {
      this.downloadManager.portalDomain = domain;
      if (this.downloadManager.runTimestampDir) {
        this.downloadManager.runDomainDir = path.resolve(this.downloadManager.runTimestampDir, domain);
        this.runDomainDir = this.downloadManager.runDomainDir;
        if (!fs.existsSync(this.runDomainDir)) {
          fs.mkdirSync(this.runDomainDir, { recursive: true });
        }
      }
    }
  }

  initDirectories() {
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
    if (!fs.existsSync(this.structuredDownloadsDir)) {
      fs.mkdirSync(this.structuredDownloadsDir, { recursive: true });
    }
    if (this.downloadManager) {
      this.downloadManager._initDirectory();
    }
  }

  processAndStoreDownload(sourcePath, itemKey = null, itemLabel = null, itemFields = {}) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const filename = path.basename(sourcePath);
    if (filename.endsWith('.crdownload') || filename.endsWith('.tmp')) return null;

    // Fallback to active item context if itemKey or fields are missing
    if (!itemKey && this._activeItemContext) {
      itemKey = this._activeItemContext.itemKey;
      itemLabel = this._activeItemContext.itemLabel;
      itemFields = { ...(this._activeItemContext.fields || {}), ...itemFields };
    }

    try {
      this.initDirectories();
      const fileBuffer = fs.readFileSync(sourcePath);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const fileSizeBytes = fileBuffer.length;

      // 1. Organize into primary Run/ hierarchy: Run/<runTimestamp>/<portalDomain>/<Category>/<formattedFilename>
      let runArtifact = null;
      if (this.downloadManager && typeof this.downloadManager.organizeRunArtifact === 'function') {
        runArtifact = this.downloadManager.organizeRunArtifact(sourcePath, itemKey, itemLabel, itemFields);
      }

      let targetFilename = runArtifact ? runArtifact.targetFilename : filename;
      let destPath = path.join(this.structuredDownloadsDir, targetFilename);

      // Handle duplicate filename with different hash: append content hash or timestamp suffix
      if (fs.existsSync(destPath)) {
        try {
          const existingBuffer = fs.readFileSync(destPath);
          const existingHash = crypto.createHash('sha256').update(existingBuffer).digest('hex');
          if (existingHash !== fileHash) {
            const ext = path.extname(targetFilename);
            const base = path.basename(targetFilename, ext);
            targetFilename = `${base}_${fileHash.substring(0, 8)}${ext}`;
            destPath = path.join(this.structuredDownloadsDir, targetFilename);
            fs.copyFileSync(sourcePath, destPath);
          }
        } catch {
          fs.copyFileSync(sourcePath, destPath);
        }
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }

      // Also copy to isolated per-execution downloads directory: downloads/<workflow-slug>/<execution-id>/
      if (this.executionDownloadsDir && fs.existsSync(this.executionDownloadsDir)) {
        const execDestPath = path.join(this.executionDownloadsDir, targetFilename);
        try {
          fs.copyFileSync(sourcePath, execDestPath);
        } catch {}
      }

      const relativeFilePath = path.relative(process.cwd(), destPath).replace(/\\/g, '/');
      const relativeRunPath = runArtifact ? runArtifact.relativeRunPath : null;

      if (this.downloadManager) {
        this.downloadManager.recordSuccess(itemKey || targetFilename, {
          filename: targetFilename,
          size: fileSizeBytes,
          filePath: destPath,
          runPath: relativeRunPath,
          category: runArtifact ? runArtifact.category : null
        }, { label: itemLabel, fields: itemFields });
      }

      const downloadRecord = {
        workflowId: this.workflowId,
        workflowName: this.workflowName,
        userId: this.userId,
        runId: this.runId,
        runTimestamp: this.runTimestamp,
        portalDomain: this.portalDomain,
        category: runArtifact ? runArtifact.category : 'Invoices',
        itemKey: itemKey || filename,
        itemLabel: itemLabel || filename,
        filename: targetFilename,
        fileHash,
        filePath: relativeFilePath,
        relativeFilePath: relativeFilePath,
        runPath: relativeRunPath,
        fileSizeBytes,
        itemFields: itemFields || {},
        downloadedAt: new Date().toISOString()
      };

      const existingInDb = db.findOne('downloads', d =>
        d.workflowId === this.workflowId &&
        d.fileHash === fileHash &&
        (d.filePath === relativeFilePath || (relativeRunPath && d.runPath === relativeRunPath))
      );

      let savedRecord = existingInDb;
      if (!existingInDb) {
        savedRecord = db.insert('downloads', downloadRecord);
      }

      this.syncWorkflowDownloadsManifest(savedRecord || downloadRecord);

      logger.info(`[ArtifactDownloadManager] Download organized: "${targetFilename}" -> ${relativeRunPath || relativeFilePath} (${fileSizeBytes} bytes)`);

      return {
        id: (savedRecord || downloadRecord).id,
        filename: targetFilename,
        path: destPath,
        relativePath: relativeFilePath,
        runPath: relativeRunPath,
        runDirectory: runArtifact ? runArtifact.categoryDir : null,
        portalDomain: this.portalDomain,
        runTimestamp: this.runTimestamp,
        category: runArtifact ? runArtifact.category : null,
        fileHash,
        sizeBytes: fileSizeBytes,
        itemKey: itemKey || filename
      };
    } catch (err) {
      logger.error(`[ArtifactDownloadManager] Error organizing download "${sourcePath}": ${err.message}`);
      return {
        filename,
        path: sourcePath,
        sizeBytes: fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 0
      };
    }
  }

  syncWorkflowDownloadsManifest(downloadRecord) {
    try {
      if (!fs.existsSync(this.workflowDownloadsBaseDir)) {
        fs.mkdirSync(this.workflowDownloadsBaseDir, { recursive: true });
      }
      const manifestPath = path.join(this.workflowDownloadsBaseDir, 'manifest.json');
      let manifestData = {
        workflowId: this.workflowId,
        workflowName: this.workflowName,
        lastUpdated: new Date().toISOString(),
        totalDownloads: 0,
        downloads: []
      };

      if (fs.existsSync(manifestPath)) {
        try {
          manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch { }
      }

      manifestData.lastUpdated = new Date().toISOString();
      manifestData.downloads = Array.isArray(manifestData.downloads) ? manifestData.downloads : [];

      const existsIdx = manifestData.downloads.findIndex(d =>
        d.fileHash === downloadRecord.fileHash || d.filePath === downloadRecord.filePath
      );

      if (existsIdx >= 0) {
        manifestData.downloads[existsIdx] = { ...manifestData.downloads[existsIdx], ...downloadRecord };
      } else {
        manifestData.downloads.push(downloadRecord);
      }
      manifestData.totalDownloads = manifestData.downloads.length;

      fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
    } catch (err) {
      logger.warn(`[ArtifactDownloadManager] Could not update workflow download manifest: ${err.message}`);
    }
  }

  checkIfAlreadyDownloaded(itemKey, invoiceNumber = null, itemFields = {}, contentHash = null) {
    if (!itemKey && !invoiceNumber && !contentHash) return { isDuplicate: false };

    // 1. Database check
    if (this.workflowId) {
      const records = db.find('downloads', d =>
        d.workflowId === this.workflowId && (
          (contentHash && d.fileHash === contentHash) ||
          (itemKey && d.itemKey === itemKey) ||
          (d.itemLabel && d.itemLabel === itemKey) ||
          (invoiceNumber && (
            (d.filename && d.filename.toLowerCase().includes(invoiceNumber.toLowerCase())) ||
            (d.itemLabel && d.itemLabel.toLowerCase().includes(invoiceNumber.toLowerCase())) ||
            (d.itemKey && d.itemKey.toLowerCase().includes(invoiceNumber.toLowerCase()))
          ))
        )
      );

      if (records && records.length > 0) {
        for (const rec of records) {
          if (rec.filePath) {
            const fullPath = path.resolve(process.cwd(), rec.filePath);
            if (fs.existsSync(fullPath)) {
              return { isDuplicate: true, inFolder: true, record: rec };
            }
          }
        }
      }
    }

    // 2. Physical disk scan in workflow downloads folder, run folder
    const targetInv = (invoiceNumber || (typeof itemKey === 'string' && itemKey.startsWith('invoice:') ? itemKey.replace(/^invoice:/, '') : null))?.trim();
    if (targetInv && targetInv.length >= 3 && this.workflowSlug && this.workflowSlug !== 'workflow') {
      const candidateDirs = [
        this.structuredDownloadsDir,
        this.workflowDownloadsBaseDir,
        this.downloadsDir
      ].filter(Boolean);

      for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
          const files = fs.readdirSync(dir, { recursive: true });
          for (const file of files) {
            const fileName = typeof file === 'string' ? path.basename(file) : file;
            if (fileName && typeof fileName === 'string' && fileName.toLowerCase().includes(targetInv.toLowerCase()) && !fileName.endsWith('.crdownload') && !fileName.endsWith('.tmp')) {
              const fullPath = path.join(dir, fileName);
              return {
                isDuplicate: true,
                inFolder: true,
                record: {
                  filename: fileName,
                  filePath: path.relative(process.cwd(), fullPath)
                }
              };
            }
          }
        } catch {}
      }
    }

    // 3. Due Date / Days Old evaluation for "old" data categorization
    const isOldData = (() => {
      if (itemFields && itemFields['Days Old'] && parseInt(itemFields['Days Old'], 10) > 0) {
        return true;
      }
      if (itemFields && itemFields['Due Date']) {
        const parsedDue = new Date(itemFields['Due Date']);
        if (!isNaN(parsedDue.getTime()) && parsedDue.getTime() <= Date.now()) {
          return true;
        }
      }
      return false;
    })();

    return { isDuplicate: false, isOldData };
  }

  async waitForDownload(previousSnapshot = [], timeoutMs = 10000) {
    const startedAt = Date.now();
    const previousRun = new Set(Array.isArray(previousSnapshot) ? previousSnapshot : (previousSnapshot.runFiles || []));
    const previousOs = new Set(Array.isArray(previousSnapshot) ? [] : (previousSnapshot.osFiles || []));
    const osDownloadsDir = path.join(os.homedir(), 'Downloads');
    let effectiveTimeoutMs = timeoutMs;

    while (Date.now() - startedAt < effectiveTimeoutMs) {
      // 1. Check primary isolated execution downloads directory
      const files = fs.existsSync(this.downloadsDir)
        ? fs.readdirSync(this.downloadsDir)
        : [];
      const candidates = files.filter(file => !previousRun.has(file) && !file.endsWith('.crdownload') && !file.endsWith('.tmp') && !file.endsWith('.download'));
      if (candidates.length) {
        return candidates.map(filename => ({
          filename,
          path: path.join(this.downloadsDir, filename),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, filename)).size
        }));
      }

      // If a .crdownload file is active that was not there before, extend timeout to let it finish
      const inFlightCr = files.filter(file => !previousRun.has(file) && (file.endsWith('.crdownload') || file.endsWith('.download') || file.endsWith('.tmp')));
      if (inFlightCr.length && effectiveTimeoutMs < 45000) {
        effectiveTimeoutMs = 45000;
      }

      // 2. Fallback: Check if browser routed the download to OS default ~/Downloads
      if (fs.existsSync(osDownloadsDir)) {
        let currentOsFiles = [];
        try {
          currentOsFiles = fs.readdirSync(osDownloadsDir);
        } catch {
          currentOsFiles = [];
        }

        const inFlightOs = currentOsFiles.filter(file => !previousOs.has(file) && (file.endsWith('.crdownload') || file.endsWith('.download') || file.endsWith('.tmp')));
        if (inFlightOs.length && effectiveTimeoutMs < 45000) {
          effectiveTimeoutMs = 45000;
        }

        const newOsCompleted = currentOsFiles.filter(file =>
          !previousOs.has(file) &&
          !file.endsWith('.crdownload') &&
          !file.endsWith('.tmp') &&
          !file.endsWith('.download')
        );

        if (newOsCompleted.length > 0) {
          const copied = [];
          for (const osFile of newOsCompleted) {
            const osFilePath = path.join(osDownloadsDir, osFile);
            try {
              const stats = fs.statSync(osFilePath);
              if (stats.size > 0 && stats.mtimeMs >= startedAt - 2500) {
                this.initDirectories();
                const targetPath = path.join(this.downloadsDir, osFile);
                fs.copyFileSync(osFilePath, targetPath);
                copied.push({
                  filename: osFile,
                  path: targetPath,
                  sizeBytes: stats.size
                });
                logger.info(`[ArtifactDownloadManager] Captured download from OS downloads folder: "${osFile}" (${stats.size} bytes)`);
              }
            } catch {}
          }
          if (copied.length > 0) {
            return copied;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  snapshotDownloadedFiles() {
    const runFiles = fs.existsSync(this.downloadsDir)
      ? fs.readdirSync(this.downloadsDir).filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'))
      : [];
    let osFiles = [];
    try {
      const osDownloadsDir = path.join(os.homedir(), 'Downloads');
      if (fs.existsSync(osDownloadsDir)) {
        osFiles = fs.readdirSync(osDownloadsDir).filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
      }
    } catch {}
    return {
      runFiles,
      osFiles,
      timestamp: Date.now()
    };
  }

  async configureDownloadInterception(page) {
    this.initDirectories();
    const configureTarget = async (target) => {
      try {
        const client = await target.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: this.downloadsDir
        }).catch(() => { });
        return client;
      } catch {
        return null;
      }
    };

    try {
      // 1. Browser-level global download configuration across all frames & windows
      if (page.browser) {
        const browser = page.browser();
        try {
          const browserTarget = (typeof browser.targets === 'function' ? browser.targets().find(t => t.type() === 'browser') : null) || (typeof browser.target === 'function' ? browser.target() : null);
          if (browserTarget && typeof browserTarget.createCDPSession === 'function') {
            const browserClient = await browserTarget.createCDPSession();
            await browserClient.send('Browser.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath: this.downloadsDir,
              eventsEnabled: true
            }).catch(() => { });
            logger.info(`[ArtifactDownloadManager] Configured browser-level CDP download path: ${this.downloadsDir}`);
          }
        } catch (bErr) {
          logger.warn(`[ArtifactDownloadManager] Note on Browser.setDownloadBehavior: ${bErr.message}`);
        }
      }

      const client = await configureTarget(page.target());
      logger.info(`[ArtifactDownloadManager] Configured CDP download path: ${this.downloadsDir}`);

      // Also configure across all other open pages
      if (page.browser) {
        const browser = page.browser();
        const pages = await browser.pages().catch(() => []);
        for (const p of pages) {
          if (p !== page && !p.isClosed()) {
            await configureTarget(p.target());
          }
        }

        // Auto-configure on any newly spawned window/tab during replay
        if (!this._replayTargetCreatedListener) {
          this._replayTargetCreatedListener = async (target) => {
            if (target.type() === 'page') {
              await configureTarget(target);
            }
          };
          browser.on('targetcreated', this._replayTargetCreatedListener);
        }
      }

      return client;
    } catch (err) {
      logger.warn(`[ArtifactDownloadManager] Warning configuring CDP download behavior: ${err.message}`);
      return null;
    }
  }

  teardownDownloadInterception(browser) {
    if (this._replayTargetCreatedListener && browser) {
      try {
        browser.off('targetcreated', this._replayTargetCreatedListener);
      } catch {}
      this._replayTargetCreatedListener = null;
    }
  }
}

module.exports = ArtifactDownloadManager;
