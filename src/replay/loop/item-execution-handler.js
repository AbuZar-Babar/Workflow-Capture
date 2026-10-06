/**
 * src/replay/loop/item-execution-handler.js
 * Manages item identification, field extraction, filter condition evaluation,
 * and individual item attempt execution with retry backoffs and state recovery.
 */

const fs = require('fs');
const path = require('path');
const ItemDiscovery = require('../../shared/item-discovery');
const { ConditionEvaluator } = require('../../shared/condition-evaluator');
const { isLoginAction } = require('../../shared/auth-detector');
const logger = require('../../utils/logger');

class ItemExecutionHandler {
  constructor(options = {}) {
    this.maxItemRetries = Number.isInteger(options.maxItemRetries) ? Math.max(0, options.maxItemRetries) : 1;
    this.gridAdapter = options.gridAdapter || null;
    this.downloadManager = options.downloadManager || null;
    this.stateCoordinator = options.stateCoordinator || null;
    this.replayEngine = options.replayEngine || null;
    this.getIsAborted = options.getIsAborted || (() => false);
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
      logger.warn(`[ItemExecutionHandler] Note extracting item identifier for item #${index + 1}: ${err.message}`);
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

          let headers = Array.isArray(collection.headerColumns) && collection.headerColumns.length > 0
            ? collection.headerColumns
            : [];

          if (!headers.length) {
            const gridContainer = (typeof el.parentElement?.closest === 'function' ? el.parentElement.closest('.x-grid, [role="grid"], [role="treegrid"], .dxgvTable, table, .data-table, .grid-container') : null) ||
              (typeof el.closest === 'function' ? el.closest('.x-grid, [role="grid"], [role="treegrid"], .dxgvTable, table') : null) ||
              document.querySelector('.x-grid, table, [role="grid"]');
            if (gridContainer) {
              const headerCt = (typeof gridContainer.querySelector === 'function' ? gridContainer.querySelector('.x-grid-header-ct, thead, .x-grid-header-row, [role="rowgroup"], .ag-header, .mat-header-row') : null) || gridContainer;
              const headerEls = Array.from(typeof headerCt.querySelectorAll === 'function' ? headerCt.querySelectorAll('.x-column-header-text, .x-column-header, th, [role="columnheader"], .dxgvHeader, .mat-header-cell, .ag-header-cell, .ant-table-thead th') : [])
                .filter(visible);
              headerEls.forEach(h => {
                const inner = (typeof h.querySelector === 'function' ? h.querySelector('.x-column-header-text, .ag-header-cell-text') : null) || h;
                const t = (inner.innerText || inner.textContent || inner.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
                if (t && t.length > 0 && t.length < 60) headers.push(t);
              });
              headers = Array.from(new Set(headers));
            }
          }

          let cellEls = [];
          if (typeof el.querySelectorAll === 'function') {
            cellEls = Array.from(el.querySelectorAll('td, [role="gridcell"], .dxgv, .cell, mat-cell, .ag-cell'));
          }
          if (!cellEls.length && Array.isArray(el.children)) {
            cellEls = Array.from(el.children);
          }

          // Account for checkbox selection column offset
          const isFirstCellChecker = cellEls.length > 0 && Boolean(
            cellEls[0].classList?.contains('x-grid-cell-special') ||
            cellEls[0].classList?.contains('x-grid-cell-row-checker') ||
            cellEls[0].classList?.contains('x-selmodel-column') ||
            (typeof cellEls[0].querySelector === 'function' && cellEls[0].querySelector('.x-grid-row-checker, input[type="checkbox"], [role="checkbox"], .mat-pseudo-checkbox')) ||
            (((cellEls[0].innerText || cellEls[0].textContent || '').trim() === '') && cellEls.length > headers.length)
          );
          const dataCellEls = isFirstCellChecker ? cellEls.slice(1) : cellEls;

          const cells = dataCellEls.map(c => {
            let val = (c.innerText || c.textContent || '').trim().replace(/\s+/g, ' ');
            if (!val) {
              const link = typeof c.querySelector === 'function' ? c.querySelector('a, button, input') : null;
              if (link) {
                val = (link.innerText || link.textContent || link.getAttribute('value') || '').trim();
              }
            }
            return val;
          });

          if (headers.length > 0 && cells.length > 0) {
            headers.forEach((hName, idx) => {
              if (idx < cells.length && cells[idx] !== undefined && cells[idx] !== '') {
                fields[hName] = cells[idx];
              }
            });
          }

          // Semantic alias for Due Date
          if (!fields['Due Date']) {
            const dueCol = headers.find(h => /\bdue\b/i.test(h));
            if (dueCol && fields[dueCol]) {
              fields['Due Date'] = fields[dueCol];
            }
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
          const extracted = domEl ? extractFieldsFromElement(domEl) : {};
          const mergedFields = Object.assign({}, base.fields || {}, extracted);
          result.push({
            index: base.index !== undefined ? base.index : i,
            text: base.text || (domEl ? (domEl.innerText || domEl.textContent || '').trim() : ''),
            label: base.text || (domEl ? (domEl.innerText || domEl.textContent || '').trim() : `Item #${i + 1}`),
            tagName: base.tagName || (domEl ? domEl.tagName.toLowerCase() : ''),
            signature: base.signature || (domEl ? structuralSignature(domEl) : ''),
            href: base.href || (domEl ? domEl.querySelector('a[href]')?.href || null : null),
            id: base.id || (domEl ? domEl.id || null : null),
            fields: mergedFields
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
   */
  async evaluateItemFilter(page, discovery, index, filterInput = undefined) {
    const rawFilter = filterInput !== undefined
      ? filterInput
      : ((this.stateCoordinator ? (this.stateCoordinator.itemFilter || this.stateCoordinator.rowFilter) : null) || this.itemFilter || this.rowFilter || null);

    if (!rawFilter || (!rawFilter.value && !rawFilter.text && !rawFilter.conditions && !rawFilter.field)) {
      return { matches: true, reason: 'No filter configured', column: null, actualValue: 'All' };
    }

    const rawVal = rawFilter.value || rawFilter.text;
    if (rawVal === '__any__' || rawVal === 'all') {
      return { matches: true, reason: 'All items accepted (no filter)', column: null, actualValue: 'All' };
    }

    // 1. Fast evaluation from discovery item fields if available
    if (discovery && Array.isArray(discovery.items) && discovery.items[index]?.fields) {
      const itemRecord = Object.assign({}, discovery.items[index], discovery.items[index].fields);
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
    const targetCol = String(rawFilter.column || rawFilter.field || 'type').toLowerCase();
    try {
      itemHandle = await ItemDiscovery.getItemHandle(page, discovery, index);
      const itemEl = itemHandle ? (itemHandle.asElement ? itemHandle.asElement() : itemHandle) : null;
      if (!itemEl) {
        return {
          matches: false,
          field: rawFilter.column || rawFilter.field || null,
          column: targetCol,
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

        const gridContainer = el.parentElement?.closest('.x-grid, [role="grid"], [role="treegrid"], .dxgvTable, table, .data-table, .grid-container') ||
          el.closest('.x-grid, [role="grid"], .dxgvTable, table') ||
          document.querySelector('.x-grid, table, [role="grid"]');
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
      logger.warn(`[ItemExecutionHandler] Filter check note on item #${index + 1}: ${err.message}`);
      return { matches: true, reason: 'Filter check error fallback', column: targetCol, actualValue: null };
    } finally {
      if (itemHandle) await itemHandle.dispose().catch(() => { });
    }
  }

  /**
   * Efficiently detects all available elements on the page, identifies relevant options/items,
   * excludes non-data controls (like "Select All"), and filters items based on the condition.
   */
  async detectAndFilterItems(page, discovery, isDropdown, rowFilter) {
    const filter = rowFilter || (this.stateCoordinator ? (this.stateCoordinator.itemFilter || this.stateCoordinator.rowFilter) : null) || this.itemFilter || this.rowFilter || null;
    const rawVal = filter ? (filter.value || filter.text) : null;
    const hasConditions = Boolean(filter && Array.isArray(filter.conditions) && filter.conditions.length > 0);
    const isFilterActive = Boolean(filter && (hasConditions || (rawVal && rawVal !== '__any__' && rawVal !== 'all')));
    const targetCol = filter ? String(filter.column || filter.field || filter.conditions?.[0]?.field || 'type').toLowerCase() : 'type';

    let itemsData = [];

    if (isDropdown && page) {
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
        } else if (filter) {
          const filterCheck = await this.evaluateItemFilter(page, discovery, idx, filter);
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
        const itemRecord = Object.assign({}, item, item.fields || {});
        const evalResult = ConditionEvaluator.evaluate(itemRecord, filter);
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
   * Executes an individual item attempt loop with retry backoffs and DOM restoration.
   */
  async executeItemWithRetries({
    page,
    discovery,
    i,
    itemResult,
    startingActionOffset = 0,
    targetItem,
    itemIdentifier,
    generalizedActions,
    effectiveLoopStepIndex,
    isDropdown,
    triggerStep,
    partition,
    currentPageUrl,
    initialPageUrls,
    currentPage,
    manifest,
    runner
  }) {
    const isAborted = () => (runner ? runner.isAborted : this.getIsAborted());
    const replayEngine = runner?.replayEngine || this.replayEngine;
    const downloadsDir = runner?.downloadsDir || this.downloadManager?.downloadsDir;
    const maxRetries = Number.isInteger(runner?.maxItemRetries) ? runner.maxItemRetries : this.maxItemRetries;

    const isCollectionPresent = async () => {
      if (runner && typeof runner.isCollectionPresent === 'function') {
        return runner.isCollectionPresent(page, discovery);
      }
      return this.gridAdapter ? this.gridAdapter.isCollectionPresent(page, discovery) : true;
    };

    const ensureDropdownOpen = async (trig) => {
      if (runner && typeof runner.ensureDropdownOpen === 'function') {
        return runner.ensureDropdownOpen(page, trig);
      }
      return this.gridAdapter ? this.gridAdapter.ensureDropdownOpen(page, trig, replayEngine) : false;
    };

    const executeDropdownOptionSingleSelect = async (idx, label) => {
      if (runner && typeof runner.executeDropdownOptionSingleSelect === 'function') {
        return runner.executeDropdownOptionSingleSelect(page, idx, label);
      }
      return this.gridAdapter ? this.gridAdapter.executeDropdownOptionSingleSelect(page, idx, label) : { success: false };
    };

    const clearGridSelections = async () => {
      if (runner && typeof runner.clearGridSelections === 'function') {
        return runner.clearGridSelections(page, discovery);
      }
      if (this.gridAdapter) await this.gridAdapter.clearGridSelections(page, discovery);
    };

    const enforceGridRowSingleSelection = async (idx) => {
      if (runner && typeof runner.enforceGridRowSingleSelection === 'function') {
        return runner.enforceGridRowSingleSelection(page, discovery, idx);
      }
      if (this.gridAdapter) await this.gridAdapter.enforceGridRowSingleSelection(page, discovery, idx);
    };

    const snapshotDownloadedFiles = () => {
      if (runner && typeof runner.snapshotDownloadedFiles === 'function') {
        return runner.snapshotDownloadedFiles();
      }
      return this.downloadManager ? this.downloadManager.snapshotDownloadedFiles() : { runFiles: [], osFiles: [] };
    };

    const waitForDownload = async (prevSnap, waitMs) => {
      if (runner && typeof runner.waitForDownload === 'function') {
        return runner.waitForDownload(prevSnap, waitMs);
      }
      return this.downloadManager ? this.downloadManager.waitForDownload(prevSnap, waitMs) : [];
    };

    const processAndStoreDownload = (src, key, lbl, flds) => {
      if (runner && typeof runner.processAndStoreDownload === 'function') {
        return runner.processAndStoreDownload(src, key, lbl, flds);
      }
      return this.downloadManager ? this.downloadManager.processAndStoreDownload(src, key, lbl, flds) : null;
    };

    const writeLoopCheckpoint = (man, idx, offset, p, pIdx, active) => {
      if (runner && typeof runner.writeLoopCheckpoint === 'function') {
        return runner.writeLoopCheckpoint(man, idx, offset, p, pIdx, active);
      }
      if (this.stateCoordinator) this.stateCoordinator.writeLoopCheckpoint(man, idx, offset, p, pIdx, active);
    };

    itemResult.actions = Array.isArray(itemResult.actions) ? itemResult.actions : [];
    itemResult.downloadedFiles = Array.isArray(itemResult.downloadedFiles) ? itemResult.downloadedFiles : [];
    itemResult.attempts = Number.isInteger(itemResult.attempts) ? itemResult.attempts : 0;
    itemResult.retryCount = Number.isInteger(itemResult.retryCount) ? itemResult.retryCount : 0;

    let completed = false;
    let lastError = null;
    let nextActionOffset = startingActionOffset;

    for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
      if (isAborted()) throw new Error('Execution stopped by user');

      itemResult.attempts = attempt + 1;
      if (attempt > 0) {
        itemResult.retryCount = attempt;
        logger.warn('[Loop Runner] Retrying item #' + (i + 1) + ' (attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ')');
        await new Promise(r => setTimeout(r, 500));

        // Reacquire the live DOM item and resume at the failed action checkpoint.
        const collectionStillPresent = await isCollectionPresent();

        if (!collectionStillPresent) {
          try {
            const currentTabUrl = page.url() || '';
            if (currentPageUrl && currentTabUrl !== currentPageUrl) {
              await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' });
              await new Promise(r => setTimeout(r, 1000));
            }
            const restored = await isCollectionPresent();
            if (!restored && partition && partition.setupSteps && partition.setupSteps.length > 0) {
              for (let s = 0; s < partition.setupSteps.length; s++) {
                const step = partition.setupSteps[s];
                const isLogin = isLoginAction(step);
                if (!isLogin && replayEngine) {
                  await replayEngine.executeAction(step, s).catch(() => { });
                }
              }
            }
          } catch (restoreErr) {
            logger.warn('[Loop Runner] Could not restore list state before retry: ' + restoreErr.message);
          }
        }
        if (replayEngine) {
          await replayEngine.dismissOverlays().catch(() => {});
          if (typeof replayEngine._waitForLoadingMasks === 'function') {
            await replayEngine._waitForLoadingMasks(4000).catch(() => {});
          }
        }
      }

      try {
        for (let actionOffset = nextActionOffset; actionOffset < generalizedActions.length; actionOffset++) {
          if (isAborted()) throw new Error('Execution stopped by user');

          const action = generalizedActions[actionOffset];
          const actionType = action.type || action.action || 'CLICK';
          const beforeActionFiles = snapshotDownloadedFiles();

          if (isDropdown && actionOffset === 0 && action.scope === 'item') {
            // Sequential single-selection dropdown checkbox logic:
            // 1. Ensure dropdown is open
            await ensureDropdownOpen(triggerStep);
            // 2. Uncheck previous option(s), check target option i
            const selectResult = await executeDropdownOptionSingleSelect(i, itemIdentifier.itemLabel);
            if (!selectResult.success) {
              throw new Error(`Dropdown option selection failed for item #${i + 1}: ${selectResult.reason || 'Could not verify target option was selected'}`);
            }
            logger.info(`[Loop Runner] Item #${i + 1}/${discovery.itemCount}: Checked "${selectResult.targetText}", previous selections cleared.`);
          } else if (action.scope === 'item') {
            // Table/grid row action:
            // On first item action (actionOffset === 0), clear previously selected rows first
            if (actionOffset === 0) {
              await clearGridSelections();
            }

            const itemHandle = await ItemDiscovery.getItemHandle(page, discovery, i);
            const itemElement = itemHandle.asElement();
            if (!itemElement) {
              await itemHandle.dispose().catch(() => { });
              throw new Error(`Item at index ${i} could not be resolved`);
            }

            try {
              if (replayEngine) {
                await replayEngine.executeActionWithinItem(
                  itemElement,
                  action,
                  effectiveLoopStepIndex + actionOffset
                );
              }

              // If first item action, verify and enforce that only row i is selected
              if (actionOffset === 0) {
                await enforceGridRowSingleSelection(i);
                logger.info(`[Loop Runner] Item #${i + 1}/${discovery.itemCount}: Selected target row, previous grid selections cleared.`);
              }
            } finally {
              await itemElement.dispose().catch(() => { });
            }
          } else {
            // Page-scoped action (e.g. click backdrop, Run Report, Export to Excel)
            if (replayEngine) {
              await replayEngine.executeAction(
                action,
                effectiveLoopStepIndex + actionOffset
              );
            }
          }

          const actionResult = {
            index: effectiveLoopStepIndex + actionOffset + 1,
            type: actionType,
            status: 'SUCCESS'
          };

          if (actionType === 'CLICK' && downloadsDir) {
            const isDownloadAction = Boolean(
              action.isDownload === true ||
              (action.target?.candidates?.some(c => c.value && /download|export|save|pdf|print|file/i.test(c.value))) ||
              (action.target?.fingerprint?.attributes?.title && /download|export|save|pdf|print/i.test(action.target.fingerprint.attributes.title)) ||
              (action.target?.fingerprint?.attributes?.href && /download|export|save|file/i.test(action.target.fingerprint.attributes.href)) ||
              (action.target?.fingerprint?.text && /download|export|save|pdf|print/i.test(action.target.fingerprint.text)) ||
              (action.name && /download|export|save/i.test(action.name)) ||
              (action.elementName && /download|export|save/i.test(action.elementName))
            );
            const downloadWaitMs = isDownloadAction ? 12000 : 1200;
            const downloaded = await waitForDownload(beforeActionFiles, downloadWaitMs);
            if (downloaded.length) {
              for (const dl of downloaded) {
                const organized = processAndStoreDownload(dl.path, itemIdentifier.itemKey, itemIdentifier.itemLabel, targetItem.fields || {});
                itemResult.downloadedFiles.push(organized || dl);
              }
              actionResult.downloadedFiles = itemResult.downloadedFiles.map(file => file.filename || file.targetFilename);
            }
          }

          itemResult.actions.push(actionResult);
          nextActionOffset = actionOffset + 1;
          writeLoopCheckpoint(
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

        // Check if any download arrived for this item (e.g. late export/save response)
        if (downloadsDir && fs.existsSync(downloadsDir)) {
          try {
            const pendingFiles = fs.readdirSync(downloadsDir)
              .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
            for (const f of pendingFiles) {
              const rawPath = path.join(downloadsDir, f);
              const organized = processAndStoreDownload(rawPath, itemIdentifier.itemKey, itemIdentifier.itemLabel, targetItem.fields || {});
              if (organized) {
                itemResult.downloadedFiles = itemResult.downloadedFiles || [];
                itemResult.downloadedFiles.push(organized);
                try { fs.unlinkSync(rawPath); } catch {}
              }
            }
          } catch {}
        }

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
        const collectionStillPresent = await isCollectionPresent();

        if (!collectionStillPresent) {
          logger.info('[Loop Runner] Collection view not present after item — restoring state to: ' + currentPageUrl);
          const currentTabUrl = page.url() || '';
          if (currentPageUrl && currentTabUrl !== currentPageUrl) {
            await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
            await new Promise(r => setTimeout(r, 1000));
          }
          const restored = await isCollectionPresent();
          if (!restored && partition && partition.setupSteps && partition.setupSteps.length > 0) {
            logger.info('[Loop Runner] Re-executing non-login setup navigation steps to restore collection view...');
            for (let s = 0; s < partition.setupSteps.length; s++) {
              const step = partition.setupSteps[s];
              const isLogin = isLoginAction(step);
              if (!isLogin && replayEngine) {
                await replayEngine.executeAction(step, s).catch(() => { });
              }
            }
          }
        } else {
          // Dismiss any open dropdown, context menu, or overlay backdrop (e.g. cdk-overlay-backdrop)
          if (replayEngine) {
            await replayEngine.dismissOverlays().catch(() => {});
            if (typeof replayEngine._waitForLoadingMasks === 'function') {
              await replayEngine._waitForLoadingMasks(4000).catch(() => {});
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

        if (attempt < maxRetries) {
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

    return { completed: true, nextActionOffset };
  }
}

module.exports = ItemExecutionHandler;
