/**
 * Workflow Capture — Citymart Domain Profile
 * 
 * Encapsulates portal-specific conventions for Citymart (iRely i21):
 * - Voucher document prefixes (SI, INV, DR, TX, CM)
 * - ExtJS grid classes and checkbox selectors
 * - Default report naming conventions
 * 
 * Core engine modules must NEVER contain these hardcoded patterns directly.
 * Instead, they query the active profile registry (if any profile is enabled).
 */

'use strict';

const CitymartProfile = {
  id: 'citymart',
  name: 'Citymart / iRely i21 Web Portal',
  matchDomains: ['citymart.i21web.com', 'i21web.com'],

  // Document identification pattern
  documentIdRegex: /\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i,

  // Document type classification
  classifyDocumentType(text) {
    if (!text) return null;
    if (/\bcredit\s*memo\b/i.test(text)) return 'Credit Memo';
    if (/\binvoice\b/i.test(text)) return 'Invoice';
    if (/\border\b/i.test(text)) return 'Order';
    return null;
  },

  // Known grid classes
  gridClasses: [
    'x-grid',
    'x-grid-row',
    'x-grid-cell',
    'x-grid-cell-special',
    'x-grid-cell-row-checker',
    'x-selmodel-column',
    'x-column-header-text'
  ],

  // Generic export file naming
  genericFileNames: ['invoicemainreport.pdf', 'mainreport.pdf']
};

module.exports = CitymartProfile;
