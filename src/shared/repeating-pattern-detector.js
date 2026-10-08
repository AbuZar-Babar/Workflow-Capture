/**
 * Workflow Capture — Universal Repeating Pattern Detector
 * 
 * Detects repeating structures on any website purely through structural,
 * layout, and behavioral analysis with ZERO hardcoded site assumptions.
 * 
 * Supports:
 * - HTML Tables (table / tbody / tr)
 * - ARIA Grids & Div-based tables (role="grid", role="row")
 * - Card grids (Flexbox / CSS-Grid with visually similar items)
 * - Checkbox lists & Radio groups (native inputs or custom styled ARIA toggles)
 * - Dropdown option collections (native selects, custom listbox/combobox overlays)
 * - Lists (ul > li, ol > li, role="list" > role="listitem")
 * - Accordions, Tabs, Tree views
 * - Open Shadow DOM roots & accessible iframe documents
 */

'use strict';

class RepeatingPatternDetector {
  /**
   * Browser-executable script that discovers and classifies repeating patterns.
   */
  static getInjectedScript() {
    return `
      function __workflowCaptureDetectRepeatingPatterns(options = {}) {
        const similarityThreshold = typeof options.similarityThreshold === 'number' ? options.similarityThreshold : 0.8;
        const minItems = typeof options.minItems === 'number' ? options.minItems : 2;
        const configOverride = options.configOverride || {};

        const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

        const isVisible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          try {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0' &&
              rect.width > 0 &&
              rect.height > 0;
          } catch {
            return false;
          }
        };

        const isNavOrChrome = (el) => {
          if (!el) return false;
          const tag = (el.tagName || '').toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();

          if (['header', 'footer', 'nav'].includes(tag)) return true;
          if (['navigation', 'banner', 'contentinfo'].includes(role)) return true;
          if (/\\b(navbar|site-header|site-footer|breadcrumb|header-nav)\\b/i.test(cls)) return true;

          try {
            if (el.closest('header, footer, nav, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar')) {
              return true;
            }
          } catch {}
          return false;
        };

        // Collect all documents including iframes and shadow roots
        const allRoots = [document];
        const shadowHosts = document.querySelectorAll('*');
        shadowHosts.forEach(el => {
          if (el.shadowRoot) allRoots.push(el.shadowRoot);
        });

        const iframes = Array.from(document.querySelectorAll('iframe'));
        iframes.forEach(ifr => {
          try {
            if (ifr.contentDocument && ifr.contentDocument.body) {
              allRoots.push(ifr.contentDocument);
            }
          } catch {}
        });

        // Compute structural fingerprint for an element
        const getStructuralSignature = (el) => {
          if (!el || !(el instanceof Element)) return '';
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || '';
          
          // Children tag sequence (up to 15 children)
          const childrenTags = Array.from(el.children).slice(0, 15).map(c => c.tagName.toLowerCase()).join('>');
          
          // Distinct interactive element counts
          const hasInputs = el.querySelector('input, select, textarea') ? 1 : 0;
          const hasButtons = el.querySelector('button, [role="button"], a[href]') ? 1 : 0;
          const hasCheckboxes = el.querySelector('input[type="checkbox"], [role="checkbox"]') ? 1 : 0;
          
          // Stable class names (filtering dynamic state classes)
          const classes = Array.from(el.classList || [])
            .filter(c => c && !/(active|focus|hover|selected|disabled|loading|open|ng-|cdk-)/i.test(c))
            .sort()
            .slice(0, 5)
            .join('.');

          return [tag, role, childrenTags, hasInputs, hasButtons, hasCheckboxes, classes].join('||');
        };

        // Calculate token/string similarity (Jaccard on structural components)
        const computeSimilarity = (sigA, sigB) => {
          if (sigA === sigB) return 1.0;
          const partsA = sigA.split('||');
          const partsB = sigB.split('||');
          if (partsA[0] !== partsB[0]) return 0.0; // Different primary tag
          
          let matches = 0;
          let total = Math.max(partsA.length, partsB.length);
          for (let i = 0; i < total; i++) {
            if (partsA[i] && partsB[i] && partsA[i] === partsB[i]) {
              matches++;
            }
          }
          return matches / total;
        };

        // Check if an item contains interactive elements
        const hasInteractiveElements = (el) => {
          if (!el) return false;
          return !!el.querySelector('input, button, a[href], select, textarea, [role="button"], [role="checkbox"], [role="link"], [role="option"], [role="menuitem"]');
        };

        // Generate stable selector for an element
        const getStableSelector = (el) => {
          if (!el) return '';
          if (el.id && !/\\d{4,}/.test(el.id)) return '#' + CSS.escape(el.id);
          if (el.getAttribute('data-testid')) return '[data-testid="' + CSS.escape(el.getAttribute('data-testid')) + '"]';
          if (el.getAttribute('data-id')) return '[data-id="' + CSS.escape(el.getAttribute('data-id')) + '"]';
          if (el.getAttribute('name')) return '[name="' + CSS.escape(el.getAttribute('name')) + '"]';
          
          const role = el.getAttribute('role');
          if (role) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return '[role="' + role + '"][aria-label="' + CSS.escape(ariaLabel) + '"]';
            return '[role="' + role + '"]';
          }

          const tag = el.tagName.toLowerCase();
          const validClasses = Array.from(el.classList || [])
            .filter(c => c && !/(active|focus|hover|selected|disabled|loading|open|ng-|cdk-)/i.test(c) && !/\\d{4,}/.test(c));
          
          if (validClasses.length > 0) {
            return tag + '.' + validClasses.slice(0, 2).map(c => CSS.escape(c)).join('.');
          }

          return tag;
        };

        // Extract key fields from an item element
        const extractItemFields = (itemEl, headerColumns = []) => {
          const fields = {};
          const fullText = clean(itemEl.textContent);

          // 1. If headers exist and element has cell children
          let cellEls = Array.from(itemEl.querySelectorAll('td, [role="gridcell"], th, [role="columnheader"]')).filter(isVisible);
          if (cellEls.length === 0 && (itemEl.tagName === 'TR' || itemEl.getAttribute('role') === 'row')) {
            cellEls = Array.from(itemEl.children).filter(isVisible);
          }

          if (cellEls.length > 0 && headerColumns.length > 0) {
            const isControlOrExpander = (c) => {
              if (!c) return false;
              if (c.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]') !== null) return true;
              if (c.classList?.contains('x-grid-cell-special') || c.classList?.contains('x-grid-cell-row-checker') || c.classList?.contains('x-grid-row-expander') || c.classList?.contains('expander')) return true;
              const txt = clean(c.textContent);
              return txt && /^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i.test(txt) && txt.length <= 4;
            };
            const nonControlCells = cellEls.filter(c => !isControlOrExpander(c));
            const dataCells = nonControlCells.length > 0 ? nonControlCells : cellEls;

            headerColumns.forEach((colName, idx) => {
              if (dataCells[idx]) {
                let txt = clean(dataCells[idx].textContent);
                if (txt && !/^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+$/i.test(txt)) {
                  txt = txt.replace(/^[▸►▶▼▽▾+\-±›❯»⮞⌄v><\u25B6\u25BC\u25B8\u25BE\u276F\u203A\s]+/, '').trim();
                  fields[colName] = txt;
                }
              }
            });
            fields._cells = dataCells.map(c => clean(c.textContent));
          }

          // 2. Labeled key-value pairs (DL/DT/DD, <label>Value</label>, strong/b)
          const labeledNodes = itemEl.querySelectorAll('dl, dt, [class*="label"], [class*="title"], label, strong, b');
          labeledNodes.forEach(lbl => {
            const lblText = clean(lbl.textContent).replace(/[:：]$/, '');
            if (lblText && lblText.length > 1 && lblText.length < 40) {
              const valEl = lbl.nextElementSibling || lbl.parentElement?.querySelector('[class*="value"], [class*="content"], span:not([class*="label"])');
              if (valEl && valEl !== lbl) {
                const val = clean(valEl.textContent);
                if (val && !fields[lblText]) fields[lblText] = val;
              }
            }
          });

          // 3. Named attributes (data-field, data-col, name)
          const namedEls = itemEl.querySelectorAll('[data-field], [data-col], [data-column], [name]');
          namedEls.forEach(el => {
            const attr = el.getAttribute('data-field') || el.getAttribute('data-column') || el.getAttribute('data-col') || el.getAttribute('name');
            const txt = clean(el.textContent);
            if (attr && txt && !fields[attr]) fields[attr] = txt;
          });

          // 4. Form inputs (checkboxes, radios, selects, text inputs)
          const checkboxEl = itemEl.querySelector('input[type="checkbox"], [role="checkbox"]');
          if (checkboxEl) {
            fields['isSelected'] = checkboxEl.checked || checkboxEl.getAttribute('aria-checked') === 'true';
            const labelFor = checkboxEl.id ? itemEl.querySelector('label[for="' + CSS.escape(checkboxEl.id) + '"]') : null;
            const parentLabel = checkboxEl.closest('label');
            const chkLabel = labelFor ? clean(labelFor.textContent) : (parentLabel ? clean(parentLabel.textContent) : '');
            if (chkLabel && !fields['Label']) fields['Label'] = chkLabel;
          }

          // 5. Semantic values (dates, currencies, IDs, status)
          if (!fields['Amount']) {
            const currencyMatch = fullText.match(/\\b([$€£¥₹]\\s*\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d{1,3}(?:,\\d{3})*\\.\\d{2}\\s*[$€£¥₹]?)\\b/);
            if (currencyMatch) fields['Amount'] = currencyMatch[1];
          }

          if (!fields['Date']) {
            const dateMatch = fullText.match(/\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{4})\\b/i);
            if (dateMatch) fields['Date'] = dateMatch[1];
          }

          if (!fields['ID'] && !fields['Identifier']) {
            const idMatch = fullText.match(/\\b([A-Z0-9]{2,8}[-_#][A-Z0-9-_#]{2,20}|#\\d{4,10})\\b/i);
            if (idMatch) fields['Identifier'] = idMatch[1];
          }

          // 6. Actionable Controls
          const controls = [];
          const interactiveNodes = Array.from(itemEl.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"], input[type="checkbox"], [role="checkbox"]')).filter(isVisible);
          interactiveNodes.forEach(ctrl => {
            const ctrlText = clean(ctrl.textContent || ctrl.getAttribute('title') || ctrl.getAttribute('aria-label') || ctrl.getAttribute('value') || '');
            controls.push({
              tag: ctrl.tagName.toLowerCase(),
              role: ctrl.getAttribute('role') || ctrl.type || 'button',
              label: ctrlText,
              selector: getStableSelector(ctrl),
              isDownload: /download|export|save|pdf|csv|excel/i.test(ctrlText + ' ' + (ctrl.getAttribute('href') || ''))
            });
          });

          // Persistent unique key
          const explicitId = itemEl.getAttribute('data-id') || itemEl.getAttribute('data-testid') || itemEl.id || null;
          const href = itemEl.querySelector('a[href]')?.getAttribute('href') || null;
          const uniqueKey = explicitId || fields['ID'] || fields['Identifier'] || href || (fullText.slice(0, 60));

          fields['Text'] = fullText;
          fields['fullText'] = fullText;

          return {
            fields,
            controls,
            uniqueKey: clean(uniqueKey)
          };
        };

        const discoveredGroups = [];

        // Traverse all root DOMs
        for (const root of allRoots) {
          const potentialParents = Array.from(root.querySelectorAll('*')).filter(el => {
            if (!isVisible(el)) return false;
            if (isNavOrChrome(el)) return false;
            const childCount = el.children ? el.children.length : 0;
            return childCount >= minItems;
          });

          for (const parent of potentialParents) {
            const directChildren = Array.from(parent.children).filter(isVisible);
            if (directChildren.length < minItems) continue;

            // Group direct children by structural similarity
            const clusters = [];
            for (const child of directChildren) {
              const sig = getStructuralSignature(child);
              let placed = false;
              for (const cluster of clusters) {
                const repSig = cluster.representativeSig;
                if (computeSimilarity(sig, repSig) >= similarityThreshold) {
                  cluster.items.push(child);
                  placed = true;
                  break;
                }
              }
              if (!placed) {
                clusters.push({
                  representativeSig: sig,
                  representativeTag: child.tagName.toLowerCase(),
                  items: [child]
                });
              }
            }

            // Evaluate valid clusters
            for (const cluster of clusters) {
              const count = cluster.items.length;
              const hasInteractivity = cluster.items.some(hasInteractiveElements);
              
              // Rule: 3+ siblings, OR 2+ if holding interactive elements
              if (count >= 3 || (count >= 2 && hasInteractivity)) {
                // Classify group type
                const sample = cluster.items[0];
                const parentTag = parent.tagName.toLowerCase();
                const parentRole = (parent.getAttribute('role') || '').toLowerCase();
                const sampleTag = sample.tagName.toLowerCase();
                const sampleRole = (sample.getAttribute('role') || '').toLowerCase();

                let groupType = 'repeating-container';
                let headerColumns = [];

                if (parentTag === 'tbody' || parentTag === 'table' || sampleTag === 'tr' || parentRole === 'grid' || sampleRole === 'row') {
                  groupType = 'table';
                  // Extract header columns
                  const tableEl = parent.closest('table') || parent;
                  const headerEls = Array.from(tableEl.querySelectorAll('thead th, [role="columnheader"]')).filter(isVisible);
                  headerColumns = Array.from(new Set(headerEls.map(h => clean(h.textContent)).filter(t => t.length > 0 && t.length < 60)));
                } else if (sample.querySelector('input[type="checkbox"], [role="checkbox"]')) {
                  groupType = 'checkbox-list';
                } else if (sample.querySelector('input[type="radio"], [role="radio"]')) {
                  groupType = 'radio-group';
                } else if (sampleTag === 'mat-option' || sampleTag === 'option' || sampleRole === 'option') {
                  groupType = 'dropdown';
                } else if (parentTag === 'ul' || parentTag === 'ol' || sampleTag === 'li' || sampleRole === 'listitem') {
                  groupType = 'list';
                } else {
                  // Check if items look like cards or tiles
                  const rect = sample.getBoundingClientRect();
                  if (rect.width > 120 && rect.height > 80) {
                    groupType = 'cards';
                  } else {
                    groupType = 'grid';
                  }
                }

                // Extract fields and controls for each item
                const itemsData = cluster.items.map((itemEl, idx) => {
                  const { fields, controls, uniqueKey } = extractItemFields(itemEl, headerColumns);
                  return {
                    index: idx,
                    uniqueKey: uniqueKey || ('item_' + (idx + 1)),
                    selector: getStableSelector(itemEl),
                    fields,
                    controls,
                    text: clean(itemEl.textContent).slice(0, 150)
                  };
                });

                // Compute comprehensive ranking score
                // Signals: count, interactivity, text variety, screen area, visibility
                const parentRect = parent.getBoundingClientRect();
                const area = parentRect.width * parentRect.height;
                const distinctTexts = new Set(cluster.items.map(it => clean(it.textContent).slice(0, 30))).size;
                const textVarietyScore = distinctTexts / Math.max(count, 1);
                const interactivityScore = hasInteractivity ? 0.3 : 0.0;
                const typeWeight = groupType === 'table' ? 0.35 : (groupType === 'checkbox-list' ? 0.30 : (groupType === 'cards' ? 0.25 : 0.20));

                const score = (
                  Math.min(count / 20, 1.0) * 0.25 +
                  textVarietyScore * 0.20 +
                  interactivityScore +
                  typeWeight +
                  Math.min(area / (window.innerWidth * window.innerHeight || 1), 1.0) * 0.10
                );

                discoveredGroups.push({
                  containerSelector: getStableSelector(parent),
                  itemSelector: getStableSelector(sample),
                  itemCount: count,
                  itemType: groupType,
                  headerColumns,
                  score: parseFloat(score.toFixed(3)),
                  hasInteractivity,
                  items: itemsData
                });
              }
            }
          }
        }

        // Deduplicate groups that wrap the same elements
        const uniqueGroups = discoveredGroups.filter((grp, idx) => {
          return !discoveredGroups.some((other, oIdx) =>
            oIdx < idx &&
            other.itemCount === grp.itemCount &&
            other.itemType === grp.itemType &&
            other.containerSelector === grp.containerSelector
          );
        });

        // Sort by score descending
        uniqueGroups.sort((a, b) => b.score - a.score);

        // Apply config override if specified
        let primaryGroup = uniqueGroups[0] || null;
        if (configOverride.containerSelector) {
          const matched = uniqueGroups.find(g => g.containerSelector.includes(configOverride.containerSelector));
          if (matched) primaryGroup = matched;
        }

        return {
          success: uniqueGroups.length > 0,
          totalGroups: uniqueGroups.length,
          primaryGroup,
          groups: uniqueGroups
        };
      }
    `;
  }

  /**
   * Run repeating pattern detection on an active Puppeteer page.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {object} options
   * @returns {Promise<object>}
   */
  static async detect(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('RepeatingPatternDetector requires an active Puppeteer page.');
    }

    try {
      const script = `${this.getInjectedScript()};\nreturn __workflowCaptureDetectRepeatingPatterns(${JSON.stringify(options)});`;
      const result = await page.evaluate(new Function(script));
      return result || { success: false, totalGroups: 0, groups: [], primaryGroup: null };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        totalGroups: 0,
        groups: [],
        primaryGroup: null
      };
    }
  }
}

module.exports = RepeatingPatternDetector;
