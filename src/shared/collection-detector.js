/**
 * Workflow Capture — Universal Collection Detector
 * 
 * Automatically identifies repeated collections across modern web applications:
 * - HTML Tables (table / tbody / tr)
 * - Data Grids (role="grid", role="row", .grid-row, .ag-row)
 * - Card Collections (.card, .item, .data-card, role="article")
 * - Lists (ul > li, ol > li, role="list" > role="listitem")
 * - Repeated Flex/Grid Div Structures
 * - Virtualized Lists & Dynamic Content
 * 
 * Does NOT require hardcoded portal selectors (#invoiceTable, .invoice-row).
 * Identifies collections from DOM hierarchy, structural repetition, sibling relationships,
 * and semantic accessibility trees.
 */

'use strict';

const FieldDetector = require('./field-detector');

class CollectionDetector {
  /**
   * Discovers and classifies repeating collections in a page context or DOM container.
   * Can run in Node.js with page handle or browser-side via evaluate.
   */
  static getInjectedDiscoveryScript() {
    return `
      function __workflowCaptureDiscoverCollections(options = {}) {
        const minItems = typeof options.minItems === 'number' ? options.minItems : 2;
        const visible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;
        };

        const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

        const isNavOrChrome = (el) => {
          if (!el) return false;
          const tag = (el.tagName || '').toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          if (['nav', 'header', 'footer', 'mat-toolbar', 'mat-toolbar-row', 'mat-tab-header', 'mat-sidenav', 'app-header', 'app-nav'].includes(tag)) return true;
          if (['navigation', 'menubar', 'tablist', 'toolbar', 'breadcrumb', 'pagination'].includes(role)) return true;
          if (/\\b(navbar|nav-tabs|nav-item|nav-link|sidebar|site-header|main-nav|page-header|pager|header-nav)\\b/i.test(cls)) return true;
          try {
            if (el.closest('nav, header, footer, mat-toolbar, [role="navigation"], [role="tablist"], [role="toolbar"], .navbar, .sidebar')) return true;
          } catch {}
          return false;
        };

        const collections = [];

        // Helper to extract fields from an item element
        const extractFields = (itemEl, headerCols = []) => {
          const fields = {};
          const fullText = clean(itemEl.textContent);

          // 1. If headers provided and element has cells/children
          let cells = Array.from(itemEl.querySelectorAll('td, [role="gridcell"], .cell, .x-grid-cell, mat-cell, .ag-cell')).filter(visible);
          if (cells.length === 0 && (itemEl.tagName === 'TR' || itemEl.getAttribute('role') === 'row')) {
            cells = Array.from(itemEl.children).filter(visible);
          }

          if (cells.length > 0 && headerCols.length > 0) {
            const isControlOrExpander = (c) => {
              if (!c) return false;
              if (c.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], .mat-pseudo-checkbox') !== null) return true;
              if (c.classList?.contains('x-grid-cell-special') || c.classList?.contains('x-grid-cell-row-checker') || c.classList?.contains('x-grid-row-expander') || c.classList?.contains('expander')) return true;
              const txt = clean(c.textContent);
              return txt && /^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i.test(txt) && txt.length <= 4;
            };
            const nonControlCells = cells.filter(c => !isControlOrExpander(c));
            const dataCells = nonControlCells.length > 0 ? nonControlCells : cells;
            headerCols.forEach((col, idx) => {
              if (dataCells[idx] !== undefined) {
                let txt = clean(dataCells[idx].textContent);
                if (txt && !/^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i.test(txt)) {
                  txt = txt.replace(/^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+/, '').trim();
                  fields[col] = txt;
                }
              }
            });
            fields._cells = dataCells.map(c => clean(c.textContent));
          }

          // 2. Labeled key-value pairs (Card / Definition List / Form rows)
          // <div class="field"><label>Due Date:</label><span>09/30/2026</span></div>
          const labeledPairs = itemEl.querySelectorAll('dl, dt, [class*="label"], [class*="title"], label, strong, b');
          labeledPairs.forEach(lblEl => {
            const labelText = clean(lblEl.textContent).replace(/[:：]$/, '');
            if (labelText && labelText.length > 1 && labelText.length < 40) {
              const valueEl = lblEl.nextElementSibling || lblEl.parentElement?.querySelector('[class*="value"], [class*="content"], span:not([class*="label"])');
              if (valueEl && valueEl !== lblEl) {
                const val = clean(valueEl.textContent);
                if (val && !fields[labelText]) {
                  fields[labelText] = val;
                }
              }
            }
          });

          // 3. Elements with data-field, data-column, or name attributes
          const dataEls = itemEl.querySelectorAll('[data-field], [data-col], [data-column], [name]');
          dataEls.forEach(el => {
            const attr = el.getAttribute('data-field') || el.getAttribute('data-column') || el.getAttribute('data-col') || el.getAttribute('name');
            const txt = clean(el.textContent);
            if (attr && txt && !fields[attr]) {
              fields[attr] = txt;
            }
          });

          // 4. Badges / Status chips
          const badgeEls = itemEl.querySelectorAll('[class*="status"], [class*="badge"], [class*="tag"], [class*="chip"], [role="status"]');
          badgeEls.forEach(b => {
            const bTxt = clean(b.textContent);
            if (bTxt && bTxt.length < 30 && !fields['Status'] && !fields['State']) {
              fields['Status'] = bTxt;
            }
          });

          // 5. Semantic token extraction from full text if fields are sparse
          if (Object.keys(fields).length < 2 && fullText) {
            // Identifier token
            const idMatch = fullText.match(/\\b([A-Z0-9]{2,8}[-_#][A-Z0-9-_#]{2,20}|(?:INV|ORD|TX|PO|SI|CM)-\\d+|#\\d{4,10})\\b/i);
            if (idMatch && !fields['Identifier'] && !fields['ID'] && !fields['Invoice Number']) {
              fields['Identifier'] = idMatch[1];
            }
            // Date token
            const dateMatch = fullText.match(/\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{4})\\b/i);
            if (dateMatch && !fields['Date'] && !fields['Created On']) {
              fields['Date'] = dateMatch[1];
            }
            // Amount token
            const amountMatch = fullText.match(/\\b([$€£¥₹]\\s*\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d{1,3}(?:,\\d{3})*\\.\\d{2}\\s*[$€£¥₹]?)\\b/);
            if (amountMatch && !fields['Amount'] && !fields['Total']) {
              fields['Amount'] = amountMatch[1];
            }
          }

          // Guaranteed fallback fields
          fields['fullText'] = fullText;
          fields['Text'] = fullText;

          return fields;
        };

        // Extract actions available inside an item
        const extractActions = (itemEl) => {
          const actionEls = Array.from(itemEl.querySelectorAll('button, a, [role="button"], input[type="button"], [class*="btn"], [class*="action"]')).filter(visible);
          return actionEls.map(el => {
            const text = clean(el.textContent);
            const title = clean(el.getAttribute('title') || el.getAttribute('aria-label') || '');
            const href = el.getAttribute('href') || null;
            return {
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') || 'button',
              label: title || text || 'Action',
              href,
              isDownload: /export|download|save|pdf|excel|csv/i.test(\`\${text} \${title} \${href || ''}\`)
            };
          });
        };

        // --- 1. TABLE & GRID COLLECTIONS ---
        const tableElements = Array.from(document.querySelectorAll('table, [role="grid"], .x-grid, .grid-container, .data-table')).filter(el => visible(el) && !isNavOrChrome(el));
        for (const tbl of tableElements) {
          // Extract header columns
          const headerCells = Array.from(tbl.querySelectorAll('thead th, [role="columnheader"], .x-column-header, .mat-header-cell, .ag-header-cell')).filter(visible);
          const headerCols = Array.from(new Set(headerCells.map(c => clean(c.textContent)).filter(t => t.length > 0 && t.length < 60)));

          const rowElements = Array.from(tbl.querySelectorAll('tbody > tr, [role="row"]:not([role="columnheader"]), .x-grid-row, .x-grid-item, .ag-row, mat-row')).filter(el => {
            if (!visible(el)) return false;
            if (el.closest('thead, .x-grid-header-ct, mat-header-row')) return false;
            const ths = el.querySelectorAll('th, [role="columnheader"]');
            const tds = el.querySelectorAll('td, [role="gridcell"]');
            if (ths.length > 0 && tds.length === 0) return false;
            return true;
          });

          // Non-nested rows
          const uniqueRows = rowElements.filter(r => !rowElements.some(other => other !== r && r.contains(other)));

          if (uniqueRows.length >= minItems) {
            const items = uniqueRows.map((r, idx) => {
              const fields = extractFields(r, headerCols);
              const actions = extractActions(r);
              const id = r.getAttribute('data-id') || r.getAttribute('data-testid') || r.id || fields['ID'] || fields['Invoice Number'] || fields['Identifier'] || \`item_\${idx + 1}\`;
              return {
                itemId: String(id).trim(),
                index: idx,
                container: 'table-row',
                fields,
                actions,
                confidence: 0.95
              };
            });

            collections.push({
              type: 'TABLE',
              elementTag: tbl.tagName.toLowerCase(),
              itemCount: items.length,
              headerColumns: headerCols,
              items,
              confidence: 0.95,
              hasSelectionCheckbox: !!tbl.querySelector('input[type="checkbox"], [role="checkbox"]')
            });
          }
        }

        // --- 2. CARD & GRID ITEM COLLECTIONS ---
        const cardContainers = Array.from(document.querySelectorAll('.card-grid, .cards-container, .results-grid, [class*="card-list"], [class*="item-grid"], [role="feed"]')).filter(el => visible(el) && !isNavOrChrome(el));
        // Also check any container with multiple repeating card children
        const potentialContainers = cardContainers.length > 0 ? cardContainers : Array.from(document.querySelectorAll('div, section, main')).filter(el => visible(el) && !isNavOrChrome(el));

        for (const container of potentialContainers) {
          if (container === document.body) continue;
          const directChildren = Array.from(container.children).filter(el => visible(el) && !isNavOrChrome(el));
          if (directChildren.length < minItems) continue;

          // Check if children look like cards (have class 'card', 'item', role 'article', or similar structure)
          const cardLike = directChildren.filter(c => {
            const cls = (typeof c.className === 'string' ? c.className : '').toLowerCase();
            const role = (c.getAttribute('role') || '').toLowerCase();
            return role === 'article' || /\\b(card|grid-item|card-item|product-item|document-item|result-item)\\b/i.test(cls);
          });

          const candidateItems = cardLike.length >= minItems ? cardLike : null;
          if (candidateItems && !collections.some(c => c.items && c.items.length >= candidateItems.length)) {
            const items = candidateItems.map((c, idx) => {
              const fields = extractFields(c);
              const actions = extractActions(c);
              const id = c.getAttribute('data-id') || c.getAttribute('data-testid') || c.id || fields['ID'] || fields['Identifier'] || \`card_\${idx + 1}\`;
              return {
                itemId: String(id).trim(),
                index: idx,
                container: 'card',
                fields,
                actions,
                confidence: 0.88
              };
            });

            collections.push({
              type: 'CARDS',
              elementTag: container.tagName.toLowerCase(),
              itemCount: items.length,
              headerColumns: Object.keys(items[0]?.fields || {}).filter(k => !k.startsWith('_') && k !== 'fullText'),
              items,
              confidence: 0.88,
              hasSelectionCheckbox: !!container.querySelector('input[type="checkbox"], [role="checkbox"]')
            });
          }
        }

        // --- 3. LIST COLLECTIONS (ul > li, ol > li, [role="list"] > [role="listitem"]) ---
        const listContainers = Array.from(document.querySelectorAll('ul, ol, [role="list"]')).filter(el => visible(el) && !isNavOrChrome(el));
        for (const lst of listContainers) {
          const listItems = Array.from(lst.children).filter(c => visible(c) && (c.tagName === 'LI' || c.getAttribute('role') === 'listitem'));
          if (listItems.length >= minItems && !collections.some(c => c.itemCount >= listItems.length)) {
            const items = listItems.map((li, idx) => {
              const fields = extractFields(li);
              const actions = extractActions(li);
              const id = li.getAttribute('data-id') || li.id || fields['ID'] || \`list_item_\${idx + 1}\`;
              return {
                itemId: String(id).trim(),
                index: idx,
                container: 'list-item',
                fields,
                actions,
                confidence: 0.85
              };
            });

            collections.push({
              type: 'LIST',
              elementTag: lst.tagName.toLowerCase(),
              itemCount: items.length,
              headerColumns: ['Label', 'Text'],
              items,
              confidence: 0.85,
              hasSelectionCheckbox: !!lst.querySelector('input[type="checkbox"]')
            });
          }
        }

        // Sort collections by confidence & itemCount
        collections.sort((a, b) => b.confidence - a.confidence || b.itemCount - a.itemCount);
        return collections;
      }
    `;
  }

  /**
   * Discovers all repeating collections on a live Puppeteer page.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {object} options
   * @returns {Promise<object>}
   */
  static async discoverCollections(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('CollectionDetector requires an active Puppeteer page.');
    }

    try {
      const script = `${this.getInjectedDiscoveryScript()};\nreturn __workflowCaptureDiscoverCollections(${JSON.stringify(options)});`;
      const collections = await page.evaluate(new Function(script));
      return {
        success: collections && collections.length > 0,
        count: collections.length,
        collections: collections || [],
        primaryCollection: collections?.[0] || null
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        collections: [],
        primaryCollection: null
      };
    }
  }
}

module.exports = CollectionDetector;
