/**
 * Workflow Capture — Workflow Execution & Loop Review Modal
 * 
 * Unifies execution preflight, item discovery, record filtering, and launch review.
 * Conforms to the Shared Filter Contract from docs/LOOP-FILTER-REQUIREMENTS.md:
 *  - Multiple filter conditions (field, operator: contains | equals | dateBetween, value / from-to dates)
 *  - Match mode: 'all' | 'any' (default: 'all')
 *  - Loop item limit: positive integer or empty (unlimited)
 *  - Preflight counts: totalCount, matchingCount, selectedCount, skippedFilterCount, skippedLimitCount
 *  - Representative samples for selected, filter-skipped, and limit-skipped items
 *  - Blocks execution on preview errors, invalid limit, or zero-selected runs
 *  - Passes exact itemFilter and loopLimit payload to API client
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';
import { Router } from '../router.js';
import { Auth } from '../auth.js';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/**
 * Validates strict YYYY-MM-DD date-only strings with real calendar boundaries.
 */
function isValidIsoDate(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parses an item's date value deterministically without locale dependence,
 * matching the shared evaluator contract from Task 12 (src/shared/item-filter.js).
 * Accepts:
 *  - Strict YYYY-MM-DD
 *  - YYYY-MM-DD... ISO timestamps
 *  - YYYY/MM/DD
 *  - YYYY/MM/DD... timestamps
 *  - Valid JavaScript Date objects
 * Rejects:
 *  - MM/DD/YYYY, M/D/YYYY
 *  - Textual dates
 *  - Locale-dependent Date.parse() fallback
 *
 * @param {any} val
 * @returns {string|null} - YYYY-MM-DD date string, or null if missing or unparseable.
 */
function parseItemDate(val) {
  if (val === null || val === undefined) {
    return null;
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) {
      return null;
    }
    return val.toISOString().slice(0, 10);
  }

  const str = String(val).trim();
  if (!str) {
    return null;
  }

  // Accept strict YYYY-MM-DD or standard ISO timestamp beginning with YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(str);
  if (isoMatch) {
    const yStr = isoMatch[1];
    const mStr = isoMatch[2];
    const dStr = isoMatch[3];
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);

    if (m >= 1 && m <= 12) {
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (d >= 1 && d <= daysInMonth[m - 1]) {
        return `${yStr}-${mStr}-${dStr}`;
      }
    }
    return null;
  }

  // Accept YYYY/MM/DD or timestamp beginning with YYYY/MM/DD
  const slashMatch = /^(\d{4})\/(\d{2})\/(\d{2})(?:[T\s].*)?$/.exec(str);
  if (slashMatch) {
    const yStr = slashMatch[1];
    const mStr = slashMatch[2];
    const dStr = slashMatch[3];
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);

    if (m >= 1 && m <= 12) {
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (d >= 1 && d <= daysInMonth[m - 1]) {
        return `${yStr}-${mStr}-${dStr}`;
      }
    }
    return null;
  }

  // All other formats (e.g. MM/DD/YYYY, DD/MM/YYYY, or textual dates) are ambiguous without locale
  return null;
}

