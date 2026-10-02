/**
 * Workflow Capture — Recorded Action Generalizer
 *
 * Converts a recorder target that points at one concrete collection item into
 * an item-relative target that can be replayed for every discovered item.
 */

class ActionGeneralizer {
  static generalizeAction(action, collection) {
    if (!action || typeof action !== 'object') {
      throw new Error('ActionGeneralizer requires a recorded action.');
    }
    if (!collection || !collection.itemTag) {
      throw new Error('ActionGeneralizer requires discovered collection metadata.');
    }

    if (!this.isItemRelative(action, collection)) {
      return {
        ...action,
        scope: 'page'
      };
    }

    const target = action.target || action;
    const generalizedTarget = this.generalizeTarget(target, collection);

    return {
      ...action,
      target: generalizedTarget,
      scope: 'item'
    };
  }

  static generalizeActions(actions, collection) {
    if (!Array.isArray(actions)) {
      throw new Error('ActionGeneralizer requires an action array.');
    }
    const targetUrl = actions[0]?.url;
    return actions.map((action, idx) => {
      // The 1st action in the loop partition is always the item-scoped trigger
      if (idx === 0) {
        const target = action.target || action;
        return {
          ...action,
          target: this.generalizeTarget(target, collection),
          scope: 'item'
        };
      }
      // If subsequent action is recorded on a distinct URL (e.g. details page), it is page-scoped
      if (action.url && targetUrl && action.url !== targetUrl) {
        return {
          ...action,
          scope: 'page'
        };
      }
      return this.generalizeAction(action, collection);
    });
  }

  static isItemRelative(action, collection) {
    if (!action || !collection || !collection.itemTag) return false;
    const target = action.target || action;
    const tag = String(collection.itemTag).toLowerCase();

    // Check if fingerprint directly matches the item or known child elements
    const fpTag = String(target.fingerprint?.tagName || '').toLowerCase();
    if (fpTag === tag) return true;
    if (tag === 'mat-option' && (fpTag === 'mat-pseudo-checkbox' || target.fingerprint?.role === 'option')) return true;
    if (tag === 'tr' && (fpTag === 'td' || fpTag === 'th')) return true;

    const candidates = Array.isArray(target?.candidates) ? [...target.candidates] : [];

    const cssPath = target.selectors?.cssPath || target.cssPath || action.selectors?.cssPath || (typeof target === 'string' ? target : null);
    if (cssPath && !candidates.some(c => c && c.value === cssPath)) {
      candidates.push({ strategy: 'css-path', value: cssPath });
    }

    return candidates.some(candidate => {
      if (!candidate || !candidate.value) return false;
      return Boolean(this.toRelativeCss(candidate.value, tag));
    });
  }

  static generalizeTarget(target, collection) {
    if (!target || typeof target !== 'object') {
      throw new Error('Recorded target is required.');
    }

    const candidates = Array.isArray(target.candidates) ? [...target.candidates] : [];
    const cssPath = target.selectors?.cssPath || target.cssPath;
    if (cssPath && !candidates.some(c => c && c.value === cssPath)) {
      candidates.push({ strategy: 'css-path', value: cssPath, priority: 5 });
    }

    const generalizedCandidates = [];

    for (const candidate of candidates) {
      if (!candidate || !candidate.value) continue;

      const relative = this.toRelativeCss(candidate.value, collection.itemTag);
      if (!relative) continue;

      generalizedCandidates.push({
        ...candidate,
        value: relative,
        uniqueness: undefined,
        priority: Math.max(Number(candidate.priority) || 0, 6),
        scope: 'item'
      });
    }

    return {
      ...target,
      candidates: generalizedCandidates,
      scope: 'item',
      collection: {
        itemTag: collection.itemTag,
        itemSignature: collection.itemSignature || null
      }
    };
  }

