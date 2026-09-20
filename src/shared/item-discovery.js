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

      // Safe fallback for simple recorded CSS candidates.
      if (!recorded) {
        const candidates = target.candidates || target.selectors?.candidates || [];
        for (const candidate of candidates) {
          if (!candidate || !candidate.value) continue;
          try {
            const el = document.querySelector(candidate.value);
            if (visible(el)) {
              recorded = el;
              break;
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
        const children = Array.from(ancestor.children).filter(visible);
        if (children.length < minItems) continue;

        // Identify which direct child of this ancestor contains the recorded element
        const itemForRecorded = children.find(child => child === recorded || child.contains(recorded));
        if (!itemForRecorded) continue;

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

        const index = matching.indexOf(itemForRecorded);
        if (index < 0) continue;

        const itemTagLower = itemForRecorded.tagName.toLowerCase();
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
          Math.min(0.3, (matching.length / Math.max(children.length, 1)) * 0.3) +
          (matching.length >= 3 ? 0.2 : 0.1) +
          bonus
        );

        candidates.push({
          score,
          itemCount: matching.length,
          recordedIndex: index,
          ancestorTag: ancestorTagLower,
          ancestorSelector: buildAncestorSelector(ancestor),
          itemTag: itemTagLower,
          itemSignature: itemSignature,
          items: matching.map((item, itemIndex) => ({
            index: itemIndex,
            text: normalize(item.innerText).slice(0, 200),
            tagName: item.tagName.toLowerCase(),
            signature: structuralSignature(item),
            href: item.querySelector('a[href]')?.href || null,
            id: item.getAttribute('data-id') ||
              item.getAttribute('data-testid') ||
              item.getAttribute('data-qa') ||
              item.id ||
              null
          }))
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
          rect.width > 0 && rect.height > 0;
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

        if (exactItems.length > index) return exactItems[index];

        // If a portal re-renders a row/card and changes a transient attribute
        // (role, data-testid, etc.), preserve the collection ordering instead
        // of losing the item entirely. The item tag remains the hard boundary.
        const compatibleItems = Array.from(ancestor.children).filter(child =>
          visible(child) &&
          child.tagName.toLowerCase() === collection.itemTag
        );

        if (compatibleItems.length > index) return compatibleItems[index];
      }

      return null;
    }, { collection: discovery.collection, index });
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
      .filter(c => c && typeof c.score === 'number')
      .sort((a, b) => b.score - a.score)[0] || null;
  }
}

module.exports = ItemDiscovery;
