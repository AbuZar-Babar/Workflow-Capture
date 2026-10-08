/**
 * Workflow Capture — Universal Exception & Interruption Handler
 * 
 * Objectives:
 * 1. Proactively and reactively handle unexpected browser interruptions
 *    (e.g., native JavaScript alert/confirm/prompt/beforeunload dialogs,
 *    unexpected blocking DOM overlays, error modals, and popups).
 * 2. Prevent Chrome from hanging or timing out when an unhandled dialog appears
 *    (such as "customerportal.usoil.com says: You must select one or more EFT Documents...").
 * 3. Provide resilient single-retry recovery around action executions without altering
 *    existing workflow logic when no interruption occurs.
 */

'use strict';

const logger = require('../utils/logger');

class InterruptionHandler {
  constructor(options = {}) {
    this.attachedPages = new WeakSet();
    this.interruptionHistory = [];
    this.maxHistory = options.maxHistory || 50;
    this.autoAcceptDialogs = options.autoAcceptDialogs !== false;
  }

  /**
   * Attach automatic dialog interception and interruption recovery to a page.
   * Safe to call multiple times (idempotent via WeakSet).
   * 
   * @param {import('puppeteer-core').Page} page
   */
  attachToPage(page) {
    if (!page || typeof page.on !== 'function') return;
    if (this.attachedPages.has(page)) return;

    this.attachedPages.add(page);

    page.on('dialog', async (dialog) => {
      const type = dialog.type();
      const message = dialog.message();
      let pageUrl = '';
      try {
        pageUrl = typeof page.url === 'function' ? page.url() : '';
      } catch {}

      const record = {
        type: 'native_dialog',
        dialogType: type,
        message,
        url: pageUrl,
        timestamp: Date.now()
      };

      this._recordInterruption(record);
      logger.warn(`[InterruptionHandler] Intercepted native browser dialog on "${pageUrl}": [${type}] "${message}". Auto-handling to prevent thread freeze.`);

      try {
        if (type === 'prompt') {
          await dialog.accept(dialog.defaultValue() || '').catch(() => {});
        } else if (this.autoAcceptDialogs) {
          await dialog.accept().catch(() => {});
        } else {
          await dialog.dismiss().catch(() => {});
        }
      } catch (err) {
        // If accept failed, attempt dismiss as fallback
        await dialog.dismiss().catch(() => {});
      }
    });

    // Proactively clear any dialog that may have been triggered before handler attached
    this.clearLingeringDialogs(page).catch(() => {});
  }

  /**
   * Use CDP protocol to dismiss/accept any lingering native JavaScript dialog on the page.
   * Crucial when a click or alert fired synchronously before Puppeteer event loop processed it.
   * 
   * @param {import('puppeteer-core').Page} page
   */
  async clearLingeringDialogs(page) {
    if (!page || typeof page.isClosed === 'function' && page.isClosed()) return false;
    try {
      const target = typeof page.target === 'function' ? page.target() : null;
      if (!target || typeof target.createCDPSession !== 'function') return false;

      const client = await target.createCDPSession().catch(() => null);
      if (!client) return false;

      let cleared = false;
      try {
        await client.send('Page.handleJavaScriptDialog', { accept: true }).then(() => {
          cleared = true;
          logger.info('[InterruptionHandler] Cleared lingering JavaScript dialog via CDP.');
        }).catch(() => {});
      } finally {
        await client.detach().catch(() => {});
      }
      return cleared;
    } catch {
      return false;
    }
  }