  /**
   * Strip the collection-item prefix from a recorder CSS path.
   * Example: table#invoices tbody > tr:nth-child(1) > td:nth-child(5) > a.btn-download
   * becomes: td:nth-child(5) > a.btn-download
   */
  static toRelativeCss(cssPath, itemTag) {
    if (typeof cssPath !== 'string' || !cssPath.trim()) return null;

    const rawTag = String(itemTag || '').toLowerCase().trim();
    if (!rawTag) return null;

    const cleanTag = rawTag.replace(/:(?:nth-child|nth-of-type)\([^)]*\)/gi, '').trim();
    const tagBase = cleanTag.match(/^([a-z][a-z0-9-]*)/i)?.[1] || '';
    const extractClasses = (s) => (s.match(/\.[a-z0-9_-]+/gi) || []).map(c => c.slice(1).toLowerCase());
    const tagClassList = extractClasses(cleanTag);

    const isSegmentMatch = (seg) => {
      if (!seg) return false;
      const cleanSeg = seg.replace(/:(?:nth-child|nth-of-type)\([^)]*\)/gi, '').trim().toLowerCase();
      if (cleanSeg === cleanTag) return true;
      const segClasses = extractClasses(cleanSeg);
      const segTag = cleanSeg.match(/^([a-z][a-z0-9-]*)/i)?.[1] || '';

      if (tagBase && segTag === tagBase) {
        if (tagClassList.length > 0) {
          return tagClassList.every(cls => segClasses.includes(cls));
        }
        return cleanSeg === tagBase || cleanSeg.startsWith(`${tagBase}:`) || cleanSeg.startsWith(`${tagBase}[`);
      }
      if (tagClassList.length > 0 && tagClassList.every(cls => segClasses.includes(cls))) {
        return true;
      }
      return false;
    };

    const cleanPath = cssPath.trim();

    // Check if path splits by '>'
    const segments = cleanPath
      .split(/\s*>\s*/)
      .map(segment => segment.trim())
      .filter(Boolean);

    let itemIndex = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (isSegmentMatch(segments[i])) {
        itemIndex = i;
        break;
      }
    }

    if (itemIndex >= 0) {
      const remainder = segments.slice(itemIndex + 1);
      return remainder.length ? remainder.join(' > ') : ':scope';
    }

    // Check if path uses descendant spaces: "table.data-table tr td a"
    const spaceTokens = cleanPath.split(/\s+/);
    let tokenIdx = -1;
    for (let i = spaceTokens.length - 1; i >= 0; i--) {
      if (isSegmentMatch(spaceTokens[i])) {
        tokenIdx = i;
        break;
      }
    }

    if (tokenIdx >= 0) {
      const remainder = spaceTokens.slice(tokenIdx + 1);
      return remainder.length ? remainder.join(' ') : ':scope';
    }

    return null;
  }

  static isGeneralized(action) {
    return Boolean(action && action.scope === 'item' && action.target?.scope === 'item');
  }

  /**
   * Classify action safety and destructive potential (Part 28: Security / Safety).
   *
   * @param {object} action
   * @returns {{ category: string, isDestructive: boolean, requiresConfirmation: boolean }}
   */
  static classifySafety(action) {
    if (!action) return { category: 'read', isDestructive: false, requiresConfirmation: false };
    const type = (action.type || action.action || '').toUpperCase();
    const text = (action.target?.fingerprint?.text || action.text || action.target?.fingerprint?.title || '').toLowerCase();

    if (/\b(delete|remove|erase|destroy|drop|terminate)\b/i.test(text)) {
      return { category: 'delete', isDestructive: true, requiresConfirmation: true };
    }
    if (/\b(pay|purchase|buy|checkout|charge|transfer)\b/i.test(text)) {
      return { category: 'purchase', isDestructive: true, requiresConfirmation: true };
    }
    if (/\b(submit|send|publish|post)\b/i.test(text)) {
      return { category: 'submit', isDestructive: false, requiresConfirmation: false };
    }
    if (/\b(download|export|save|print)\b/i.test(text) || action.isDownload) {
      return { category: 'download', isDestructive: false, requiresConfirmation: false };
    }
    if (type === 'TYPE' || type === 'SELECT') {
      return { category: 'edit', isDestructive: false, requiresConfirmation: false };
    }
    if (type === 'NAVIGATE') {
      return { category: 'navigate', isDestructive: false, requiresConfirmation: false };
    }
    return { category: 'read', isDestructive: false, requiresConfirmation: false };
  }
}

module.exports = ActionGeneralizer;
