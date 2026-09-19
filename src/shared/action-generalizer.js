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

    const target = action.target || action;
    const generalizedTarget = this.generalizeTarget(target, collection);

    return {
      ...action,
      target: generalizedTarget,
      scope: 'item'
    };
  }

  static generalizeTarget(target, collection) {
    if (!target || typeof target !== 'object') {
      throw new Error('Recorded target is required.');
    }

    const candidates = Array.isArray(target.candidates) ? target.candidates : [];
    const generalizedCandidates = [];

    for (const candidate of candidates) {
      if (!candidate || candidate.strategy !== 'css-path' || !candidate.value) continue;

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

    const segments = cssPath
      .split('>')
      .map(segment => segment.trim())
      .filter(Boolean);

    const itemIndex = segments.findIndex(segment => {
      const match = segment.match(/^([a-z][a-z0-9-]*)/i);
      return match && match[1].toLowerCase() === tag;
    });

    if (itemIndex < 0) return null;

    const remainder = segments.slice(itemIndex + 1);
    return remainder.length ? remainder.join(' > ') : ':scope';
  }

  static isGeneralized(action) {
    return Boolean(action && action.scope === 'item' && action.target?.scope === 'item');
  }
}

module.exports = ActionGeneralizer;
