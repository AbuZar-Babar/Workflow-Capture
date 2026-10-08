/**
 * PageInspector
 * 
 * Autonomous full-page DOM & Schema Inspector for Intent-Driven Workflows.
 * Evaluates active web pages and iframes to discover all data collections,
 * column schemas, entities, export triggers, and navigation mechanics.
 */

class PageInspector {
  /**
   * Inspects a Puppeteer page (including all active frames) and produces
   * a structured PageInspectionSummary.
   * 
   * @param {import('puppeteer-core').Page} page 
   * @param {object} options 
   * @returns {Promise<object>} PageInspectionSummary
   */
  static async inspectPage(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('PageInspector requires an active Puppeteer page');
    }

    try {
      const inspection = await page.evaluate(() => {
        const isVisible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;
        };

        const cleanText = (str) => String(str || '').replace(/\s+/g, ' ').trim();
        const EXPANDER_GLYPH_REGEX = /^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i;
        const DOCUMENT_ID_REGEX = /\b((?:SI|INV|DR|TX|CM|PO|SO|BILL|REC|ORD)-\d+(?:[-_]\w+)*|\b\d{4,10}\b)/i;

        const cleanCellText = (val) => {
          if (val == null) return '';
          let s = String(val).trim().replace(/\s+/g, ' ');
          if (EXPANDER_GLYPH_REGEX.test(s)) return '';
          s = s.replace(/^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+/, '').trim();
          s = s.replace(/[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/, '').trim();
          return s;
        };

        const isControlOrExpanderCell = (cellEl) => {
          if (!cellEl || typeof cellEl !== 'object') return false;
          if (
            cellEl.classList?.contains('x-grid-cell-special') ||
            cellEl.classList?.contains('x-grid-cell-row-checker') ||
            cellEl.classList?.contains('x-selmodel-column') ||
            cellEl.classList?.contains('ant-table-selection-column') ||
            cellEl.classList?.contains('mat-column-select') ||
            (typeof cellEl.querySelector === 'function' && cellEl.querySelector(
              '.x-grid-row-checker, input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], .mat-pseudo-checkbox'
            ))
          ) {
            return true;
          }
          if (
            cellEl.classList?.contains('x-grid-row-expander') ||
            cellEl.classList?.contains('ant-table-row-expand-icon') ||
            cellEl.classList?.contains('dt-control') ||
            cellEl.classList?.contains('details-control') ||
            cellEl.classList?.contains('tree-node-toggle') ||
            cellEl.classList?.contains('expander') ||
            cellEl.classList?.contains('expand-btn') ||
            cellEl.classList?.contains('mat-expansion-indicator') ||
            (typeof cellEl.querySelector === 'function' && cellEl.querySelector(
              'button[aria-expanded], [aria-expanded], .expander, .expand-btn, [class*="chevron" i], [class*="expander" i], [class*="tree-toggle" i], [class*="dt-control" i]'
            ))
          ) {
            return true;
          }
          const raw = (cellEl.innerText || cellEl.textContent || '').trim();
          if (raw && EXPANDER_GLYPH_REGEX.test(raw) && raw.length <= 4) {
            return true;
          }
          return false;
        };

        // 1. Identify active modal / dialog if open
        let activeModalTitle = null;
        const modalEl = document.querySelector('.x-window, .modal, [role="dialog"], .dialog, .cdk-overlay-pane');
        if (modalEl && isVisible(modalEl)) {
          const header = modalEl.querySelector('.x-window-header, .modal-title, [role="heading"], h1, h2, h3, h4, .title');
          if (header) activeModalTitle = cleanText(header.textContent);
        }

        // 2. Discover Table & Grid Collections
        const discoveredEntities = [];
        const tableCandidates = Array.from(document.querySelectorAll('.x-grid, [role="grid"], .grid-container, .data-table, table')).filter(el => {
          if (!isVisible(el)) return false;
          if (el.tagName === 'TABLE' && el.closest('.x-grid, [role="grid"], .grid-container, .data-table')) {
            return false;
          }
          return true;
        });

        tableCandidates.forEach((tableEl, idx) => {
          // Extract column headers
          const headerCells = Array.from(tableEl.querySelectorAll('.x-column-header-text, .x-column-header, th, [role="columnheader"], .x-grid-header, .mat-header-cell, .ag-header-cell')).filter(isVisible);
          const rawHeaderLayout = headerCells.map(c => cleanCellText(c.textContent || c.getAttribute('aria-label') || ''));
          const rawColumns = rawHeaderLayout.filter(t => t.length > 0 && t.length < 60 && !EXPANDER_GLYPH_REGEX.test(t));
          const columns = Array.from(new Set(rawColumns));

          // Extract visible row items and filter out header rows
          const allRowEls = Array.from(tableEl.querySelectorAll('tbody > tr, [role="row"]:not([role="columnheader"]), .x-grid-row, .x-grid-item, .ag-row, mat-row, .ant-table-row')).filter(isVisible);

          // Deduplicate nested row elements: if an element in allRowEls contains another element in allRowEls
          // (e.g. table.x-grid-item wrapping tr.x-grid-row), drop the outer wrapper so each row is represented exactly once.
          const nonNestedRowEls = allRowEls.filter(el => {
            return !allRowEls.some(other => other !== el && el.contains(other));
          });
          const uniqueRowEls = Array.from(new Set(nonNestedRowEls));

          const rowEls = uniqueRowEls.filter(r => {
            if (r.closest('thead, .x-grid-header-ct, .x-grid-header, mat-header-row')) return false;
            if (r.classList?.contains('x-grid-header-row') || r.classList?.contains('x-grid-header')) return false;
            const ths = r.querySelectorAll('th, [role="columnheader"], .x-column-header, mat-header-cell');
            const tds = r.querySelectorAll('td, [role="gridcell"], .x-grid-cell, mat-cell, .ag-cell');
            if (ths.length > 0 && tds.length === 0) return false;
            const rText = cleanText(r.textContent).toLowerCase();
            const matchingHeaderCols = columns.filter(c => c && rText.includes(c.toLowerCase()));
            if (matchingHeaderCols.length >= Math.min(3, Math.max(2, columns.length - 1))) return false;
            return true;
          });

          if (rowEls.length >= 1) {
            let entityName = activeModalTitle || 'Data Grid';
            if (columns.some(c => /invoice/i.test(c))) entityName = 'Invoices';
            else if (columns.some(c => /order/i.test(c))) entityName = 'Orders';
            else if (columns.some(c => /payment|transaction/i.test(c))) entityName = 'Payments / Transactions';
            else if (columns.some(c => /statement/i.test(c))) entityName = 'Statements';
            else if (columns.some(c => /item|product|part/i.test(c))) entityName = 'Products / Items';

            // Extract all visible rows (up to 200 items so all records in the portal grid are discovered)
            const sampleRows = rowEls.slice(0, 200).map(r => {
              let cells = Array.from(r.querySelectorAll('td, [role="gridcell"], mat-cell, .ag-cell'));
              if (cells.length === 0) {
                cells = Array.from(r.children).filter(c => c.matches?.('td, th, .x-grid-cell, .cell, mat-cell') || c.tagName === 'TD' || c.tagName === 'TH');
              }
              if (cells.length === 0) {
                cells = Array.from(r.querySelectorAll('.x-grid-cell, .dxgv, .cell'));
              }

              // Filter out control and expander cells
              const nonControlCells = cells.filter(c => !isControlOrExpanderCell(c));
              const dataCells = nonControlCells.length > 0 ? nonControlCells : cells;

              const rowObj = {};
              let mapped = false;

              // Strategy A: Exact positional alignment when raw header layout matches row cells
              if (rawHeaderLayout.length > 0 && rawHeaderLayout.length === cells.length) {
                rawHeaderLayout.forEach((col, i) => {
                  if (col && !EXPANDER_GLYPH_REGEX.test(col)) {
                    let txt = cleanCellText(cells[i].textContent);
                    if (!txt) {
                      const link = cells[i].querySelector('a, button, input');
                      if (link) {
                        txt = cleanCellText(link.textContent || link.getAttribute('value') || '');
                      }
                    }
                    if (txt && !EXPANDER_GLYPH_REGEX.test(txt)) {
                      rowObj[col] = txt;
                      mapped = true;
                    }
                  }
                });
              }

              // Strategy B: Control-filtered mapping
              if (!mapped || Object.keys(rowObj).filter(k => !k.startsWith('_')).length === 0) {
                columns.forEach((col, i) => {
                  if (dataCells[i] !== undefined) {
                    let txt = cleanCellText(dataCells[i].textContent);
                    if (!txt) {
                      const link = dataCells[i].querySelector('a, button, input');
                      if (link) {
                        txt = cleanCellText(link.textContent || link.getAttribute('value') || '');
                      }
                    }
                    if (txt && !EXPANDER_GLYPH_REGEX.test(txt)) {
                      rowObj[col] = txt;
                    }
                  }
                });
              }

              const rawTxt = cleanText(r.textContent);
              rowObj._rawText = rawTxt;
              rowObj.Text = rawTxt;
              rowObj._cells = dataCells.map(c => cleanCellText(c.textContent));

              const isInvoiceGrid = columns.some(c => /invoice/i.test(c));
              if (isInvoiceGrid) {
                const currentInv = rowObj['Invoice Number'] || rowObj['Invoice No'];
                if (!currentInv || EXPANDER_GLYPH_REGEX.test(currentInv) || !/\d/.test(currentInv)) {
                  const invMatch = rawTxt.match(DOCUMENT_ID_REGEX) ||
                    dataCells.map(c => cleanCellText(c.textContent)).find(t => DOCUMENT_ID_REGEX.test(t));
                  if (invMatch) {
                    const foundId = typeof invMatch === 'string' ? invMatch : invMatch[1];
                    if (columns.includes('Invoice No')) {
                      rowObj['Invoice No'] = foundId;
                    } else {
                      rowObj['Invoice Number'] = foundId;
                    }
                  }
                }
                if (!rowObj['Type'] || rowObj['Type'] === rawTxt || /^(SI|INV|DR|TX|CM)-\d+/i.test(rowObj['Type'])) {
                  if (/\bcredit\s*memo\b/i.test(rawTxt)) rowObj['Type'] = 'Credit Memo';
                  else if (/\binvoice\b/i.test(rawTxt)) rowObj['Type'] = 'Invoice';
                  else if (/\border\b/i.test(rawTxt)) rowObj['Type'] = 'Order';
                }
                if (!rowObj['Days Old']) {
                  const daysMatch = rawTxt.match(/\b(\d{1,3})\s+days?\s+old\b/i) ||
                    rawTxt.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\s+(\d{1,3})\s+\d{1,2}\/\d{1,2}\/\d{4}\b/) ||
                    rawTxt.match(/\b(\d{1,3})\s+\d{1,2}\/\d{1,2}\/\d{4}\b/);
                  if (daysMatch) {
                    rowObj['Days Old'] = daysMatch[1];
                  }
                }
              }

              if (!rowObj['Status'] || EXPANDER_GLYPH_REGEX.test(rowObj['Status'])) {
                const statusMatch = rawTxt.match(/\b(Open|Closed|Pending|Paid|Unpaid|Draft|Approved|Posted)\b/i);
                if (statusMatch) rowObj['Status'] = statusMatch[1];
              }

              // Strip expander glyphs from any field
              for (const [k, v] of Object.entries(rowObj)) {
                if (typeof v === 'string') {
                  if (EXPANDER_GLYPH_REGEX.test(v)) {
                    delete rowObj[k];
                  } else {
                    rowObj[k] = cleanCellText(v);
                  }
                }
              }

              return rowObj;
            });

            const allCols = new Set(columns);
            sampleRows.forEach(sr => {
              Object.keys(sr).forEach(k => {
                if (k && !k.startsWith('_')) allCols.add(k);
              });
            });

            // Check for row-scoped action controls (downloads, export buttons, checkboxes)
            let hasDownloadLinks = false;
            let hasActionControls = false;
            let actionColumn = null;
            let actionText = null;

            for (const r of rowEls) {
              const downloadEl = r.querySelector('a[href*="download" i], a[href*="file" i], button[title*="download" i]') ||
                Array.from(r.querySelectorAll('a, button')).find(b => /download|export|save|file/i.test(b.textContent || b.getAttribute('title') || ''));
              if (downloadEl) {
                hasDownloadLinks = true;
                hasActionControls = true;
                actionText = cleanText(downloadEl.textContent || downloadEl.getAttribute('title') || 'Download');
                const cell = downloadEl.closest('td, th, [role="gridcell"]');
                if (cell && cell.parentElement === r) {
                  const cellIdx = Array.from(r.children).indexOf(cell);
                  if (columns[cellIdx]) actionColumn = columns[cellIdx];
                }
                break;
              }
            }

            // Distinguish key-value layout / profile tables (e.g. "Name : Sania") from repeating record collections
            const isKeyValueLayout = columns.length === 0 && rowEls.length > 0 && rowEls.every(r => {
              const tds = r.querySelectorAll('td, th');
              const txt = cleanText(r.textContent);
              return (tds.length === 2 || tds.length === 4) && /:\s*\w+/.test(txt);
            });

            const collectionScore = (columns.length >= 2 ? 0.5 : 0.1) +
              (hasDownloadLinks ? 0.4 : 0) +
              (hasActionControls ? 0.1 : 0) +
              (isKeyValueLayout ? -0.4 : 0);

            discoveredEntities.push({
              id: `entity_table_${idx + 1}`,
              name: entityName,
              type: 'table_grid',
              itemCount: rowEls.length,
              columns: Array.from(allCols),
              sampleRows,
              rows: sampleRows,
              hasSelectionCheckbox: !!tableEl.querySelector('input[type="checkbox"], [role="checkbox"]'),
              hasExplicitHeaders: columns.length >= 2,
              hasDownloadLinks,
              hasActionControls,
              actionColumn,
              actionText,
              isKeyValueLayout,
              collectionScore,
              tag: tableEl.tagName.toLowerCase()
            });
          }
        });

        // 3. Discover Repeating List / Card Collections
        const listCandidates = Array.from(document.querySelectorAll('ul, ol, [role="list"], .card-list, .results-list')).filter(isVisible);
        listCandidates.forEach((listEl, idx) => {
          const items = Array.from(listEl.children).filter(c => isVisible(c) && (c.tagName === 'LI' || c.getAttribute('role') === 'listitem' || c.classList.contains('item')));
          if (items.length >= 2 && !discoveredEntities.some(e => e.type === 'table_grid' && e.itemCount >= items.length)) {
            const firstItemText = cleanText(items[0].textContent);
            discoveredEntities.push({
              id: `entity_list_${idx + 1}`,
              name: `List Items (${items.length} records)`,
              type: 'item_list',
              itemCount: items.length,
              columns: ['Label', 'Text'],
              sampleRows: items.slice(0, 5).map((item, i) => ({
                Label: cleanText(item.textContent).slice(0, 80),
                Text: cleanText(item.textContent)
              })),
              hasSelectionCheckbox: !!listEl.querySelector('input[type="checkbox"]'),
              tag: listEl.tagName.toLowerCase()
            });
          }
        });

        // 4. Discover Dropdown Options
        const dropdownOptions = Array.from(document.querySelectorAll('mat-option, [role="option"], select option')).filter(isVisible);
        if (dropdownOptions.length >= 2) {
          discoveredEntities.push({
            id: 'entity_dropdown_options',
            name: 'Dropdown Selection Options',
            type: 'dropdown_options',
            itemCount: dropdownOptions.length,
            columns: ['Option'],
            sampleRows: dropdownOptions.slice(0, 5).map(opt => ({ Option: cleanText(opt.textContent) })),
            hasSelectionCheckbox: !!dropdownOptions[0].querySelector('input[type="checkbox"], [role="checkbox"], .mat-pseudo-checkbox'),
            tag: dropdownOptions[0].tagName.toLowerCase()
          });
        }

        // 5. Discover Action Triggers (Export, Download, Search, Filters)
        const discoveredActions = [];
        const actionElements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], img[title]')).filter(isVisible);

        actionElements.forEach((btn) => {
          const text = cleanText(btn.textContent);
          const title = cleanText(btn.getAttribute('title') || btn.getAttribute('aria-label') || '');
          const combined = `${text} ${title}`.toLowerCase();

          if (/export|download|save|print|pdf|excel|csv/i.test(combined)) {
            discoveredActions.push({
              type: 'DOWNLOAD',
              label: title || text || 'Export / Download',
              tag: btn.tagName.toLowerCase(),
              title: title || null,
              id: btn.id || null
            });
          } else if (/search|find|filter|apply/i.test(combined) && btn.tagName !== 'INPUT') {
            discoveredActions.push({
              type: 'FILTER',
              label: title || text || 'Search / Filter',
              tag: btn.tagName.toLowerCase(),
              title: title || null,
              id: btn.id || null
            });
          }
        });

        // 6. Discover Navigation Mechanics (Pagination, Next Button, Load More)
        let hasPagination = false;
        let nextButtonFound = false;
        let hasLoadMore = false;

        const nextButtons = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(el => {
          if (!isVisible(el)) return false;
          const label = cleanText(el.textContent + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          const cls = (el.className || '').toLowerCase();
          return (label === 'next' || label.includes('next page') || label === '›' || label === '»' || cls.includes('next-page') || cls.includes('x-btn-next')) &&
            !el.hasAttribute('disabled') &&
            !cls.includes('disabled');
        });

        if (nextButtons.length > 0) {
          hasPagination = true;
          nextButtonFound = true;
        }

        const loadMoreButtons = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(el => {
          if (!isVisible(el)) return false;
          const label = cleanText(el.textContent).toLowerCase();
          return /load more|show more|view more/i.test(label) && !el.hasAttribute('disabled');
        });

        if (loadMoreButtons.length > 0) {
          hasLoadMore = true;
        }

        return {
          pageTitle: document.title,
          url: window.location.href,
          activeModal: activeModalTitle,
          entities: discoveredEntities,
          actions: discoveredActions,
          navigation: {
            hasPagination,
            nextButtonFound,
            hasLoadMore,
            hasInfiniteScroll: false
          }
        };
      });

      return {
        success: true,
        summary: inspection,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PageInspector };
}
