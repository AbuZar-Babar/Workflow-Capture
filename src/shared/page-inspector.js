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
          const rawColumns = headerCells.map(c => cleanText(c.textContent || c.getAttribute('aria-label') || '')).filter(t => t.length > 0 && t.length < 60);
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
            if (rText.includes('invoice number') && (rText.includes('customer name') || rText.includes('customer number') || rText.includes('payment method'))) return false;
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

              // Account for checkbox selection column offset
              const isFirstCellChecker = cells.length > 0 && (
                cells[0].classList?.contains('x-grid-cell-special') ||
                cells[0].classList?.contains('x-grid-cell-row-checker') ||
                cells[0].classList?.contains('x-selmodel-column') ||
                cells[0].querySelector?.('.x-grid-row-checker, input[type="checkbox"], [role="checkbox"], .mat-pseudo-checkbox') !== null ||
                (cleanText(cells[0].textContent) === '' && cells.length > columns.length)
              );

              const dataCells = isFirstCellChecker ? cells.slice(1) : cells;
              const cellTexts = dataCells.map(c => cleanText(c.textContent));
              const rowObj = {};
              columns.forEach((col, i) => {
                if (cellTexts[i] !== undefined && cellTexts[i]) rowObj[col] = cellTexts[i];
              });
              const rawTxt = cleanText(r.textContent);
              rowObj._rawText = rawTxt;
              rowObj.Text = rawTxt;

              if (!rowObj['Invoice Number'] && !rowObj['Invoice No']) {
                const invMatch = rawTxt.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
                if (invMatch) rowObj['Invoice Number'] = invMatch[1];
              }
              if (!rowObj['Type'] || rowObj['Type'] === rawTxt || /^(SI|INV|DR|TX|CM)-\d+/i.test(rowObj['Type'])) {
                if (/\bcredit\s*memo\b/i.test(rawTxt)) rowObj['Type'] = 'Credit Memo';
                else if (/\binvoice\b/i.test(rawTxt)) rowObj['Type'] = 'Invoice';
                else if (/\border\b/i.test(rawTxt)) rowObj['Type'] = 'Order';
              }
              if (!rowObj['Status']) {
                const statusMatch = rawTxt.match(/\b(Open|Closed|Pending|Paid|Unpaid|Draft|Approved|Posted)\b/i);
                if (statusMatch) rowObj['Status'] = statusMatch[1];
              }

              // Due Date & Invoice Date
              if (!rowObj['Due Date'] || !rowObj['Invoice Date']) {
                const dateMatches = rawTxt.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);
                if (dateMatches && dateMatches.length >= 2) {
                  rowObj['Invoice Date'] = rowObj['Invoice Date'] || dateMatches[0];
                  rowObj['Due Date'] = rowObj['Due Date'] || dateMatches[1];
                } else if (dateMatches && dateMatches.length === 1) {
                  rowObj['Due Date'] = rowObj['Due Date'] || dateMatches[0];
                }
              }

              // Days Old
              if (!rowObj['Days Old']) {
                const daysMatch = rawTxt.match(/\b(\d{1,3})\s+days?\s+old\b/i) ||
                  rawTxt.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\s+(\d{1,3})\s+\d{1,2}\/\d{1,2}\/\d{4}\b/) ||
                  rawTxt.match(/\b(\d{1,3})\s+\d{1,2}\/\d{1,2}\/\d{4}\b/);
                if (daysMatch) {
                  rowObj['Days Old'] = daysMatch[1];
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

            discoveredEntities.push({
              id: `entity_table_${idx + 1}`,
              name: entityName,
              type: 'table_grid',
              itemCount: rowEls.length,
              columns: Array.from(allCols),
              sampleRows,
              rows: sampleRows,
              hasSelectionCheckbox: !!tableEl.querySelector('input[type="checkbox"], [role="checkbox"]'),
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