  /**
   * Extract CSS selector candidates from an action target to protect intentional workflow modals.
   * 
   * @private
   * @param {object} [action]
   * @returns {string[]}
   */
  _extractActionTargetSelectors(action) {
    if (!action) return [];
    const selectors = [];
    if (action.target) {
      if (typeof action.target === 'string') {
        selectors.push(action.target);
      } else {
        if (action.target.candidates && Array.isArray(action.target.candidates)) {
          for (const c of action.target.candidates) {
            if (c && c.value && typeof c.value === 'string' && !c.value.startsWith('//') && !c.value.startsWith('(')) {
              selectors.push(c.value);
            }
          }
        }
        if (action.target.selector && typeof action.target.selector === 'string') {
          selectors.push(action.target.selector);
        }
        if (action.target.selectors?.cssPath && typeof action.target.selectors.cssPath === 'string') {
          selectors.push(action.target.selectors.cssPath);
        }
        if (action.target.id && typeof action.target.id === 'string') {
          selectors.push(`#${action.target.id}`);
        }
      }
    }
    if (action.selector && typeof action.selector === 'string') {
      selectors.push(action.selector);
    }
    return selectors;
  }

  /**
   * Detect and dismiss unexpected blocking DOM modals, alert banners, popups, and overlays across any site.
   * Proactively checks for close cross buttons ('×', '✕', '✖', '.x', '[aria-label="close"]', SVG icons),
   * dismissive actions ('Skip', 'No thanks', 'Decline', 'Stay signed in', 'Dismiss', 'Close'),
   * and unexpected overlays.
   * Intended workflow modals containing the action's target are protected and never dismissed.
   * 
   * @param {import('puppeteer-core').Page} page
   * @param {object} [action] Optional current workflow action to ensure target protection
   * @returns {Promise<boolean>} True if an unexpected popup or overlay was detected and dismissed
   */
  async dismissBlockingOverlays(page, action = null) {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return false;

    const targetSelectors = this._extractActionTargetSelectors(action);
    let totalDismissed = 0;

    try {
      // Loop up to 3 passes to handle cascading popups (e.g. cookie banner + survey modal + promo toast)
      for (let pass = 0; pass < 3; pass++) {
        const dismissResult = await page.evaluate((targetSels) => {
          const isVisible = (el) => {
            if (!el || el.nodeType !== 1) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          // 1. Semantic and Framework Modal Selectors
          const semanticSelectors = [
            // Standard ARIA dialogs & HTML5 dialog
            '[role="alertdialog"]',
            '[role="dialog"]',
            'dialog[open]',
            '[aria-modal="true"]',
            
            // Common component libraries & frameworks
            '.swal2-container.swal2-shown',
            '.swal2-popup',
            '.cdk-overlay-pane:has([role="dialog"])',
            '.cdk-overlay-pane',
            '.mat-mdc-dialog-container',
            '.dx-dialog',
            '.dx-overlay-content',
            '.x-window:not(.x-hidden):not(.x-window-minimized)',
            '.ant-modal',
            '.ant-modal-wrap',
            '.MuiDialog-root',
            '.ReactModal__Content',
            '.chakra-modal__content',
            
            // Generic modal & overlay classes/attributes
            '.modal.show',
            '.modal.in',
            '.modal',
            '.overlay',
            '.overlay-backdrop',
            '[class*="overlay" i]',
            '[id*="overlay" i]',
            '[class*="modal" i]',
            '[id*="modal" i]',
            '[class*="popup" i]',
            '[id*="popup" i]',
            '[class*="dialog" i]',
            '[id*="dialog" i]',
            '[data-testid*="modal" i]',
            '[data-testid*="dialog" i]',
            '[data-testid*="popup" i]',
            '[data-testid*="survey" i]',
            '[data-testid*="prompt" i]',
            '[data-testid*="alert" i]',
            
            // Cookie / consent banners
            '#cookie',
            '[id*="cookie" i]',
            '[class*="cookie" i]',
            '[class*="consent" i]',
            '[id*="consent" i]',
            '[class*="privacy" i]',
            '[id*="privacy" i]',
            '[aria-label*="cookie" i]',
            '#onetrust-banner-sdk',
            '#sp_message_container',
            
            // Toasts & floating announcement banners
            '.toast',
            '[class*="toast" i]',
            '[class*="announcement" i]',
            '[class*="notification" i]',
            '[class*="banner" i]',
            '.alert-dismissible'
          ];

          let candidates = [];
          for (const sel of semanticSelectors) {
            try {
              const els = Array.from(document.querySelectorAll(sel));
              for (const el of els) {
                if (isVisible(el) && !candidates.includes(el)) {
                  candidates.push(el);
                }
              }
            } catch {}
          }

          // 2. Generic Geometry & Layout Scan for custom popups on ANY site
          try {
            const fixedElements = Array.from(document.querySelectorAll(
              'div, section, aside, article, form, [style*="fixed"], [style*="z-index"], .fixed'
            ));
            for (const el of fixedElements) {
              if (!isVisible(el) || candidates.includes(el)) continue;
              const style = window.getComputedStyle(el);
              if (style.position !== 'fixed' && style.position !== 'sticky') continue;
              
              const rect = el.getBoundingClientRect();
              const z = parseInt(style.zIndex, 10);
              const isHighZ = !isNaN(z) && z >= 10;
              const isLargeOverlay = (rect.width >= window.innerWidth * 0.35 && rect.height >= window.innerHeight * 0.25);
              const isBanner = (rect.width >= window.innerWidth * 0.6 && (rect.top <= 80 || rect.bottom >= window.innerHeight - 80));
              
              const hasClickable = Boolean(el.querySelector('button, a, [role="button"], .close, .x, svg'));
              if ((isHighZ || isLargeOverlay || isBanner) && hasClickable) {
                candidates.push(el);
              }
            }
          } catch {}

          if (candidates.length === 0) return null;

          const dispatchFullClick = (btn) => {
            btn.focus?.();
            if (typeof PointerEvent !== 'undefined') {
              btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
              btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            }
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            btn.click?.();
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          };

          // Target Protection: If action target is inside the modal container, do NOT dismiss it
          for (const container of candidates) {
            if (targetSels && targetSels.length > 0) {
              let containsTarget = false;
              for (const tSel of targetSels) {
                try {
                  if (tSel && container.querySelector(tSel)) {
                    containsTarget = true;
                    break;
                  }
                } catch {}
              }
              if (containsTarget) {
                // Target is inside container, skip to next candidate
                continue;
              }
            }

            // Collect all clickable elements inside the container
            const clickables = Array.from(container.querySelectorAll(
              'button, a, input[type="button"], input[type="submit"], [role="button"], .close, .btn-close, .modal-close, .popup-close, .overlay-close, .x, [data-testid*="close" i], [aria-label*="close" i], [title*="close" i], [data-dismiss], [data-bs-dismiss], span, div, i, svg'
            )).filter(isVisible);

            // Priority 1: Cross / Close button ("just cross it")
            const isCrossBtn = (b) => {
              if (!isVisible(b)) return false;
              const text = (b.textContent || b.value || '').trim();
              const aria = (b.getAttribute('aria-label') || '').trim();
              const title = (b.getAttribute('title') || '').trim();
              const testId = (b.getAttribute('data-testid') || '').trim();
              const cls = (typeof b.className === 'string' ? b.className : '').trim();
              const id = (b.id || '').trim();

              // Exact cross / times character or 'x' / 'X' / '+'
              if (/^([×✕✖✗✘⨯xX+]|\u00d7|\u2715|\u2716|\u2717|\u2718|\u2a2f|&times;)$/i.test(text)) return true;
              if (/^(close|dismiss|exit|cancel)$/i.test(text)) return true;
              if (/^[×✕✖✗✘xX]\s*(close|dismiss)?$/i.test(text)) return true;

              // Class name hints
              if (b.classList.contains('close') ||
                  b.classList.contains('btn-close') ||
                  b.classList.contains('modal-close') ||
                  b.classList.contains('popup-close') ||
                  b.classList.contains('overlay-close') ||
                  b.classList.contains('x') ||
                  b.classList.contains('swal2-close') ||
                  b.classList.contains('icon-close')) return true;
              if (/close|dismiss|modal-close|btn-close/i.test(cls)) return true;

              // Attribute hints
              if (/close|dismiss|exit|cancel/i.test(aria) ||
                  /close|dismiss|exit|cancel/i.test(title) ||
                  /close|dismiss/i.test(testId) ||
                  /close|dismiss/i.test(id)) return true;
              if (b.hasAttribute('data-dismiss') || b.hasAttribute('data-bs-dismiss')) return true;

              // SVG close icon inside button
              const svg = b.tagName === 'SVG' ? b : b.querySelector('svg');
              if (svg) {
                const sAria = (svg.getAttribute('aria-label') || '').trim();
                const sClass = (svg.getAttribute('class') || '').trim();
                if (/close|dismiss|x|cross|times/i.test(sAria) || /close|dismiss|x|cross|times/i.test(sClass)) return true;
                
                const rect = b.getBoundingClientRect();
                const isSmall = (rect.width <= 60 && rect.height <= 60);
                if (isSmall && (!text || /^([×✕✖xX+]|\s*)$/.test(text))) {
                  const cRect = container.getBoundingClientRect();
                  const inUpperSection = (rect.top - cRect.top) <= Math.max(80, cRect.height * 0.35);
                  if (inUpperSection) return true;
                }
              }

              // Child <i> or <span> icon classes
              const icon = b.querySelector('i, span');
              if (icon) {
                const iClass = (typeof icon.className === 'string' ? icon.className : '').trim();
                if (/fa-times|fa-xmark|bi-x|bi-x-lg|feather-x|lucide-x/i.test(iClass)) return true;
              }

              return false;
            };

            const crossButton = clickables.find(isCrossBtn);
            if (crossButton) {
              try {
                dispatchFullClick(crossButton);
                return {
                  dismissed: true,
                  method: 'cross_click',
                  detail: crossButton.getAttribute('aria-label') || crossButton.textContent?.trim() || 'cross'
                };
              } catch {}
            }

            // Priority 2: Dismissive / neutral / bypass action buttons ("or deal with it")
            const DISMISS_BUTTON_REGEX = /^(skip|no thanks|no, thanks|not now|later|maybe later|remind me later|never|don't ask again|don't show again|decline all|decline|reject all|reject|disagree|continue without accepting|close|cancel|dismiss|stay signed in|extend session|keep me logged in|keep signed in|keep working|continue session|refresh session|accept all|accept cookies|accept all cookies|accept recommended|accept|allow all|allow|agree|got it|ok|okay|i understand|continue|proceed|understood|confirm|exit|hide)$/i;

            const actionButton = clickables.find(b => {
              if (!isVisible(b)) return false;
              const text = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
              if (DISMISS_BUTTON_REGEX.test(text)) return true;
              if (b.classList.contains('swal2-confirm') || b.classList.contains('swal2-cancel')) return true;
              const bId = (b.id || '').toLowerCase();
              if (bId.includes('decline') || bId.includes('reject') || bId.includes('accept') ||
                  bId.includes('dismiss') || bId.includes('stay') || bId.includes('skip')) return true;
              return false;
            });

            if (actionButton) {
              try {
                dispatchFullClick(actionButton);
                return {
                  dismissed: true,
                  method: 'button_click',
                  detail: (actionButton.textContent || actionButton.value || '').trim()
                };
              } catch {}
            }
          }

          return null;
        }, targetSelectors);

        if (dismissResult && dismissResult.dismissed) {
          totalDismissed++;
          logger.info(`[InterruptionHandler] Successfully dismissed unexpected popup via ${dismissResult.method} (${dismissResult.detail}).`);
          this._recordInterruption({
            type: 'blocking_overlay',
            method: dismissResult.method,
            detail: dismissResult.detail,
            timestamp: Date.now()
          });
          await new Promise(r => setTimeout(r, 150));
        } else {
          break;
        }
      }

      if (totalDismissed > 0) {
        return true;
      }

      // Priority 3: If an unexpected backdrop / modal overlay is still present, attempt Escape key
      const hasBackdrop = await page.evaluate(() => {
        const backdrops = Array.from(document.querySelectorAll(
          '.cdk-overlay-backdrop, .modal-backdrop, .swal2-backdrop, .overlay'
        ));
        return backdrops.some(b => {
          const style = window.getComputedStyle(b);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
      }).catch(() => false);

      if (hasBackdrop && page.keyboard) {
        await page.keyboard.press('Escape').catch(() => {});
        logger.info('[InterruptionHandler] Dispatched Escape key to dismiss blocking overlay backdrop.');
        await new Promise(r => setTimeout(r, 200));

        // Priority 4: If an empty/stuck blocking backdrop persists with no interactive children, disable pointer events
        await page.evaluate(() => {
          const backdrops = Array.from(document.querySelectorAll(
            '.cdk-overlay-backdrop, .modal-backdrop, .swal2-backdrop, .overlay:not(:has(button)):not(:has(input))'
          ));
          let count = 0;
          for (const b of backdrops) {
            const style = window.getComputedStyle(b);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              b.style.pointerEvents = 'none';
              b.style.display = 'none';
              count++;
            }
          }
          return count > 0;
        }).catch(() => false);

        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Action Execution Wrapper with Interruption Recovery.
   * 
   * When NO interruption occurs:
   *   Runs executionFn() directly with zero alteration.
   * 
   * ONLY when an unexpected interruption occurs (e.g. dialog blocked click,
   * modal backdrop obscured target, or lingering alert paused runtime):
   *   Clears the interruption and retries the action once.
   * 
   * @param {import('puppeteer-core').Page} page
   * @param {object} action
   * @param {() => Promise<any>} executionFn
   * @returns {Promise<any>}
   */
  async executeWithRecovery(page, action, executionFn) {
    // Proactive checks: clear any dialog or unexpected overlay sitting unhandled before running action
    if (page && (typeof page.isClosed !== 'function' || !page.isClosed())) {
      await this.clearLingeringDialogs(page).catch(() => {});
      await this.dismissBlockingOverlays(page, action).catch(() => {});
    }

    try {
      return await executionFn();
    } catch (err) {
      const errMsg = err ? (err.message || String(err)) : '';
      const isInterruptionError = (
        errMsg.includes('Click timeout') ||
        errMsg.includes('Target closed') ||
        errMsg.includes('Protocol error') ||
        errMsg.includes('Node is detached') ||
        errMsg.includes('not clickable') ||
        errMsg.includes('obscure') ||
        errMsg.includes('intercepts pointer events') ||
        errMsg.includes('Execution context was destroyed') ||
        errMsg.includes('waiting for dialog') ||
        errMsg.includes('Dialog is already open') ||
        errMsg.includes('not visible in DOM') ||
        errMsg.includes('not interactable') ||
        errMsg.includes('Element not found') ||
        errMsg.includes('Failed to click')
      );

      if (!isInterruptionError || !page || (typeof page.isClosed === 'function' && page.isClosed())) {
        throw err;
      }

      logger.warn(`[InterruptionHandler] Interruption detected during action #${action?.index || 0} (${action?.type}): ${errMsg}. Attempting recovery...`);

      // Attempt recovery:
      // 1. Clear any native dialog that may have appeared during the click
      const clearedDialog = await this.clearLingeringDialogs(page);

      // 2. Clear any blocking DOM modal or overlay
      const clearedOverlay = await this.dismissBlockingOverlays(page, action);

      if (clearedDialog || clearedOverlay) {
        logger.info(`[InterruptionHandler] Interruption cleared (dialog=${clearedDialog}, overlay=${clearedOverlay}). Retrying action #${action?.index || 0}...`);
        await new Promise(r => setTimeout(r, 300));
        return await executionFn();
      }

      // If no specific dialog/overlay was found, propagate original error cleanly
      throw err;
    }
  }

  _recordInterruption(record) {
    this.interruptionHistory.unshift(record);
    if (this.interruptionHistory.length > this.maxHistory) {
      this.interruptionHistory.length = this.maxHistory;
    }
  }

  getInterruptionLog() {
    return [...this.interruptionHistory];
  }
}

module.exports = InterruptionHandler;
