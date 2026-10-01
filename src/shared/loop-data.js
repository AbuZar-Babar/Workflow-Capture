/**
 * Workflow Capture — Persisted Loop Data
 *
 * Keeps recorded loop metadata and the latest item snapshot separate from
 * browser-specific ElementHandles. The snapshot is safe to persist in a
 * workflow JSON file and can later be refreshed from the portal.
 */

function normalizeLoopData(discovery, options = {}) {
  if (!discovery || discovery.success !== true || !discovery.collection) {
    return null;
  }

  const items = Array.isArray(discovery.items)
    ? discovery.items.map((item, index) => ({
        index: Number.isInteger(item?.index) ? item.index : index,
        text: item?.text || '',
        tagName: item?.tagName || '',
        signature: item?.signature || '',
        fields: item?.fields && typeof item.fields === 'object' ? { ...item.fields } : {},
        href: item?.href || null,
        id: item?.id || null
      }))
    : [];

  return {
    version: 1,
    capturedAt: options.capturedAt || new Date().toISOString(),
    source: options.source || 'recording',
    loopStepIndex: Number.isInteger(options.loopStepIndex) ? options.loopStepIndex : null,
    patternType: options.patternType || null,
    confidence: typeof discovery.confidence === 'number' ? discovery.confidence : 0,
    itemCount: items.length,
    availableFields: Array.isArray(discovery.availableFields)
      ? [...new Set(discovery.availableFields.filter(Boolean))]
      : [],
    collection: {
      ancestorTag: discovery.collection.ancestorTag || null,
      ancestorSelector: discovery.collection.ancestorSelector || null,
      itemTag: discovery.collection.itemTag || null,
      itemSignature: discovery.collection.itemSignature || null
    },
    items
  };
}

function validateLoopData(loopData) {
  if (!loopData || typeof loopData !== 'object') {
    return { valid: false, error: 'loopData must be an object.' };
  }

  if (loopData.version !== 1) {
    return { valid: false, error: 'Unsupported loopData version.' };
  }

  if (!loopData.collection || typeof loopData.collection !== 'object') {
    return { valid: false, error: 'loopData.collection is required.' };
  }

  if (!Array.isArray(loopData.items)) {
    return { valid: false, error: 'loopData.items must be an array.' };
  }

  if (!Array.isArray(loopData.availableFields)) {
    return { valid: false, error: 'loopData.availableFields must be an array.' };
  }

  return { valid: true };
}

module.exports = {
  normalizeLoopData,
  validateLoopData
};
