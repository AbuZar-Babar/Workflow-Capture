/**
 * Workflow Capture — Workflow Execution & Loop Review Modal
 * 
 * Unifies execution preflight, item discovery, record filtering, and launch review.
 * Conforms to the Shared Filter Contract from MULTI-AGENT-WORK-PLAN.md:
 *  - itemFilter: { field, operator, value }
 *  - Operators: 'contains' | 'equals' (case-insensitive, whitespace trimmed)
 *  - Preflight counts: totalCount, selectedCount, skippedCount, representative samples
 *  - Blocks execution on preview errors or zero-match filtered runs
 *  - Passes itemFilter unchanged to API client
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

export const ExecutionModal = {
  container: null,
  currentWorkflowId: null,
  workflowName: 'Workflow',
  stepCount: 0,
  loopStepIndex: 0,
  isLoopConfigured: false,
  selectedMode: 'single', // 'single' | 'loop'
  onExecuted: null,

  // Preflight and filter state
  preflightStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
  preflightError: '',
  discoveryData: null,
  availableFields: [],
  filterEnabled: true,
  filterField: 'Type',
  customFieldName: '',
  filterOperator: 'contains', // 'contains' | 'equals'
  filterValue: 'Invoice',
  filterPreview: {
    totalCount: 0,
    selectedCount: 0,
    skippedCount: 0,
    selectedPreview: [],
    skippedPreview: [],
    errors: []
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

    // Reset preflight state
    this.preflightStatus = 'idle';
    this.preflightError = '';
    this.discoveryData = null;
    this.availableFields = [];
    this.filterEnabled = true;
    this.filterField = 'Type';
    this.customFieldName = '';
    this.filterOperator = 'contains';
    this.filterValue = 'Invoice';
    this.filterPreview = {
      totalCount: 0,
      selectedCount: 0,
      skippedCount: 0,
      selectedPreview: [],
      skippedPreview: [],
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
              <input type="radio" name="execModeRadio" value="single" ${!isLoopSelected ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);">
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
              <input type="radio" name="execModeRadio" value="loop" ${isLoopSelected ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);">
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

      const hasFields = this.availableFields.length > 0;
      const isCustomField = this.filterField === '__custom__' || (!hasFields && !!this.filterField);
      const currentField = isCustomField ? (this.customFieldName || this.filterField || 'Type') : (this.filterField || 'Type');

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
        <div style="display:flex; flex-direction:column; gap:0.6rem; padding-top:0.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <span style="font-size:0.82rem; font-weight:800; color:var(--text-main);">🎯 Target Filter Guard</span>
              <span class="badge-tag primary" style="font-size:0.65rem; padding:0.1rem 0.4rem;">Shared Filter Contract</span>
            </div>
            <span style="font-size:0.72rem; color:var(--text-sub);">Generic field-level preflight</span>
          </div>

          <!-- Explicit Filter Mode Toggle -->
          <div class="exec-filter-mode-row">
            <label class="exec-filter-mode-label">
              <input type="radio" name="execFilterModeToggle" value="all" ${!this.filterEnabled ? 'checked' : ''} style="accent-color:var(--brand-forest);">
              <span>Process all items (No filter)</span>
            </label>
            <label class="exec-filter-mode-label" style="margin-left:0.5rem;">
              <input type="radio" name="execFilterModeToggle" value="filter" ${this.filterEnabled ? 'checked' : ''} style="accent-color:var(--brand-forest);">
              <span>Filter items by field condition</span>
            </label>
          </div>

          <!-- Filter Condition Controls (visible when filter is enabled) -->
          <div id="execFilterControlsWrapper" style="display:${this.filterEnabled ? 'flex' : 'none'}; flex-direction:column; gap:0.65rem;">
            <div class="exec-filter-inputs-grid">
              
              <!-- Field Selector -->
              <div class="exec-field-group">
                <label for="execFilterFieldSelect">Target Field</label>
                ${hasFields ? `
                  <select id="execFilterFieldSelect" class="exec-control-select">
                    ${this.availableFields.map(f => `<option value="${escapeHtml(f)}" ${f.toLowerCase() === currentField.toLowerCase() ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                    <option value="__custom__" ${this.filterField === '__custom__' ? 'selected' : ''}>Custom field…</option>
                  </select>
                ` : `
                  <input type="text" id="execFilterCustomField" class="exec-control-input" value="${escapeHtml(currentField)}" placeholder="e.g. Type, Status…">
                `}
              </div>

              <!-- Operator Selector -->
              <div class="exec-field-group">
                <label for="execFilterOperatorSelect">Operator</label>
                <select id="execFilterOperatorSelect" class="exec-control-select">
                  <option value="contains" ${this.filterOperator === 'contains' ? 'selected' : ''}>contains</option>
                  <option value="equals" ${this.filterOperator === 'equals' ? 'selected' : ''}>equals</option>
                </select>
              </div>

              <!-- Value Input -->
              <div class="exec-field-group">
                <label for="execFilterValueInput">Match Value</label>
                <input type="text" id="execFilterValueInput" class="exec-control-input" value="${escapeHtml(this.filterValue)}" placeholder="e.g. Invoice">
              </div>
            </div>

            <!-- Custom field name input if '__custom__' selected with available fields -->
            <div id="execCustomFieldContainer" style="display:${this.filterField === '__custom__' ? 'flex' : 'none'}; flex-direction:column; gap:0.25rem;">
              <label for="execFilterCustomFieldInput" style="font-size:0.7rem; font-weight:700; color:var(--text-sub);">Custom Column / Field Name</label>
              <input type="text" id="execFilterCustomFieldInput" class="exec-control-input" value="${escapeHtml(this.customFieldName)}" placeholder="Enter exact column name...">
            </div>

            <!-- Explanatory rule text -->
            <p class="exec-filter-rule-explainer" id="execFilterExplanation">
              ⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(currentField)} ${escapeHtml(this.filterOperator)} "${escapeHtml(this.filterValue)}"</strong> will execute. Other rows are skipped as <code>SKIPPED_FILTER</code>.
            </p>
          </div>

          <!-- Live Preview Summary Counts -->
          <div class="exec-preview-counts-bar" id="execPreviewCountsBar">
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Total:</span>
              <strong style="color:var(--text-main);" id="prevTotalCount">${this.filterPreview.totalCount}</strong>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Selected:</span>
              <span class="badge-tag success" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevSelectedCount">${this.filterPreview.selectedCount}</span>
            </div>
            <div class="exec-preview-count-item">
              <span style="color:var(--text-sub);">Skipped:</span>
              <span class="badge-tag warning" style="font-size:0.72rem; padding:0.1rem 0.5rem; font-weight:800;" id="prevSkippedCount">${this.filterPreview.skippedCount}</span>
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
    const skipped = Array.isArray(this.filterPreview.skippedPreview) ? this.filterPreview.skippedPreview : [];

    if (selected.length === 0 && skipped.length === 0) {
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

    if (skipped.length > 0) {
      html += `
        <div class="exec-sample-section">
          <span class="exec-sample-title">Skipped Sample Items (First ${skipped.length} of ${this.filterPreview.skippedCount}):</span>
          <div class="exec-sample-chips">
            ${skipped.map(item => `
              <span class="exec-sample-chip skipped" title="${escapeHtml(item.reason || 'Skipped by filter')}">
                <span>↷ ${escapeHtml(item.label || item.text || item.id || `Item #${item.index || ''}`)}</span>
                <span style="opacity:0.8; font-size:0.65rem;">(${escapeHtml(item.reason || 'skipped')})</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    return html;
  },

  renderAlertBanner() {
    if (this.filterEnabled && Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0) {
      return `
        <div class="exec-alert-banner error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div>
            <strong>Filter Configuration Error:</strong>
            <div style="margin-top:0.15rem;">${this.filterPreview.errors.map(e => escapeHtml(e)).join(' · ')}</div>
          </div>
        </div>
      `;
    }

    if (this.filterEnabled && this.filterPreview.totalCount > 0 && this.filterPreview.selectedCount === 0) {
      return `
        <div class="exec-alert-banner warning" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <div>
            <strong>Zero Items Match Filter:</strong>
            <p style="margin:0.15rem 0 0;">Out of ${this.filterPreview.totalCount} discovered items, 0 match the criteria. Filtered execution is blocked to prevent running an empty batch. Adjust the match value or select &ldquo;Process all items&rdquo; to proceed.</p>
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

    // Field Selector
    const fieldSelect = preflightContainer.querySelector('#execFilterFieldSelect');
    const customFieldWrapper = preflightContainer.querySelector('#execCustomFieldContainer');
    const customFieldInput = preflightContainer.querySelector('#execFilterCustomFieldInput');
    const standaloneCustomField = preflightContainer.querySelector('#execFilterCustomField');

    if (fieldSelect) {
      fieldSelect.onchange = () => {
        this.filterField = fieldSelect.value;
        if (this.filterField === '__custom__') {
          if (customFieldWrapper) customFieldWrapper.style.display = 'flex';
          this.customFieldName = customFieldInput?.value.trim() || '';
        } else {
          if (customFieldWrapper) customFieldWrapper.style.display = 'none';
        }
        this.evaluateFilterPreview();
      };
    }

    if (customFieldInput) {
      customFieldInput.oninput = () => {
        this.customFieldName = customFieldInput.value;
        this.evaluateFilterPreview();
      };
    }

    if (standaloneCustomField) {
      standaloneCustomField.oninput = () => {
        this.filterField = standaloneCustomField.value;
        this.evaluateFilterPreview();
      };
    }

    // Operator Selector
    const operatorSelect = preflightContainer.querySelector('#execFilterOperatorSelect');
    if (operatorSelect) {
      operatorSelect.onchange = () => {
        this.filterOperator = operatorSelect.value;
        this.evaluateFilterPreview();
      };
    }

    // Value Input
    const valInput = preflightContainer.querySelector('#execFilterValueInput');
    if (valInput) {
      valInput.oninput = () => {
        this.filterValue = valInput.value;
        this.evaluateFilterPreview();
      };
    }
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
      // Build request body according to preview contract: { loopStepIndex, itemFilter }
      const itemFilterPayload = (this.filterEnabled && this.filterField && this.filterValue) ? {
        field: (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim(),
        operator: this.filterOperator,
        value: this.filterValue.trim()
      } : null;

      let data;
      try {
        const res = await Auth.authenticatedFetch(`/api/workflows/${encodeURIComponent(this.currentWorkflowId)}/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loopStepIndex: this.loopStepIndex,
            itemFilter: itemFilterPayload
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

      // If filterField is not set or not in availableFields, pick the first discovered field
      if (this.availableFields.length > 0 && (!this.filterField || this.filterField === 'Type')) {
        const hasType = this.availableFields.some(f => f.toLowerCase() === 'type');
        this.filterField = hasType ? 'Type' : this.availableFields[0];
      }

      // If backend returned filterPreview, accept it; otherwise evaluate client-side
      if (data.filterPreview && typeof data.filterPreview.selectedCount === 'number') {
        this.filterPreview = {
          totalCount: Number(data.filterPreview.totalCount ?? data.discovery?.itemCount ?? 0),
          selectedCount: Number(data.filterPreview.selectedCount ?? 0),
          skippedCount: Number(data.filterPreview.skippedCount ?? 0),
          selectedPreview: Array.isArray(data.filterPreview.selectedPreview) ? data.filterPreview.selectedPreview : [],
          skippedPreview: Array.isArray(data.filterPreview.skippedPreview) ? data.filterPreview.skippedPreview : [],
          errors: Array.isArray(data.filterPreview.errors) ? data.filterPreview.errors : []
        };
      } else {
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
        Object.keys(item.fields).forEach(k => k && fields.add(k.trim()));
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
    const totalCount = Number(this.discoveryData?.filterPreview?.totalCount ?? discovery.itemCount ?? items.length);

    if (!this.filterEnabled) {
      this.filterPreview = {
        totalCount,
        selectedCount: totalCount,
        skippedCount: 0,
        selectedPreview: items.slice(0, 5).map((item, idx) => ({
          index: idx + 1,
          label: this.getItemLabel(item, idx + 1),
          raw: item
        })),
        skippedPreview: [],
        errors: []
      };
      this.updateFilterPreviewUI();
      return;
    }

    const field = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
    const value = this.filterValue.trim();
    const operator = this.filterOperator || 'contains';
    const errors = [];

    if (!field) {
      errors.push('Filter field is required');
    }
    if (!value && value !== '0') {
      errors.push('Filter value is required');
    }
    if (this.availableFields.length > 0 && field && !this.availableFields.some(f => f.toLowerCase() === field.toLowerCase())) {
      errors.push(`Field "${field}" not found in discovered fields (${this.availableFields.join(', ')})`);
    }
    if (operator !== 'contains' && operator !== 'equals') {
      errors.push(`Unsupported operator "${operator}". Use "contains" or "equals".`);
    }

    if (errors.length > 0) {
      this.filterPreview = {
        totalCount,
        selectedCount: 0,
        skippedCount: 0,
        selectedPreview: [],
        skippedPreview: [],
        errors
      };
      this.updateFilterPreviewUI();
      return;
    }

    // Client-side pure evaluation across discovered items matching shared filter contract
    const selectedList = [];
    const skippedList = [];
    const normTargetVal = value.toLowerCase();

    items.forEach((item, idx) => {
      const itemIndex = idx + 1;
      const label = this.getItemLabel(item, itemIndex);
      const extracted = this.extractFieldValue(item, field);

      if (!extracted.found) {
        // Shared contract rule: configured field that cannot be read is a validation error, never a match
        skippedList.push({
          index: itemIndex,
          label,
          reason: `Field "${field}" not found on item`,
          raw: item
        });
        return;
      }

      const itemVal = String(extracted.value ?? '').trim().toLowerCase();
      let matches = false;
      let reason = '';

      if (operator === 'contains') {
        matches = itemVal.includes(normTargetVal);
        reason = matches ? 'Matches filter' : `Field "${field}" ("${extracted.value}") does not contain "${value}"`;
      } else if (operator === 'equals') {
        matches = itemVal === normTargetVal;
        reason = matches ? 'Matches filter' : `Field "${field}" ("${extracted.value}") does not equal "${value}"`;
      }

      if (matches) {
        selectedList.push({
          index: itemIndex,
          label,
          field,
          fieldValue: extracted.value,
          raw: item
        });
      } else {
        skippedList.push({
          index: itemIndex,
          label,
          field,
          fieldValue: extracted.value,
          reason,
          raw: item
        });
      }
    });

    this.filterPreview = {
      totalCount: items.length,
      selectedCount: selectedList.length,
      skippedCount: skippedList.length,
      selectedPreview: selectedList.slice(0, 5),
      skippedPreview: skippedList.slice(0, 5),
      errors: []
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

    // Check item.fields object
    if (item.fields && typeof item.fields === 'object') {
      for (const [k, v] of Object.entries(item.fields)) {
        if (k.trim().toLowerCase() === targetKey) {
          return { found: true, value: v };
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

    // If targetKey is 'text' or 'label'
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
      if (!this.filterEnabled) {
        expText.innerHTML = `⚡ <strong>No filter applied:</strong> All discovered items in the grid will be processed sequentially.`;
      } else {
        const field = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim() || 'Field';
        const op = this.filterOperator || 'contains';
        const val = this.filterValue.trim() || '...';
        expText.innerHTML = `⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(field)} ${escapeHtml(op)} "${escapeHtml(val)}"</strong> will execute. Other rows are skipped as <code>SKIPPED_FILTER</code>.`;
      }
    }

    // Update Counts Bar
    const totalEl = preflightContainer.querySelector('#prevTotalCount');
    const selEl = preflightContainer.querySelector('#prevSelectedCount');
    const skipEl = preflightContainer.querySelector('#prevSkippedCount');

    if (totalEl) totalEl.textContent = this.filterPreview.totalCount;
    if (selEl) selEl.textContent = this.filterPreview.selectedCount;
    if (skipEl) skipEl.textContent = this.filterPreview.skippedCount;

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
      const hasErrors = this.filterEnabled && Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0;
      const isZeroMatch = this.filterEnabled && this.filterPreview.selectedCount === 0;

      if (hasErrors) {
        confirmBtn.disabled = true;
        confirmBtn.title = 'Fix filter configuration error';
        if (confirmText) confirmText.textContent = 'Invalid Filter';
        return;
      }

      if (isZeroMatch) {
        confirmBtn.disabled = true;
        confirmBtn.title = 'Zero items match your filter. Filtered runs with 0 items are blocked.';
        if (confirmText) confirmText.textContent = '0 Matching Items';
        return;
      }

      const count = this.filterEnabled ? this.filterPreview.selectedCount : this.filterPreview.totalCount;
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

    // Build itemFilter payload according to shared filter contract
    let itemFilter = null;
    let rowFilter = null;

    if (isLoopMode && this.filterEnabled) {
      const field = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
      const operator = this.filterOperator || 'contains';
      const value = this.filterValue.trim();

      // Guard against zero-match or invalid filter execution
      if (!field || (!value && value !== '0') || this.filterPreview.selectedCount === 0) {
        Toast.error('Cannot execute: filter has zero matches or invalid field.');
        return;
      }

      // Agreed itemFilter contract shape
      itemFilter = {
        field,
        operator,
        value
      };

      // Legacy rowFilter shape for backward compatibility
      rowFilter = {
        column: field,
        value
      };
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (confirmText) confirmText.textContent = 'Launching…';

    const launchDesc = isLoopMode
      ? (itemFilter ? `loop (${itemFilter.field} ${itemFilter.operator} "${itemFilter.value}")` : 'batch loop (all items)')
      : 'single macro';
    Toast.info(`Starting ${launchDesc} execution…`);

    try {
      const res = await Api.executeWorkflow(this.currentWorkflowId, {
        mode: this.selectedMode,
        isLoop: isLoopMode,
        loopStepIndex: isLoopMode ? this.loopStepIndex : null,
        forceRedownload,
        itemFilter,
        rowFilter
      });

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
