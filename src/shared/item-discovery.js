/**
 * Workflow Capture — Deterministic Item Discovery
 *
 * Finds repeated records on the current page from the element the user
 * interacted with during recording. This module is intentionally independent
 * from replay execution so discovery can be tested and evolved separately.
 */

class ItemDiscovery {
  /**
   * Discover a repeated collection around a recorded target.
   *
   * The browser-side portion deliberately uses structural evidence instead of
   * relying only on nth-child selectors. It returns diagnostics suitable for
   * showing the user before batch execution.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {object} target Recorded target/fingerprint
   * @param {object} options Discovery options
   * @returns {Promise<object>}
   */
  static async discover(page, target, options = {}) {
    if (!page) throw new Error('ItemDiscovery.discover requires a Puppeteer page.');
    if (!target) return { success: false, reason: 'No recorded target supplied.' };
    if (target.role === 'SETUP' || target.isNavigationOrChrome === true) {
      return { success: false, reason: 'Target element belongs to site navigation or setup controls.' };
    }

    const minItems = Number.isInteger(options.minItems) ? options.minItems : 2;
    const minScore = typeof options.minScore === 'number' ? options.minScore : 0.55;

    return page.evaluate(({ target, minItems, minScore }) => {
      const visible = (el) => {
        if (!el || !(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0;
      };

      const isNavOrChrome = (el) => {
        if (!el || !(el instanceof Element)) return false;
        const tag = el.tagName.toLowerCase();
        if (['nav', 'header', 'footer', 'mat-toolbar', 'mat-toolbar-row', 'mat-tab-header', 'mat-tab-group', 'mat-tab-nav-bar', 'mat-tab-link', 'mat-sidenav', 'mat-sidenav-container', 'app-header', 'app-nav'].includes(tag)) {
          return true;
        }
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (['navigation', 'menubar', 'tablist', 'tab', 'banner', 'contentinfo', 'toolbar', 'breadcrumb', 'pagination'].includes(role)) {
          return true;
        }
        const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        if (/\b(navbar|nav-tabs|nav-item|nav-link|top-bar|app-bar|sidebar-nav|site-header|main-nav|page-header|pager|header-nav|menu-item|menu-link|i21-menu-link)\b/i.test(className)) {
          return true;
        }
        if (el.id && /(^|#|\b)menu-\d+/i.test(el.id)) {
          return true;
        }
        try {
          if (el.closest('nav, header, footer, mat-toolbar, mat-toolbar-row, mat-tab-header, mat-tab-nav-bar, [role="navigation"], [role="tablist"], [role="menubar"], [role="toolbar"], .navbar, .top-bar, .x-menu, .sidebar')) {
            return true;
          }
        } catch {}
        return false;
      };

      const normalize = (value) => String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      const tokenSet = (value) => new Set(
        normalize(value).split(/[^a-z0-9_#-]+/).filter(Boolean)
      );

      const similarity = (a, b) => {
        const aa = tokenSet(a);
        const bb = tokenSet(b);
        if (!aa.size && !bb.size) return 1;
        if (!aa.size || !bb.size) return 0;
        let intersection = 0;
        for (const token of aa) if (bb.has(token)) intersection++;
        return intersection / Math.max(aa.size, bb.size);
      };

      const structuralSignature = (el) => {
        const children = Array.from(el.children).slice(0, 12)
          .map(child => child.tagName.toLowerCase())
          .join('>');
        return [
          el.tagName.toLowerCase(),
          children,
          el.getAttribute('role') || '',
          (el.getAttribute('data-testid') || '').replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '#'),
          (el.getAttribute('data-qa') || '').replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '#')
        ].join('|');
      };

      const stableClasses = (el) => Array.from(el.classList || [])
        .filter(c => c && !/(active|focus|hover|selected|disabled|loading|open|ng-|cdk-|mat-)/i.test(c))
        .map(c => c.replace(/\d+/g, '#'))
        .slice(0, 8)
        .join(' ');

      let recorded = null;

      // Prefer the project's resolver when it is already injected.
      try {
        if (window.SelectorResolver && typeof window.SelectorResolver.resolveElement === 'function') {
          const resolved = window.SelectorResolver.resolveElement(target);
          if (resolved && resolved.success) recorded = resolved.element;
        }
      } catch {}

      // Safe fallback for recorded candidates (CSS & XPath)
      if (!recorded) {
        const candidates = target.candidates || target.selectors?.candidates || [];
        for (const candidate of candidates) {
          if (!candidate || !candidate.value) continue;
          try {
            const val = String(candidate.value).trim();
            if (val.startsWith('/') || val.startsWith('(') || candidate.strategy === 'xpath') {
              const iterator = document.evaluate(val, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
              let node = iterator.iterateNext();
              let firstNonNav = null;
              while (node) {
                if (visible(node)) {
                  if (!isNavOrChrome(node)) {
                    firstNonNav = node;
                    break;
                  }
                  if (!recorded) recorded = node;
                }
                node = iterator.iterateNext();
              }
              if (firstNonNav) {
                recorded = firstNonNav;
                break;
              }
            } else {
              const matches = Array.from(document.querySelectorAll(val)).filter(visible);
              const nonNav = matches.find(el => !isNavOrChrome(el));
              if (nonNav) {
                recorded = nonNav;
                break;
              } else if (matches.length && !recorded) {
                recorded = matches[0];
              }
            }
          } catch {}
        }
      }

      // Additional fallback: resolve by ID or tag name + text content
      if (!recorded && target.fingerprint) {
        const fp = target.fingerprint;
        if (fp.id) {
          try {
            const el = document.getElementById(fp.id);
            if (visible(el)) recorded = el;
          } catch {}
        }
        if (!recorded && fp.tagName && fp.text) {
          try {
            const normTargetText = normalize(fp.text).slice(0, 40);
            if (normTargetText) {
              const tagElements = Array.from(document.querySelectorAll(fp.tagName)).filter(visible);
              const found = tagElements.find(el => normalize(el.innerText).includes(normTargetText));
              if (found) recorded = found;
            }
          } catch {}
        }
      }

      if (!recorded) {
        return {
          success: false,
          reason: 'Recorded target could not be resolved on the current page.'
        };
      }

      // Check if recorded target itself is navigation or toolbar chrome
      if (isNavOrChrome(recorded)) {
        return {
          success: false,
          reason: 'Recorded element belongs to site navigation or chrome toolbar.'
        };
      }

      const buildAncestorSelector = (el) => {
        if (!el) return '';
        if (el.id) return `#${el.id}`;
        const parent = el.parentElement;
        if (parent && parent.id) return `#${parent.id} ${el.tagName.toLowerCase()}`;
        return el.tagName.toLowerCase();
      };

      const recordedParent = recorded.parentElement;
      const ancestors = [];
      let current = recordedParent;

      while (current && current !== document.body) {
        ancestors.push(current);
        current = current.parentElement;
      }

      const candidates = [];

      for (const ancestor of ancestors) {
        if (isNavOrChrome(ancestor)) continue;

        // Table rows (<tr> / [role="row"]) contain table cells (columns), NOT repeating records.
        const ancTag = ancestor.tagName.toLowerCase();
        const ancRole = (ancestor.getAttribute('role') || '').toLowerCase();
        if (ancTag === 'tr' || ancRole === 'row' || ancestor.classList?.contains('x-grid-row')) {
          continue;
        }

        const children = Array.from(ancestor.children).filter(visible);
        if (children.length < minItems) continue;

        // Identify which direct child of this ancestor contains the recorded element
        const itemForRecorded = children.find(child => child === recorded || child.contains(recorded));
        if (!itemForRecorded) continue;
        if (isNavOrChrome(itemForRecorded)) continue;

        const itemTagLower = itemForRecorded.tagName.toLowerCase();
        const itemRole = (itemForRecorded.getAttribute('role') || '').toLowerCase();

        // Table cells (<td> / <th> / [role="gridcell"]) are columns within a row, NOT collection items.
        if (itemTagLower === 'td' || itemTagLower === 'th' || itemRole === 'gridcell' || itemForRecorded.classList?.contains('x-grid-cell')) {
          continue;
        }

        const sameTag = children.filter(child =>
          child.tagName === itemForRecorded.tagName
        );

        const siblingSet = sameTag.length >= minItems ? sameTag : children;
        if (siblingSet.length < minItems) continue;

        const itemSignature = structuralSignature(itemForRecorded);
        const itemClasses = stableClasses(itemForRecorded);

        const matching = siblingSet.filter(child => {
          const structureScore = child === itemForRecorded
            ? 1
            : similarity(structuralSignature(child), itemSignature);
          const classScore = similarity(stableClasses(child), itemClasses);
          return (structureScore * 0.75 + classScore * 0.25) >= minScore;
        });

        if (matching.length < minItems) continue;

        // 1. Detect if any sibling is a table header row/table and extract headerColumns
        let headerColumns = [];
        const isHeaderItem = (el) => {
          if (!el) return false;
          const tag = el.tagName.toLowerCase();
          if (tag === 'thead' || el.closest('thead, .x-grid-header-ct, .x-grid-header')) return true;
          if (el.classList?.contains('x-grid-header-row') || el.classList?.contains('x-grid-header')) return true;
          const ths = el.querySelectorAll('th, [role="columnheader"], .x-column-header');
          const tds = el.querySelectorAll('td, [role="gridcell"], .x-grid-cell');
          if (ths.length > 0 && tds.length === 0) return true;
          const txt = (el.innerText || el.textContent || '').toLowerCase();
          if (txt.includes('invoice number') && (txt.includes('customer name') || txt.includes('customer number') || txt.includes('payment method'))) return true;
          return false;
        };

        // Try extracting headers from explicit header row or parent grid header
        const explicitHeader = siblingSet.find(isHeaderItem);
        if (explicitHeader) {
          const hCells = Array.from(explicitHeader.querySelectorAll('th, [role="columnheader"], td, .x-column-header')).map(c => (c.innerText || c.textContent || '').trim()).filter(t => t.length > 0 && t.length < 50);
          if (hCells.length > 0) {
            headerColumns = Array.from(new Set(hCells));
          }
        }

        // Also check parent grid / table container for header elements
        const gridContainer = (itemForRecorded.closest && itemForRecorded.closest('.x-grid, table, [role="grid"], .dxgvTable, .grid-container')) || document.querySelector('.x-grid, table, [role="grid"]');
        if (gridContainer && headerColumns.length === 0) {
          const headerCt = gridContainer.querySelector('.x-grid-header-ct, thead, .x-grid-header-row') || gridContainer;
          const headerEls = Array.from(headerCt.querySelectorAll('.x-column-header, th, [role="columnheader"], .mat-header-cell, .ag-header-cell'))
            .filter(h => !h.parentElement?.closest('.x-column-header'));
          const colTexts = headerEls.map(h => {
            const innerTextEl = h.querySelector('.x-column-header-text') || h;
            return (innerTextEl.innerText || innerTextEl.textContent || '').trim();
          }).filter(t => t.length > 0 && t.length < 60);
          if (colTexts.length > 0) {
            headerColumns = Array.from(new Set(colTexts));
          }
        }

        // Exclude header rows from data items
        const dataMatching = matching.filter(child => !isHeaderItem(child));
        const effectiveMatching = dataMatching.length >= minItems ? dataMatching : matching;

        const index = effectiveMatching.indexOf(itemForRecorded);
        if (index < 0 && !effectiveMatching.includes(itemForRecorded) && effectiveMatching.length === 0) continue;

        const ancestorTagLower = ancestor.tagName.toLowerCase();

        // Bonus for recognized repeated item structures (table rows, list items)
        let bonus = 0;
        if ((ancestorTagLower === 'tbody' || ancestorTagLower === 'table') && itemTagLower === 'tr') {
          bonus += 0.2;
        } else if ((ancestorTagLower === 'ul' || ancestorTagLower === 'ol') && itemTagLower === 'li') {
          bonus += 0.2;
        }

        const score = Math.min(
          1,
          0.5 +
          Math.min(0.3, (effectiveMatching.length / Math.max(children.length, 1)) * 0.3) +
          (effectiveMatching.length >= 3 ? 0.2 : 0.1) +
          bonus
        );

        candidates.push({
          score,
          itemCount: effectiveMatching.length,
          recordedIndex: Math.max(0, index),
          ancestorTag: ancestorTagLower,
          ancestorSelector: buildAncestorSelector(ancestor),
          itemTag: itemTagLower,
          itemSignature: itemSignature,
          headerColumns,
          items: effectiveMatching.map((item, itemIndex) => {
            // Extract named columns from table header for table row records
            const fields = {};
            const itemText = (item.innerText || item.textContent || '').trim().replace(/\s+/g, ' ');
            const isTableRow = itemTagLower === 'tr' ||
              itemTagLower === 'table' ||
              item.getAttribute('role') === 'row' ||
              item.classList?.contains('x-grid-row') ||
              item.classList?.contains('x-grid-item') ||
              item.querySelector('td, .x-grid-cell') !== null;

            if (isTableRow) {
              // Direct cell querying without double-matching child divs
              let cells = Array.from(item.querySelectorAll('td, [role="gridcell"]'));
              if (cells.length === 0) {
                cells = Array.from(item.children).filter(c => c.matches?.('td, th, .x-grid-cell, .cell') || c.tagName === 'TD' || c.tagName === 'TH');
              }
              if (cells.length === 0) {
                cells = Array.from(item.querySelectorAll('.x-grid-cell, .dxgv, .cell'));
              }

              // Check if first cell is a selection checkbox or special row-checker
              const isFirstCellChecker = cells.length > 0 && (
                cells[0].classList?.contains('x-grid-cell-special') ||
                cells[0].classList?.contains('x-grid-cell-row-checker') ||
                cells[0].classList?.contains('x-selmodel-column') ||
                cells[0].querySelector?.('.x-grid-row-checker, input[type="checkbox"], [role="checkbox"]') !== null ||
                ((cells[0].innerText || cells[0].textContent || '').trim() === '' && cells.length > headerColumns.length)
              );

              const dataCells = isFirstCellChecker ? cells.slice(1) : cells;

              if (headerColumns.length > 0 && dataCells.length > 0) {
                headerColumns.forEach((h, idx) => {
                  if (dataCells[idx] !== undefined) {
                    const val = (dataCells[idx].innerText || dataCells[idx].textContent || '').trim();
                    if (val) fields[h] = val;
                  }
                });
              }

              // Also check if cells have direct column classes or attribute references
              cells.forEach(cell => {
                const cellText = (cell.innerText || cell.textContent || '').trim();
                const colAttr = cell.getAttribute('data-column') || cell.getAttribute('data-field') || cell.getAttribute('name');
                if (colAttr && cellText) {
                  fields[colAttr] = cellText;
                }
              });

              // Smart field derivation for common enterprise table attributes:
              // 1. Transaction / Invoice Number
              if (!fields['Invoice Number'] && !fields['Invoice No'] && !fields['Invoice']) {
                const invMatch = itemText.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
                if (invMatch) {
                  fields['Invoice Number'] = invMatch[1];
                }
              }

              // 2. Document / Record Type
              if (!fields['Type'] || fields['Type'] === itemText || /^(SI|INV|DR|TX|CM)-\d+/i.test(fields['Type'])) {
                if (/\bcredit\s*memo\b/i.test(itemText)) {
                  fields['Type'] = 'Credit Memo';
                } else if (/\binvoice\b/i.test(itemText)) {
                  fields['Type'] = 'Invoice';
                } else if (/\border\b/i.test(itemText)) {
                  fields['Type'] = 'Order';
                }
              }

              // 3. Status
              if (!fields['Status']) {
                const statusMatch = itemText.match(/\b(Open|Closed|Pending|Paid|Unpaid|Draft|Approved|Posted)\b/i);
                if (statusMatch) {
                  fields['Status'] = statusMatch[1];
                }
              }

              // 4. Due Date & Invoice Date
              if (!fields['Due Date'] || !fields['Invoice Date']) {
                const dateMatches = itemText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);
                if (dateMatches && dateMatches.length >= 2) {
                  fields['Invoice Date'] = fields['Invoice Date'] || dateMatches[0];
                  fields['Due Date'] = fields['Due Date'] || dateMatches[1];
                } else if (dateMatches && dateMatches.length === 1) {
                  fields['Due Date'] = fields['Due Date'] || dateMatches[0];
                }
              }

              // 5. Days Old
              if (!fields['Days Old']) {
                const daysMatch = itemText.match(/\b(\d{1,3})\s+(?:days?\s+old|\d{1,2}\/\d{1,2}\/\d{4})/i);
                if (daysMatch) {
                  fields['Days Old'] = daysMatch[1];
                }
              }
            } else if (itemTagLower === 'mat-option' || itemRole === 'option' || itemTagLower === 'option') {
              fields['Type'] = itemText;
              fields['Option'] = itemText;
              fields['Document Type'] = itemText;
              fields['Text'] = itemText;
              fields['Value'] = itemText;
            } else {
              // Universal field extraction for cards, grids, and list items
              // 1. Labeled pairs (<label>Key:</label><span>Val</span>, <dt>Key</dt><dd>Val</dd>)
              const labelEls = item.querySelectorAll('dt, label, [class*="label"], [class*="title"], strong, b');
              labelEls.forEach(lbl => {
                const lText = (lbl.innerText || lbl.textContent || '').trim().replace(/[:：]$/, '');
                if (lText && lText.length > 1 && lText.length < 40) {
                  const valEl = lbl.nextElementSibling || lbl.parentElement?.querySelector('[class*="value"], [class*="content"], span:not([class*="label"])');
                  if (valEl && valEl !== lbl) {
                    const val = (valEl.innerText || valEl.textContent || '').trim();
                    if (val && !fields[lText]) fields[lText] = val;
                  }
                }
              });

              // 2. Data attributes and named elements
              const dataEls = item.querySelectorAll('[data-field], [data-col], [data-column], [name]');
              dataEls.forEach(el => {
                const attr = el.getAttribute('data-field') || el.getAttribute('data-column') || el.getAttribute('data-col') || el.getAttribute('name');
                const txt = (el.innerText || el.textContent || '').trim();
                if (attr && txt && !fields[attr]) fields[attr] = txt;
              });

              // 3. Status badges / chips
              const badgeEls = item.querySelectorAll('[class*="status"], [class*="badge"], [class*="tag"], [role="status"]');
              badgeEls.forEach(b => {
                const bTxt = (b.innerText || b.textContent || '').trim();
                if (bTxt && bTxt.length < 30 && !fields['Status'] && !fields['State']) {
                  fields['Status'] = bTxt;
                }
              });

              // 4. Semantic tokens from text
              const idMatch = itemText.match(/\b([A-Z0-9]{2,8}[-_#][A-Z0-9-_#]{2,20}|(?:INV|ORD|TX|PO|SI|CM)-\d+|#\d{4,10})\b/i);
              if (idMatch && !fields['Identifier'] && !fields['ID'] && !fields['Invoice Number']) {
                fields['Identifier'] = idMatch[1];
              }
              const dateMatch = itemText.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i);
              if (dateMatch && !fields['Date'] && !fields['Created On']) {
                fields['Date'] = dateMatch[1];
              }
              const amountMatch = itemText.match(/\b([$€£¥₹]\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})*\.\d{2}\s*[$€£¥₹]?)\b/);
              if (amountMatch && !fields['Amount'] && !fields['Total']) {
                fields['Amount'] = amountMatch[1];
              }
            }

            if (fields['Type'] === undefined && fields['type'] === undefined) {
              fields['Type'] = itemText;
            }
            fields['fullText'] = itemText;
            fields['label'] = itemText;
            fields['Text'] = itemText;
            fields['_rawText'] = itemText;

            return {
              index: itemIndex,
              text: normalize(itemText).slice(0, 200),
              tagName: item.tagName.toLowerCase(),
              signature: structuralSignature(item),
              fields,
              href: item.querySelector('a[href]')?.href || null,
              id: item.getAttribute('data-id') ||
                item.getAttribute('data-testid') ||
                item.getAttribute('data-qa') ||
                item.id ||
                null
            };
          })
        });
      }

      candidates.sort((a, b) => b.score - a.score);

      const best = candidates[0];
      if (!best || best.score < minScore) {
        return {
          success: false,
          reason: 'No repeated collection met the discovery confidence threshold.',
          confidence: best ? best.score : 0,
          candidates: candidates.slice(0, 5)
        };
      }

      const availableCols = new Set(best.headerColumns || []);
      for (const itm of best.items || []) {
        for (const k of Object.keys(itm.fields || {})) {
          if (k && !['fullText', 'label', 'isSelectAll'].includes(k)) availableCols.add(k);
        }
      }

      return {
        success: true,
        confidence: best.score,
        itemCount: best.itemCount,
        recordedIndex: best.recordedIndex,
        collection: {
          ancestorTag: best.ancestorTag,
          ancestorSelector: best.ancestorSelector,
          itemTag: best.itemTag,
          itemSignature: best.itemSignature
        },
        items: best.items,
        availableFields: Array.from(availableCols),
        candidates: candidates.slice(0, 5)
      };
    }, { target, minItems, minScore });
  }


  /**
   * Resolve one discovered item again from the current DOM.
   * Returns a Puppeteer ElementHandle so replay can execute the recorded action
   * relative to that item instead of the original recorded element.
   */
  static async getItemHandle(page, discovery, index) {
    if (!page) throw new Error('ItemDiscovery.getItemHandle requires a Puppeteer page.');
    if (!discovery || !discovery.success || !discovery.collection) {
      throw new Error('Invalid discovery result.');
    }

    return page.evaluateHandle(({ collection, index }) => {
      const visible = (el) => {
        if (!el || !(el instanceof Element)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          rect.width > 0 && rect.height > 0 && rect.top > -500 && rect.left > -500;
      };

      const normalize = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();

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

      for (const ancestor of ancestors) {
        // Prefer exact structural matches captured during discovery.
        const exactItems = Array.from(ancestor.children).filter(child =>
          visible(child) &&
          child.tagName.toLowerCase() === collection.itemTag &&
          structuralSignature(child) === collection.itemSignature
        );

        if (exactItems.length > index) {
          try { exactItems[index].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
          return exactItems[index];
        }

        // If a portal re-renders a row/card and changes a transient attribute
        // (role, data-testid, etc.), preserve the collection ordering instead
        // of losing the item entirely. The item tag remains the hard boundary.
        const compatibleItems = Array.from(ancestor.children).filter(child =>
          visible(child) &&
          child.tagName.toLowerCase() === collection.itemTag
        );

        if (compatibleItems.length > index) {
          try { compatibleItems[index].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
          return compatibleItems[index];
        }
      }

      return null;
    }, { collection: discovery.collection, index });
  }

  /**
   * Check whether a discovered collection candidate belongs to site navigation or toolbar chrome.
   */
  static isNavigationCandidate(candidate) {
    if (!candidate) return false;
    const combined = [
      candidate.tagName || '',
      candidate.parentTag || '',
      candidate.role || '',
      candidate.ancestorTag || '',
      candidate.ancestorSelector || '',
      Array.isArray(candidate.classes) ? candidate.classes.join(' ') : (candidate.classes || '')
    ].join(' ').toLowerCase();

    if (/\b(mat-toolbar|mat-toolbar-row|mat-tab-header|mat-tab-group|mat-tab-nav-bar|mat-tab-link|mat-sidenav|mat-sidenav-container|app-header|app-nav|navbar)\b/i.test(combined)) {
      return true;
    }
    if (/\b(navigation|menubar|tablist|tab|banner|contentinfo|toolbar|breadcrumb|pagination)\b/i.test(combined)) {
      return true;
    }
    if (/\b(navbar|nav-tabs|nav-item|nav-link|top-bar|app-bar|sidebar-nav|site-header|main-nav|page-header|pager|header-nav|menu-item)\b/i.test(combined)) {
      return true;
    }
    return false;
  }

  /**
   * Select the best candidate from already-collected discovery candidates.
   * Kept pure for deterministic unit testing.
   *
   * @param {Array<object>} candidates
   * @returns {object|null}
   */
  static selectBestCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return candidates
      .filter(c => c && typeof c.score === 'number' && !this.isNavigationCandidate(c))
      .sort((a, b) => b.score - a.score)[0] || null;
  }
}

module.exports = ItemDiscovery;
