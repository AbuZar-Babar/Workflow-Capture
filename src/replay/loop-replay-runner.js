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
const { resolveTargetUrl, extractWorkflowStartUrl } = require('../utils/url-helper');
const {
  normalizeItemFilter,
  validateItemFilter,
  evaluateItemFilter: sharedEvaluateItemFilter,
  evaluateFilterPreview,
  extractAvailableFields
} = require('../shared/item-filter');
const { ConditionEvaluator } = require('../shared/condition-evaluator');
const { validateLoopData } = require('../shared/loop-data');
const { PageInspector } = require('../shared/page-inspector');
const { IntentCompiler } = require('../engine/intent-compiler');
const { SemanticResolver } = require('./semantic-resolver');

class LoopReplayRunner {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.runId = options.runId || `run_${Date.now()}`;
    this.workflowId = options.workflowId || null;
    this.workflowName = options.workflowName || 'workflow';
    this.forceRedownload = options.forceRedownload === true;
    this.itemMode = ['new', 'old', 'all'].includes(options.itemMode) ? options.itemMode : 'new';
    this.maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : null;

    this.runsDir = path.resolve(process.cwd(), 'recordings', 'runs', this.runId);
    this.downloadsDir = path.join(this.runsDir, 'downloads');
    this.replayEngine = new ReplayEngine({ cdpPort: this.cdpPort });
    this.maxItemRetries = Number.isInteger(options.maxItemRetries) ? Math.max(0, options.maxItemRetries) : 1;
    this.resumeFromCheckpoint = options.resumeFromCheckpoint === true;
    this.isAborted = false;

    // Filter and limit configuration
    const rawFilter = options.itemFilter !== undefined
      ? options.itemFilter
      : (options.rowFilter || (options.filterValue ? { column: options.filterColumn || 'Type', value: options.filterValue } : null));
    const filterValidation = validateItemFilter(rawFilter);
    this.itemFilter = filterValidation.valid ? filterValidation.filter : (options.itemFilter || null);
    this.filterValidationError = filterValidation.valid ? null : filterValidation.error;

