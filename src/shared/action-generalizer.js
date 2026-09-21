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
    return actions.map(action => this.generalizeAction(action, collection));
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

    const tag = String(itemTag || '').toLowerCase();
    if (!tag) return null;

    const cleanPath = cssPath.trim();

    // Check if path splits by '>'
    const segments = cleanPath
      .split(/\s*>\s*/)
      .map(segment => segment.trim())
      .filter(Boolean);

    const itemIndex = segments.findIndex(segment => {
      const match = segment.match(/^([a-z][a-z0-9-]*)/i);
      return match && match[1].toLowerCase() === tag;
    });

    if (itemIndex >= 0) {
      const remainder = segments.slice(itemIndex + 1);
      return remainder.length ? remainder.join(' > ') : ':scope';
    }

    // Check if path uses descendant spaces: "table.data-table tr td a"
    const spaceTokens = cleanPath.split(/\s+/);
    const tokenIdx = spaceTokens.findIndex(token => {
      const match = token.match(/^([a-z][a-z0-9-]*)/i);
      return match && match[1].toLowerCase() === tag;
    });

    if (tokenIdx >= 0) {
      const remainder = spaceTokens.slice(tokenIdx + 1);
      return remainder.length ? remainder.join(' ') : ':scope';
    }

    return null;
  }

  static isGeneralized(action) {
    return Boolean(action && action.scope === 'item' && action.target?.scope === 'item');
  }
}

module.exports = ActionGeneralizer;
