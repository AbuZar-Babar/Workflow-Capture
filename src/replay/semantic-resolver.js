/**
 * SemanticResolver
 * 
 * Adaptive semantic element grounding and fuzzy locator resolver.
 * Evaluates candidate elements across multiple semantic signals (text overlap,
 * ARIA roles, title attributes, nearby labels, tag structure) to match intent
 * even when websites update classes or element wording.
 */

class SemanticResolver {
  /**
   * Resolves a target element on the page using semantic signals and recorded hints.
   * 
   * @param {import('puppeteer-core').Page|import('puppeteer-core').ElementHandle} rootHandle 
   * @param {object} targetHint - Target descriptor from recording / intent
   * @returns {Promise<{ handle: import('puppeteer-core').ElementHandle|null, confidence: number, strategy: string }>}
   */
  static async resolveElement(rootHandle, targetHint = {}) {
    if (!rootHandle) return { handle: null, confidence: 0, strategy: 'none' };

    const expectedText = String(targetHint.text || targetHint.fingerprint?.text || '').trim();
    const expectedTitle = String(targetHint.fingerprint?.attributes?.title || targetHint.fingerprint?.attributes?.['aria-label'] || '').trim();
    const expectedTag = String(targetHint.fingerprint?.tagName || '').toLowerCase();
    const recordedCss = targetHint.candidates?.find(c => c.type === 'css')?.value || targetHint.fingerprint?.selectors?.cssPath || null;

    // 1. Try CSS Path direct match first
    if (recordedCss) {
      try {
        const directEl = await rootHandle.$(recordedCss);
        if (directEl) {
          return { handle: directEl, confidence: 1.0, strategy: 'direct_css' };
        }
      } catch {}
    }

    // 2. Semantic Multi-Signal Search in DOM
    try {
      const bestMatchHandle = await rootHandle.evaluateHandle(({ expectedText, expectedTitle, expectedTag }) => {
        const isVisible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const clean = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const targetClean = clean(expectedText);
        const titleClean = clean(expectedTitle);

        const candidates = Array.from(document.querySelectorAll('button, a, input, select, [role="button"], [role="option"], tr, li, span, div')).filter(isVisible);

        let bestEl = null;
        let highestScore = 0;

        for (const el of candidates) {
          let score = 0;
          const text = clean(el.textContent);
          const title = clean(el.getAttribute('title') || el.getAttribute('aria-label') || '');
          const tag = el.tagName.toLowerCase();

          // Tag alignment
          if (expectedTag && tag === expectedTag) score += 0.2;

          // Text matching
          if (targetClean && text) {
            if (text === targetClean) score += 0.6;
            else if (text.includes(targetClean) || targetClean.includes(text)) score += 0.45;
            else {
              // Token overlap
              const targetTokens = targetClean.split(' ').filter(t => t.length > 2);
              const matchingTokens = targetTokens.filter(t => text.includes(t));
              if (targetTokens.length > 0) {
                score += (matchingTokens.length / targetTokens.length) * 0.35;
              }
            }
          }

          // Title / ARIA matching
          if (titleClean && title) {
            if (title === titleClean) score += 0.5;
            else if (title.includes(titleClean) || titleClean.includes(title)) score += 0.35;
          }

          if (score > highestScore) {
            highestScore = score;
            bestEl = el;
          }
        }

        return highestScore >= 0.5 ? bestEl : null;
      }, { expectedText, expectedTitle, expectedTag });

      const element = bestMatchHandle.asElement();
      if (element) {
        return { handle: element, confidence: 0.85, strategy: 'semantic_scoring' };
      }
    } catch {}

    return { handle: null, confidence: 0, strategy: 'unresolved' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SemanticResolver };
}
