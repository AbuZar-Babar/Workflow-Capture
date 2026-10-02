/**
 * Workflow Capture — Semantic Field Detector
 * 
 * Inspects item structures (table rows, cards, lists, grids) and extracts
 * semantic fields (identifier, date, status, amount, name, type, description)
 * WITHOUT hardcoded portal-specific names or structures.
 * 
 * Supports:
 * - Table header alignment
 * - Labeled pairs (<label>, <dt>/<dd>, <strong>Label:</strong> Value)
 * - Data attributes (data-field, data-col, data-qa, data-testid)
 * - ARIA attributes (aria-label, role)
 * - Type recognition heuristics (Dates, Currencies, Statuses, IDs)
 * - Semantic concept resolution mapping user intent to live portal fields
 */

'use strict';

class FieldDetector {
  /**
   * Concept keyword mappings for semantic classification.
   */
  static CONCEPT_PATTERNS = Object.freeze({
    identifier: /\b(id|number|num|no|code|ref|reference|key|sku|tracking|txn|transaction|document|doc|account)\b/i,
    date: /\b(date|created|issued|timestamp|time|due|modified|updated|posted|closed|period|start|end)\b/i,
    status: /\b(status|state|condition|phase|stage|progress|flag|situation)\b/i,
    amount: /\b(amount|total|price|cost|subtotal|balance|due|fee|tax|sum|value|rate|charge|payment)\b/i,
    name: /\b(name|customer|client|vendor|user|recipient|payer|payee|merchant|owner|author|assignee|party)\b/i,
    type: /\b(type|category|kind|class|genre|mode|classification|group)\b/i,
    description: /\b(description|details|notes|memo|subject|comment|summary|title|text|info)\b/i
  });

  /**
   * Status token dictionary covering common business states across portals.
   */
  static KNOWN_STATUS_VALUES = Object.freeze([
    'paid', 'unpaid', 'partially paid', 'overdue', 'pending', 'open', 'closed',
    'active', 'inactive', 'draft', 'posted', 'approved', 'rejected', 'declined',
    'void', 'cancelled', 'canceled', 'completed', 'in progress', 'processing',
    'failed', 'success', 'shipped', 'delivered', 'returned', 'refunded',
    'hold', 'on hold', 'new', 'resolved', 'acknowledged'
  ]);

  /**
   * Detects the semantic type of a field from its name and value.
   *
   * @param {string} fieldName - Label or column name
   * @param {any} fieldValue - String or value representation
   * @returns {'identifier' | 'date' | 'status' | 'amount' | 'name' | 'type' | 'description' | 'text'}
   */
  static detectFieldType(fieldName = '', fieldValue = '') {
    const name = String(fieldName || '').trim().toLowerCase();
    const val = String(fieldValue || '').trim();

    // 1. Check field name against semantic concepts
    if (this.CONCEPT_PATTERNS.identifier.test(name)) return 'identifier';
    if (this.CONCEPT_PATTERNS.date.test(name)) return 'date';
    if (this.CONCEPT_PATTERNS.status.test(name)) return 'status';
    if (this.CONCEPT_PATTERNS.amount.test(name)) return 'amount';
    if (this.CONCEPT_PATTERNS.name.test(name)) return 'name';
    if (this.CONCEPT_PATTERNS.type.test(name)) return 'type';
    if (this.CONCEPT_PATTERNS.description.test(name)) return 'description';

    // 2. Fallback to inspecting the field value if name is generic (e.g. "Col 1" or empty)
    if (val) {
      if (this.isCurrencyOrAmount(val)) return 'amount';
      if (this.isDateString(val)) return 'date';
      if (this.isStatusValue(val)) return 'status';
      if (this.isIdentifierString(val)) return 'identifier';
    }

    return 'text';
  }

  /**
   * Checks if a string represents a date.
   */
  static isDateString(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    if (trimmed.length < 4 || trimmed.length > 40) return false;

    // ISO format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
    // Common US/EU date format: MM/DD/YYYY or DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(trimmed)) return true;
    // Dash date: DD-MM-YYYY
    if (/^\d{1,2}-\d{1,2}-\d{2,4}\b/.test(trimmed)) return true;
    // Named month: Sep 27, 2026 or 27 September 2026
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(trimmed)) return true;
    if (/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i.test(trimmed)) return true;

