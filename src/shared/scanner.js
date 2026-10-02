/**
 * Workflow Capture — Universal Deep Page Scanner
 * 
 * Scans web pages across main DOM, nested iframes, and open Shadow DOM trees.
 * Produces a comprehensive, structured map of every interactive element with
 * prioritized stable selectors and semantic labels.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class Scanner {
  /**
   * Waits for the page to be truly ready and stable before scanning:
   * 1. Network idle
   * 2. Spinners, loaders, and busy overlays dismissed
   * 3. DOM quiet (MutationObserver debounce)
   */
  static async waitForPageReady(page, options = {}) {
    if (!page) return;
    const timeout = options.timeout || 10000;
    const quietMs = options.quietMs || 300;

    // 1. Wait for network idle if possible
    try {
      if (typeof page.waitForNetworkIdle === 'function') {
        await page.waitForNetworkIdle({ idleTime: 300, timeout: Math.min(timeout, 3000) }).catch(() => {});
      }
    } catch {}

    // 2. Wait for loading indicators and spinners to disappear
    try {
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll(
          '.spinner, .loading, .loader, [aria-busy="true"], .mat-progress-spinner, .x-mask, .ant-spin-spinning'
        );
        for (const s of spinners) {
          const style = window.getComputedStyle(s);
          const rect = s.getBoundingClientRect();
          if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
            return false;
          }
        }
        return true;
      }, { timeout: Math.min(timeout, 4000) }).catch(() => {});
    } catch {}

    // 3. DOM MutationObserver Debounce (waits until no mutations occur for quietMs)
    try {
      await page.evaluate((quietDuration) => {
        return new Promise((resolve) => {
          let timer = setTimeout(resolve, quietDuration);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, quietDuration);
          });
          observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true
          });
          // Safety timeout
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 3000);
        });
      }, quietMs).catch(() => {});
    } catch {}
  }

  /**
   * Browser-side scanning script that traverses document, shadow roots, and iframes.
   */
  static getInjectedScannerScript() {
    return `
      function __workflowCaptureScanPage(scanOptions = {}) {
        const includeHidden = scanOptions.includeHidden === true;
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

        // Collect all roots (main DOM, open shadow roots, accessible iframes)
        const roots = [{ doc: document, frameName: 'top' }];
        
        // Open Shadow Roots
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => {
          if (el.shadowRoot) {
            roots.push({ doc: el.shadowRoot, frameName: 'shadow-root' });
          }
        });

        // Iframes
        const iframes = Array.from(document.querySelectorAll('iframe'));
        iframes.forEach((ifr, idx) => {
          try {
            if (ifr.contentDocument && ifr.contentDocument.body) {
              roots.push({ doc: ifr.contentDocument, frameName: ifr.name || ifr.id || ('iframe_' + idx) });
            }
          } catch {}
        });

        // Label finder
        const resolveLabel = (el) => {
          if (!el) return '';
          // 1. label[for="id"]
          if (el.id) {
            const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
            if (lbl && clean(lbl.textContent)) return clean(lbl.textContent);
          }
          // 2. Wrapping label
          const parentLabel = el.closest('label');
          if (parentLabel && clean(parentLabel.textContent)) {
            // Remove the element's own value text if included
            return clean(parentLabel.textContent);
          }
          // 3. aria-labelledby
          const ariaLabelledBy = el.getAttribute('aria-labelledby');
          if (ariaLabelledBy) {
            const refEl = document.getElementById(ariaLabelledBy);
            if (refEl && clean(refEl.textContent)) return clean(refEl.textContent);
          }
          // 4. aria-label
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && clean(ariaLabel)) return clean(ariaLabel);
          // 5. placeholder or title
          const placeholder = el.getAttribute('placeholder') || el.getAttribute('title');
          if (placeholder && clean(placeholder)) return clean(placeholder);
          // 6. Preceding text / sibling
          let prev = el.previousElementSibling;
          while (prev) {
            const txt = clean(prev.textContent);
            if (txt && txt.length > 1 && txt.length < 50) return txt.replace(/[:：]$/, '');
            prev = prev.previousElementSibling;
          }
          return '';
        };

        // Stable Selector Builder: Priority id > name > data-* > aria-label > label text > CSS path > XPath
        const buildStableSelector = (el, label) => {
          if (!el) return { selector: '', strategy: 'none' };
          
          // 1. Non-dynamic ID
          if (el.id && !/\\d{5,}/.test(el.id) && !/^(ext-|ember|yui|gwt|uid)/i.test(el.id)) {
            return { selector: '#' + CSS.escape(el.id), strategy: 'id' };
          }

          // 2. Name attribute
          const name = el.getAttribute('name');
          if (name && !/\\d{5,}/.test(name)) {
            return { selector: el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]', strategy: 'name' };
          }

          // 3. Data attributes (data-testid, data-qa, data-id)
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-cy');
          if (testId) {
            return { selector: '[data-testid="' + CSS.escape(testId) + '"]', strategy: 'data-testid' };
          }
          const dataId = el.getAttribute('data-id') || el.getAttribute('data-key');
          if (dataId && !/\\d{5,}/.test(dataId)) {
            return { selector: '[' + (el.getAttribute('data-id') ? 'data-id' : 'data-key') + '="' + CSS.escape(dataId) + '"]', strategy: 'data-id' };
          }

          // 4. ARIA label
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.length < 60) {
            return { selector: el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(ariaLabel) + '"]', strategy: 'aria-label' };
          }

          // 5. Unique CSS with stable classes
          const tag = el.tagName.toLowerCase();
          const stableClasses = Array.from(el.classList || [])
            .filter(c => c && !/(active|focus|hover|selected|disabled|loading|open|ng-|cdk-)/i.test(c) && !/\\d{5,}/.test(c));

          if (stableClasses.length > 0) {
            const classSel = tag + '.' + stableClasses.slice(0, 2).map(c => CSS.escape(c)).join('.');
            try {
              if (document.querySelectorAll(classSel).length === 1) {
                return { selector: classSel, strategy: 'css-class-unique' };
              }
            } catch {}
          }

          // 6. Label / Text-based XPath
          if (label && label.length > 1 && label.length < 40 && !/[\\'"]/.test(label)) {
            if (['button', 'a'].includes(tag) || el.getAttribute('role') === 'button') {
              return { selector: '//' + tag + '[contains(text(), "' + label + '")]', strategy: 'xpath-text' };
            }
          }

          // 7. Fallback hierarchical path
          let path = tag;
          let parent = el.parentElement;
          let depth = 0;
          while (parent && parent !== document.body && depth < 3) {
            if (parent.id && !/\\d{5,}/.test(parent.id)) {
              path = '#' + CSS.escape(parent.id) + ' > ' + path;
              break;
            }
            path = parent.tagName.toLowerCase() + ' > ' + path;
            parent = parent.parentElement;
            depth++;
          }

          return { selector: path, strategy: 'css-path' };
        };

        // Determine specific element type
        const determineElementType = (el) => {
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();

          if (tag === 'textarea') return 'textarea';
          if (tag === 'select') return el.multiple ? 'multi-select' : 'select';
          if (tag === 'input') {
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'password') return 'password';
            if (type === 'email') return 'email';
            if (type === 'number') return 'number';
            if (type === 'date' || type === 'datetime-local') return 'date';
            if (type === 'file') return 'file';
            if (type === 'submit' || type === 'button') return 'button';
            return 'text';
          }
          if (tag === 'button' || role === 'button') return 'button';
          if (tag === 'a' && el.hasAttribute('href')) return 'link';
          if (role === 'checkbox' || el.classList.contains('checkbox')) return 'checkbox';
          if (role === 'switch') return 'toggle';
          if (role === 'tab') return 'tab';
          if (role === 'option') return 'dropdown-option';
          if (tag === 'tr' || role === 'row') return 'table-row';
          if (el.closest('.pagination, [role="navigation"]') || /next|prev|page/i.test(el.className)) return 'pagination-control';
          
          return tag;
        };

        const elements = [];

        // Interactive selectors
        const interactiveSelector = [
          'input', 'select', 'textarea', 'button', 'a[href]',
          '[role="button"]', '[role="checkbox"]', '[role="switch"]', '[role="tab"]',
          '[role="option"]', '[role="menuitem"]', '[tabindex]:not([tabindex="-1"])',
          'tr[data-id]', '[role="row"]'
        ].join(', ');

        for (const { doc, frameName } of roots) {
          const matchedNodes = Array.from(doc.querySelectorAll(interactiveSelector));

          matchedNodes.forEach((el, index) => {
            if (!includeHidden && !isVisible(el)) return;

            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const inputType = determineElementType(el);
            const label = resolveLabel(el);
            const { selector, strategy } = buildStableSelector(el, label);

            const isChecked = el.checked || el.getAttribute('aria-checked') === 'true';
            const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
            const isRequired = el.required || el.getAttribute('aria-required') === 'true';

            // Value or text representation
            let val = '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
              val = el.value || '';
            } else {
              val = clean(el.textContent).slice(0, 100);
            }

            elements.push({
              index: elements.length,
              frame: frameName,
              tag,
              type: inputType,
              id: el.id || null,
              name: el.getAttribute('name') || null,
              className: el.className ? String(el.className).trim() : null,
              placeholder: el.getAttribute('placeholder') || null,
              ariaLabel: el.getAttribute('aria-label') || null,
              text: clean(el.textContent).slice(0, 100),
              label: label || null,
              parentContainer: el.parentElement ? el.parentElement.tagName.toLowerCase() : null,
              currentValue: val,
              checked: isChecked,
              disabled: isDisabled,
              required: isRequired,
              visible: isVisible(el),
              selector,
              selectorStrategy: strategy,
              position: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          });
        }

        return {
          url: window.location.href,
          title: document.title,
          totalInteractive: elements.length,
          elements
        };
      }
    `;
  }

  /**
   * Scans an active page and outputs `fields.json` and a console summary table.
   *
   * @param {import('puppeteer-core').Page} page
   * @param {object} options
   * @returns {Promise<object>}
   */
  static async scan(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('Scanner requires an active Puppeteer page.');
    }

    // Ensure page stability
    await this.waitForPageReady(page, options);

    try {
      const script = `${this.getInjectedScannerScript()};\nreturn __workflowCaptureScanPage(${JSON.stringify(options)});`;
      const result = await page.evaluate(new Function(script));

      // Print clean console summary table
      if (result && Array.isArray(result.elements)) {
        const summaryRows = result.elements.slice(0, 30).map(e => ({
          '#': e.index,
          Type: e.type,
          Label: e.label || e.text || e.name || e.id || '-',
          Selector: e.selector,
          Strategy: e.selectorStrategy,
          Value: e.currentValue ? String(e.currentValue).slice(0, 20) : '-'
        }));

        logger.info(`\n📊 [Scanner] Discovered ${result.totalInteractive} interactive elements on "${result.title}":`);
        if (typeof console.table === 'function' && summaryRows.length > 0) {
          console.table(summaryRows);
        }
      }

      // Save fields.json if outputPath is provided or run directory exists
      const outputPath = options.outputPath || (options.runDir ? path.join(options.runDir, 'fields.json') : null);
      if (outputPath) {
        try {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
          logger.info(`[Scanner] Wrote field map to ${outputPath}`);
        } catch (writeErr) {
          logger.warn(`[Scanner] Could not write fields.json: ${writeErr.message}`);
        }
      }

      return result;
    } catch (err) {
      logger.error(`[Scanner] Scanning error: ${err.message}`);
      return {
        url: '',
        title: '',
        totalInteractive: 0,
        elements: [],
        error: err.message
      };
    }
  }
}

module.exports = Scanner;