    let validatedLimit = null;
    let limitError = null;
    if (options.loopLimit !== undefined && options.loopLimit !== null) {
      if (typeof options.loopLimit === 'number' && Number.isInteger(options.loopLimit) && options.loopLimit > 0) {
        validatedLimit = options.loopLimit;
      } else if (typeof options.loopLimit === 'string' && /^\d+$/.test(options.loopLimit.trim()) && parseInt(options.loopLimit.trim(), 10) > 0) {
        validatedLimit = parseInt(options.loopLimit.trim(), 10);
      } else {
        limitError = 'Invalid loopLimit: must be a positive integer';
      }
    }
    this.loopLimit = validatedLimit;
    this.loopLimitError = limitError;
    this.rowFilter = options.itemFilter || options.rowFilter || null;

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
      await this.replayEngine.abort().catch(() => { });
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
        sizeBytes: fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 0
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
      logger.warn(`[Runner] Could not update workflow download manifest: ${err.message}`);
    }
  }

  /**
   * Checks whether an item has already been downloaded for this workflow.
   * Verifies database records, physical presence on disk, and file names in workflow downloads folder.
   * Also evaluates Due Date / Days Old if itemFields are provided.
   */
  checkIfAlreadyDownloaded(itemKey, invoiceNumber = null, itemFields = {}) {
    if (!itemKey && !invoiceNumber) return { isDuplicate: false };

    // 1. Database check
    if (this.workflowId) {
      const records = db.find('downloads', d =>
        d.workflowId === this.workflowId && (
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

  /**
   * Checks whether the discovered collection/table is still present and accessible in the DOM.
   */
  async isCollectionPresent(page, discovery) {
    if (!page || !discovery || !discovery.collection) return false;
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) return false;

      // 1. In ExtJS, check if any rendered/visible grid exists with rows
      const hasExtGrid = await page.evaluate(() => {
        if (window.Ext && window.Ext.ComponentQuery) {
          try {
            const grids = window.Ext.ComponentQuery.query('grid, gridpanel');
            return grids.some(g => {
              if (!g.rendered || !g.isVisible || !g.isVisible()) return false;
              const el = g.getEl && g.getEl().dom;
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 50 && rect.height > 50 && rect.top > -500 && rect.left > -500 &&
                g.getStore && g.getStore() && g.getStore().getCount() > 0;
            });
          } catch (e) {
            return false;
          }
        }
        return false;
      }).catch(() => false);
      if (hasExtGrid) return true;

      // 2. Direct page check: see if collection container exists and is visible in main page DOM without traversing child frames
      const selector = discovery.collection.ancestorSelector || discovery.collection.containerSelector || '.x-grid, [role="grid"], table tbody';
      const existsInMainPage = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 20 && rect.top > -500 && rect.left > -500;
      }, selector).catch(() => false);
      if (existsInMainPage) return true;

      // 3. Safe handle fallback across frames
      const handle = await ItemDiscovery.getItemHandle(page, discovery, 0).catch(() => null);
      const el = handle ? handle.asElement() : null;
      if (el) {
        const isElVisible = await el.evaluate(node => {
          if (!node || !node.isConnected) return false;
          const s = window.getComputedStyle(node);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const r = node.getBoundingClientRect();
          return r.width > 5 && r.height > 5 && r.top > -500 && r.left > -500;
        }).catch(() => false);
        if (typeof el.dispose === 'function') await el.dispose().catch(() => { });
        if (isElVisible) return true;
      }
      if (handle && typeof handle.dispose === 'function') await handle.dispose().catch(() => { });
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clears any active row selections in ExtJS, AG-Grid, or standard HTML tables
   * to ensure sequential 1-by-1 iteration without multi-selection accumulation.
   */
  async clearGridSelections(page, discovery) {
    if (!page) return;
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) return;
      await page.evaluate(() => {
        // 1. ExtJS Component API: deselectAll on all rendered/visible grids
        if (window.Ext && window.Ext.ComponentQuery) {
          try {
            const grids = window.Ext.ComponentQuery.query('grid, gridpanel');
            for (const grid of grids) {
              const sm = grid.getSelectionModel && grid.getSelectionModel();
              if (sm && typeof sm.deselectAll === 'function') {
                sm.deselectAll();
              }
            }
          } catch (e) {}
        }

        // 2. DOM-based deselect: find all selected rows
        const selectedRows = Array.from(document.querySelectorAll(
          '.x-grid-item-selected, .x-grid-row-selected, tr.selected, [aria-selected="true"]'
        ));

        for (const row of selectedRows) {
          const checker = row.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]');
          if (checker) {
            checker.click();
          } else {
            row.classList.remove('x-grid-item-selected', 'x-grid-row-selected');
            row.removeAttribute('aria-selected');
          }
        }

        // 3. Uncheck any checked checkboxes in the grid body
        const checkedBoxes = Array.from(document.querySelectorAll(
          '.x-grid-body input[type="checkbox"]:checked, [role="grid"] input[type="checkbox"]:checked, table tbody input[type="checkbox"]:checked'
        ));
        for (const cb of checkedBoxes) {
          cb.click();
        }

        // 4. Header select-all checker deselect if checked
        const headerChecker = document.querySelector('.x-grid-hd-checker-on, .x-column-header-checkbox.x-grid-hd-checker-on');
        if (headerChecker) {
          headerChecker.click();
        }
      });
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      logger.warn(`[Loop Runner] clearGridSelections note: ${err.message}`);
    }
  }

  /**
   * Enforces that ONLY the target row index is selected, and all other rows are deselected.
   */
  async enforceGridRowSingleSelection(page, discovery, targetIndex) {
    if (!page) return;
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) return;
      await page.evaluate((targetIdx) => {
        // 1. ExtJS Component API: select targetIdx on the active/visible grid
        if (window.Ext && window.Ext.ComponentQuery) {
          try {
            const grids = window.Ext.ComponentQuery.query('grid, gridpanel');
            const visibleGrids = grids.filter(g => {
              if (!g.rendered || !g.isVisible || !g.isVisible()) return false;
              const el = g.getEl && g.getEl().dom;
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 50 && rect.height > 50 && rect.top > -500 && rect.left > -500;
            });

            for (const grid of visibleGrids) {
              const sm = grid.getSelectionModel && grid.getSelectionModel();
              if (sm && typeof sm.select === 'function') {
                sm.deselectAll();
                sm.select(targetIdx);
                return;
              }
            }
          } catch (e) {}
        }

        // 2. DOM-based selection for standard HTML tables / ARIA grids:
        const gridBody = document.querySelector('.x-grid-body, [role="grid"], table tbody') || document;
        // Collect DISTINCT row elements (do not mix table.x-grid-item and tr.x-grid-row)
        let rows = Array.from(gridBody.querySelectorAll('table.x-grid-item')).filter(r => {
          const rect = r.getBoundingClientRect();
          const style = window.getComputedStyle(r);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.top > -500;
        });
        if (!rows.length) {
          rows = Array.from(gridBody.querySelectorAll('tbody > tr:not(.x-grid-row-before), [role="row"]')).filter(r => {
            if (r.closest('thead, .x-grid-header-ct')) return false;
            const rect = r.getBoundingClientRect();
            const style = window.getComputedStyle(r);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.top > -500;
          });
        }

        const targetRow = rows[targetIdx];
        if (targetRow) {
          const isSelected = targetRow.classList.contains('x-grid-item-selected') ||
            targetRow.classList.contains('x-grid-row-selected') ||
            targetRow.getAttribute('aria-selected') === 'true' ||
            targetRow.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]');

          if (!isSelected) {
            const checker = targetRow.querySelector('.x-grid-row-checker, input[type="checkbox"], [role="checkbox"]');
            if (checker) checker.click();
            else targetRow.click();
          }
        }

        // Deselect any other row
        rows.forEach((r, idx) => {
          if (idx !== targetIdx) {
            const isSelected = r.classList.contains('x-grid-item-selected') ||
              r.classList.contains('x-grid-row-selected') ||
              r.getAttribute('aria-selected') === 'true';
            if (isSelected) {
              const checker = r.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]');
              if (checker) checker.click();
              r.classList.remove('x-grid-item-selected', 'x-grid-row-selected');
              r.removeAttribute('aria-selected');
            }
          }
        });
      }, targetIndex);
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      logger.warn(`[Loop Runner] enforceGridRowSingleSelection note: ${err.message}`);
    }
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

    // Check pre-discovered item fields first
    if (discovery && Array.isArray(discovery.items) && discovery.items[index]?.fields) {
      const fields = discovery.items[index].fields;
      const invNo = fields['Invoice Number'] || fields['Invoice No'] || fields['Invoice'];
      if (invNo) {
        const label = fields.Type ? `${invNo} (${fields.Type})` : invNo;
        return { itemKey: `invoice:${invNo}`, itemLabel: label, invoiceNumber: invNo };
      }
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
          const invMatch = text.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
          return {
            text: firstLine ? firstLine.slice(0, 100) : text.slice(0, 100),
            link,
            dataId,
            invoiceNo: invMatch ? invMatch[1] : null
          };
        });

        const invoiceNo = info.invoiceNo;
        const label = invoiceNo || info.text || info.dataId || `Item #${index + 1}`;
        const key = invoiceNo
          ? `invoice:${invoiceNo}`
          : (info.dataId
            ? `id:${info.dataId}`
            : (info.link ? `link:${info.link}` : `text:${label}`));
        return { itemKey: key, itemLabel: label, invoiceNumber: invoiceNo };
      }
    } catch (err) {
      logger.warn(`[Runner] Note extracting item identifier for item #${index + 1}: ${err.message}`);
    } finally {
      if (itemHandle) await itemHandle.dispose().catch(() => { });
    }

    return { itemKey: `item_${index + 1}`, itemLabel: `Item #${index + 1}` };
  }

  /**
   * Extracts fields from all discovered items in the collection using the browser DOM.
   * Pure and deterministic extraction of headers and cell values.
   */
  static async extractDiscoveredItems(page, discovery) {
    if (!page || !discovery || !discovery.collection) {
      return (discovery?.items || []).map((it, idx) => ({
        index: it.index !== undefined ? it.index : idx,
        label: it.text || `Item #${idx + 1}`,
        text: it.text || '',
        fields: it.fields || {}
      }));
    }

    try {
      const itemsWithFields = await page.evaluate(({ collection, items }) => {
        const visible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            rect.width > 0 && rect.height > 0;
        };

        const structuralSignature = (el) => {
          const children = Array.from(el.children).slice(0, 12)
            .map(child => child.tagName.toLowerCase()).join('>');
          return [
            el.tagName.toLowerCase(),
            children,
            el.getAttribute('role') || '',
            (el.getAttribute('data-testid') || '').replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '#'),
            (el.getAttribute('data-qa') || '').replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '#')
          ].join('|');
        };

        let ancestors = [];
        if (collection.ancestorSelector) {
          try {
            ancestors = Array.from(document.querySelectorAll(collection.ancestorSelector)).filter(visible);
          } catch {}
        }
        if (!ancestors.length && collection.ancestorTag) {
          ancestors = Array.from(document.querySelectorAll(collection.ancestorTag)).filter(visible);
        }

        let domElements = [];
        for (const ancestor of ancestors) {
          const exact = Array.from(ancestor.children).filter(child =>
            visible(child) &&
            child.tagName.toLowerCase() === collection.itemTag &&
            structuralSignature(child) === collection.itemSignature
          );
          if (exact.length > 0) {
            domElements = exact;
            break;
          }
          const compat = Array.from(ancestor.children).filter(child =>
            visible(child) && child.tagName.toLowerCase() === collection.itemTag
          );
          if (compat.length > 0) {
            domElements = compat;
            break;
          }
        }

        function extractFieldsFromElement(el) {
          const fields = {};
          if (!el) return fields;

          const table = (typeof el.closest === 'function' && el.closest('table, [role="grid"], [role="treegrid"], .dxgvTable')) ||
                        (typeof document !== 'undefined' && typeof document.querySelector === 'function' && document.querySelector('table, [role="grid"], [role="treegrid"], .dxgvTable'));
          const headers = [];
          if (table && typeof table.querySelectorAll === 'function') {
            const thead = typeof table.querySelector === 'function' ? table.querySelector('thead') : null;
            let headerEls = thead && typeof thead.querySelectorAll === 'function' ? Array.from(thead.querySelectorAll('th, td, [role="columnheader"]')) : [];
            if (!headerEls.length) {
              headerEls = Array.from(table.querySelectorAll('th, [role="columnheader"], .dxgvHeader'));
            }
            headerEls.forEach(h => {
              const t = (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' ');
              if (t) headers.push(t);
            });
          }

          let cellEls = [];
          if (typeof el.querySelectorAll === 'function') {
            cellEls = Array.from(el.querySelectorAll('td, [role="gridcell"], .dxgv, .cell'));
          }
          if (!cellEls.length && Array.isArray(el.children)) {
            cellEls = Array.from(el.children);
          }

          const cells = cellEls.map(c =>
            (c.innerText || c.textContent || '').trim().replace(/\s+/g, ' ')
          );

          if (headers.length > 0 && cells.length > 0) {
            headers.forEach((hName, idx) => {
              if (idx < cells.length) {
                fields[hName] = cells[idx];
              }
            });
          }

          if (cellEls.length > 0) {
            cellEls.forEach(c => {
              if (typeof c.getAttribute === 'function') {
                const attr = c.getAttribute('data-field') || c.getAttribute('data-column') || c.getAttribute('data-label') || c.getAttribute('data-name');
                if (attr && attr.trim()) {
                  fields[attr.trim()] = (c.innerText || c.textContent || '').trim().replace(/\s+/g, ' ');
                }
              }
            });
          }

          if (typeof el.querySelectorAll === 'function') {
            const dts = Array.from(el.querySelectorAll('dt'));
            const dds = Array.from(el.querySelectorAll('dd'));
            if (dts.length > 0 && dts.length === dds.length) {
              dts.forEach((dt, idx) => {
                const k = (dt.innerText || dt.textContent || '').trim().replace(/:$/, '');
                const v = (dds[idx].innerText || dds[idx].textContent || '').trim();
                if (k) fields[k] = v;
              });
            }
          }

          return fields;
        }

        const total = items ? items.length : domElements.length;
        const result = [];
        for (let i = 0; i < total; i++) {
          const base = items && items[i] ? items[i] : {};
          const domEl = domElements[i] || null;
          const extracted = domEl ? extractFieldsFromElement(domEl) : (base.fields || {});
          result.push({
            index: base.index !== undefined ? base.index : i,
            text: base.text || (domEl ? (domEl.innerText || domEl.textContent || '').trim() : ''),
            label: base.text || (domEl ? (domEl.innerText || domEl.textContent || '').trim() : `Item #${i + 1}`),
            tagName: base.tagName || (domEl ? domEl.tagName.toLowerCase() : ''),
            signature: base.signature || (domEl ? structuralSignature(domEl) : ''),
            href: base.href || (domEl ? domEl.querySelector('a[href]')?.href || null : null),
            id: base.id || (domEl ? domEl.id || null : null),
            fields: extracted
          });
        }
        return result;
      }, { collection: discovery.collection, items: discovery.items });

      return itemsWithFields;
    } catch (err) {
      return (discovery?.items || []).map((it, idx) => ({
        index: it.index !== undefined ? it.index : idx,
        label: it.text || `Item #${idx + 1}`,
        text: it.text || '',
        fields: it.fields || {}
      }));
    }
  }

  /**
   * Evaluates if a loop item matches the configured filter criteria.
   * Uses the shared item-filter evaluator over extracted DOM fields.
   */
  async evaluateItemFilter(page, discovery, index, filterInput = undefined) {
    const rawFilter = filterInput !== undefined
      ? filterInput
      : (this.itemFilter || this.rowFilter || null);

    if (!rawFilter || (!rawFilter.value && !rawFilter.text && !rawFilter.conditions && !rawFilter.field)) {
      return { matches: true, reason: 'No filter configured', column: null, actualValue: 'All' };
    }

    const rawVal = rawFilter.value || rawFilter.text;
    if (rawVal === '__any__' || rawVal === 'all') {
      return { matches: true, reason: 'All items accepted (no filter)', column: null, actualValue: 'All' };
    }

    // 1. Fast evaluation from discovery item fields if available
    if (discovery && Array.isArray(discovery.items) && discovery.items[index]?.fields) {
      const itemRecord = discovery.items[index].fields;
      const targetCol = String(rawFilter.column || rawFilter.field || 'type').toLowerCase();
      const actualVal = itemRecord[rawFilter.column] || itemRecord[rawFilter.field] || itemRecord.Type || itemRecord.label || itemRecord.fullText || '';
      const evalResult = ConditionEvaluator.evaluate(itemRecord, rawFilter);
      return {
        matches: evalResult.matches,
        reason: evalResult.reason || 'Matches configured condition',
        column: targetCol,
        actualValue: actualVal
      };
    }

    let itemHandle = null;
    try {
      itemHandle = await ItemDiscovery.getItemHandle(page, discovery, index);
      const itemEl = itemHandle ? (itemHandle.asElement ? itemHandle.asElement() : itemHandle) : null;
      if (!itemEl) {
        return {
          matches: false,
          field: rawFilter.column || rawFilter.field || null,
          column: rawFilter.column ? String(rawFilter.column).toLowerCase() : null,
          actualValue: null,
          expectedValue: null,
          operator: null,
          reason: 'Could not resolve element for filter',
          error: 'Could not resolve element for filter'
        };
      }

      const itemRecord = await itemEl.evaluate((el) => {
        const fullText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        let cellEls = Array.from(el.querySelectorAll('td, [role="gridcell"]'));
        if (cellEls.length === 0) {
          cellEls = Array.from(el.querySelectorAll('.x-grid-cell, .dxgv, .cell'));
        }

        // Account for checkbox selection column
        const isFirstCellChecker = cellEls.length > 0 && Boolean(
          cellEls[0].classList?.contains('x-grid-cell-special') ||
          cellEls[0].classList?.contains('x-grid-cell-row-checker') ||
          cellEls[0].querySelector?.('.x-grid-row-checker, input[type="checkbox"]')
        );
        const dataCellEls = isFirstCellChecker ? cellEls.slice(1) : cellEls;
        const cells = dataCellEls.map(c => (c.innerText || c.textContent || '').trim());

        const gridContainer = el.closest('.x-grid, table, [role="grid"], .dxgvTable') || document.querySelector('.x-grid, table, [role="grid"]');
        const record = {
          fullText,
          label: fullText.slice(0, 100),
          _cells: cells,
          Option: fullText,
          'Document Type': fullText,
          Text: fullText
        };

        if (gridContainer) {
          const headerCt = (typeof gridContainer.querySelector === 'function' ? gridContainer.querySelector('.x-grid-header-ct, thead, .x-grid-header-row') : null) || gridContainer;
          const headerEls = Array.from(typeof headerCt.querySelectorAll === 'function' ? headerCt.querySelectorAll('.x-column-header, th, [role="columnheader"]') : [])
            .filter(h => !h.parentElement?.closest?.('.x-column-header'));
          const colTexts = headerEls.map(h => {
            const inner = (typeof h.querySelector === 'function' ? h.querySelector('.x-column-header-text') : null) || h;
            return (inner.innerText || inner.textContent || '').trim();
          }).filter(t => t.length > 0);

          colTexts.forEach((hText, idx) => {
            if (hText && cells[idx] !== undefined) {
              record[hText] = cells[idx];
            }
          });
        }

        // Invoice Number fallback
        if (!record['Invoice Number']) {
          const invMatch = fullText.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
          if (invMatch) record['Invoice Number'] = invMatch[1];
        }

        // Type fallback
        if (!record['Type'] || record['Type'] === fullText || /^(SI|INV|DR|TX|CM)-\d+/i.test(record['Type'])) {
          if (/\bcredit\s*memo\b/i.test(fullText)) record['Type'] = 'Credit Memo';
          else if (/\binvoice\b/i.test(fullText)) record['Type'] = 'Invoice';
          else record['Type'] = fullText;
        }

        return record;
      });

      const targetCol = String(rawFilter.column || rawFilter.field || 'type').toLowerCase();
      const actualVal = itemRecord[rawFilter.column] || itemRecord[rawFilter.field] || itemRecord.Type || itemRecord.label || itemRecord.fullText || '';
      const evalResult = ConditionEvaluator.evaluate(itemRecord, rawFilter);
      return {
        matches: evalResult.matches,
        field: rawFilter.column || rawFilter.field || null,
        column: targetCol,
        actualValue: actualVal,
        expectedValue: rawFilter.value,
        operator: rawFilter.operator || 'contains',
        reason: evalResult.reason || (evalResult.matches ? 'Matches configured condition' : 'Does not match condition'),
        error: null
      };
    } catch (err) {
      logger.warn(`[Runner] Filter check note on item #${index + 1}: ${err.message}`);
      return { matches: true, reason: 'Filter check error fallback', column: targetCol, actualValue: null };
    } finally {
      if (itemHandle) await itemHandle.dispose().catch(() => { });
    }
  }

  /**
   * Efficiently detects all available elements on the page, identifies relevant options/items,
   * excludes non-data controls (like "Select All"), and filters items based on the condition.
   * Runs in a single pass instead of per-item RPC roundtrips.
   */
  async detectAndFilterItems(page, discovery, isDropdown, rowFilter, snapshotItems = null) {
    const filter = rowFilter || this.itemFilter || this.rowFilter || null;
    const rawVal = filter ? (filter.value || filter.text) : null;
    const hasConditions = Boolean(filter && Array.isArray(filter.conditions) && filter.conditions.length > 0);
    const isFilterActive = Boolean(filter && (hasConditions || (rawVal && rawVal !== '__any__' && rawVal !== 'all')));
    const targetCol = filter ? String(filter.column || filter.field || filter.conditions?.[0]?.field || 'type').toLowerCase() : 'type';

    let itemsData = [];

    // When supplied, snapshotItems contain the persisted field values used for
    // filtering. Their indexes are mapped to current live items for execution.
    if (Array.isArray(snapshotItems) && snapshotItems.length) {
      itemsData = snapshotItems.map((item, idx) => {
        const savedIndex = Number.isInteger(item?.index) ? item.index : idx;
        const savedHref = item?.href || null;
        const savedId = item?.id || null;
        const savedSignature = item?.signature || null;
        const savedText = String(item?.text || '').trim();

        const liveMatch = Array.isArray(discovery?.items)
          ? discovery.items.find(live => {
              if (savedId && live?.id && savedId === live.id) return true;
              if (savedHref && live?.href && savedHref === live.href) return true;
              if (savedSignature && live?.signature && savedSignature === live.signature) {
                const liveText = String(live?.text || '').trim();
                return !savedText || !liveText || savedText === liveText;
              }
              return false;
            })
          : null;

        return {
          ...item,
          index: Number.isInteger(liveMatch?.index) ? liveMatch.index : savedIndex,
          text: item?.text || '',
          isSelectAll: /select\s*all/i.test(item?.text || ''),
          fields: item?.fields || {}
        };
      });
    }

    if (!itemsData.length && isDropdown && page) {
      // For dropdowns: query all visible options in a single evaluate call
      itemsData = await page.evaluate(() => {
        const visible = el => {
          if (!el || !el.isConnected) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const opts = Array.from(document.querySelectorAll('mat-option, [role="option"], select option')).filter(visible);
        return opts.map((el, idx) => {
          const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          return {
            index: idx,
            text,
            isSelectAll: /select\s*all/i.test(text),
            fields: {
              Type: text,
              Option: text,
              'Document Type': text,
              Text: text,
              Value: text,
              fullText: text,
              label: text
            }
          };
        });
      }).catch(() => []);
    }

    // If non-dropdown or dropdown evaluate returned empty, use discovery.items
    if (!itemsData.length && discovery && Array.isArray(discovery.items) && discovery.items.length) {
      itemsData = discovery.items.map((item, idx) => {
        const text = item.text || '';
        return {
          index: item.index !== undefined ? item.index : idx,
          text,
          isSelectAll: /select\s*all/i.test(text),
          fields: item.fields || {
            Type: text,
            Option: text,
            'Document Type': text,
            Text: text,
            Value: text,
            fullText: text,
            label: text
          }
        };
      });
    }

    // Fallback if discovery.items is empty (e.g. synthetic test discovery with only itemCount)
    if (!itemsData.length) {
      const count = discovery ? (discovery.itemCount || 0) : 0;
      const fallbackList = [];
      for (let idx = 0; idx < count; idx++) {
        const itemIdentifier = await this.extractItemIdentifier(page, discovery, idx, isDropdown);
        let matches = true;
        let reason = 'Matches condition';
        if (isDropdown && /select\s*all/i.test(itemIdentifier.itemLabel)) {
          matches = false;
          reason = 'Dropdown "Select All" control excluded from data items';
        } else if (this.rowFilter) {
          const filterCheck = await this.evaluateItemFilter(page, discovery, idx, this.rowFilter);
          matches = filterCheck.matches;
          reason = filterCheck.reason;
        }
        fallbackList.push({
          index: idx,
          itemIdentifier,
          matches,
          reason
        });
      }
      return fallbackList;
    }

    // Evaluate all discovered items efficiently
    const evaluatedItems = [];
    for (const item of itemsData) {
      const fields = item.fields || {};
      const invoiceNo = fields['Invoice Number'] || fields['Invoice No'] || fields['Invoice'] ||
        (item.text && item.text.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i)?.[1]) || null;

      let itemLabel = item.text || `Item #${item.index + 1}`;
      if (invoiceNo) {
        itemLabel = fields.Type ? `${invoiceNo} (${fields.Type})` : invoiceNo;
      }
      const itemKey = isDropdown
        ? `dropdown:${itemLabel}`
        : (invoiceNo ? `invoice:${invoiceNo}` : `item_${item.index + 1}`);

      const itemIdentifier = { itemKey, itemLabel, invoiceNumber: invoiceNo };

      let matches = true;
      let reason = 'Matches condition';

      if (isDropdown && item.isSelectAll) {
        matches = false;
        reason = 'Dropdown "Select All" control excluded from data items';
      } else if (isFilterActive) {
        const evalResult = ConditionEvaluator.evaluate(item.fields, filter);
        matches = evalResult.matches;
        reason = evalResult.reason || (matches ? 'Matches configured condition' : `Filtered out by "${targetCol}"`);
      }

      evaluatedItems.push({
        index: item.index,
        itemIdentifier,
        fields: item.fields,
        matches,
        reason
      });
    }

    return evaluatedItems;
  }

  /**
   * Wait for a new completed download in this run's download directory.
   */
  async waitForDownload(previousFiles = [], timeoutMs = 10000) {
    const startedAt = Date.now();
    const previous = new Set(previousFiles);
    let effectiveTimeoutMs = timeoutMs;
    while (Date.now() - startedAt < effectiveTimeoutMs) {
      const files = fs.existsSync(this.downloadsDir)
        ? fs.readdirSync(this.downloadsDir)
        : [];
      const candidates = files.filter(file => !previous.has(file) && !file.endsWith('.crdownload') && !file.endsWith('.tmp'));
      if (candidates.length) {
        return candidates.map(filename => ({
          filename,
          path: path.join(this.downloadsDir, filename),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, filename)).size
        }));
      }

      // If a .crdownload file is active that was not there before, extend timeout to let it finish
      const inFlightCr = files.filter(file => !previous.has(file) && file.endsWith('.crdownload'));
      if (inFlightCr.length && effectiveTimeoutMs < 45000) {
        effectiveTimeoutMs = 45000;
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
    this._lastCursor = {
      currentItemIndex,
      currentActionOffset,
      currentPage,
      currentPageItemIndex,
      activeItem
    };
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
      matchingCount: manifest.matchingCount || 0,
      selectedCount: manifest.selectedCount || 0,
      skippedFilterCount: manifest.skippedFilterCount || 0,
      skippedLimitCount: manifest.skippedLimitCount || 0,
      skippedDuplicateCount: manifest.skippedDuplicateCount || 0,
      matching: manifest.matchingCount || 0,
      selected: manifest.selectedCount || 0,
      skippedFilter: manifest.skippedFilterCount || 0,
      skippedLimit: manifest.skippedLimitCount || 0,
      skippedDuplicate: manifest.skippedDuplicateCount || 0,
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
      const client = await configureTarget(page.target());
      logger.info(`[Runner] Configured CDP download path: ${this.downloadsDir}`);

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
      logger.warn(`[Runner] Warning configuring CDP download behavior: ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate browser to the workflow's designated target/start URL
   */
  async navigateToWorkflowTarget(page, workflow) {
    const resolved = extractWorkflowStartUrl(workflow);
    if (!resolved) {
      logger.info('[Runner] No target URL specified for workflow. Executing on active tab.');
      return;
    }

    try {
      await page.bringToFront().catch(() => { });
    } catch { }

    const currentUrl = page.url();
    let shouldNavigate = false;

    if (currentUrl === 'about:blank' || currentUrl.startsWith('chrome://')) {
      shouldNavigate = true;
    } else {
      try {
        const currentOrigin = new URL(currentUrl).origin;
        const targetOrigin = new URL(resolved).origin;
        if (currentOrigin !== targetOrigin) {
          shouldNavigate = true;
        } else {
          // Same origin: do NOT navigate back to /login if current page is already authenticated past login
          const isTargetLogin = /\/login\b/i.test(resolved);
          const isCurrentLogin = /\/login\b/i.test(currentUrl);
          if (isTargetLogin && !isCurrentLogin) {
            shouldNavigate = false;
            logger.info(`[Runner] Session already active at "${currentUrl}". Skipping navigation to login URL: ${resolved}`);
          } else if (currentUrl !== resolved && isCurrentLogin) {
            shouldNavigate = true;
          }
        }
      } catch {
        shouldNavigate = currentUrl !== resolved;
      }
    }

    if (shouldNavigate) {
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
      logger.info(`[Runner] Tab already at target URL: ${currentUrl}`);
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
      if (handle) await handle.dispose().catch(() => { });
      return false;
    }

    try {
      if (this.replayEngine) await this.replayEngine._setAutomatedAction(true, element);
      await element.scrollIntoViewIfNeeded().catch(() => { });
      await element.click();
    } finally {
      if (this.replayEngine) await this.replayEngine._setAutomatedAction(false);
      await element.dispose().catch(() => { });
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
      const selectHandle = await page.$('mat-select .mat-mdc-select-trigger, mat-select .mat-mdc-select-value, mat-select, [role="combobox"]').catch(() => null);
      if (selectHandle) {
        try {
          if (this.replayEngine) await this.replayEngine._setAutomatedAction(true, selectHandle);
          await selectHandle.click();
          await new Promise(r => setTimeout(r, 600));
        } finally {
          if (this.replayEngine) await this.replayEngine._setAutomatedAction(false);
          await selectHandle.dispose().catch(() => { });
        }
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

  async executeDropdownOptionSingleSelect(page, targetIndex, targetText = '') {
    return page.evaluate((targetIdx, expectedText) => {
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

      const cleanText = (str) => String(str || '').replace(/\s+/g, ' ').trim();

      const options = Array.from(document.querySelectorAll('mat-option, [role="option"], select option')).filter(visible);
      if (!options.length) {
        return { success: false, reason: 'No visible dropdown options found' };
      }

      // 1. Locate target option: prefer expectedText match if given, otherwise targetIdx
      let targetOpt = null;
      if (expectedText) {
        const norm = cleanText(expectedText).toLowerCase();
        targetOpt = options.find(o => cleanText(o.textContent).toLowerCase() === norm);
        if (!targetOpt) {
          targetOpt = options.find(o => {
            const t = cleanText(o.textContent).toLowerCase();
            return t && !/select\s*all/i.test(t) && (t.includes(norm) || norm.includes(t));
          });
        }
      }
      if (!targetOpt && targetIdx >= 0 && targetIdx < options.length) {
        targetOpt = options[targetIdx];
      }

      if (!targetOpt) {
        return {
          success: false,
          reason: `Target option not found (index: ${targetIdx}, text: "${expectedText}")`,
          totalOptions: options.length
        };
      }

      const actionsDone = [];

      // 2. Check if target option is already selected AND no other option is selected
      const selectAllOpt = options.find(o => /select\s*all/i.test(cleanText(o.textContent)));
      const otherSelected = options.filter(o => o !== targetOpt && isOptionSelected(o));

      if (isOptionSelected(targetOpt) && otherSelected.length === 0) {
        return {
          success: true,
          targetIndex: options.indexOf(targetOpt),
          targetText: cleanText(targetOpt.textContent).slice(0, 80),
          alreadySelected: true,
          actionsDone
        };
      }

      // 3. Handle "Select All" checkbox if present and currently checked
      if (selectAllOpt && selectAllOpt !== targetOpt && isOptionSelected(selectAllOpt)) {
        if (selectAllOpt.scrollIntoView) selectAllOpt.scrollIntoView({ block: 'nearest' });
        selectAllOpt.click();
        actionsDone.push({ action: 'UNCHECK_SELECT_ALL', text: cleanText(selectAllOpt.textContent).slice(0, 40) });
      }

      // 4. Safely uncheck any OTHER option that is currently selected (e.g. from previous loop item)
      // Never click unselected options!
      for (let idx = 0; idx < options.length; idx++) {
        const opt = options[idx];
        if (opt !== targetOpt && opt !== selectAllOpt && isOptionSelected(opt)) {
          if (opt.scrollIntoView) opt.scrollIntoView({ block: 'nearest' });
          opt.click();
          actionsDone.push({ action: 'UNCHECK', index: idx, text: cleanText(opt.textContent).slice(0, 40) });
        }
      }

      // 5. Click target option to select it
      if (!isOptionSelected(targetOpt)) {
        if (targetOpt.scrollIntoView) targetOpt.scrollIntoView({ block: 'nearest' });
        targetOpt.click();
        actionsDone.push({ action: 'CHECK', index: options.indexOf(targetOpt), text: cleanText(targetOpt.textContent).slice(0, 40) });
      }

      const targetIsNowSelected = isOptionSelected(targetOpt);
      return {
        success: targetIsNowSelected || actionsDone.some(a => a.action === 'CHECK'),
        targetIndex: options.indexOf(targetOpt),
        targetText: cleanText(targetOpt.textContent).slice(0, 80),
        totalOptions: options.length,
        actionsDone
      };
    }, targetIndex, targetText);
  }

  /**
   * Execute a standard sequential workflow (all steps in order)
   * @param {object} workflow - Stored workflow object with steps array
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeStandard(workflow, onProgress = () => { }) {
    this.initDirectories();
    const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || workflow.actions || [];
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
            const isDownloadAction = Boolean(
              (step.target?.candidates?.some(c => c.value && /download|export|save|pdf|print/i.test(c.value))) ||
              (step.target?.fingerprint?.attributes?.title && /download|export|save|pdf|print/i.test(step.target.fingerprint.attributes.title)) ||
              (step.target?.fingerprint?.text && /download|export|save|pdf|print/i.test(step.target.fingerprint.text))
            );
            const downloadWaitMs = isDownloadAction ? 12000 : 1200;
            const downloaded = await this.waitForDownload(beforeStepFiles, downloadWaitMs);
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
        } catch { }
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
    } finally {
      manifest.endTime = manifest.endTime || new Date().toISOString();
      if (this.isAborted) {
        manifest.status = 'STOPPED';
      }
      try {
        fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      } catch { }
      if (this._replayTargetCreatedListener && this.replayEngine?.browser) {
        try {
          this.replayEngine.browser.off('targetcreated', this._replayTargetCreatedListener);
        } catch { }
        this._replayTargetCreatedListener = null;
      }
      if (this.replayEngine) {
        await this.replayEngine.disconnect().catch(() => { });
      }
      onProgress({ status: manifest.status, manifest });
    }

    return manifest;
  }

  /**
   * Execute a parameterized loop workflow
   * @param {object} workflow - Stored workflow object with steps array
   * @param {number} loopStepIndex - Index of the action to iterate over
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeLoop(workflow, loopStepIndex = null, onProgress = () => { }) {
    this._limitReached = false;
    if (workflow) {
      if (!this.workflowId) this.workflowId = workflow.id || workflow.metadata?.recordingId;
      if (!this.workflowName || this.workflowName === 'workflow') this.workflowName = workflow.name || workflow.metadata?.name || workflow.id || 'workflow';
      const rawSlug = (this.workflowName || this.workflowId || 'workflow').toLowerCase();
      this.workflowSlug = rawSlug.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
      this.workflowDownloadsBaseDir = path.resolve(process.cwd(), 'downloads', this.workflowSlug);
      this.structuredDownloadsDir = path.resolve(this.workflowDownloadsBaseDir, this.dateStr);
    }
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
      matchingCount: 0,
      selectedCount: 0,
      skippedFilterCount: 0,
      skippedLimitCount: 0,
      skippedDuplicateCount: 0,
      matching: 0,
      selected: 0,
      skippedFilter: 0,
      skippedLimit: 0,
      skippedDuplicate: 0,
      itemFilter: this.itemFilter,
      loopLimit: this.loopLimit,
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
      manifest.skippedFilterCount = Number.isInteger(checkpoint.skippedFilterCount)
        ? checkpoint.skippedFilterCount
        : manifest.results.filter(result => result.status === 'SKIPPED_FILTER').length;
      manifest.skippedLimitCount = Number.isInteger(checkpoint.skippedLimitCount)
        ? checkpoint.skippedLimitCount
        : manifest.results.filter(result => result.status === 'SKIPPED_LIMIT').length;
      manifest.skippedDuplicateCount = Number.isInteger(checkpoint.skippedDuplicateCount)
        ? checkpoint.skippedDuplicateCount
        : manifest.results.filter(result => result.status === 'SKIPPED_DUPLICATE').length;
      manifest.itemsSkipped = Number.isInteger(checkpoint.itemsSkipped)
        ? checkpoint.itemsSkipped
        : (manifest.skippedFilterCount + manifest.skippedLimitCount + manifest.skippedDuplicateCount);
      manifest.matchingCount = Number.isInteger(checkpoint.matchingCount)
        ? checkpoint.matchingCount
        : manifest.results.filter(result => result.status !== 'SKIPPED_FILTER').length;
      manifest.selectedCount = Number.isInteger(checkpoint.selectedCount)
        ? checkpoint.selectedCount
        : manifest.results.filter(result => result.status !== 'SKIPPED_FILTER' && result.status !== 'SKIPPED_LIMIT').length;
      manifest.matching = manifest.matchingCount;
      manifest.selected = manifest.selectedCount;
      manifest.skippedFilter = manifest.skippedFilterCount;
      manifest.skippedLimit = manifest.skippedLimitCount;
      manifest.skippedDuplicate = manifest.skippedDuplicateCount;
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
    this._lastCursor = checkpoint ? {
      currentItemIndex: checkpoint.currentItemIndex ?? null,
      currentActionOffset: checkpoint.currentActionOffset ?? null,
      currentPage: checkpoint.currentPage ?? 1,
      currentPageItemIndex: checkpoint.currentPageItemIndex ?? null,
      activeItem: checkpoint.activeItem ?? null
    } : null;

    logger.info(`[Loop Runner] Starting execution run ${this.runId} for workflow "${workflow.name}"`);
    onProgress({ status: checkpoint ? 'RESUMING' : 'STARTING', manifest, checkpoint });

    let currentPage = 1;

    try {
      if (this.replayEngine) {
        this.replayEngine.isPaused = false;
        this.replayEngine.isAborted = false;
      }
      const browser = await this.replayEngine.connect();
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      this.replayEngine.page = page;
      const initialPageUrls = new Set(pages.map(p => p.url()));

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
      const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || workflow.actions || [];

      // Determine effective loopStepIndex:
      let effectiveLoopStepIndex = Number.isInteger(loopStepIndex) ? loopStepIndex : null;
      if (effectiveLoopStepIndex !== null) {
        const reqStep = steps[effectiveLoopStepIndex];
        const isNav = reqStep && LoopDetector.isNavigationOrChrome(
          reqStep.target?.candidates?.find(c => c && c.strategy === 'css-path')?.value || '',
          reqStep.target?.fingerprint || reqStep.fingerprint || {}
        );
        if (isNav) {
          const autoIdx = LoopDetector.findLoopCandidateIndex(steps);
          if (autoIdx >= 0) effectiveLoopStepIndex = autoIdx;
        }
      } else {
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
      const persistedLoopData = workflow.loopData || workflow.recordingData?.metadata?.loopData || null;
      const loopDataValidation = validateLoopData(persistedLoopData);
      const hasSavedLoopData = loopDataValidation.valid && Array.isArray(persistedLoopData.items) && persistedLoopData.items.length > 0;

      manifest.loopStepIndex = effectiveLoopStepIndex;

      logger.info(`[Loop Runner] Loop starts at step index ${effectiveLoopStepIndex} (Setup: ${partition.setupSteps.length} step(s), Loop: ${partition.loopSteps.length} action(s))`);
      logger.info(`[Loop Runner] Detected pattern: ${analysis.patternType} (Container: ${analysis.containerSelector})`);

      // Capture the current page URL for state restoration. This must be updated
      // per pagination page so retries on page 2+ do not accidentally return to page 1.
      let currentPageUrl = page.url();

      // If target step is an option/dropdown, ensure dropdown is open before ItemDiscovery
      const isDropdownCandidate = analysis.patternType === 'dropdown-option' ||
        targetStep.fingerprint?.parentTag === 'mat-option' ||
        targetStep.fingerprint?.tagName === 'mat-option' ||
        (targetStep.target?.candidates && targetStep.target.candidates.some(c => c && /mat-option|role=["']option["']/i.test(c.value)));

      if (isDropdownCandidate) {
        const triggerStep = partition.setupSteps.length > 0 ? partition.setupSteps[partition.setupSteps.length - 1] : null;
        await this.ensureDropdownOpen(page, triggerStep);
        await new Promise(r => setTimeout(r, 400));
      }

      // Check if the target collection is ALREADY open and visible in DOM before running setup steps
      let discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
        minItems: 2,
        minScore: 0.55
      }).catch(() => ({ success: false }));

      const alreadyOpen = Boolean(discovery && discovery.success && discovery.itemCount >= 2);

      if (alreadyOpen) {
        logger.info(`[Loop Runner] Target collection already open and visible in DOM (${discovery.itemCount} items). Skipping setup steps.`);
      } else if (partition.setupSteps.length > 0) {
        // Execute Setup Steps (e.g. Login & Navigate)
        logger.info(`[Loop Runner] Executing ${partition.setupSteps.length} setup step(s)...`);
        for (let i = 0; i < partition.setupSteps.length; i++) {
          const step = partition.setupSteps[i];
          const isLogin = (step.target?.candidates?.some(c => /login|signin/i.test(c.value || ''))) ||
            /login|signin/i.test(step.name || step.elementName || '');
          const isCurrentLogin = /\/login\b/i.test(page.url());
          if (isLogin && !isCurrentLogin) {
            logger.info(`[Loop Runner] Skipping setup login step #${i + 1} (${step.name || 'login'}) — session already authenticated.`);
            continue;
          }
          await this.replayEngine.executeAction(step, i);
        }

        if (isDropdownCandidate) {
          const triggerStep = partition.setupSteps.length > 0 ? partition.setupSteps[partition.setupSteps.length - 1] : null;
          await this.ensureDropdownOpen(page, triggerStep);
          await new Promise(r => setTimeout(r, 400));
        }

        discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
          minItems: 2,
          minScore: 0.55
        });
      }

      if (!discovery.success || discovery.itemCount < 2) {
        logger.warn(`[Loop Runner] Item discovery did not detect multiple items: ${discovery.reason || 'only single item found'}. Falling back to standard execution.`);
        return await this.executeStandard(workflow, onProgress);
      }

      if (!checkpoint) {
        manifest.itemsTotal = discovery.itemCount;
        manifest.pagesProcessed = 1;
      }

      const isDropdown = this.isDropdownOptionCollection(discovery.collection, discovery.items);
      const triggerStep = partition.setupSteps.length > 0
        ? partition.setupSteps[partition.setupSteps.length - 1]
        : null;

      // ItemDiscovery already extracts fields while preserving the exact
      // discovered item identity/order used by getItemHandle().
      // Do not rebuild the collection from the DOM here: doing so can shift
      // row indices (headers/hidden rows) and overwrite correct fields.
      // The persisted snapshot is the source of truth for field values and filter
      // evaluation. Live discovery above is retained only to resolve current DOM
      // handles/collection identity needed for execution.
      let itemsWithFields = hasSavedLoopData
        ? persistedLoopData.items.map(item => ({ ...item, fields: { ...(item.fields || {}) } }))
        : (Array.isArray(discovery.items) ? discovery.items : []);

      if (hasSavedLoopData) {
        logger.info(`[Loop Runner] Using saved loop snapshot (${persistedLoopData.items.length} item(s), captured ${persistedLoopData.capturedAt || 'unknown'}). Live DOM discovery is used only for execution handles.`);
      }

      if (this.filterValidationError) {
        throw new Error(`Filter configuration error: ${this.filterValidationError}`);
      }
      if (this.loopLimitError) {
        throw new Error(`Filter configuration error: ${this.loopLimitError}`);
      }

      const effectiveFilter = this.itemFilter || this.rowFilter || null;
      const preview = evaluateFilterPreview(effectiveFilter, itemsWithFields, {
        loopLimit: this.loopLimit,
        previewLimit: itemsWithFields.length
      });

      if (preview.errors && preview.errors.length > 0) {
        const errMsg = `Filter configuration error: ${preview.errors.join('; ')}`;
        logger.error(`[Loop Runner] ${errMsg}`);
        throw new Error(errMsg);
      }

      if (itemsWithFields.length > 0 && preview.selectedCount === 0) {
        logger.info(`[Loop Runner] Filter criteria selected 0 of ${discovery.itemCount} item(s). No items to execute.`);
        manifest.itemsTotal = discovery.itemCount;
        manifest.matchingCount = preview.matchingCount;
        manifest.matching = preview.matchingCount;
        manifest.selectedCount = 0;
        manifest.selected = 0;
        manifest.skippedFilterCount = preview.skippedFilterCount;
        manifest.skippedFilter = preview.skippedFilterCount;
        manifest.skippedLimitCount = preview.skippedLimitCount;
        manifest.skippedLimit = preview.skippedLimitCount;
        manifest.skippedDuplicateCount = 0;
        manifest.skippedDuplicate = 0;
        manifest.itemsSkipped = preview.skippedFilterCount + preview.skippedLimitCount;

        for (let i = 0; i < discovery.itemCount; i++) {
          const itemIdentifier = await this.extractItemIdentifier(page, discovery, i, isDropdown);
          const itemFields = itemsWithFields[i]?.fields || {};
          const filterCheck = sharedEvaluateItemFilter(effectiveFilter, itemFields);
          const skippedResult = {
            index: i + 1,
            itemIndex: i,
            page: currentPage,
            label: itemIdentifier.itemLabel,
            itemKey: itemIdentifier.itemKey,
            status: 'SKIPPED_FILTER',
            skippedReason: filterCheck.reason,
            timestamp: new Date().toISOString()
          };
          manifest.results.push(skippedResult);
          onProgress({ status: 'ITEM_SKIPPED', itemResult: skippedResult, manifest });
        }

        manifest.status = 'COMPLETED';
        manifest.endTime = new Date().toISOString();
        this.writeLoopCheckpoint(manifest, null, null, currentPage, null, null);
        try {
          fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        } catch {}
        onProgress({ status: manifest.status, manifest });
        return manifest;
      }

      // Convert recorded actions: items inside collection become item-relative,
      // subsequent page actions (e.g. backdrop, Run Report, Export to Excel) are page-scoped.
      const generalizedActions = ActionGeneralizer.generalizeActions(partition.loopSteps, discovery.collection);

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
      currentPage = 1;
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
          itemsWithFields = Array.isArray(discovery.items) ? discovery.items : [];
          // Saved loop data is currently a single captured page snapshot. Pagination
          // pages must use their freshly discovered fields until explicit refresh
          // support is extended to a multi-page snapshot model.
          currentPage++;
          manifest.pagesProcessed = currentPage;
          manifest.itemsTotal += discovery.itemCount;
          currentPageUrl = page.url();
          continue;
        }

        // 1. Efficiently identify and filter available items on current page
        const evaluatedItems = await this.detectAndFilterItems(
          page,
          discovery,
          isDropdown,
          this.itemFilter || this.rowFilter,
          currentPage === 1 && hasSavedLoopData ? itemsWithFields : null
        );

        const matchingItems = evaluatedItems.filter(it => it.matches);
        const skippedItems = evaluatedItems.filter(it => !it.matches);

        manifest.matchingCount = (manifest.matchingCount || 0) + matchingItems.length;
        manifest.matching = manifest.matchingCount;

        // Record all filtered-out items in manifest and progress immediately
        for (const skipped of skippedItems) {
          const skippedIndex = resumeItemIndex != null && currentPage === resumePage && skipped.index === resumePageItemIndex
            ? resumeItemIndex
            : manifest.results.reduce((max, result) => Math.max(max, Number(result.index) || 0), 0) + 1;
          const skippedResult = {
            index: skippedIndex,
            itemIndex: skipped.index,
            page: currentPage,
            label: skipped.itemIdentifier.itemLabel,
            itemKey: skipped.itemIdentifier.itemKey,
            status: 'SKIPPED_FILTER',
            skippedReason: skipped.reason,
            timestamp: new Date().toISOString()
          };
          manifest.results.push(skippedResult);
          manifest.skippedFilterCount = (manifest.skippedFilterCount || 0) + 1;
          manifest.skippedFilter = manifest.skippedFilterCount;
          manifest.itemsSkipped = (manifest.itemsSkipped || 0) + 1;
        }

        if (this.rowFilter || isDropdown) {
          logger.info(`[Loop Runner] Filter evaluation: ${matchingItems.length}/${evaluatedItems.length} matching item(s) (${skippedItems.length} filtered out). Iterating properly through matching items.`);
        }

        // 2. Iterate properly through ONLY matching items
        for (let m = 0; m < matchingItems.length; m++) {
          const targetItem = matchingItems[m];
          const i = targetItem.index;
          const itemIdentifier = targetItem.itemIdentifier;

          if (this.isAborted) {
            logger.warn(`[Loop Runner] Abort signal active before item #${i + 1}. Stopping loop.`);
            manifest.status = 'STOPPED';
            this.writeLoopCheckpoint(manifest, null, 0, currentPage, i, null);
            break;
          }

          if (checkpoint && currentPage === resumePage && i < resumePageItemIndex) {
            continue;
          }

          logger.info(`\n[Loop Runner] --- Processing item [${m + 1}/${matchingItems.length}] (DOM index ${i + 1}: "${itemIdentifier.itemLabel}") ---`);

          // 1b. Stop when the requested loop limit / maxItems is reached
          const effectiveLimit = this.loopLimit || this.maxItems;
          if (effectiveLimit) {
            const doneCount = (manifest.selectedCount || 0);
            if (doneCount >= effectiveLimit) {
              const limitReason = `Beyond loop limit (${effectiveLimit})`;
              logger.info(`[Loop Runner] 🛑 Skipping item #${i + 1} ("${itemIdentifier.itemLabel}") — ${limitReason}`);
              this._limitReached = true;
              const skippedIndex = resumeItemIndex != null && currentPage === resumePage && i === resumePageItemIndex
                ? resumeItemIndex
                : manifest.results.reduce((max, result) => Math.max(max, Number(result.index) || 0), 0) + 1;

              const skippedResult = {
                index: skippedIndex,
                itemIndex: i,
                page: currentPage,
                label: itemIdentifier.itemLabel,
                itemKey: itemIdentifier.itemKey,
                status: 'SKIPPED_LIMIT',
                skippedReason: limitReason,
                timestamp: new Date().toISOString()
              };

              manifest.results.push(skippedResult);
              manifest.skippedLimitCount = (manifest.skippedLimitCount || 0) + 1;
              manifest.skippedLimit = manifest.skippedLimitCount;
              manifest.itemsSkipped = (manifest.itemsSkipped || 0) + 1;
              this.manifest = manifest;
              this.writeLoopCheckpoint(manifest, null, 0, currentPage, i + 1, null);
              onProgress({ status: 'ITEM_SKIPPED', itemResult: skippedResult, manifest });
              continue;
            }
          }

          // Item matched filter and is selected for execution!
          manifest.selectedCount = (manifest.selectedCount || 0) + 1;
          manifest.selected = manifest.selectedCount;

          // 2. Hybrid Deduplication Check: UI Identifier + DB Metadata + Physical Disk File
          const dedupe = this.checkIfAlreadyDownloaded(itemIdentifier.itemKey, itemIdentifier.invoiceNumber, targetItem.fields || {});

          // "old only" mode: skip items that were never downloaded before and not past due
          if (this.itemMode === 'old' && !dedupe.isDuplicate && !dedupe.isOldData) {
            const skippedIndex = manifest.results.reduce((max, result) => Math.max(max, Number(result.index) || 0), 0) + 1;
            const skippedResult = {
              index: skippedIndex,
              itemIndex: i,
              page: currentPage,
              label: itemIdentifier.itemLabel,
              itemKey: itemIdentifier.itemKey,
              status: 'SKIPPED_FILTER',
              skippedReason: 'New item (run mode is "old only")',
              timestamp: new Date().toISOString()
            };
            manifest.results.push(skippedResult);
            manifest.itemsSkipped = (manifest.itemsSkipped || 0) + 1;
            this.manifest = manifest;
            this.writeLoopCheckpoint(manifest, null, 0, currentPage, i + 1, null);
            onProgress({ status: 'ITEM_SKIPPED', itemResult: skippedResult, manifest });
            continue;
          }

          // "new only" mode (default): skip items already downloaded
          if (dedupe.isDuplicate && this.itemMode === 'new' && !this.forceRedownload) {
            logger.info(`[Loop Runner] Skipping item #${i + 1} ("${itemIdentifier.itemLabel}") — already downloaded: "${dedupe.record?.filename || 'existing'}" (${dedupe.record?.filePath || 'folder'})`);
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
              skippedReason: dedupe.inFolder ? `Already in download folder: ${dedupe.record?.filename || 'file'}` : `Already downloaded: ${dedupe.record?.filename || 'file'}`,
              existingFile: dedupe.record?.filePath || null,
              downloadedFiles: dedupe.record?.filePath ? [{
                filename: dedupe.record.filename,
                path: path.resolve(process.cwd(), dedupe.record.filePath),
                relativePath: dedupe.record.filePath,
                sizeBytes: dedupe.record.fileSizeBytes || 0,
                skipped: true
              }] : [],
              timestamp: new Date().toISOString()
            };

            manifest.results.push(skippedResult);
            manifest.skippedDuplicateCount = (manifest.skippedDuplicateCount || 0) + 1;
            manifest.skippedDuplicate = manifest.skippedDuplicateCount;
            manifest.itemsSkipped = (manifest.itemsSkipped || 0) + 1;
            this.manifest = manifest;
            this.writeLoopCheckpoint(manifest, null, 0, currentPage, i + 1, null);
            try {
              fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
            } catch { }
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
              itemIndex: i,
              page: currentPage,
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
                const collectionStillPresent = await this.isCollectionPresent(page, discovery);

                if (!collectionStillPresent) {
                  try {
                    const currentTabUrl = page.url() || '';
                    if (currentPageUrl && currentTabUrl !== currentPageUrl) {
                      await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' });
                      await new Promise(r => setTimeout(r, 1000));
                    }
                    const restored = await this.isCollectionPresent(page, discovery);
                    if (!restored && partition.setupSteps.length > 0) {
                      for (let s = 0; s < partition.setupSteps.length; s++) {
                        const step = partition.setupSteps[s];
                        const isLogin = step.target?.candidates?.some(c => /login|signin/i.test(c.value || '')) ||
                          /login|signin/i.test(step.name || step.elementName || '');
                        if (!isLogin) {
                          await this.replayEngine.executeAction(step, s).catch(() => { });
                        }
                      }
                    }
                  } catch (restoreErr) {
                    logger.warn('[Loop Runner] Could not restore list state before retry: ' + restoreErr.message);
                  }
                }
                if (this.replayEngine) {
                  await this.replayEngine.dismissOverlays().catch(() => {});
                  if (typeof this.replayEngine._waitForLoadingMasks === 'function') {
                    await this.replayEngine._waitForLoadingMasks(4000).catch(() => {});
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
                    const selectResult = await this.executeDropdownOptionSingleSelect(page, i, itemIdentifier.itemLabel);
                    if (!selectResult.success) {
                      throw new Error(`Dropdown option selection failed for item #${i + 1}: ${selectResult.reason || 'Could not verify target option was selected'}`);
                    }
                    logger.info(`[Loop Runner] Item #${i + 1}/${discovery.itemCount}: Checked "${selectResult.targetText}", previous selections cleared.`);
                  } else if (action.scope === 'item') {
                    // Table/grid row action:
                    // On first item action (actionOffset === 0), clear previously selected rows first
                    if (actionOffset === 0) {
                      await this.clearGridSelections(page, discovery);
                    }

                    const itemHandle = await ItemDiscovery.getItemHandle(page, discovery, i);
                    const itemElement = itemHandle.asElement();
                    if (!itemElement) {
                      await itemHandle.dispose().catch(() => { });
                      throw new Error(`Item at index ${i} could not be resolved`);
                    }

                    try {
                      await this.replayEngine.executeActionWithinItem(
                        itemElement,
                        action,
                        effectiveLoopStepIndex + actionOffset
                      );

                      // If first item action, verify and enforce that only row i is selected
                      if (actionOffset === 0) {
                        await this.enforceGridRowSingleSelection(page, discovery, i);
                        logger.info(`[Loop Runner] Item #${i + 1}/${discovery.itemCount}: Selected target row, previous grid selections cleared.`);
                      }
                    } finally {
                      await itemElement.dispose().catch(() => { });
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
                    const isDownloadAction = Boolean(
                      (action.target?.candidates?.some(c => c.value && /download|export|save|pdf|print/i.test(c.value))) ||
                      (action.target?.fingerprint?.attributes?.title && /download|export|save|pdf|print/i.test(action.target.fingerprint.attributes.title)) ||
                      (action.target?.fingerprint?.text && /download|export|save|pdf|print/i.test(action.target.fingerprint.text))
                    );
                    const downloadWaitMs = isDownloadAction ? 12000 : 1200;
                    const downloaded = await this.waitForDownload(beforeActionFiles, downloadWaitMs);
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

                // Close only auxiliary tabs opened by item actions (e.g. target="_blank" download links)
                // NEVER close the dashboard tab or pre-existing tabs
                try {
                  const browserPages = await page.browser().pages();
                  for (const p of browserPages) {
                    if (p !== page && !p.isClosed()) {
                      const pUrl = p.url() || '';
                      const isDashboard = pUrl.includes('127.0.0.1:3000') || pUrl.includes('localhost:3000') || pUrl.includes('/app#');
                      const wasInitial = initialPageUrls && initialPageUrls.has(pUrl);
                      if (!isDashboard && !wasInitial) {
                        logger.info('[Loop Runner] Closing auxiliary tab opened during item replay: ' + pUrl);
                        await p.close().catch(() => { });
                      }
                    }
                  }
                  await page.bringToFront().catch(() => { });
                } catch { }

                // Resilient state verification back to the item collection page
                const collectionStillPresent = await this.isCollectionPresent(page, discovery);

                if (!collectionStillPresent) {
                  logger.info('[Loop Runner] Collection view not present after item — restoring state to: ' + currentPageUrl);
                  const currentTabUrl = page.url() || '';
                  if (currentPageUrl && currentTabUrl !== currentPageUrl) {
                    await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
                    await new Promise(r => setTimeout(r, 1000));
                  }
                  const restored = await this.isCollectionPresent(page, discovery);
                  if (!restored && partition.setupSteps.length > 0) {
                    logger.info('[Loop Runner] Re-executing non-login setup navigation steps to restore collection view...');
                    for (let s = 0; s < partition.setupSteps.length; s++) {
                      const step = partition.setupSteps[s];
                      const isLogin = step.target?.candidates?.some(c => /login|signin/i.test(c.value || '')) ||
                        /login|signin/i.test(step.name || step.elementName || '');
                      if (!isLogin) {
                        await this.replayEngine.executeAction(step, s).catch(() => { });
                      }
                    }
                  }
                } else {
                  // Dismiss any open dropdown, context menu, or overlay backdrop (e.g. cdk-overlay-backdrop)
                  if (this.replayEngine) {
                    await this.replayEngine.dismissOverlays().catch(() => {});
                    if (typeof this.replayEngine._waitForLoadingMasks === 'function') {
                      await this.replayEngine._waitForLoadingMasks(4000).catch(() => {});
                    }
                  }
                }

                // Ensure the collection list container is present on the page before next item
                if (discovery.collection && discovery.collection.ancestorSelector) {
                  try {
                    await page.waitForSelector(discovery.collection.ancestorSelector, { timeout: 3000 }).catch(() => { });
                  } catch { }
                }

                completed = true;
              } catch (attemptErr) {
                lastError = attemptErr;
                const diagReport = attemptErr.resolutionReport || attemptErr.details?.resolutionReport;
                const diagReason = diagReport?.reason || diagReport?.attempts?.find(a => a.reason)?.reason;
                const detailStr = diagReason ? ` (${diagReason})` : '';
                logger.warn('[Loop Runner] Item #' + (i + 1) + ' attempt ' + (attempt + 1) + ' failed at action #' + (nextActionOffset + 1) + ': ' + attemptErr.message + detailStr);

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
              const existingIdx = manifest.results.findIndex(r => r.index === itemResult.index);
              if (existingIdx >= 0) {
                manifest.results[existingIdx] = itemResult;
              } else {
                manifest.results.push(itemResult);
              }
              this.writeLoopCheckpoint(
                manifest,
                itemResult.index,
                nextActionOffset,
                currentPage,
                i,
                itemResult
              );
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
                  await p.close().catch(() => { });
                }
              }
              await page.bringToFront().catch(() => { });
              if (this.replayEngine) {
                await this.replayEngine.dismissOverlays().catch(() => { });
              } else if (page.keyboard) {
                await page.keyboard.press('Escape').catch(() => { });
              }
              const collectionStillPresent = await this.isCollectionPresent(page, discovery);
              if (!collectionStillPresent && page.url() !== currentPageUrl) {
                await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
                if (partition.setupSteps.length > 0) {
                  for (let s = 0; s < partition.setupSteps.length; s++) {
                    await this.replayEngine.executeAction(partition.setupSteps[s], s).catch(() => { });
                  }
                }
              } else if (!collectionStillPresent && partition.setupSteps.length > 0) {
                for (let s = 0; s < partition.setupSteps.length; s++) {
                  await this.replayEngine.executeAction(partition.setupSteps[s], s).catch(() => { });
                }
              }
            } catch {
              // Ignore recovery error
            }
          }

          const existingIdx = manifest.results.findIndex(r => r.index === itemResult.index);
          if (existingIdx >= 0) {
            manifest.results[existingIdx] = itemResult;
          } else {
            manifest.results.push(itemResult);
          }
          this.manifest = manifest;
          try {
            fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
          } catch { }
          this.writeLoopCheckpoint(
            manifest,
            null,
            null,
            currentPage,
            i + 1,
            null
          );
          onProgress({ status: 'ITEM_COMPLETE', itemResult, manifest });
        }

        if (!paginationEnabled || currentPage >= maxPages || this._limitReached) {
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
        itemsWithFields = Array.isArray(discovery.items) ? discovery.items : [];
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
      if (!this.isAborted) {
        this.writeLoopCheckpoint(manifest, null, null, currentPage, null, null);
      }
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
    } finally {
      manifest.endTime = manifest.endTime || new Date().toISOString();
      if (this.isAborted) {
        manifest.status = 'STOPPED';
      }

      try {
        if (this.isAborted && this._lastCursor) {
          this.writeLoopCheckpoint(
            manifest,
            this._lastCursor.currentItemIndex,
            this._lastCursor.currentActionOffset,
            this._lastCursor.currentPage || currentPage,
            this._lastCursor.currentPageItemIndex,
            this._lastCursor.activeItem
          );
        } else if (manifest.status === 'COMPLETED' || manifest.status === 'COMPLETED_WITH_ERRORS') {
          this.writeLoopCheckpoint(manifest, null, null, currentPage, null, null);
        }
      } catch (cpErr) {
        logger.warn(`[Loop Runner] Warning writing final checkpoint: ${cpErr.message}`);
      }

      try {
        fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      } catch (mfErr) {
        logger.warn(`[Loop Runner] Warning writing final manifest: ${mfErr.message}`);
      }

      if (this._replayTargetCreatedListener && this.replayEngine?.browser) {
        try {
          this.replayEngine.browser.off('targetcreated', this._replayTargetCreatedListener);
        } catch { }
        this._replayTargetCreatedListener = null;
      }

      if (this.replayEngine) {
        await this.replayEngine.disconnect().catch(() => { });
      }

      onProgress({ status: manifest.status, manifest });
    }

    return manifest;
  }
}

module.exports = LoopReplayRunner;