    return false;
  }

  /**
   * Checks if a string represents a currency or numeric amount.
   */
  static isCurrencyOrAmount(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    // Currency symbols ($ € £ ¥ ₹) or standard decimal amount
    if (/^[$€£¥₹]\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(trimmed)) return true;
    if (/^-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*[$€£¥₹]$/.test(trimmed)) return true;
    // Pure decimal number with 2 decimal places e.g. 1,450.00
    if (/^-?\d{1,3}(?:,\d{3})+\.\d{2}$/.test(trimmed)) return true;
    return false;
  }

  /**
   * Checks if a string matches common status values.
   */
  static isStatusValue(str) {
    if (!str || typeof str !== 'string') return false;
    const norm = str.trim().toLowerCase();
    return this.KNOWN_STATUS_VALUES.includes(norm);
  }

  /**
   * Checks if a string matches an identifier format (e.g. INV-2026-001, PO#9821, #12345).
   */
  static isIdentifierString(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    if (/^[A-Z0-9]{2,8}[-_#][A-Z0-9-_#]{2,20}$/i.test(trimmed)) return true;
    if (/^#\d{3,10}$/.test(trimmed)) return true;
    if (/^\d{5,12}$/.test(trimmed)) return true;
    return false;
  }

  /**
   * Analyzes an item's raw key-value fields and tags each with semantic metadata.
   *
   * @param {object} rawFields - Map of field names to values
   * @returns {object} Schema map with classified fields
   */
  static classifyFields(rawFields = {}) {
    const classified = {};
    const conceptMap = {
      identifier: [],
      date: [],
      status: [],
      amount: [],
      name: [],
      type: [],
      description: []
    };

    for (const [key, value] of Object.entries(rawFields)) {
      if (key.startsWith('_')) continue;
      const valStr = String(value || '').trim();
      const type = this.detectFieldType(key, valStr);

      classified[key] = {
        fieldName: key,
        value: valStr,
        type,
        isStatus: type === 'status',
        isDate: type === 'date',
        isAmount: type === 'amount',
        isIdentifier: type === 'identifier'
      };

      if (conceptMap[type]) {
        conceptMap[type].push(key);
      }
    }

    return {
      fields: classified,
      concepts: conceptMap
    };
  }

  /**
   * Resolves a high-level user concept (e.g. "status", "date", "amount", "id", "identifier")
   * to the exact field name present on this item / portal.
   *
   * @param {object} itemFields - Map of item fields
   * @param {string} concept - The concept to find (e.g. "status", "payment state", "date", "created on")
   * @returns {string|null} The matching field name in itemFields, or null if none found
   */
  static resolveFieldForConcept(itemFields = {}, concept = '') {
    if (!concept || typeof concept !== 'string') return null;
    const cleanConcept = concept.trim().toLowerCase();

    // 1. Direct exact or case-insensitive match
    for (const key of Object.keys(itemFields)) {
      if (key.trim().toLowerCase() === cleanConcept) return key;
    }

    // 2. Direct substring match
    for (const key of Object.keys(itemFields)) {
      const lowerKey = key.trim().toLowerCase();
      if (lowerKey.includes(cleanConcept) || cleanConcept.includes(lowerKey)) {
        return key;
      }
    }

    // 3. Semantic category mapping
    let targetType = null;
    if (this.CONCEPT_PATTERNS.status.test(cleanConcept) || ['paid', 'unpaid', 'pending', 'open'].includes(cleanConcept)) {
      targetType = 'status';
    } else if (this.CONCEPT_PATTERNS.date.test(cleanConcept) || ['recent', 'new', 'old', 'today', 'month'].includes(cleanConcept)) {
      targetType = 'date';
    } else if (this.CONCEPT_PATTERNS.amount.test(cleanConcept) || ['price', 'total', 'cost'].includes(cleanConcept)) {
      targetType = 'amount';
    } else if (this.CONCEPT_PATTERNS.identifier.test(cleanConcept) || ['id', 'number', 'ref'].includes(cleanConcept)) {
      targetType = 'identifier';
    }

    if (targetType) {
      const classified = this.classifyFields(itemFields);
      const candidates = classified.concepts[targetType] || [];
      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    return null;
  }
}

module.exports = FieldDetector;
