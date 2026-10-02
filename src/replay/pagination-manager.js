/**
 * Workflow Capture — Robust Pagination & Duplicate Protection Manager
 * 
 * Manages pagination discovery, multi-page traversal, dynamic content loading,
 * and duplicate item protection across:
 * - Next Page buttons (table paginators, arrows, pagination controls)
 * - "Load More" buttons
 * - Infinite Scroll containers
 * - Virtualized lists
 * 
 * Invariants:
 * - Detects visited pages to prevent infinite navigation loops
 * - Computes stable item fingerprints to prevent duplicate processing
 * - Waits for DOM mutations and state transitions rather than fixed delays
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

class PaginationManager {
  constructor(options = {}) {
    this.maxPages = Number.isInteger(options.maxPages) ? options.maxPages : 25;
    this.currentPage = 1;
    this.visitedPageSignatures = new Set();
    this.processedItemIds = new Set();
    this.consecutiveEmptyPages = 0;
  }

  /**
   * Generates a stable unique fingerprint for an item.
   *
   * @param {object} item - Item record with fields, id, index, href
   * @returns {string} Deterministic item fingerprint
   */
  generateItemFingerprint(item) {
    if (!item) return 'empty_item';

    // 1. Explicit stable IDs
    if (item.id && !item.id.startsWith('item_') && !item.id.startsWith('card_')) {
      return `id:${String(item.id).trim()}`;
    }

    const fields = item.fields || {};

    // 2. Primary business identifier fields
    const idVal = fields['Invoice Number'] || fields['Invoice No'] || fields['ID'] ||
      fields['Identifier'] || fields['Document ID'] || fields['Order Number'] ||
      fields['Order #'] || fields['Reference'] || fields['Ref'] || fields['Transaction ID'];
    if (idVal) {
      return `ref:${String(idVal).trim().toLowerCase()}`;
    }

    // 3. Unique link / href
    if (item.href) {
      return `href:${item.href.split('#')[0]}`;
    }

    // 4. Composite hash of semantic data fields
    const keyParts = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k.startsWith('_') || k === 'fullText' || k === 'Text' || k === 'label') continue;
      if (v) keyParts.push(`${k}:${String(v).trim().toLowerCase()}`);
    }

    if (keyParts.length > 0) {
      keyParts.sort();
      return `hash:${crypto.createHash('sha1').update(keyParts.join('|')).digest('hex').slice(0, 16)}`;
    }

    // 5. Fallback to normalized text snippet
    const rawText = String(item.text || fields.fullText || fields.Text || '').slice(0, 100).trim().toLowerCase();
    return `text:${crypto.createHash('sha1').update(rawText).digest('hex').slice(0, 16)}`;
  }

  /**
   * Checks whether an item has already been processed in this execution run.
   *
   * @param {object} item
   * @returns {boolean}
   */
  isDuplicate(item) {
    const fp = this.generateItemFingerprint(item);
    return this.processedItemIds.has(fp);
  }

  /**
   * Marks an item as processed.
   *
   * @param {object} item
   */
  markProcessed(item) {
    const fp = this.generateItemFingerprint(item);
    this.processedItemIds.add(fp);
  }

  /**
   * Filter out already processed items from a newly discovered batch.
   *
   * @param {Array<object>} items
   * @returns {{ deduplicated: Array<object>, duplicateCount: number }}
   */
  deduplicateBatch(items = []) {
    const deduplicated = [];
    let duplicateCount = 0;

    for (const item of items) {
      if (this.isDuplicate(item)) {
        duplicateCount++;
      } else {
        deduplicated.push(item);
      }
    }

    return { deduplicated, duplicateCount };
  }

  /**
   * Discovers pagination controls on the active page.
   *
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<{
   *   hasPagination: boolean,
   *   type: 'NEXT_BUTTON' | 'LOAD_MORE' | 'INFINITE_SCROLL' | 'NONE',
   *   hasNextButton: boolean,
   *   isNextDisabled: boolean,
   *   selector: string|null
   * }>}
   */
  static async detectPaginationControls(page) {
    if (!page || typeof page.evaluate !== 'function') {
      return { hasPagination: false, type: 'NONE', hasNextButton: false, isNextDisabled: true, selector: null };
    }

    try {
      return await page.evaluate(() => {
        const visible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        };

        const isDisabled = (el) => {
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          if (/\\b(disabled|x-item-disabled|dxp-disabled|mat-button-disabled|is-disabled)\\b/i.test(cls)) return true;
          return false;
        };

        // 1. Next button candidates
        const nextCandidates = Array.from(document.querySelectorAll(
          'button, a, [role="button"], .next-page, .btn-next, .pagination-next, .x-tbar-page-next, .dxp-button, .mat-paginator-navigation-next, [aria-label*="next" i], [title*="next" i]'
        )).filter(visible);

        for (const el of nextCandidates) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();

          const isNextMatch = /\\bnext\\b|^>|^»|chevron_right/i.test(text) ||
            /\\bnext\\b/i.test(title) ||
            /\\bnext\\b/i.test(aria) ||
            /\\b(x-tbar-page-next|dxp-button-next|mat-paginator-navigation-next|next-page)\\b/i.test(cls);

          if (isNextMatch) {
            const disabled = isDisabled(el);
            return {
              hasPagination: true,
              type: 'NEXT_BUTTON',
              hasNextButton: true,
              isNextDisabled: disabled,
              text: text || title || aria
            };
          }
        }

        // 2. Load More button candidates
        const loadMoreCandidates = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(visible);
        for (const el of loadMoreCandidates) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (/load more|show more|view more/i.test(text)) {
            return {
              hasPagination: true,
              type: 'LOAD_MORE',
              hasNextButton: true,
              isNextDisabled: isDisabled(el),
              text
            };
          }
        }

        // 3. Infinite Scroll / scrollable container check
        const scrollable = Array.from(document.querySelectorAll('div, table, section, ul')).find(el => {
          if (!visible(el)) return false;
          return el.scrollHeight > el.clientHeight + 100 && (el.scrollHeight > 600);
        });

        if (scrollable) {
          return {
            hasPagination: true,
            type: 'INFINITE_SCROLL',
            hasNextButton: false,
            isNextDisabled: false
          };
        }

        return {
          hasPagination: false,
          type: 'NONE',
          hasNextButton: false,
          isNextDisabled: true
        };
      });
    } catch {
      return { hasPagination: false, type: 'NONE', hasNextButton: false, isNextDisabled: true, selector: null };
    }
  }

  /**
   * Advances the portal to the next page / next batch of items.
   *
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<{ advanced: boolean, reason: string|null, newPage: number }>}
   */
  async advance(page) {
    if (this.currentPage >= this.maxPages) {
      return { advanced: false, reason: `Max pages limit (${this.maxPages}) reached.`, newPage: this.currentPage };
    }

    const controls = await PaginationManager.detectPaginationControls(page);

    if (!controls.hasPagination || controls.type === 'NONE') {
      return { advanced: false, reason: 'No pagination controls detected on page.', newPage: this.currentPage };
    }

    if (controls.isNextDisabled) {
      return { advanced: false, reason: 'Next page control is disabled (reached last page).', newPage: this.currentPage };
    }

    // Capture initial page state signature to verify that navigation actually changes content
    const beforeSignature = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('tr, .card, li, [role="row"]')).slice(0, 5);
      return items.map(i => (i.innerText || '').slice(0, 30)).join('|');
    }).catch(() => '');

    this.visitedPageSignatures.add(beforeSignature);

    let clicked = false;

    if (controls.type === 'NEXT_BUTTON' || controls.type === 'LOAD_MORE') {
      clicked = await page.evaluate(() => {
        const visible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        };

        const isDisabled = (el) => {
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          return /\\b(disabled|x-item-disabled|dxp-disabled|mat-button-disabled|is-disabled)\\b/i.test(cls);
        };

        const candidates = Array.from(document.querySelectorAll(
          'button, a, [role="button"], .next-page, .btn-next, .pagination-next, .x-tbar-page-next, .dxp-button, .mat-paginator-navigation-next, [aria-label*="next" i], [title*="next" i]'
        )).filter(visible).filter(el => !isDisabled(el));

        for (const el of candidates) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();

          if (/\\bnext\\b|^>|^»|load more|show more/i.test(text) ||
              /\\bnext\\b/i.test(title) ||
              /\\bnext\\b/i.test(aria) ||
              /\\b(x-tbar-page-next|dxp-button-next|mat-paginator-navigation-next|next-page)\\b/i.test(cls)) {
            el.scrollIntoView({ block: 'nearest' });
            el.click();
            return true;
          }
        }
        return false;
      }).catch(() => false);
    } else if (controls.type === 'INFINITE_SCROLL') {
      clicked = await page.evaluate(() => {
        window.scrollBy(0, 800);
        return true;
      }).catch(() => false);
    }

    if (!clicked) {
      return { advanced: false, reason: 'Failed to click pagination control.', newPage: this.currentPage };
    }

    // Wait for DOM mutation / new items to load
    await new Promise(r => setTimeout(r, 600));
    try {
      await page.waitForFunction(
        (prevSig) => {
          const items = Array.from(document.querySelectorAll('tr, .card, li, [role="row"]')).slice(0, 5);
          const currentSig = items.map(i => (i.innerText || '').slice(0, 30)).join('|');
          return currentSig !== prevSig;
        },
        { timeout: 3500 },
        beforeSignature
      ).catch(() => {});
    } catch {}

    // Check if new page content is identical to any visited page (detect cycle/loop)
    const afterSignature = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('tr, .card, li, [role="row"]')).slice(0, 5);
      return items.map(i => (i.innerText || '').slice(0, 30)).join('|');
    }).catch(() => '');

    if (afterSignature && this.visitedPageSignatures.has(afterSignature)) {
      return { advanced: false, reason: 'Page content did not change or already visited (pagination loop prevented).', newPage: this.currentPage };
    }

    this.currentPage++;
    logger.info(`[Pagination] Successfully advanced to page #${this.currentPage}`);
    return { advanced: true, reason: null, newPage: this.currentPage };
  }
}

module.exports = PaginationManager;