export const ExecutionModal = {
  container: null,
  currentWorkflowId: null,
  workflowName: 'Workflow',
  stepCount: 0,
  loopStepIndex: 0,
  isLoopConfigured: false,
  selectedMode: 'single', // 'single' | 'loop'
  onExecuted: null,

  // Preflight and filter state (v2 contract)
  preflightStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
  preflightError: '',
  discoveryData: null,
  availableFields: [],
  filterEnabled: true,
  matchMode: 'all', // 'all' | 'any'
  conditions: [
    {
      id: 'cond_1',
      field: 'Type',
      customField: '',
      operator: 'contains',
      value: 'Invoice',
      dateFrom: '',
      dateTo: ''
    }
  ],
  loopLimit: null, // positive integer or null (unlimited)
  loopLimitInput: '', // raw input string

  filterPreview: {
    totalCount: 0,
    matchingCount: 0,
    selectedCount: 0,
    skippedFilterCount: 0,
    skippedLimitCount: 0,
    selectedPreview: [],
    skippedFilterPreview: [],
    skippedLimitPreview: [],
    errors: []
  },

  // Deterministic date parser matching Task 12 contract
  parseItemDate,

  // Backwards compatibility accessors for v1 code / callers
  get filterField() {
    return this.conditions[0]?.field || 'Type';
  },
  set filterField(val) {
    if (this.conditions[0]) this.conditions[0].field = val;
  },
  get filterOperator() {
    return this.conditions[0]?.operator || 'contains';
  },
  set filterOperator(val) {
    if (this.conditions[0]) this.conditions[0].operator = val;
  },
  get filterValue() {
    return this.conditions[0]?.value || '';
  },
  set filterValue(val) {
    if (this.conditions[0]) this.conditions[0].value = val;
  },
  get customFieldName() {
    return this.conditions[0]?.customField || '';
  },
  set customFieldName(val) {
    if (this.conditions[0]) this.conditions[0].customField = val;
  },

  init() {
    let el = document.getElementById('workflowExecutionModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'workflowExecutionModal';
      el.className = 'modal-overlay hidden';
      el.style.zIndex = '1100';
      document.body.appendChild(el);
    }
    this.container = el;

    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });

    this.handleKeyDown = (e) => {
      if (e.key === 'Escape' && this.container && !this.container.classList.contains('hidden')) {
        this.close();
      }
    };
  },

  open({ workflowId, workflowName = 'Workflow', stepCount = 0, loopStepIndex = null, isLoop = false, onExecuted = null }) {
    if (!this.container) this.init();

    this.currentWorkflowId = workflowId;
    this.workflowName = workflowName || 'Workflow';
    this.stepCount = stepCount || 0;
    this.loopStepIndex = Number.isInteger(loopStepIndex) && loopStepIndex >= 0 ? loopStepIndex : 0;
    this.isLoopConfigured = isLoop === true || (Number.isInteger(loopStepIndex) && loopStepIndex >= 0);
    this.selectedMode = this.isLoopConfigured ? 'loop' : 'single';
    this.onExecuted = onExecuted;

    // Reset preflight & filter state
    this.preflightStatus = 'idle';
    this.preflightError = '';
    this.discoveryData = null;
    this.availableFields = [];
    this.filterEnabled = true;
    this.matchMode = 'all';
    this.loopLimit = null;
    this.loopLimitInput = '';
    this.conditions = [
      {
        id: 'cond_1',
        field: 'Type',
        customField: '',
        operator: 'contains',
        value: 'Invoice',
        dateFrom: '',
        dateTo: ''
      }
    ];
    this.filterPreview = {
      totalCount: 0,
      matchingCount: 0,
      selectedCount: 0,
      skippedFilterCount: 0,
      skippedLimitCount: 0,
      selectedPreview: [],
      skippedFilterPreview: [],
      skippedLimitPreview: [],
      errors: []
    };

    document.addEventListener('keydown', this.handleKeyDown);

    this.render();

    if (this.selectedMode === 'loop') {
      this.runPreflight();
    }
  },

  close() {
    if (this.container) {
      this.container.classList.add('hidden');
    }
    document.removeEventListener('keydown', this.handleKeyDown);
  },

  isLimitInvalid() {
    const raw = String(this.loopLimitInput || '').trim();
    if (raw === '') return false;
    if (!/^\d+$/.test(raw)) return true;
    const n = parseInt(raw, 10);
    return n <= 0;
  },

  addCondition() {
    const id = 'cond_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const defaultField = this.availableFields.length > 0 ? this.availableFields[0] : 'Type';
    this.conditions.push({
      id,
      field: defaultField,
      customField: '',
      operator: 'contains',
      value: '',
      dateFrom: '',
      dateTo: ''
    });
    this.refreshConditionsUI();
  },

  removeCondition(condId) {
    if (this.conditions.length <= 1) return;
    this.conditions = this.conditions.filter(c => c.id !== condId);
    this.refreshConditionsUI();
  },

  refreshConditionsUI() {
    const container = this.container?.querySelector('#execConditionsContainer');
    if (container) {
      container.innerHTML = this.renderConditionRows();
      this.bindConditionEvents();
    }
    this.evaluateFilterPreview();
  },

  render() {
    const hasLoopConfigured = this.isLoopConfigured;
    const isLoopSelected = this.selectedMode === 'loop';

    this.container.innerHTML = `
      <div class="modal-dialog exec-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="execModalTitle">
        <div class="modal-header" style="padding: 1.25rem 1.5rem;">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <div style="width:34px; height:34px; border-radius:10px; background:var(--brand-tint); color:var(--brand-forest); display:flex; align-items:center; justify-content:center;">
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
            <div>
              <h3 id="execModalTitle" style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-main);">${escapeHtml(this.workflowName)}</h3>
              <span style="font-size:0.75rem; color:var(--text-sub);">${this.stepCount > 0 ? `${this.stepCount} steps recorded` : 'Workflow Execution'}</span>
            </div>
          </div>
          <button class="btn-icon" id="btnCloseExecModal" title="Close" aria-label="Close execution dialog" style="background:transparent; border:none; cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="modal-body" style="padding: 1.4rem 1.5rem; gap: 1.1rem; max-height: 80vh; overflow-y: auto;">
          <p style="font-size: 0.82rem; color: var(--text-sub); margin: 0;">Select how you want to execute this workflow:</p>

          <!-- Execution Mode Options -->
          <div style="display:flex; flex-direction:column; gap:0.65rem;">
            <!-- Option 1: Macro Execution (Single) -->
            <label class="exec-option-label ${!isLoopSelected ? 'active' : ''}" id="labelExecSingle">
              <input type="radio" name="execModeRadio" value="single" ${!isLoopSelected ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);" aria-label="Run as Macro (Single Execution)">
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong style="font-size:0.9rem; color:var(--text-main);">⚡ Run as Macro (Single Execution)</strong>
                  <span class="badge-tag success" style="font-size:0.65rem; padding:0.12rem 0.4rem;">Standard</span>
                </div>
                <span style="font-size:0.76rem; color:var(--text-sub);">Replays the exact recorded workflow once from start to finish. Does not iterate through other rows.</span>
              </div>
            </label>

            <!-- Option 2: Loop Execution (Batch) -->
            <label class="exec-option-label ${isLoopSelected ? 'active' : ''}" id="labelExecLoop">
              <input type="radio" name="execModeRadio" value="loop" ${isLoopSelected ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);" aria-label="Run as Loop (Batch / Filtered Items)">
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong style="font-size:0.9rem; color:var(--text-main);">🔁 Run as Loop (Batch / Filtered Items)</strong>
                  ${hasLoopConfigured ? '<span class="badge-tag success" style="font-size:0.65rem; padding:0.12rem 0.4rem;">Configured</span>' : '<span class="badge-tag primary" style="font-size:0.65rem; padding:0.12rem 0.4rem;">Auto-Discovery</span>'}
                </div>
                <span style="font-size:0.76rem; color:var(--text-sub);">Discovers repeated records on the target page and iterates across matching items using the preflight filter guard.</span>
              </div>
            </label>
          </div>

          <!-- Loop Discovery & Preflight Section -->
          <div id="execLoopSection" style="display: ${isLoopSelected ? 'flex' : 'none'}; flex-direction:column; gap:0.85rem;">

            <!-- Preflight Container (Mount point for Loading / Error / Preflight Review) -->
            <div id="execPreflightContainer" class="exec-preflight-container">
              ${this.renderPreflightContent()}
            </div>

            <!-- Deduplication Option -->
            <div style="display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0.15rem;">
              <input type="checkbox" id="chkExecForceRedownload" style="accent-color:var(--brand-forest); cursor:pointer;">
              <label for="chkExecForceRedownload" style="font-size:0.78rem; color:var(--text-body); cursor:pointer; user-select:none;">Force re-download (re-download existing artifacts without skipping duplicates)</label>
            </div>
          </div>

          <!-- Action Buttons -->
          <div style="display:flex; justify-content:flex-end; align-items:center; gap:0.65rem; margin-top:0.25rem; padding-top:1rem; border-top:1px solid var(--border-light);">
            <button type="button" class="btn btn-secondary btn-sm" id="btnCancelExecModal">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" id="btnConfirmExecModal" style="display:inline-flex; align-items:center; gap:0.4rem; padding:0.55rem 1.25rem;">
              <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span id="btnConfirmExecText">Start Execution</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.classList.remove('hidden');
    this.bindEvents();
    this.updateExecuteButton();
  },

  renderConditionRows() {
    const hasFields = this.availableFields.length > 0;

    return this.conditions.map((cond, idx) => {
      const isCustomField = cond.field === '__custom__' || (!hasFields && !!cond.field);
      const currentField = isCustomField ? (cond.customField || cond.field || 'Type') : (cond.field || 'Type');
      const isDateOp = cond.operator === 'dateBetween';

      return `
        <div class="exec-condition-row" data-cond-id="${escapeHtml(cond.id)}">
          <div class="exec-condition-main-grid">
            <!-- Field Selector -->
            <div class="exec-field-group">
              <label for="execCondField_${cond.id}">Field</label>
              ${hasFields ? `
                <select id="execCondField_${cond.id}" class="exec-control-select exec-cond-field" data-cond-id="${escapeHtml(cond.id)}" aria-label="Condition ${idx + 1} Field">
                  ${this.availableFields.map(f => `<option value="${escapeHtml(f)}" ${f.toLowerCase() === currentField.toLowerCase() ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                  <option value="__custom__" ${cond.field === '__custom__' ? 'selected' : ''}>Custom field…</option>
                </select>
              ` : `
                <input type="text" id="execCondField_${cond.id}" class="exec-control-input exec-cond-field-input" data-cond-id="${escapeHtml(cond.id)}" value="${escapeHtml(currentField)}" placeholder="e.g. Type, Status…" aria-label="Condition ${idx + 1} Field">
              `}
            </div>

            <!-- Operator Selector -->
            <div class="exec-field-group">
              <label for="execCondOp_${cond.id}">Operator</label>
              <select id="execCondOp_${cond.id}" class="exec-control-select exec-cond-operator" data-cond-id="${escapeHtml(cond.id)}" aria-label="Condition ${idx + 1} Operator">
                <option value="contains" ${cond.operator === 'contains' ? 'selected' : ''}>contains</option>
                <option value="equals" ${cond.operator === 'equals' ? 'selected' : ''}>equals</option>
                <option value="dateBetween" ${cond.operator === 'dateBetween' ? 'selected' : ''}>dateBetween</option>
              </select>
            </div>

            <!-- Value / Date Inputs -->
            <div class="exec-field-group exec-value-group">
              <label for="${isDateOp ? `execCondDateFrom_${cond.id}` : `execCondVal_${cond.id}`}">${isDateOp ? 'Date Range (YYYY-MM-DD)' : 'Match Value'}</label>
              ${isDateOp ? `
                <div class="exec-date-range-row">
                  <input type="date" id="execCondDateFrom_${cond.id}" class="exec-control-input exec-date-input exec-cond-date-from" data-cond-id="${escapeHtml(cond.id)}" value="${escapeHtml(cond.dateFrom || '')}" placeholder="YYYY-MM-DD" aria-label="Condition ${idx + 1} From Date">
                  <span class="exec-date-sep">to</span>
                  <input type="date" id="execCondDateTo_${cond.id}" class="exec-control-input exec-date-input exec-cond-date-to" data-cond-id="${escapeHtml(cond.id)}" value="${escapeHtml(cond.dateTo || '')}" placeholder="YYYY-MM-DD" aria-label="Condition ${idx + 1} To Date">
                </div>
              ` : `
                <input type="text" id="execCondVal_${cond.id}" class="exec-control-input exec-cond-value" data-cond-id="${escapeHtml(cond.id)}" value="${escapeHtml(cond.value || '')}" placeholder="e.g. Invoice" aria-label="Condition ${idx + 1} Value">
              `}
            </div>

            <!-- Remove Condition Button -->
            <div class="exec-field-group exec-remove-group">
              <label>&nbsp;</label>
              <button type="button" class="btn-icon exec-btn-remove-cond" data-cond-id="${escapeHtml(cond.id)}" title="Remove this condition" aria-label="Remove condition ${idx + 1}" ${this.conditions.length <= 1 ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>

          <!-- Custom Field Sub-Input if __custom__ selected -->
          ${cond.field === '__custom__' ? `
            <div class="exec-custom-field-row" style="margin-top:0.35rem;">
              <label for="execCondCustomField_${cond.id}" style="font-size:0.68rem; font-weight:700; color:var(--text-sub);">Custom Column / Field Name</label>
              <input type="text" id="execCondCustomField_${cond.id}" class="exec-control-input exec-cond-custom-field" data-cond-id="${escapeHtml(cond.id)}" value="${escapeHtml(cond.customField || '')}" placeholder="Enter exact column name..." aria-label="Condition ${idx + 1} Custom Field Name">
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  renderFilterExplanation() {
    if (!this.filterEnabled) {
      return '⚡ <strong>Process all items:</strong> No filter conditions applied. All discovered items will be processed sequentially.';
    }

    const opWord = this.matchMode === 'any' ? 'ANY' : 'ALL';
    const condDescs = this.conditions.map(c => {
      const field = (c.field === '__custom__' ? c.customField : c.field).trim() || 'Field';
      if (c.operator === 'dateBetween') {
        return `<code>${escapeHtml(field)}</code> date between "${escapeHtml(c.dateFrom || 'YYYY-MM-DD')}" and "${escapeHtml(c.dateTo || 'YYYY-MM-DD')}"`;
      }
      return `<code>${escapeHtml(field)}</code> ${escapeHtml(c.operator)} "${escapeHtml(c.value || '...')}"`;
    });

    return `⚡ Loop will inspect each item: rows matching <strong style="color:var(--brand-forest);">${opWord}</strong> of [ ${condDescs.join(', ')} ] will be selected. Other rows are skipped as <code>SKIPPED_FILTER</code>.`;
  },

  renderPreflightContent() {
    if (this.preflightStatus === 'loading') {
      return `
        <div class="exec-preflight-loading">
          <div class="exec-preflight-spinner"></div>
          <div>
            <strong style="display:block; font-size:0.82rem; color:var(--text-main);">Inspecting page and discovering repeatable items…</strong>
            <span style="display:block; margin-top:0.2rem; font-size:0.72rem; color:var(--text-sub);">Connecting via CDP to evaluate repeating DOM elements and schema fields.</span>
          </div>
        </div>
      `;
    }

    if (this.preflightStatus === 'error') {
      return `
        <div class="exec-preflight-error">
          <div style="display:flex; align-items:flex-start; gap:0.5rem;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <div style="flex:1;">
              <strong>Preflight Discovery Failed</strong>
              <p style="margin:0.2rem 0 0; font-size:0.72rem; line-height:1.4;">${escapeHtml(this.preflightError || 'Target page not available or no repeating items could be found.')}</p>
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.35rem;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnRetryPreflight" style="font-size:0.72rem; padding:0.25rem 0.65rem;">
              <span>Retry Preflight Check</span>
            </button>
          </div>
        </div>
      `;
    }

    if (this.preflightStatus === 'success') {
      const discovery = this.discoveryData?.discovery || {};
      const totalDiscovered = Number(this.filterPreview.totalCount ?? discovery.itemCount ?? 0);
      const confidencePct = Math.round((discovery.confidence || 0.95) * 100);
      const collectionName = discovery.collection ? `${discovery.collection.itemTag || 'Item'} rows` : 'Table / Grid';
      const actionsPerItem = this.discoveryData?.actionsPerItem ?? 1;

      return `
        <!-- Preflight Metrics Bar -->
        <div class="exec-preflight-grid">
          <div class="exec-preflight-metric">
            <span>Discovered</span>
            <strong id="metricDiscoveredCount">${totalDiscovered}</strong>
          </div>
          <div class="exec-preflight-metric">
            <span>Confidence</span>
            <strong>${confidencePct}%</strong>
          </div>
          <div class="exec-preflight-metric">
            <span>Collection</span>
            <strong style="font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(collectionName)}">${escapeHtml(collectionName)}</strong>
          </div>
          <div class="exec-preflight-metric">
            <span>Actions / item</span>
            <strong>${actionsPerItem}</strong>
          </div>
        </div>

        <!-- Filter Guard Section -->
        <div style="display:flex; flex-direction:column; gap:0.65rem; padding-top:0.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <span style="font-size:0.82rem; font-weight:800; color:var(--text-main);">🎯 Target Filter Guard</span>
              <span class="badge-tag primary" style="font-size:0.65rem; padding:0.1rem 0.4rem;">v2 Contract</span>
            </div>
            <span style="font-size:0.72rem; color:var(--text-sub);">Multi-condition &amp; limit preflight</span>
          </div>

          <!-- Explicit Filter Mode Toggle -->
          <div class="exec-filter-mode-row">
            <label class="exec-filter-mode-label">
              <input type="radio" name="execFilterModeToggle" value="all" ${!this.filterEnabled ? 'checked' : ''} style="accent-color:var(--brand-forest);">
              <span>Process all items (No filter)</span>
            </label>
            <label class="exec-filter-mode-label" style="margin-left:0.5rem;">
              <input type="radio" name="execFilterModeToggle" value="filter" ${this.filterEnabled ? 'checked' : ''} style="accent-color:var(--brand-forest);">
              <span>Filter items by field condition(s)</span>
            </label>
          </div>

          <!-- Filter Condition Controls (visible when filter is enabled) -->
          <div id="execFilterControlsWrapper" style="display:${this.filterEnabled ? 'flex' : 'none'}; flex-direction:column; gap:0.65rem;">

            <!-- Match Mode Row -->
            <div class="exec-match-mode-row">
              <label for="execFilterMatchMode" class="exec-match-mode-label">Match</label>
              <select id="execFilterMatchMode" class="exec-control-select exec-match-select" aria-label="Condition match mode">
                <option value="all" ${this.matchMode === 'all' ? 'selected' : ''}>ALL conditions (AND)</option>
                <option value="any" ${this.matchMode === 'any' ? 'selected' : ''}>ANY condition (OR)</option>
              </select>
              <span class="exec-match-mode-suffix">of the following:</span>
            </div>

            <!-- Conditions List -->
            <div id="execConditionsContainer" class="exec-conditions-container">
              ${this.renderConditionRows()}
            </div>

            <!-- Add Condition Button -->
            <div style="display:flex; justify-content:flex-start; margin-top:0.15rem;">
              <button type="button" class="btn btn-secondary btn-sm" id="btnAddConditionBtn" style="font-size:0.73rem; padding:0.3rem 0.75rem; display:inline-flex; align-items:center; gap:0.35rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>Add Condition</span>
              </button>
            </div>

            <!-- Explanatory rule text -->
            <p class="exec-filter-rule-explainer" id="execFilterExplanation">
              ${this.renderFilterExplanation()}
            </p>
          </div>

          <!-- Loop Item Limit Control -->
          <div class="exec-limit-container">
            <div class="exec-field-group">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <label for="execLoopLimitInput" style="font-size:0.75rem; font-weight:700; color:var(--text-main);">Loop Item Limit (Attempt Cap)</label>
                <span style="font-size:0.68rem; color:var(--text-sub);">Empty for all matching items</span>
              </div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <input type="number" id="execLoopLimitInput" class="exec-control-input ${this.isLimitInvalid() ? 'invalid' : ''}" value="${escapeHtml(this.loopLimitInput)}" min="1" step="1" placeholder="Unlimited (all matching items)" aria-describedby="execLimitHelp">
                <span class="badge-tag info" style="font-size:0.68rem; padding:0.2rem 0.5rem; white-space:nowrap;" id="execLimitBadge">${this.loopLimit ? `${this.loopLimit} items max` : 'Unlimited'}</span>
              </div>
              <span id="execLimitHelp" style="font-size:0.69rem; color:var(--text-sub); line-height:1.35;">
                Limits the run to at most N matching items in discovery order. Each selected item counts as an attempt even if it fails.
              </span>
            </div>
          </div>

          <!-- Live Preview Summary Counts -->
          <div class="exec-preview-counts-bar" id="execPreviewCountsBar">
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Discovered:</span>
              <strong style="color:var(--text-main);" id="prevTotalCount">${this.filterPreview.totalCount}</strong>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Matching:</span>
              <span class="badge-tag info" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevMatchingCount">${this.filterPreview.matchingCount ?? this.filterPreview.selectedCount}</span>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Selected:</span>
              <span class="badge-tag success" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevSelectedCount">${this.filterPreview.selectedCount}</span>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Skipped (Filter):</span>
              <span class="badge-tag warning" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevSkippedFilterCount">${this.filterPreview.skippedFilterCount ?? this.filterPreview.skippedCount}</span>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Skipped (Limit):</span>
              <span class="badge-tag secondary" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevSkippedLimitCount">${this.filterPreview.skippedLimitCount ?? 0}</span>
            </div>
          </div>

          <!-- Representative Samples Container -->
          <div id="execRepresentativeSamplesContainer" style="display:flex; flex-direction:column; gap:0.5rem;">
            ${this.renderRepresentativeSamples()}
          </div>

          <!-- Preview Validation & Zero-Match Blocking Banners -->
          <div id="execAlertContainer">
            ${this.renderAlertBanner()}
          </div>
        </div>
      `;
    }

    // Default fallback: preflight standby
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0;">
        <span style="font-size:0.78rem; color:var(--text-sub);">Preflight discovery inspects target items before execution.</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btnStartPreflightCheck" style="font-size:0.72rem;">Run Preflight Check</button>
      </div>
    `;
  },

  renderRepresentativeSamples() {
    const selected = Array.isArray(this.filterPreview.selectedPreview) ? this.filterPreview.selectedPreview : [];
    const filterSkipped = Array.isArray(this.filterPreview.skippedFilterPreview)
      ? this.filterPreview.skippedFilterPreview
      : (Array.isArray(this.filterPreview.skippedPreview) ? this.filterPreview.skippedPreview : []);
    const limitSkipped = Array.isArray(this.filterPreview.skippedLimitPreview) ? this.filterPreview.skippedLimitPreview : [];

    if (selected.length === 0 && filterSkipped.length === 0 && limitSkipped.length === 0) {
      return '';
    }

    let html = '';

    if (selected.length > 0) {
      html += `
        <div class="exec-sample-section">
          <span class="exec-sample-title">Selected Sample Items (First ${selected.length} of ${this.filterPreview.selectedCount}):</span>
          <div class="exec-sample-chips">
            ${selected.map(item => `
              <span class="exec-sample-chip selected" title="${escapeHtml(item.label || item.text || item.id || 'Selected item')}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${escapeHtml(item.label || item.text || item.id || `Item #${item.index || ''}`)}</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (filterSkipped.length > 0) {
      const totalFilterSkipped = this.filterPreview.skippedFilterCount ?? this.filterPreview.skippedCount ?? filterSkipped.length;
      html += `
        <div class="exec-sample-section">
          <span class="exec-sample-title">Filter-Skipped Sample Items (First ${filterSkipped.length} of ${totalFilterSkipped}):</span>
          <div class="exec-sample-chips">
            ${filterSkipped.map(item => `
              <span class="exec-sample-chip skipped" title="${escapeHtml(item.reason || 'Skipped by filter')}">
                <span>⊘ ${escapeHtml(item.label || item.text || item.id || `Item #${item.index || ''}`)}</span>
                <span style="opacity:0.8; font-size:0.65rem;">(${escapeHtml(item.reason || 'filter mismatch')})</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (limitSkipped.length > 0) {
      const totalLimitSkipped = this.filterPreview.skippedLimitCount ?? limitSkipped.length;
      html += `
        <div class="exec-sample-section">
          <span class="exec-sample-title">Limit-Skipped Sample Items (First ${limitSkipped.length} of ${totalLimitSkipped}):</span>
          <div class="exec-sample-chips">
            ${limitSkipped.map(item => `
              <span class="exec-sample-chip skipped-limit" title="${escapeHtml(item.reason || 'Skipped by limit')}">
                <span>⇥ ${escapeHtml(item.label || item.text || item.id || `Item #${item.index || ''}`)}</span>
                <span style="opacity:0.8; font-size:0.65rem;">(${escapeHtml(item.reason || 'limit reached')})</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    return html;
  },

  renderAlertBanner() {
    if (Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0) {
      return `
        <div class="exec-alert-banner error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div>
            <strong>Configuration Error:</strong>
            <div style="margin-top:0.15rem;">${this.filterPreview.errors.map(e => escapeHtml(e)).join(' · ')}</div>
          </div>
        </div>
      `;
    }

    if (this.filterPreview.totalCount > 0 && this.filterPreview.selectedCount === 0) {
      return `
        <div class="exec-alert-banner warning" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <div>
            <strong>Zero Items Selected:</strong>
            <p style="margin:0.15rem 0 0;">Out of ${this.filterPreview.totalCount} discovered items, 0 are selected. Execution is blocked to prevent running an empty batch. Adjust your filter conditions, item limit, or select &ldquo;Process all items&rdquo; to proceed.</p>
          </div>
        </div>
      `;
    }

    return '';
  },

  bindEvents() {
    const closeBtn = this.container.querySelector('#btnCloseExecModal');
    const cancelBtn = this.container.querySelector('#btnCancelExecModal');
    const confirmBtn = this.container.querySelector('#btnConfirmExecModal');

    if (closeBtn) closeBtn.onclick = () => this.close();
    if (cancelBtn) cancelBtn.onclick = () => this.close();

    // Mode Radio Inputs (Single vs Loop)
    const radioInputs = this.container.querySelectorAll('input[name="execModeRadio"]');
    const singleCard = this.container.querySelector('#labelExecSingle');
    const loopCard = this.container.querySelector('#labelExecLoop');
    const loopSection = this.container.querySelector('#execLoopSection');

    radioInputs.forEach(radio => {
      radio.onchange = () => {
        this.selectedMode = radio.value;
        if (this.selectedMode === 'single') {
          if (singleCard) singleCard.classList.add('active');
          if (loopCard) loopCard.classList.remove('active');
          if (loopSection) loopSection.style.display = 'none';
        } else {
          if (loopCard) loopCard.classList.add('active');
          if (singleCard) singleCard.classList.remove('active');
          if (loopSection) loopSection.style.display = 'flex';
          if (this.preflightStatus === 'idle') {
            this.runPreflight();
          }
        }
        this.updateExecuteButton();
      };
    });

    this.bindPreflightEvents();

    if (confirmBtn) {
      confirmBtn.onclick = () => this.execute();
    }
  },

  bindPreflightEvents() {
    const preflightContainer = this.container.querySelector('#execPreflightContainer');
    if (!preflightContainer) return;

    // Retry button if preflight errored
    const btnRetry = preflightContainer.querySelector('#btnRetryPreflight');
    if (btnRetry) {
      btnRetry.onclick = () => this.runPreflight();
    }

    const btnStartCheck = preflightContainer.querySelector('#btnStartPreflightCheck');
    if (btnStartCheck) {
      btnStartCheck.onclick = () => this.runPreflight();
    }

    // Filter Mode Radios ('all' vs 'filter')
    const modeRadios = preflightContainer.querySelectorAll('input[name="execFilterModeToggle"]');
    modeRadios.forEach(r => {
      r.onchange = () => {
        this.filterEnabled = r.value === 'filter';
        const controls = preflightContainer.querySelector('#execFilterControlsWrapper');
        if (controls) controls.style.display = this.filterEnabled ? 'flex' : 'none';
        this.evaluateFilterPreview();
      };
    });

    // Match Mode Select ('all' vs 'any')
    const matchSelect = preflightContainer.querySelector('#execFilterMatchMode');
    if (matchSelect) {
      matchSelect.onchange = () => {
        this.matchMode = matchSelect.value === 'any' ? 'any' : 'all';
        this.evaluateFilterPreview();
      };
    }

    // Add Condition Button
    const btnAdd = preflightContainer.querySelector('#btnAddConditionBtn');
    if (btnAdd) {
      btnAdd.onclick = () => this.addCondition();
    }

    // Item Limit Input
    const limitInput = preflightContainer.querySelector('#execLoopLimitInput');
    if (limitInput) {
      limitInput.oninput = () => {
        this.loopLimitInput = limitInput.value;
        const badge = preflightContainer.querySelector('#execLimitBadge');
        if (badge) {
          if (this.isLimitInvalid()) {
            badge.className = 'badge-tag warning';
            badge.textContent = 'Invalid limit';
          } else {
            const raw = this.loopLimitInput.trim();
            badge.className = 'badge-tag info';
            badge.textContent = raw ? `${raw} max attempts` : 'Unlimited';
          }
        }
        this.evaluateFilterPreview();
      };
    }

    this.bindConditionEvents();
  },

  bindConditionEvents() {
    const preflightContainer = this.container.querySelector('#execPreflightContainer');
    if (!preflightContainer) return;

    // Condition Field Selects
    preflightContainer.querySelectorAll('.exec-cond-field').forEach(fieldSelect => {
      fieldSelect.onchange = () => {
        const condId = fieldSelect.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.field = fieldSelect.value;
          this.refreshConditionsUI();
        }
      };
    });

    // Standalone Custom Field Inputs (when no schema fields available)
    preflightContainer.querySelectorAll('.exec-cond-field-input').forEach(fieldInput => {
      fieldInput.oninput = () => {
        const condId = fieldInput.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.field = fieldInput.value;
          this.evaluateFilterPreview();
        }
      };
    });

    // Custom Field Sub-Inputs (when '__custom__' selected)
    preflightContainer.querySelectorAll('.exec-cond-custom-field').forEach(customInput => {
      customInput.oninput = () => {
        const condId = customInput.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.customField = customInput.value;
          this.evaluateFilterPreview();
        }
      };
    });

    // Operator Selects
    preflightContainer.querySelectorAll('.exec-cond-operator').forEach(opSelect => {
      opSelect.onchange = () => {
        const condId = opSelect.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.operator = opSelect.value;
          this.refreshConditionsUI();
        }
      };
    });

    // Text Value Inputs
    preflightContainer.querySelectorAll('.exec-cond-value').forEach(valInput => {
      valInput.oninput = () => {
        const condId = valInput.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.value = valInput.value;
          this.evaluateFilterPreview();
        }
      };
    });

    // Date From Inputs
    preflightContainer.querySelectorAll('.exec-cond-date-from').forEach(dateInput => {
      dateInput.oninput = () => {
        const condId = dateInput.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.dateFrom = dateInput.value;
          this.evaluateFilterPreview();
        }
      };
    });

    // Date To Inputs
    preflightContainer.querySelectorAll('.exec-cond-date-to').forEach(dateInput => {
      dateInput.oninput = () => {
        const condId = dateInput.getAttribute('data-cond-id');
        const cond = this.conditions.find(c => c.id === condId);
        if (cond) {
          cond.dateTo = dateInput.value;
          this.evaluateFilterPreview();
        }
      };
    });

    // Remove Condition Buttons
    preflightContainer.querySelectorAll('.exec-btn-remove-cond').forEach(btn => {
      btn.onclick = () => {
        const condId = btn.getAttribute('data-cond-id');
        this.removeCondition(condId);
      };
    });
  },

  async runPreflight() {
    this.preflightStatus = 'loading';
    this.preflightError = '';
    const preflightContainer = this.container.querySelector('#execPreflightContainer');
    if (preflightContainer) {
      preflightContainer.innerHTML = this.renderPreflightContent();
    }
    this.updateExecuteButton();

    try {
      // Build request body according to preview contract: { loopStepIndex, itemFilter, loopLimit }
      const conditions = this.conditions.map(c => {
        const field = (c.field === '__custom__' ? c.customField : c.field).trim();
        if (c.operator === 'dateBetween') {
          return {
            field,
            operator: 'dateBetween',
            value: {
              from: (c.dateFrom || '').trim(),
              to: (c.dateTo || '').trim()
            }
          };
        }
        return {
          field,
          operator: c.operator || 'contains',
          value: (c.value || '').trim()
        };
      });

      const itemFilterPayload = this.filterEnabled ? {
        matchMode: this.matchMode,
        conditions
      } : null;

      let loopLimitPayload = null;
      if (this.loopLimitInput && this.loopLimitInput.trim()) {
        const raw = this.loopLimitInput.trim();
        if (/^\d+$/.test(raw) && parseInt(raw, 10) > 0) {
          loopLimitPayload = parseInt(raw, 10);
        }
      }

      let data;
      try {
        const res = await Auth.authenticatedFetch(`/api/workflows/${encodeURIComponent(this.currentWorkflowId)}/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loopStepIndex: this.loopStepIndex,
            itemFilter: itemFilterPayload,
            loopLimit: loopLimitPayload
          })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || data.discovery?.reason || 'Discovery preflight failed');
      } catch (authErr) {
        // Fallback to Api.discoverWorkflow if available
        if (typeof Api.discoverWorkflow === 'function') {
          data = await Api.discoverWorkflow(this.currentWorkflowId, this.loopStepIndex);
        } else {
          throw authErr;
        }
      }

      this.preflightStatus = 'success';
      this.discoveryData = data;
      this.availableFields = this.extractAvailableFields(data);

      // If condition field not in availableFields, default to first available field if available
      if (this.availableFields.length > 0 && this.conditions.length === 1 && this.conditions[0].field === 'Type' && !this.availableFields.some(f => f.toLowerCase() === 'type')) {
        this.conditions[0].field = this.availableFields[0];
      }

      // Check if server returned a filterPreview that confirms filter and limit
      const serverPreview = data.filterPreview;
      const serverConfirmsLimit = (loopLimitPayload === null) ||
        (serverPreview && (serverPreview.skippedLimitCount !== undefined || (typeof serverPreview.selectedCount === 'number' && serverPreview.selectedCount <= loopLimitPayload)));

      const canUseServerPreview = serverPreview &&
        typeof serverPreview.selectedCount === 'number' &&
        this.filterEnabled &&
        serverConfirmsLimit;

      if (canUseServerPreview) {
        this.filterPreview = {
          totalCount: Number(serverPreview.totalCount ?? data.discovery?.itemCount ?? 0),
          matchingCount: Number(serverPreview.matchingCount ?? serverPreview.selectedCount ?? 0),
          selectedCount: Number(serverPreview.selectedCount ?? 0),
          skippedFilterCount: Number(serverPreview.skippedFilterCount ?? serverPreview.skippedCount ?? 0),
          skippedLimitCount: Number(serverPreview.skippedLimitCount ?? 0),
          selectedPreview: Array.isArray(serverPreview.selectedPreview) ? serverPreview.selectedPreview : [],
          skippedFilterPreview: Array.isArray(serverPreview.skippedFilterPreview)
            ? serverPreview.skippedFilterPreview
            : (Array.isArray(serverPreview.skippedPreview) ? serverPreview.skippedPreview : []),
          skippedLimitPreview: Array.isArray(serverPreview.skippedLimitPreview) ? serverPreview.skippedLimitPreview : [],
          errors: Array.isArray(serverPreview.errors) ? serverPreview.errors : []
        };
      } else {
        // Evaluate client-side using discovered items
        this.evaluateFilterPreview();
      }

      if (preflightContainer) {
        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
      }
      this.updateExecuteButton();
    } catch (err) {
      this.preflightStatus = 'error';
      this.preflightError = err.message || 'Discovery preflight failed';
      if (preflightContainer) {
        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
      }
      this.updateExecuteButton();
    }
  },

  extractAvailableFields(data) {
    const fields = new Set();

    if (Array.isArray(data.availableFields)) {
      data.availableFields.forEach(f => f && fields.add(String(f).trim()));
    }
    if (Array.isArray(data.discovery?.availableFields)) {
      data.discovery.availableFields.forEach(f => f && fields.add(String(f).trim()));
    }

    const items = Array.isArray(data.discovery?.items) ? data.discovery.items : [];
    items.forEach(item => {
      if (item && item.fields && typeof item.fields === 'object') {
        if (item.fields instanceof Map) {
          for (const k of item.fields.keys()) if (k) fields.add(String(k).trim());
        } else {
          Object.keys(item.fields).forEach(k => k && fields.add(k.trim()));
        }
      } else if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => {
          const lower = k.toLowerCase();
          if (!['index', 'text', 'id', 'element', 'selector', 'target', 'fingerprint', 'itemkey', 'itemlabel'].includes(lower)) {
            fields.add(k.trim());
          }
        });
      }
    });

    return Array.from(fields);
  },

  evaluateFilterPreview() {
    const discovery = this.discoveryData?.discovery || {};
    const items = Array.isArray(discovery.items) ? discovery.items : [];
    const totalCount = Number(discovery.itemCount ?? items.length);

    // 1. Validate Loop Limit
    let parsedLimit = null;
    let limitError = null;
    const rawLimit = String(this.loopLimitInput || '').trim();

    if (rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit)) {
        limitError = 'Item limit must be a positive whole number';
      } else {
        const n = parseInt(rawLimit, 10);
        if (n <= 0) {
          limitError = 'Item limit must be greater than zero';
        } else {
          parsedLimit = n;
        }
      }
    }
    this.loopLimit = parsedLimit;

    // 2. If filter is disabled (Process all items / No filter)
    if (!this.filterEnabled) {
      const errors = limitError ? [limitError] : [];
      let selectedItems = items;
      let limitSkippedItems = [];

      if (parsedLimit !== null && items.length > 0) {
        selectedItems = items.slice(0, parsedLimit);
        limitSkippedItems = items.slice(parsedLimit);
      }

      const selectedCount = errors.length > 0 ? 0 : (parsedLimit !== null ? Math.min(totalCount, parsedLimit) : totalCount);
      const skippedLimitCount = errors.length > 0 ? 0 : (parsedLimit !== null ? Math.max(0, totalCount - parsedLimit) : 0);

      this.filterPreview = {
        totalCount,
        matchingCount: totalCount,
        selectedCount,
        skippedFilterCount: 0,
        skippedLimitCount,
        selectedPreview: selectedItems.slice(0, 5).map((item, idx) => ({
          index: idx + 1,
          label: this.getItemLabel(item, idx + 1),
          raw: item
        })),
        skippedFilterPreview: [],
        skippedLimitPreview: limitSkippedItems.slice(0, 5).map((item, idx) => ({
          index: (parsedLimit || 0) + idx + 1,
          label: this.getItemLabel(item, (parsedLimit || 0) + idx + 1),
          reason: `Exceeded loop item limit (capped at ${parsedLimit})`,
          raw: item
        })),
        errors
      };
      this.updateFilterPreviewUI();
      return;
    }

    // 3. Filter is enabled: Validate matchMode and conditions
    const errors = [];
    if (limitError) {
      errors.push(limitError);
    }

    if (this.matchMode !== 'all' && this.matchMode !== 'any') {
      errors.push('Match mode must be "all" or "any"');
    }

    if (!Array.isArray(this.conditions) || this.conditions.length === 0) {
      errors.push('At least one filter condition is required');
    }

    const validatedConditions = [];

    this.conditions.forEach((c, idx) => {
      const rowNum = idx + 1;
      const field = (c.field === '__custom__' ? c.customField : c.field).trim();
      const op = c.operator || 'contains';

      if (!field) {
        errors.push(`Condition #${rowNum}: Field name is required`);
      } else if (this.availableFields.length > 0 && !this.availableFields.some(f => f.toLowerCase() === field.toLowerCase())) {
        errors.push(`Condition #${rowNum}: Field "${field}" not found in discovered fields (${this.availableFields.join(', ')})`);
      }

      if (!['contains', 'equals', 'dateBetween'].includes(op)) {
        errors.push(`Condition #${rowNum}: Unsupported operator "${op}". Use contains, equals, or dateBetween.`);
      }

      if (op === 'contains' || op === 'equals') {
        const val = String(c.value ?? '').trim();
        if (!val && val !== '0') {
          errors.push(`Condition #${rowNum}: Match value is required`);
        } else {
          validatedConditions.push({ index: rowNum, field, operator: op, value: val });
        }
      } else if (op === 'dateBetween') {
        const from = String(c.dateFrom ?? '').trim();
        const to = String(c.dateTo ?? '').trim();

        if (!from) {
          errors.push(`Condition #${rowNum}: "From" date is required for dateBetween`);
        } else if (!isValidIsoDate(from)) {
          errors.push(`Condition #${rowNum}: "From" date must use YYYY-MM-DD format`);
        }

        if (!to) {
          errors.push(`Condition #${rowNum}: "To" date is required for dateBetween`);
        } else if (!isValidIsoDate(to)) {
          errors.push(`Condition #${rowNum}: "To" date must use YYYY-MM-DD format`);
        }

        if (isValidIsoDate(from) && isValidIsoDate(to)) {
          if (from > to) {
            errors.push(`Condition #${rowNum}: "From" date (${from}) must not be after "To" date (${to})`);
          } else {
            validatedConditions.push({ index: rowNum, field, operator: op, dateFrom: from, dateTo: to });
          }
        }
      }
    });

    if (errors.length > 0) {
      this.filterPreview = {
        totalCount,
        matchingCount: 0,
        selectedCount: 0,
        skippedFilterCount: 0,
        skippedLimitCount: 0,
        selectedPreview: [],
        skippedFilterPreview: [],
        skippedLimitPreview: [],
        errors
      };
      this.updateFilterPreviewUI();
      return;
    }

    // 4. Evaluate each item against conditions
    const matchingList = [];
    const filterSkippedList = [];

    items.forEach((item, idx) => {
      const itemIndex = idx + 1;
      const label = this.getItemLabel(item, itemIndex);

      let itemMatches = false;
      const conditionResults = [];

      for (const cond of validatedConditions) {
        const extracted = this.extractFieldValue(item, cond.field);

        if (!extracted.found) {
          conditionResults.push({
            matches: false,
            reason: `Field "${cond.field}" not found on item`
          });
          continue;
        }

        const rawVal = extracted.value;
        const actualStr = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';

        if (cond.operator === 'contains') {
          const m = actualStr.toLowerCase().includes(cond.value.toLowerCase());
          conditionResults.push({
            matches: m,
            reason: m
              ? `Field "${cond.field}" contains "${cond.value}"`
              : `Field "${cond.field}" ("${actualStr}") does not contain "${cond.value}"`
          });
        } else if (cond.operator === 'equals') {
          const m = actualStr.toLowerCase() === cond.value.toLowerCase();
          conditionResults.push({
            matches: m,
            reason: m
              ? `Field "${cond.field}" equals "${cond.value}"`
              : `Field "${cond.field}" ("${actualStr}") does not equal "${cond.value}"`
          });
        } else if (cond.operator === 'dateBetween') {
          const itemCalDate = parseItemDate(rawVal !== undefined && rawVal !== null ? rawVal : actualStr);
          if (!itemCalDate) {
            conditionResults.push({
              matches: false,
              reason: !actualStr
                ? `Field "${cond.field}" has missing or empty date value (cannot evaluate dateBetween)`
                : `Field "${cond.field}" value "${actualStr}" cannot be parsed as a calendar date`
            });
          } else {
            const m = itemCalDate >= cond.dateFrom && itemCalDate <= cond.dateTo;
            conditionResults.push({
              matches: m,
              reason: m
                ? `Field "${cond.field}" date (${itemCalDate}) is between ${cond.dateFrom} and ${cond.dateTo}`
                : `Field "${cond.field}" date (${itemCalDate}) is outside ${cond.dateFrom} to ${cond.dateTo}`
            });
          }
        }
      }

      if (this.matchMode === 'all') {
        itemMatches = conditionResults.length > 0 && conditionResults.every(r => r.matches);
      } else {
        itemMatches = conditionResults.length > 0 && conditionResults.some(r => r.matches);
      }

      if (itemMatches) {
        matchingList.push({
          index: itemIndex,
          label,
          raw: item
        });
      } else {
        const failReasons = conditionResults.filter(r => !r.matches).map(r => r.reason);
        filterSkippedList.push({
          index: itemIndex,
          label,
          reason: failReasons.join('; ') || 'Did not match filter criteria',
          raw: item
        });
      }
    });

    // 5. Apply loop limit to matching items
    let selectedList = matchingList;
    let limitSkippedList = [];

    if (parsedLimit !== null && parsedLimit > 0) {
      selectedList = matchingList.slice(0, parsedLimit);
      limitSkippedList = matchingList.slice(parsedLimit).map(item => ({
        ...item,
        reason: `Exceeded loop item limit (capped at ${parsedLimit})`
      }));
    }

    this.filterPreview = {
      totalCount: items.length || totalCount,
      matchingCount: matchingList.length,
      selectedCount: selectedList.length,
      skippedFilterCount: filterSkippedList.length,
      skippedLimitCount: limitSkippedList.length,
      selectedPreview: selectedList.slice(0, 5),
      skippedFilterPreview: filterSkippedList.slice(0, 5),
      skippedLimitPreview: limitSkippedList.slice(0, 5),
      errors
    };

    this.updateFilterPreviewUI();
  },

  getItemLabel(item, fallbackIndex = 1) {
    if (!item) return `Item #${fallbackIndex}`;
    if (typeof item === 'string') return item;
    if (item.label) return String(item.label);
    if (item.text) return String(item.text);
    if (item.id) return String(item.id);
    if (item.fields && typeof item.fields === 'object') {
      const vals = Object.values(item.fields).filter(Boolean);
      if (vals.length > 0) return vals.join(' · ');
    }
    return `Item #${fallbackIndex}`;
  },

  extractFieldValue(item, fieldName) {
    if (!item || !fieldName) return { found: false, value: undefined };
    const targetKey = fieldName.trim().toLowerCase();

    // Check item.fields Map or Object
    if (item.fields && typeof item.fields === 'object') {
      if (item.fields instanceof Map) {
        for (const [k, v] of item.fields.entries()) {
          if (k.trim().toLowerCase() === targetKey) {
            return { found: true, value: v };
          }
        }
      } else {
        for (const [k, v] of Object.entries(item.fields)) {
          if (k.trim().toLowerCase() === targetKey) {
            return { found: true, value: v };
          }
        }
      }
    }

    // Check direct properties of item
    if (typeof item === 'object') {
      for (const [k, v] of Object.entries(item)) {
        if (k.trim().toLowerCase() === targetKey) {
          return { found: true, value: v };
        }
      }
    }

    // Check text / label / name properties
    if (['text', 'label', 'name'].includes(targetKey)) {
      const v = item.text || item.label || (typeof item === 'string' ? item : undefined);
      if (v !== undefined) return { found: true, value: v };
    }

    return { found: false, value: undefined };
  },

  updateFilterPreviewUI() {
    const preflightContainer = this.container.querySelector('#execPreflightContainer');
    if (!preflightContainer) return;

    // Update explanation
    const expText = preflightContainer.querySelector('#execFilterExplanation');
    if (expText) {
      expText.innerHTML = this.renderFilterExplanation();
    }

    // Update Counts Bar
    const totalEl = preflightContainer.querySelector('#prevTotalCount');
    const matchEl = preflightContainer.querySelector('#prevMatchingCount');
    const selEl = preflightContainer.querySelector('#prevSelectedCount');
    const skipFilterEl = preflightContainer.querySelector('#prevSkippedFilterCount');
    const skipLimitEl = preflightContainer.querySelector('#prevSkippedLimitCount');
    const metricTotalEl = preflightContainer.querySelector('#metricDiscoveredCount');

    if (totalEl) totalEl.textContent = this.filterPreview.totalCount;
    if (metricTotalEl) metricTotalEl.textContent = this.filterPreview.totalCount;
    if (matchEl) matchEl.textContent = this.filterPreview.matchingCount ?? this.filterPreview.selectedCount;
    if (selEl) selEl.textContent = this.filterPreview.selectedCount;
    if (skipFilterEl) skipFilterEl.textContent = this.filterPreview.skippedFilterCount;
    if (skipLimitEl) skipLimitEl.textContent = this.filterPreview.skippedLimitCount;

    // Update Limit Badge & Input state
    const limitBadge = preflightContainer.querySelector('#execLimitBadge');
    const limitInput = preflightContainer.querySelector('#execLoopLimitInput');
    if (limitBadge) {
      if (this.isLimitInvalid()) {
        limitBadge.className = 'badge-tag warning';
        limitBadge.textContent = 'Invalid limit';
        if (limitInput) limitInput.classList.add('invalid');
      } else {
        const raw = this.loopLimitInput.trim();
        limitBadge.className = 'badge-tag info';
        limitBadge.textContent = raw ? `${raw} max attempts` : 'Unlimited';
        if (limitInput) limitInput.classList.remove('invalid');
      }
    }

    // Update Representative Samples
    const samplesContainer = preflightContainer.querySelector('#execRepresentativeSamplesContainer');
    if (samplesContainer) {
      samplesContainer.innerHTML = this.renderRepresentativeSamples();
    }

    // Update Alert Banner
    const alertContainer = preflightContainer.querySelector('#execAlertContainer');
    if (alertContainer) {
      alertContainer.innerHTML = this.renderAlertBanner();
    }

    this.updateExecuteButton();
  },

  updateExecuteButton() {
    const confirmBtn = this.container.querySelector('#btnConfirmExecModal');
    const confirmText = this.container.querySelector('#btnConfirmExecText');
    if (!confirmBtn) return;

    if (this.selectedMode === 'single') {
      confirmBtn.disabled = false;
      confirmBtn.title = 'Start single workflow execution';
      if (confirmText) confirmText.textContent = 'Start Single Execution';
      return;
    }

    // In Loop Mode: check preflight status and filter constraints
    if (this.preflightStatus === 'loading') {
      confirmBtn.disabled = true;
      confirmBtn.title = 'Preflight discovery in progress…';
      if (confirmText) confirmText.textContent = 'Discovering items…';
      return;
    }

    if (this.preflightStatus === 'error') {
      confirmBtn.disabled = true;
      confirmBtn.title = 'Preflight check failed. Please resolve the error before executing.';
      if (confirmText) confirmText.textContent = 'Preflight Error';
      return;
    }

    if (this.preflightStatus === 'success') {
      const hasErrors = Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0;
      const isZeroSelected = this.filterPreview.selectedCount === 0;

      if (hasErrors) {
        confirmBtn.disabled = true;
        confirmBtn.title = 'Fix configuration error: ' + (this.filterPreview.errors[0] || '');
        if (confirmText) confirmText.textContent = 'Invalid Configuration';
        return;
      }

      if (isZeroSelected) {
        confirmBtn.disabled = true;
        confirmBtn.title = 'Zero items selected. Filtered runs with 0 items are blocked.';
        if (confirmText) confirmText.textContent = '0 Selected Items';
        return;
      }

      const count = this.filterPreview.selectedCount;
      confirmBtn.disabled = count <= 0;
      confirmBtn.title = `Execute loop on ${count} item${count === 1 ? '' : 's'}`;
      if (confirmText) {
        confirmText.textContent = `Execute Loop (${count} item${count === 1 ? '' : 's'})`;
      }
      return;
    }

    // Preflight not yet run
    confirmBtn.disabled = true;
    if (confirmText) confirmText.textContent = 'Run Preflight First';
  },

  async execute() {
    const confirmBtn = this.container.querySelector('#btnConfirmExecModal');
    const confirmText = this.container.querySelector('#btnConfirmExecText');
    const chkRedownload = this.container.querySelector('#chkExecForceRedownload');

    const isLoopMode = this.selectedMode === 'loop';
    const forceRedownload = !!chkRedownload?.checked;

    let itemFilter = null;
    let loopLimit = null;
    let rowFilter = null;

    if (isLoopMode) {
      // 1. Validate Loop Limit
      const rawLimit = String(this.loopLimitInput || '').trim();
      if (rawLimit !== '') {
        if (!/^\d+$/.test(rawLimit) || parseInt(rawLimit, 10) <= 0) {
          Toast.error('Cannot execute: loop item limit must be a positive integer.');
          return;
        }
        loopLimit = parseInt(rawLimit, 10);
      }

      // 2. Validate filter if enabled
      if (this.filterEnabled) {
        if (Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0) {
          Toast.error('Cannot execute: ' + this.filterPreview.errors[0]);
          return;
        }

        if (this.filterPreview.selectedCount === 0) {
          Toast.error('Cannot execute: 0 items selected for execution.');
          return;
        }

        const conditions = this.conditions.map(c => {
          const field = (c.field === '__custom__' ? c.customField : c.field).trim();
          if (c.operator === 'dateBetween') {
            return {
              field,
              operator: 'dateBetween',
              value: {
                from: (c.dateFrom || '').trim(),
                to: (c.dateTo || '').trim()
              }
            };
          }
          return {
            field,
            operator: c.operator || 'contains',
            value: String(c.value ?? '').trim()
          };
        });

        itemFilter = {
          matchMode: this.matchMode || 'all',
          conditions
        };

        // Legacy rowFilter compatibility for single condition text filter
        if (conditions.length === 1 && (conditions[0].operator === 'contains' || conditions[0].operator === 'equals')) {
          rowFilter = {
            column: conditions[0].field,
            value: conditions[0].value,
            operator: conditions[0].operator
          };
        }
      } else {
        // Filter disabled: check if zero items exist
        if (this.filterPreview.totalCount === 0) {
          Toast.error('Cannot execute: no discovered items found.');
          return;
        }
        if (this.filterPreview.selectedCount === 0) {
          Toast.error('Cannot execute: 0 items selected for execution.');
          return;
        }
      }
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (confirmText) confirmText.textContent = 'Launching…';

    const launchDesc = isLoopMode
      ? (itemFilter ? `loop (${itemFilter.conditions.length} condition(s), limit: ${loopLimit ?? 'unlimited'})` : `batch loop (all items, limit: ${loopLimit ?? 'unlimited'})`)
      : 'single macro';
    Toast.info(`Starting ${launchDesc} execution…`);

    try {
      const executeOptions = {
        mode: this.selectedMode,
        isLoop: isLoopMode,
        loopStepIndex: isLoopMode ? this.loopStepIndex : null,
        forceRedownload,
        itemFilter,
        loopLimit,
        rowFilter
      };

      const res = await Api.executeWorkflow(this.currentWorkflowId, executeOptions);

      this.close();
      Toast.success('Workflow execution dispatched!');

      if (typeof this.onExecuted === 'function') {
        this.onExecuted(res);
      } else if (res && res.runId) {
        sessionStorage.setItem('workflowCaptureActiveRunId', res.runId);
        Router.navigate(`execution/${encodeURIComponent(res.runId)}`);
      } else {
        Router.navigate('execution');
      }
    } catch (err) {
      Toast.error(err.message || 'Failed to start execution');
      if (confirmBtn) confirmBtn.disabled = false;
      this.updateExecuteButton();
    }
  }
};
