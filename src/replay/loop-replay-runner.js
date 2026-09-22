/**
 * Workflow Capture — Intelligent Replay & Batch Execution Runner
 * 
 * Executes standard sequential workflows and generalized loops over table rows,
 * list items, or grids. Manages auto-navigation to target URLs, CDP file download
 * interception, per-item state restoration, and error isolation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ReplayEngine = require('./replay-engine');
const LoopDetector = require('../shared/loop-detector');
const ItemDiscovery = require('../shared/item-discovery');
const ActionGeneralizer = require('../shared/action-generalizer');
const logger = require('../utils/logger');
const { db } = require('../database/db');
const { decryptSecret } = require('../auth/secret-util');
const { resolveTargetUrl } = require('../utils/url-helper');

class LoopReplayRunner {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.runId = options.runId || `run_${Date.now()}`;
    this.workflowId = options.workflowId || null;
    this.workflowName = options.workflowName || 'workflow';
    this.userId = options.userId || null;
    this.forceRedownload = options.forceRedownload === true;

    this.runsDir = path.resolve(process.cwd(), 'recordings', 'runs', this.runId);
    this.downloadsDir = path.join(this.runsDir, 'downloads');
    this.replayEngine = new ReplayEngine({ cdpPort: this.cdpPort });
    this.maxItemRetries = Number.isInteger(options.maxItemRetries) ? Math.max(0, options.maxItemRetries) : 1;
    this.resumeFromCheckpoint = options.resumeFromCheckpoint === true;
    this.isAborted = false;

    // Structured downloads hierarchy: downloads/<workflow-slug>/<YYYY-MM-DD>/
    const rawSlug = (this.workflowName || this.workflowId || 'workflow').toLowerCase();
    this.workflowSlug = rawSlug.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
    this.dateStr = new Date().toISOString().split('T')[0];
    this.workflowDownloadsBaseDir = path.resolve(process.cwd(), 'downloads', this.workflowSlug);
    this.structuredDownloadsDir = path.resolve(this.workflowDownloadsBaseDir, this.dateStr);
  }

  /**
   * Abort/stop the current execution immediately
   */
  async stop() {
    this.isAborted = true;
    logger.warn(`[Runner] Stop signal triggered for run: ${this.runId}`);
    if (this.replayEngine && typeof this.replayEngine.abort === 'function') {
      await this.replayEngine.abort().catch(() => {});
    }
  }

  initDirectories() {
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
    if (!fs.existsSync(this.structuredDownloadsDir)) {
      fs.mkdirSync(this.structuredDownloadsDir, { recursive: true });
    }
  }

  /**
   * Post-processes a downloaded file:
   * 1. Validates existence and completion.
   * 2. Calculates SHA256 checksum.
   * 3. Moves/copies file into structured folder: downloads/<workflow-slug>/<YYYY-MM-DD>/<filename>
   * 4. Persists metadata record in db.json ('downloads' collection)
   * 5. Appends record to workflow downloads manifest: downloads/<workflow-slug>/manifest.json
   */
  processAndStoreDownload(sourcePath, itemKey = null, itemLabel = null) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const filename = path.basename(sourcePath);
    if (filename.endsWith('.crdownload') || filename.endsWith('.tmp')) return null;

    try {
      this.initDirectories();
      const fileBuffer = fs.readFileSync(sourcePath);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const fileSizeBytes = fileBuffer.length;

      let targetFilename = filename;
      let destPath = path.join(this.structuredDownloadsDir, targetFilename);

      // Handle duplicate filename with different hash: append timestamp suffix
      if (fs.existsSync(destPath)) {
        try {
          const existingBuffer = fs.readFileSync(destPath);
          const existingHash = crypto.createHash('sha256').update(existingBuffer).digest('hex');
          if (existingHash !== fileHash) {
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            targetFilename = `${base}_${Date.now()}${ext}`;
            destPath = path.join(this.structuredDownloadsDir, targetFilename);
            fs.copyFileSync(sourcePath, destPath);
          }
        } catch {
          fs.copyFileSync(sourcePath, destPath);
        }
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }

      const relativeFilePath = path.relative(process.cwd(), destPath).replace(/\\/g, '/');

      const downloadRecord = {
        workflowId: this.workflowId,
        workflowName: this.workflowName,
        userId: this.userId,
        runId: this.runId,
        itemKey: itemKey || filename,
        itemLabel: itemLabel || filename,
        filename: targetFilename,
        fileHash,
        filePath: relativeFilePath,
        relativeFilePath: relativeFilePath,
        fileSizeBytes,
        downloadedAt: new Date().toISOString()
      };

      const existingInDb = db.findOne('downloads', d =>
        d.workflowId === this.workflowId &&
        d.fileHash === fileHash &&
        d.filePath === relativeFilePath
      );

      let savedRecord = existingInDb;
      if (!existingInDb) {
        savedRecord = db.insert('downloads', downloadRecord);
      }

      this.syncWorkflowDownloadsManifest(savedRecord || downloadRecord);

      logger.info(`[Runner] Download organized: "${targetFilename}" -> ${relativeFilePath} (${fileSizeBytes} bytes)`);

      return {
        id: (savedRecord || downloadRecord).id,
        filename: targetFilename,
        path: destPath,
        relativePath: relativeFilePath,
        fileHash,
        sizeBytes: fileSizeBytes,
        itemKey: itemKey || filename
      };
    } catch (err) {
      logger.error(`[Runner] Error organizing download "${sourcePath}": ${err.message}`);
      return {
        filename,
        path: sourcePath,
        sizeBytes: fs.statSync(sourcePath).size
      };
    }
  }

  /**
   * Syncs download record to workflow-level manifest.json
   */
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
        } catch {}
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
      logger.warn(`[Runner] Could not update workflow download manifest: ${err.message}`);
    }
  }

  /**
   * Checks whether an item has already been downloaded for this workflow.
   * Verifies both database record and physical presence on disk.
   */
  checkIfAlreadyDownloaded(itemKey) {
    if (!itemKey || !this.workflowId) return { isDuplicate: false };

    const records = db.find('downloads', d =>
      d.workflowId === this.workflowId && (d.itemKey === itemKey || (d.itemLabel && d.itemLabel === itemKey))
    );

    if (!records || records.length === 0) return { isDuplicate: false };

    // Verify at least one file actually exists on disk
    for (const rec of records) {
      if (rec.filePath) {
        const fullPath = path.resolve(process.cwd(), rec.filePath);
        if (fs.existsSync(fullPath)) {
          return { isDuplicate: true, record: rec };
        }
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Extracts a unique identifier and human-readable label from a loop item
   */
  async extractItemIdentifier(page, discovery, index, isDropdown = false) {
    if (isDropdown) {
      const optText = await page.evaluate((idx) => {
        const opts = Array.from(document.querySelectorAll('mat-option, [role="option"], select option'));
        const el = opts[idx];
        return el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : null;
      }, index).catch(() => null);
      const label = optText || `Option #${index + 1}`;
      return { itemKey: `dropdown:${label}`, itemLabel: label };
    }

    let itemHandle = null;
    try {
      itemHandle = await ItemDiscovery.getItemHandle(page, discovery, index);
      const itemEl = itemHandle ? itemHandle.asElement() : null;
      if (itemEl) {
        const info = await itemEl.evaluate(el => {
          const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          const firstLine = text.split(/[\n\r]/)[0].trim();
          const link = el.querySelector('a[href]')?.getAttribute('href') || el.getAttribute('href') || '';
          const dataId = el.getAttribute('data-id') || el.getAttribute('data-testid') || el.getAttribute('id') || '';
          return {
            text: firstLine ? firstLine.slice(0, 100) : text.slice(0, 100),
            link,
            dataId
          };
        });

        const label = info.text || info.dataId || `Item #${index + 1}`;
        const key = info.dataId
          ? `id:${info.dataId}`
          : (info.link ? `link:${info.link}` : `text:${label}`);
        return { itemKey: key, itemLabel: label };
      }
    } catch (err) {
      logger.warn(`[Runner] Note extracting item identifier for item #${index + 1}: ${err.message}`);
    } finally {
      if (itemHandle) await itemHandle.dispose().catch(() => {});
    }

    return { itemKey: `item_${index + 1}`, itemLabel: `Item #${index + 1}` };
  }

  /**
   * Wait for a new completed download in this run's download directory.
   */
  async waitForDownload(previousFiles = [], timeoutMs = 10000) {
    const startedAt = Date.now();
    const previous = new Set(previousFiles);
    while (Date.now() - startedAt < timeoutMs) {
      const files = fs.existsSync(this.downloadsDir)
        ? fs.readdirSync(this.downloadsDir)
        : [];
      const candidates = files.filter(file => !previous.has(file) && !file.endsWith('.crdownload'));
      if (candidates.length) {
        return candidates.map(filename => ({
          filename,
          path: path.join(this.downloadsDir, filename),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, filename)).size
        }));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  snapshotDownloadedFiles() {
    return fs.existsSync(this.downloadsDir)
      ? fs.readdirSync(this.downloadsDir).filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'))
      : [];
  }

  writeLoopCheckpoint(
    manifest,
    currentItemIndex = null,
    currentActionOffset = null,
    currentPage = 1,
    currentPageItemIndex = null,
    activeItem = null
  ) {
    const checkpoint = {
      runId: manifest.runId,
      workflowId: manifest.workflowId,
      mode: manifest.mode,
      status: manifest.status,
      currentPage,
      currentPageItemIndex,
      currentItemIndex,
      currentActionOffset,
      completedItemIndexes: manifest.results
        .filter(result => result.status === 'SUCCESS')
        .map(result => result.index),
      itemsSucceeded: manifest.itemsSucceeded,
      itemsFailed: manifest.itemsFailed,
      itemsSkipped: manifest.itemsSkipped || 0,
      pagesProcessed: manifest.pagesProcessed || currentPage,
      itemsTotal: manifest.itemsTotal,
      results: manifest.results,
      downloadedFiles: manifest.downloadedFiles,
      activeItem,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(this.runsDir, 'checkpoint.json'),
      JSON.stringify(checkpoint, null, 2)
    );
  }

  loadLoopCheckpoint(workflow) {
    if (!this.resumeFromCheckpoint) return null;

    const checkpointPath = path.join(this.runsDir, 'checkpoint.json');
    if (!fs.existsSync(checkpointPath)) return null;

    try {
      const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));

      if (
        checkpoint.runId !== this.runId ||
        checkpoint.workflowId !== workflow.id ||
        checkpoint.mode !== 'LOOP'
      ) {
        logger.warn('[Loop Runner] Existing checkpoint does not match this run/workflow. Starting fresh.');
        return null;
      }

      logger.info(
        '[Loop Runner] Resuming checkpoint: page ' +
        (checkpoint.currentPage || 1) +
        ', item ' +
        (checkpoint.currentPageItemIndex == null ? '-' : checkpoint.currentPageItemIndex + 1) +
        ', action offset ' +
        (checkpoint.currentActionOffset || 0)
      );

      return checkpoint;
    } catch (err) {
      logger.warn('[Loop Runner] Could not read checkpoint. Starting fresh: ' + err.message);
      return null;
    }
  }

  async configureDownloadInterception(page) {
    this.initDirectories();
    try {
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this.downloadsDir
      });
      logger.info(`[Runner] Configured CDP download path: ${this.downloadsDir}`);
      return client;
    } catch (err) {
      logger.warn(`[Runner] Warning configuring CDP download behavior: ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate browser to the workflow's designated target/start URL
   */
  async navigateToWorkflowTarget(page, workflow) {
    let targetUrl = workflow.targetUrl ||
      (workflow.recordingData && workflow.recordingData.metadata && workflow.recordingData.metadata.startUrl) ||
      (workflow.metadata && workflow.metadata.startUrl) ||
      (workflow.steps && workflow.steps[0] && workflow.steps[0].url) ||
      null;

    const resolved = resolveTargetUrl(targetUrl);
    if (!resolved) {
      logger.info('[Runner] No target URL specified for workflow. Executing on active tab.');
      return;
    }

    try {
      await page.bringToFront().catch(() => {});
    } catch {}

    const currentUrl = page.url();
    if (currentUrl === 'about:blank' || currentUrl.startsWith('chrome://') || currentUrl !== resolved) {
      logger.info(`[Runner] Navigating tab from "${currentUrl}" to workflow target URL: ${resolved}`);
      try {
        await page.goto(resolved, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (this.replayEngine && typeof this.replayEngine._applyStealthEvasion === 'function') {
          await this.replayEngine._applyStealthEvasion();
        }
        await new Promise(r => setTimeout(r, 600));
      } catch (navErr) {
        logger.warn(`[Runner] Auto-navigation note: ${navErr.message}`);
      }
    } else {
      logger.info(`[Runner] Tab already at target URL: ${resolved}`);
    }
  }

  /**
   * Find a likely pagination "next" control on the current page.
   * The resolver is intentionally conservative: it requires semantic next-page
   * signals and rejects disabled/hidden controls. A workflow may provide an
   * explicit selector through workflow.pagination.nextSelector.
   */
  async findNextPageTarget(page, workflow = {}) {
    const explicitSelector = workflow.pagination && workflow.pagination.nextSelector;
    return page.evaluateHandle((selector) => {
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const disabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');

      if (selector) {
        const el = document.querySelector(selector);
        return el && visible(el) && !disabled(el) ? el : null;
      }

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [aria-label]'))
        .filter(el => visible(el) && !disabled(el));

      const scored = candidates.map(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const title = (el.getAttribute('title') || '').trim().toLowerCase();
        const combined = [text, aria, title].join(' ');
        let score = 0;
        if (/^next(?: page)?$/.test(text)) score += 8;
        if (/next(?: page)?/.test(aria)) score += 7;
        if (/next(?: page)?/.test(title)) score += 5;
        if (/^›$|^»$|^>$/.test(text)) score += 4;
        if (/pagination|pager/.test(combined)) score += 2;
        if (/previous|back|first|last/.test(combined) && !/next/.test(combined)) score -= 5;
        return { el, score };
      }).filter(x => x.score >= 5).sort((a, b) => b.score - a.score);

      return scored.length ? scored[0].el : null;
    }, explicitSelector);
  }

  async getCollectionFingerprint(page, collection) {
    if (!collection) return '';
    return page.evaluate((meta) => {
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
      const ancestors = Array.from(document.querySelectorAll(meta.ancestorTag || '*')).filter(visible);
      for (const ancestor of ancestors) {
        const items = Array.from(ancestor.children).filter(child =>
          visible(child) &&
          child.tagName.toLowerCase() === meta.itemTag
        );
        if (items.length) {
          return items.slice(0, 5).map(item => normalize(item.textContent)).join('||');
        }
      }
      return '';
    }, collection).catch(() => '');
  }

  async advanceToNextPage(page, workflow = {}) {
    const beforeUrl = page.url();
    const handle = await this.findNextPageTarget(page, workflow);
    const element = handle && handle.asElement();
    if (!element) {
      if (handle) await handle.dispose().catch(() => {});
      return false;
    }

    try {
      await element.scrollIntoViewIfNeeded().catch(() => {});
      await element.click();
    } finally {
      await element.dispose().catch(() => {});
    }

    const timeout = Number.isInteger(workflow.pagination?.waitTimeoutMs)
      ? Math.max(1000, workflow.pagination.waitTimeoutMs)
      : 10000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      await new Promise(r => setTimeout(r, 250));
      if (page.url() !== beforeUrl) return true;
      const state = await page.evaluate(() => document.readyState).catch(() => 'loading');
      if (state === 'complete' || state === 'interactive') {
        // Give AJAX/virtualized grids a little time to replace their rows.
        await new Promise(r => setTimeout(r, 750));
        return true;
      }
    }
    return true;
  }

  isDropdownOptionCollection(collection, items = []) {
    if (!collection) return false;
    const tag = String(collection.itemTag || '').toLowerCase();
    if (tag === 'mat-option' || tag === 'option') return true;
    if (collection.ancestorTag === 'mat-select' || collection.ancestorTag === 'select') return true;
    if (collection.ancestorSelector && /cdk-overlay|listbox|mat-select/i.test(collection.ancestorSelector)) return true;
    if (Array.isArray(items) && items.some(it => it.tagName === 'mat-option' || it.tagName === 'option')) return true;
    return false;
  }

  async ensureDropdownOpen(page, triggerStep = null) {
    const isOpen = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('mat-option, [role="option"]'));
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return options.some(visible);
    }).catch(() => false);

    if (isOpen) return true;

    logger.info('[Loop Runner] Dropdown overlay closed. Reopening dropdown for next option...');

    if (triggerStep) {
      try {
        await this.replayEngine.executeAction(triggerStep);
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        logger.warn(`[Loop Runner] Trigger step replay note: ${err.message}`);
      }
    }

    const stillClosed = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('mat-option, [role="option"]'));
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return !options.some(visible);
    }).catch(() => true);

    if (stillClosed) {
      const triggerCoords = await page.evaluate(() => {
        const select = document.querySelector('mat-select .mat-mdc-select-trigger, mat-select .mat-mdc-select-value, mat-select, [role="combobox"]');
        if (!select) return null;
        const rect = select.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        };
      }).catch(() => null);

      if (triggerCoords) {
        await page.mouse.click(triggerCoords.x, triggerCoords.y);
        await new Promise(r => setTimeout(r, 600));
      }
    }

    const started = Date.now();
    while (Date.now() - started < 3000) {
      const ready = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('mat-option, [role="option"]'));
        return options.some(el => el.getBoundingClientRect().height > 0);
      }).catch(() => false);
      if (ready) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  async executeDropdownOptionSingleSelect(page, targetIndex) {
    return page.evaluate((targetIdx) => {
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const isOptionSelected = opt => {
        if (!opt) return false;
        if (opt.getAttribute('aria-selected') === 'true') return true;
        if (opt.classList.contains('mat-mdc-option-selected') || opt.classList.contains('mat-selected')) return true;
        const cb = opt.querySelector('.mat-pseudo-checkbox-checked, input[type="checkbox"]:checked');
        return Boolean(cb);
      };

      const options = Array.from(document.querySelectorAll('mat-option, [role="option"]')).filter(visible);
      if (!options.length) {
        return { success: false, reason: 'No visible dropdown options found' };
      }

      const actionsDone = [];

      // Phase 1: Uncheck any option currently checked whose index !== targetIdx
      for (let idx = 0; idx < options.length; idx++) {
        if (idx !== targetIdx && isOptionSelected(options[idx])) {
          const opt = options[idx];
          if (opt.scrollIntoView) opt.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          opt.click();
          actionsDone.push({ action: 'UNCHECK', index: idx, text: opt.innerText.trim().slice(0, 40) });
        }
      }

      // Phase 2: Check target option if not already checked
      const targetOpt = options[targetIdx];
      if (!targetOpt) {
        return {
          success: false,
          reason: `Target option at index ${targetIdx} not found (total options: ${options.length})`,
          actionsDone
        };
      }

      if (!isOptionSelected(targetOpt)) {
        if (targetOpt.scrollIntoView) targetOpt.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        targetOpt.click();
        actionsDone.push({ action: 'CHECK', index: targetIdx, text: targetOpt.innerText.trim().slice(0, 40) });
      }

      const targetIsNowSelected = isOptionSelected(targetOpt);

      return {
        success: targetIsNowSelected,
        targetIndex: targetIdx,
        targetText: targetOpt.innerText.trim().slice(0, 80),
        totalOptions: options.length,
        actionsDone
      };
    }, targetIndex);
  }

  /**
   * Execute a standard sequential workflow (all steps in order)
   * @param {object} workflow - Stored workflow object with steps array
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeStandard(workflow, onProgress = () => {}) {
    this.initDirectories();
    const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
    const manifest = {
      runId: this.runId,
      workflowId: workflow.id,
      mode: 'STANDARD',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      itemsTotal: steps.length,
      itemsSucceeded: 0,
      itemsFailed: 0,
      itemsSkipped: 0,
      results: [],
      downloadedFiles: []
    };
    this.manifest = manifest;

    logger.info(`[Runner] Starting standard execution run ${this.runId} for workflow "${workflow.name}" (${steps.length} steps)`);
    onProgress({ status: 'STARTING', manifest });

    try {
      const browser = await this.replayEngine.connect();
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      this.replayEngine.page = page;

      // Set up the secret resolver using the workflow's userId
      this.replayEngine.secretResolver = async (secretId) => {
        const secret = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
        if (secret && secret.encryptedData) {
          try {
            return decryptSecret(secret.encryptedData);
          } catch (e) {
            logger.warn(`Failed to decrypt secret [${secretId}]: ${e.message}`);
          }
        }
        logger.warn(`Secret [${secretId}] not found or could not be decrypted.`);
        return `{{secret:${secretId}}}`;
      };

      // Setup CDP download interception
      await this.configureDownloadInterception(page);

      // Set active recording on replayEngine for context-aware execution
      this.replayEngine.recording = workflow.recordingData || { actions: steps };

      // Auto-navigate to target URL before steps execution
      await this.navigateToWorkflowTarget(page, workflow);

      // Execute each step in order
      for (let i = 0; i < steps.length; i++) {
        if (this.isAborted) {
          logger.warn(`[Runner] Abort signal active before step #${i + 1}. Stopping execution.`);
          manifest.status = 'STOPPED';
          break;
        }

        const step = steps[i];
        const stepType = step.type || step.action || 'CLICK';

        // Natural pacing delay: wait if the user waited during recording (e.g. for grid data to load)
        if (i > 0 && step.timeDeltaMs && step.timeDeltaMs > 0) {
          const paceDelay = Math.min(step.timeDeltaMs, 15000);
          if (paceDelay > 600) {
            logger.info(`[Runner] Pacing step #${i + 1}: waiting ${paceDelay}ms for page/grid to settle...`);
            const end = Date.now() + paceDelay;
            while (Date.now() < end) {
              if (this.isAborted) break;
              await new Promise(r => setTimeout(r, 100));
            }
          }
        }

        if (this.isAborted) {
          logger.warn(`[Runner] Abort signal active after pacing for step #${i + 1}. Stopping execution.`);
          manifest.status = 'STOPPED';
          break;
        }

        logger.info(`[Runner] Executing step ${i + 1}/${steps.length} [${stepType}]...`);
        const beforeStepFiles = this.snapshotDownloadedFiles();
        const stepResult = {
          stepIndex: i + 1,
          type: stepType,
          status: 'PENDING',
          startTime: new Date().toISOString()
        };

        try {
          await this.replayEngine.executeAction(step, i);
          stepResult.status = 'SUCCESS';
          manifest.itemsSucceeded++;

          if (stepType === 'CLICK' && this.downloadsDir) {
            const downloaded = await this.waitForDownload(beforeStepFiles, 1200);
            if (downloaded.length) {
              stepResult.downloadedFiles = downloaded.map(dl => {
                return this.processAndStoreDownload(dl.path, step.selector || `step_${i + 1}`, `Step #${i + 1}`) || dl;
              });
            }
          }
        } catch (stepErr) {
          if (this.isAborted) {
            stepResult.status = 'STOPPED';
            stepResult.error = 'Execution stopped by user';
            manifest.status = 'STOPPED';
            manifest.results.push(stepResult);
            break;
          }
          logger.error(`[Runner] Step #${i + 1} failed: ${stepErr.message}`);
          stepResult.status = 'FAILED';
          stepResult.error = stepErr.message;
          manifest.itemsFailed++;
        }

        stepResult.endTime = new Date().toISOString();
        manifest.results.push(stepResult);
        this.manifest = manifest;
        try {
          fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        } catch {}
        onProgress({ status: 'STEP_COMPLETE', stepResult, manifest });
      }

      // Gather and organize downloaded files into structured folder
      if (fs.existsSync(this.downloadsDir)) {
        const files = fs.readdirSync(this.downloadsDir)
          .filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
        manifest.downloadedFiles = files.map(file => {
          const rawPath = path.join(this.downloadsDir, file);
          const stored = this.processAndStoreDownload(rawPath, file, file);
          return stored || {
            filename: file,
            path: rawPath,
            sizeBytes: fs.statSync(rawPath).size
          };
        });
      }

      manifest.status = this.isAborted ? 'STOPPED' : 'COMPLETED';
      manifest.endTime = new Date().toISOString();
      logger.success(`\n[Runner] Standard execution run ${this.runId} ${manifest.status}! Succeeded: ${manifest.itemsSucceeded}/${steps.length}`);

    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED';
      manifest.error = err.message;
      manifest.endTime = new Date().toISOString();
      if (this.isAborted) {
        logger.warn(`[Runner] Execution run ${this.runId} stopped by user.`);
      } else {
        logger.error(`[Runner] Fatal execution failure: ${err.message}`);
      }
    }

    fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    onProgress({ status: manifest.status, manifest });

    return manifest;
  }

  /**
   * Execute a parameterized loop workflow
   * @param {object} workflow - Stored workflow object with steps array
   * @param {number} loopStepIndex - Index of the action to iterate over
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeLoop(workflow, loopStepIndex = 0, onProgress = () => {}) {
    this.initDirectories();
    const manifest = {
      runId: this.runId,
      workflowId: workflow.id,
      mode: 'LOOP',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      itemsTotal: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      itemsSkipped: 0,
      results: [],
      downloadedFiles: []
    };

    const checkpoint = this.loadLoopCheckpoint(workflow);
    if (checkpoint) {
      manifest.results = Array.isArray(checkpoint.results) ? checkpoint.results : [];
      manifest.itemsSucceeded = Number.isInteger(checkpoint.itemsSucceeded)
        ? checkpoint.itemsSucceeded
        : manifest.results.filter(result => result.status === 'SUCCESS').length;
      manifest.itemsFailed = Number.isInteger(checkpoint.itemsFailed)
        ? checkpoint.itemsFailed
        : manifest.results.filter(result => result.status === 'FAILED').length;
      manifest.itemsSkipped = Number.isInteger(checkpoint.itemsSkipped)
        ? checkpoint.itemsSkipped
        : manifest.results.filter(result => result.status === 'SKIPPED_DUPLICATE').length;
      manifest.downloadedFiles = Array.isArray(checkpoint.downloadedFiles)
        ? checkpoint.downloadedFiles
        : [];
      manifest.pagesProcessed = Number.isInteger(checkpoint.pagesProcessed)
        ? checkpoint.pagesProcessed
        : 1;
      manifest.itemsTotal = Number.isInteger(checkpoint.itemsTotal)
        ? checkpoint.itemsTotal
        : 0;
      manifest.activeItem = checkpoint.activeItem || null;
    }
    this.manifest = manifest;

    logger.info(`[Loop Runner] Starting execution run ${this.runId} for workflow "${workflow.name}"`);
    onProgress({ status: checkpoint ? 'RESUMING' : 'STARTING', manifest, checkpoint });

    try {
      const browser = await this.replayEngine.connect();
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      this.replayEngine.page = page;

      // Set up the secret resolver using the workflow's userId
      this.replayEngine.secretResolver = async (secretId) => {
        const secret = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
        if (secret && secret.encryptedData) {
          try {
            return decryptSecret(secret.encryptedData);
          } catch (e) {
            logger.warn(`Failed to decrypt secret [${secretId}]: ${e.message}`);
          }
        }
        logger.warn(`Secret [${secretId}] not found or could not be decrypted. Falling back to placeholder.`);
        return `{{secret:${secretId}}}`;
      };

      // Setup CDP download interception
      await this.configureDownloadInterception(page);

      // Set active recording on replayEngine for context-aware execution
      this.replayEngine.recording = workflow.recordingData || { actions: workflow.steps || [] };

      // Auto-navigate to workflow target URL before executing setup / loop steps
      await this.navigateToWorkflowTarget(page, workflow);

      // Ensure the same selector resolver used by normal replay is available to
      // ItemDiscovery before it tries to resolve the recorded target.
      await this.replayEngine._ensureSelectorResolverInFrame(page.mainFrame());

      // 1. Partition steps into Setup vs Loop Steps
      const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];

      // Determine effective loopStepIndex:
      let effectiveLoopStepIndex = Number.isInteger(loopStepIndex) ? loopStepIndex : null;
      if (effectiveLoopStepIndex === null || effectiveLoopStepIndex === 0) {
        if (Number.isInteger(workflow.loopStepIndex) && workflow.loopStepIndex >= 0) {
          effectiveLoopStepIndex = workflow.loopStepIndex;
        } else if (Number.isInteger(workflow.settings?.loopStepIndex) && workflow.settings.loopStepIndex >= 0) {
          effectiveLoopStepIndex = workflow.settings.loopStepIndex;
        } else {
          const autoIdx = LoopDetector.findLoopCandidateIndex(steps);
          if (autoIdx >= 0) {
            effectiveLoopStepIndex = autoIdx;
          } else {
            effectiveLoopStepIndex = 0;
          }
        }
      }

      const partition = LoopDetector.partitionWorkflow(steps, effectiveLoopStepIndex);
      const targetStep = partition.loopSteps[0];
      if (!targetStep) {
        logger.warn(`[Loop Runner] No loop target action found at index ${effectiveLoopStepIndex}. Falling back to standard execution.`);
        return await this.executeStandard(workflow, onProgress);
      }
      const analysis = LoopDetector.analyzeStep(targetStep);

      manifest.loopStepIndex = effectiveLoopStepIndex;

      logger.info(`[Loop Runner] Loop starts at step index ${effectiveLoopStepIndex} (Setup: ${partition.setupSteps.length} step(s), Loop: ${partition.loopSteps.length} action(s))`);
      logger.info(`[Loop Runner] Detected pattern: ${analysis.patternType} (Container: ${analysis.containerSelector})`);

      // 2. Execute Setup Steps Once (e.g. Login & Navigate)
      if (partition.setupSteps.length > 0) {
        logger.info(`[Loop Runner] Executing ${partition.setupSteps.length} setup step(s)...`);
        for (let i = 0; i < partition.setupSteps.length; i++) {
          await this.replayEngine.executeAction(partition.setupSteps[i], i);
        }
      }

      // Capture the current page URL for state restoration. This must be updated
      // per pagination page so retries on page 2+ do not accidentally return to page 1.
      let currentPageUrl = page.url();

      // 3. Discover the collection from the element the user actually recorded.
      // ItemDiscovery replaces the old nth-child/container-only heuristic for the
      // first generalized execution path.
      let discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
        minItems: 2,
        minScore: 0.55
      });

      if (!discovery.success || discovery.itemCount < 2) {
        logger.warn(`[Loop Runner] Item discovery did not detect multiple items: ${discovery.reason || 'only single item found'}. Falling back to standard execution.`);
        return await this.executeStandard(workflow, onProgress);
      }

      if (!checkpoint) {
        manifest.itemsTotal = discovery.itemCount;
        manifest.pagesProcessed = 1;
      }

      // Convert recorded actions: items inside collection become item-relative,
      // subsequent page actions (e.g. backdrop, Run Report, Export to Excel) are page-scoped.
      const generalizedActions = ActionGeneralizer.generalizeActions(partition.loopSteps, discovery.collection);

      const isDropdown = this.isDropdownOptionCollection(discovery.collection, discovery.items);
      const triggerStep = partition.setupSteps.length > 0
        ? partition.setupSteps[partition.setupSteps.length - 1]
        : null;

      logger.info(`[Loop Runner] Discovered ${discovery.itemCount} repeated item(s) with confidence ${Math.round(discovery.confidence * 100)}% (Dropdown Mode: ${isDropdown})`);
      logger.info(`[Loop Runner] Generalized ${generalizedActions.length} loop action(s) (${generalizedActions.filter(a => a.scope === 'item').length} item-scoped, ${generalizedActions.filter(a => a.scope === 'page').length} page-scoped).`);
      onProgress({ status: 'PROCESSING_ITEMS', manifest, discovery, generalizedActions });

      // 4. Process the current page, then optionally advance through pagination.
      // Pagination is opt-in through workflow.pagination.enabled to avoid clicking
      // unrelated "Next" controls on portals that do not use paging.
      const paginationEnabled = workflow.pagination?.enabled === true;
      const maxPages = Number.isInteger(workflow.pagination?.maxPages)
        ? Math.max(1, workflow.pagination.maxPages)
        : 100;
      let currentPage = 1;
      const resumePage = checkpoint && Number.isInteger(checkpoint.currentPage)
        ? checkpoint.currentPage
        : 1;
      const resumePageItemIndex = checkpoint && Number.isInteger(checkpoint.currentPageItemIndex)
        ? checkpoint.currentPageItemIndex
        : 0;
      const resumeActionOffset = checkpoint && Number.isInteger(checkpoint.currentActionOffset)
        ? checkpoint.currentActionOffset
        : 0;
      const resumeItemIndex = checkpoint && Number.isInteger(checkpoint.currentItemIndex)
        ? checkpoint.currentItemIndex
        : null;

      while (true) {
        currentPageUrl = page.url();

        if (currentPage < resumePage) {
          const beforeResumeFingerprint = await this.getCollectionFingerprint(page, discovery.collection);
          const advancedToResumePage = await this.advanceToNextPage(page, workflow);
          if (!advancedToResumePage) {
            throw new Error(`Could not reach checkpoint page #${resumePage}`);
          }

          const nextDiscovery = await ItemDiscovery.discover(
            page,
            targetStep.target || targetStep.fingerprint,
            { minItems: 1, minScore: 0.55 }
          );
          if (!nextDiscovery.success || nextDiscovery.itemCount < 1) {
            throw new Error(`Could not rediscover item collection while resuming page #${currentPage + 1}`);
          }

          const afterResumeFingerprint = await this.getCollectionFingerprint(page, nextDiscovery.collection);
          if (
            beforeResumeFingerprint &&
            afterResumeFingerprint &&
            beforeResumeFingerprint === afterResumeFingerprint
          ) {
            throw new Error(`Pagination did not advance while resuming page #${currentPage + 1}`);
          }

          discovery = nextDiscovery;
          currentPage++;
          manifest.pagesProcessed = currentPage;
          manifest.itemsTotal += discovery.itemCount;
          currentPageUrl = page.url();
          continue;
        }

        for (let i = 0; i < discovery.itemCount; i++) {
        if (this.isAborted) {
          logger.warn(`[Loop Runner] Abort signal active before item #${i + 1}. Stopping loop.`);
          manifest.status = 'STOPPED';
          break;
        }

        if (checkpoint && currentPage === resumePage && i < resumePageItemIndex) {
          continue;
        }

        logger.info(`\n[Loop Runner] --- Processing item [${i + 1}/${discovery.itemCount}] ---`);

        // Extract human-readable item identifier (text, link href, or data attribute)
        const itemIdentifier = await this.extractItemIdentifier(page, discovery, i, isDropdown);

        // Hybrid Deduplication Check: UI Identifier + DB Metadata + Physical Disk File
        const dedupe = this.checkIfAlreadyDownloaded(itemIdentifier.itemKey);
        if (dedupe.isDuplicate && !this.forceRedownload) {
          logger.info(`[Loop Runner] Skipping item #${i + 1} ("${itemIdentifier.itemLabel}") — already downloaded: "${dedupe.record.filename}" (${dedupe.record.filePath})`);
          const skippedIndex = resumeItemIndex != null && currentPage === resumePage && i === resumePageItemIndex
            ? resumeItemIndex
            : manifest.results.reduce((max, result) => Math.max(max, Number(result.index) || 0), 0) + 1;

          const skippedResult = {
            index: skippedIndex,
            itemIndex: i,
            page: currentPage,
            label: itemIdentifier.itemLabel,
            itemKey: itemIdentifier.itemKey,
            status: 'SKIPPED_DUPLICATE',
            skippedReason: `Already downloaded: ${dedupe.record.filename}`,
            existingFile: dedupe.record.filePath,
            downloadedFiles: [{
              filename: dedupe.record.filename,
              path: path.resolve(process.cwd(), dedupe.record.filePath),
              relativePath: dedupe.record.filePath,
              sizeBytes: dedupe.record.fileSizeBytes,
              skipped: true
            }],
            timestamp: new Date().toISOString()
          };

          manifest.results.push(skippedResult);
          manifest.itemsSkipped = (manifest.itemsSkipped || 0) + 1;
          this.manifest = manifest;
          this.writeLoopCheckpoint(manifest, skippedIndex, 0, currentPage, i, skippedResult);
          try {
            fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
          } catch {}
          onProgress({ status: 'ITEM_SKIPPED', itemResult: skippedResult, manifest });
          continue;
        }

        const isResumingCurrentItem =
          checkpoint &&
          currentPage === resumePage &&
          i === resumePageItemIndex &&
          resumeItemIndex != null;

        const itemResult = isResumingCurrentItem && checkpoint.activeItem
          ? { ...checkpoint.activeItem, status: 'PENDING', error: null }
          : {
              index: resumeItemIndex != null && currentPage === resumePage && i === resumePageItemIndex
                ? resumeItemIndex
                : manifest.results.reduce((max, result) => Math.max(max, Number(result.index) || 0), 0) + 1,
              status: 'PENDING',
              itemKey: itemIdentifier.itemKey,
              label: itemIdentifier.itemLabel,
              timestamp: new Date().toISOString(),
              error: null
            };
        const startingActionOffset =
          checkpoint && currentPage === resumePage && i === resumePageItemIndex
            ? resumeActionOffset
            : 0;
        this.writeLoopCheckpoint(
          manifest,
          itemResult.index,
          startingActionOffset,
          currentPage,
          i,
          itemResult
        );

        try {
          itemResult.actions = Array.isArray(itemResult.actions) ? itemResult.actions : [];
          itemResult.downloadedFiles = Array.isArray(itemResult.downloadedFiles) ? itemResult.downloadedFiles : [];
          itemResult.attempts = Number.isInteger(itemResult.attempts) ? itemResult.attempts : 0;
          itemResult.retryCount = Number.isInteger(itemResult.retryCount) ? itemResult.retryCount : 0;

          let completed = false;
          let lastError = null;
          let nextActionOffset = startingActionOffset;

          for (let attempt = 0; attempt <= this.maxItemRetries && !completed; attempt++) {
            if (this.isAborted) throw new Error('Execution stopped by user');

            itemResult.attempts = attempt + 1;
            if (attempt > 0) {
              itemResult.retryCount = attempt;
              logger.warn('[Loop Runner] Retrying item #' + (i + 1) + ' (attempt ' + (attempt + 1) + '/' + (this.maxItemRetries + 1) + ')');
              await new Promise(r => setTimeout(r, 500));

              // Reacquire the live DOM item and resume at the failed action checkpoint.
              if (page.url() !== currentPageUrl) {
                try {
                  await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' });
                  await new Promise(r => setTimeout(r, 1000));
                } catch (restoreErr) {
                  logger.warn('[Loop Runner] Could not restore list state before retry: ' + restoreErr.message);
                }
              }
            }

            try {
              for (let actionOffset = nextActionOffset; actionOffset < generalizedActions.length; actionOffset++) {
                if (this.isAborted) throw new Error('Execution stopped by user');

                const action = generalizedActions[actionOffset];
                const actionType = action.type || action.action || 'CLICK';
                const beforeActionFiles = this.snapshotDownloadedFiles();

                if (isDropdown && actionOffset === 0 && action.scope === 'item') {
                  // Sequential single-selection dropdown checkbox logic:
                  // 1. Ensure dropdown is open
                  await this.ensureDropdownOpen(page, triggerStep);
                  // 2. Uncheck previous option(s), check target option i
                  const selectResult = await this.executeDropdownOptionSingleSelect(page, i);
                  if (!selectResult.success) {
                    throw new Error(`Dropdown option selection failed for item #${i + 1}: ${selectResult.reason || 'Could not verify target option was selected'}`);
                  }
                  logger.info(`[Loop Runner] Item #${i + 1}/${discovery.itemCount}: Checked "${selectResult.targetText}", previous selections cleared.`);
                } else if (action.scope === 'item') {
                  const itemHandle = await ItemDiscovery.getItemHandle(page, discovery, i);
                  const itemElement = itemHandle.asElement();
                  if (!itemElement) {
                    await itemHandle.dispose().catch(() => {});
                    throw new Error(`Item at index ${i} could not be resolved`);
                  }

                  try {
                    await this.replayEngine.executeActionWithinItem(
                      itemElement,
                      action,
                      effectiveLoopStepIndex + actionOffset
                    );
                  } finally {
                    await itemElement.dispose().catch(() => {});
                  }
                } else {
                  // Page-scoped action (e.g. click backdrop, Run Report, Export to Excel)
                  await this.replayEngine.executeAction(
                    action,
                    effectiveLoopStepIndex + actionOffset
                  );
                }

                const actionResult = {
                  index: effectiveLoopStepIndex + actionOffset + 1,
                  type: actionType,
                  status: 'SUCCESS'
                };

                if (actionType === 'CLICK' && this.downloadsDir) {
                  const downloaded = await this.waitForDownload(beforeActionFiles, 1200);
                  if (downloaded.length) {
                    for (const dl of downloaded) {
                      const organized = this.processAndStoreDownload(dl.path, itemIdentifier.itemKey, itemIdentifier.itemLabel);
                      itemResult.downloadedFiles.push(organized || dl);
                    }
                    actionResult.downloadedFiles = downloaded.map(file => file.filename);
                  }
                }

                itemResult.actions.push(actionResult);
                nextActionOffset = actionOffset + 1;
                this.writeLoopCheckpoint(
                  manifest,
                  itemResult.index,
                  nextActionOffset,
                  currentPage,
                  i,
                  itemResult
                );
                await new Promise(r => setTimeout(r, 300));
              }

              // Allow the complete per-item procedure to settle before restoring state.
              await new Promise(r => setTimeout(r, 800));

              // Close any auxiliary tabs opened by item actions (e.g. target="_blank" download links)
              try {
                const browserPages = await page.browser().pages();
                for (const p of browserPages) {
                  if (p !== page && !p.isClosed()) {
                    logger.info('[Loop Runner] Closing auxiliary tab opened during item replay: ' + p.url());
                    await p.close().catch(() => {});
                  }
                }
                await page.bringToFront().catch(() => {});
              } catch {}

              // Resilient state restoration back to the item collection page
              if (page.url() !== currentPageUrl) {
                logger.info('[Loop Runner] Restoring state -> Navigating back to: ' + currentPageUrl);
                await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
                await new Promise(r => setTimeout(r, 1000));
              } else {
                // Dismiss any open dropdown, context menu, or overlay modal (e.g. cdk-overlay-backdrop)
                try {
                  await page.keyboard.press('Escape');
                  await new Promise(r => setTimeout(r, 200));
                } catch {}
              }

              // Ensure the collection list container is present on the page before next item
              if (discovery.collection && discovery.collection.ancestorSelector) {
                try {
                  await page.waitForSelector(discovery.collection.ancestorSelector, { timeout: 3000 }).catch(() => {});
                } catch {}
              }

              completed = true;
            } catch (attemptErr) {
              lastError = attemptErr;
              logger.warn('[Loop Runner] Item #' + (i + 1) + ' attempt ' + (attempt + 1) + ' failed at action #' + (nextActionOffset + 1) + ': ' + attemptErr.message);

              if (attempt < this.maxItemRetries) {
                // Keep the checkpoint at the first action that did not complete.
                continue;
              }
            }
          }

          if (!completed) {
            throw lastError || new Error('Item #' + (i + 1) + ' failed after ' + itemResult.attempts + ' attempt(s)');
          }

          itemResult.status = 'SUCCESS';
          manifest.itemsSucceeded++;
          if (itemResult.downloadedFiles.length) {
            manifest.downloadedFiles.push(...itemResult.downloadedFiles);
          }
        } catch (itemErr) {
          if (this.isAborted) {
            itemResult.status = 'STOPPED';
            itemResult.error = 'Execution stopped by user';
            manifest.status = 'STOPPED';
            manifest.results.push(itemResult);
            break;
          }
          logger.error(`[Loop Runner] Error on item #${i + 1}: ${itemErr.message}`);
          itemResult.status = 'FAILED';
          itemResult.error = itemErr.message;
          manifest.itemsFailed++;

          // Attempt recovery
          try {
            const browserPages = await page.browser().pages();
            for (const p of browserPages) {
              if (p !== page && !p.isClosed()) {
                await p.close().catch(() => {});
              }
            }
            await page.bringToFront().catch(() => {});
            if (page.url() !== currentPageUrl) {
              await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            } else {
              await page.keyboard.press('Escape').catch(() => {});
            }
          } catch {
            // Ignore recovery error
          }
        }

        manifest.results.push(itemResult);
        this.manifest = manifest;
        try {
          fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        } catch {}
        this.writeLoopCheckpoint(
          manifest,
          itemResult.status === 'SUCCESS' ? null : itemResult.index,
          null,
          currentPage,
          itemResult.status === 'SUCCESS' ? i + 1 : i,
          null
        );
        onProgress({ status: 'ITEM_COMPLETE', itemResult, manifest });
      }

        if (!paginationEnabled || currentPage >= maxPages) {
          break;
        }

        const beforePageFingerprint = await this.getCollectionFingerprint(page, discovery.collection);
        const advanced = await this.advanceToNextPage(page, workflow);
        if (!advanced) {
          logger.info('[Loop Runner] No next page control found. Pagination complete.');
          break;
        }

        const previousItemCount = discovery.itemCount;
        const nextDiscovery = await ItemDiscovery.discover(
          page,
          targetStep.target || targetStep.fingerprint,
          { minItems: 1, minScore: 0.55 }
        );

        if (!nextDiscovery.success || nextDiscovery.itemCount < 1) {
          logger.info('[Loop Runner] Next page did not expose a discoverable item collection. Pagination complete.');
          break;
        }

        const afterPageFingerprint = await this.getCollectionFingerprint(page, nextDiscovery.collection);
        if (beforePageFingerprint && afterPageFingerprint && beforePageFingerprint === afterPageFingerprint) {
          logger.info('[Loop Runner] Next control did not change the discovered collection. Pagination complete.');
          break;
        }

        discovery = nextDiscovery;
        manifest.itemsTotal += discovery.itemCount;
        manifest.pagesProcessed = currentPage + 1;
        currentPage++;
        currentPageUrl = page.url();
        this.writeLoopCheckpoint(manifest, null, null, currentPage, null, null);
        logger.info('[Loop Runner] Advanced to page #' + currentPage + ' with ' + discovery.itemCount + ' item(s).');
        onProgress({ status: 'PAGE_COMPLETE', page: currentPage, manifest, discovery });

        if (discovery.itemCount === previousItemCount && currentPage >= maxPages) {
          break;
        }
      }

      // 5. Gather and organize all downloaded files into structured folder
      if (fs.existsSync(this.downloadsDir)) {
        const files = fs.readdirSync(this.downloadsDir)
          .filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
        manifest.downloadedFiles = files.map(file => {
          const rawPath = path.join(this.downloadsDir, file);
          const stored = this.processAndStoreDownload(rawPath);
          return stored || {
            filename: file,
            path: rawPath,
            sizeBytes: fs.statSync(rawPath).size
          };
        });
      }

      manifest.status = this.isAborted ? 'STOPPED' : (manifest.itemsFailed > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
      manifest.endTime = new Date().toISOString();
      this.writeLoopCheckpoint(manifest, null, null, currentPage, null, null);
      logger.success(`\n[Loop Runner] Run ${this.runId} ${manifest.status}! Succeeded: ${manifest.itemsSucceeded}, Failed: ${manifest.itemsFailed}`);

    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED';
      manifest.error = err.message;
      manifest.endTime = new Date().toISOString();
      if (this.isAborted) {
        logger.warn(`[Loop Runner] Loop run ${this.runId} stopped by user.`);
      } else {
        logger.error(`[Loop Runner] Fatal run failure: ${err.message}`);
      }
    }

    // Save manifest file
    fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    onProgress({ status: manifest.status, manifest });

    return manifest;
  }
}

module.exports = LoopReplayRunner;
