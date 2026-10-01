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
  workflowSteps: [],
  fieldValues: {},
  itemMode: 'new', // 'new' | 'all' | 'old'

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

  findBestLoopStepIndex(steps) {
    if (!Array.isArray(steps) || !steps.length) return 0;
    // 1. Explicit loop candidate or sequential iteration
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s && (s.isLoopCandidate || s.isLoop || s.role === 'LOOP' || s.role === 'LOOP_TARGET' || s.loopMode === 'sequential_iteration')) {
        return i;
      }
    }
    // 2. Look for table row, grid cell, or dropdown options
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s) continue;
      const id = s.target?.fingerprint?.id || '';
      const name = (s.name || '').toLowerCase();
      const cssPath = s.target?.candidates?.find(c => c && c.strategy === 'css-path')?.value || '';
      // Skip navigation or chrome
      if (/menu-|navbar|nav-|toolbar/i.test(id) || /(^|\s|#)menu-|\bnavbar\b|\bnav-/i.test(cssPath) || /i21-menu/i.test(name)) {
        continue;
      }
      if (/table|tbody|tr|td|gridcell|x-grid-cell|mat-option|\[role="option"\]/i.test(cssPath)) {
        return i;
      }
    }
    // 3. If step 0 is navigation / menu link, skip to step 1
    if (steps.length > 1) {
      const s0 = steps[0];
      const s0Id = s0?.target?.fingerprint?.id || '';
      const s0Name = (s0?.name || '').toLowerCase();
      if (/menu/i.test(s0Id) || /menu|link/i.test(s0Name)) {
        return 1;
      }
    }
    return 0;
  },

  open({ workflowId, workflowName = 'Workflow', stepCount = 0, loopStepIndex = null, isLoop = false, steps = [], onExecuted = null }) {
    if (!this.container) this.init();

    this.currentWorkflowId = workflowId;
    this.workflowName = workflowName || 'Workflow';
    this.stepCount = stepCount || 0;
    const hasExplicitLoopStep = Number.isInteger(loopStepIndex) && loopStepIndex >= 0;
    this.workflowSteps = Array.isArray(steps) ? steps : [];
    this.loopStepIndex = hasExplicitLoopStep ? loopStepIndex : this.findBestLoopStepIndex(this.workflowSteps);
    this.isLoopConfigured = isLoop === true || hasExplicitLoopStep;
    this.selectedMode = this.isLoopConfigured ? 'loop' : 'single';
    this.fieldValues = {};
    this.itemMode = 'new';
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

    // If steps not provided, fetch them in background so step selector is populated
    if (!this.workflowSteps.length && typeof Api.getWorkflow === 'function') {
      Api.getWorkflow(this.currentWorkflowId).then(wf => {
        if (wf && Array.isArray(wf.steps) && wf.steps.length) {
          this.workflowSteps = wf.steps;
          if (!hasExplicitLoopStep) {
            const cand = this.findBestLoopStepIndex(wf.steps);
            if (cand !== this.loopStepIndex) {
              this.loopStepIndex = cand;
              if (this.selectedMode === 'loop') {
                this.runPreflight();
              }
            }
          }
          this.updateStepSelectorUI();
        }
      }).catch(() => {});
    }

    if (this.selectedMode === 'loop') {
      this.runPreflight();
    }
  },

  renderStepOptions() {
    if (!this.workflowSteps || !this.workflowSteps.length) {
      return `<option value="${this.loopStepIndex}" selected>Step #${this.loopStepIndex + 1} (Auto-detect repeating target)</option>`;
    }
    return this.workflowSteps.map((step, idx) => {
      const type = step.type || step.action || 'ACTION';
      const targetText = step.target?.fingerprint?.text || step.target?.fingerprint?.title || (typeof step.target === 'string' ? step.target : '') || step.role || '';
      const label = targetText ? `${type}: ${targetText.slice(0, 45)}` : `${type} action`;
      const isCandidate = step.isLoopCandidate || step.isLoop || step.role === 'LOOP_TARGET';
      const isSelected = idx === this.loopStepIndex;
      return `<option value="${idx}" ${isSelected ? 'selected' : ''}>
        Step #${idx + 1}: [${type}] ${escapeHtml(label)} ${isCandidate ? '⭐ (Recommended loop candidate)' : ''}
      </option>`;
    }).join('');
  },

  updateStepSelectorUI() {
    const sel = this.container?.querySelector('#selExecLoopStep');
    if (sel) {
      sel.innerHTML = this.renderStepOptions();
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

            <!-- Step 1: Where to implement loop? -->
            <div class="exec-loop-step-picker-box" style="padding:0.75rem 0.85rem; background:var(--bg-surface-secondary, rgba(0,0,0,0.02)); border-radius:6px; border:1px solid var(--border-light, #e2e8f0);">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
                <label for="selExecLoopStep" style="font-size:0.8rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
                  <span>📍 Where to implement loop?</span>
                  <span style="font-size:0.72rem; font-weight:normal; color:var(--text-sub);">(Action that repeats for each item)</span>
                </label>
                <span class="badge-tag primary" style="font-size:0.65rem;">Loop Target Step</span>
              </div>
              <select id="selExecLoopStep" class="exec-control-select" style="font-size:0.8rem; font-weight:600;">
                ${this.renderStepOptions()}
              </select>
            </div>

            <!-- Preflight Container (Mount point for Loading / Error / Preflight Review) -->
            <div id="execPreflightContainer" class="exec-preflight-container">
              ${this.renderPreflightContent()}
            </div>

            <!-- Section 3: Which data is required? (New vs Old vs All) -->
            <div class="exec-data-requirement-box" style="padding:0.75rem 0.85rem; background:var(--bg-surface-secondary, rgba(0,0,0,0.02)); border-radius:6px; border:1px solid var(--border-light, #e2e8f0);">
              <label style="font-size:0.8rem; font-weight:700; color:var(--text-main); display:block; margin-bottom:0.45rem;">
                📦 Which data is required?
              </label>
              <div class="exec-data-mode-radios" style="display:flex; flex-direction:column; gap:0.4rem;">
                <label class="exec-data-radio-label ${this.itemMode === 'new' ? 'active' : ''}">
                  <input type="radio" name="execDataModeRadio" value="new" ${this.itemMode === 'new' ? 'checked' : ''} style="accent-color:var(--brand-forest); margin-top:0.15rem;">
                  <div>
                    <strong style="font-size:0.82rem; color:var(--text-main);">New data only <span class="badge-tag success" style="font-size:0.62rem; padding:0.05rem 0.35rem;">Recommended</span></strong>
                    <span style="font-size:0.74rem; color:var(--text-sub); display:block;">Automatically skip items already downloaded or processed in prior runs</span>
                  </div>
                </label>

                <label class="exec-data-radio-label ${this.itemMode === 'all' ? 'active' : ''}">
                  <input type="radio" name="execDataModeRadio" value="all" ${this.itemMode === 'all' ? 'checked' : ''} style="accent-color:var(--brand-forest); margin-top:0.15rem;">
                  <div>
                    <strong style="font-size:0.82rem; color:var(--text-main);">All data</strong>
                    <span style="font-size:0.74rem; color:var(--text-sub); display:block;">Fetch and process all matching items, even if already downloaded</span>
                  </div>
                </label>

                <label class="exec-data-radio-label ${this.itemMode === 'old' ? 'active' : ''}">
                  <input type="radio" name="execDataModeRadio" value="old" ${this.itemMode === 'old' ? 'checked' : ''} style="accent-color:var(--brand-forest); margin-top:0.15rem;">
                  <div>
                    <strong style="font-size:0.82rem; color:var(--text-main);">Old data only</strong>
                    <span style="font-size:0.74rem; color:var(--text-sub); display:block;">Only re-download or inspect items downloaded in prior runs</span>
                  </div>
                </label>
              </div>

              <!-- Limit and pagination options -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.65rem; padding-top:0.65rem; border-top:1px solid var(--border-light, #e2e8f0);">
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                  <label for="inpExecMaxItems" style="font-size:0.75rem; font-weight:600; color:var(--text-main);">Max items: <span style="font-weight:normal; color:var(--text-sub);">(blank = all)</span></label>
                  <input type="number" id="inpExecMaxItems" class="exec-control-input" min="1" placeholder="All matching" style="font-size:0.78rem;">
                </div>
                <div style="display:flex; flex-direction:column; justify-content:center; gap:0.35rem; margin-top:0.4rem;">
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <input type="checkbox" id="chkExecPaginate" style="accent-color:var(--brand-forest); cursor:pointer;">
                    <label for="chkExecPaginate" style="font-size:0.76rem; color:var(--text-body); cursor:pointer; user-select:none;">Go through all pages?</label>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <input type="checkbox" id="chkExecForceRedownload" style="accent-color:var(--brand-forest); cursor:pointer;">
                    <label for="chkExecForceRedownload" style="font-size:0.76rem; color:var(--text-body); cursor:pointer; user-select:none;">Force re-download</label>
                  </div>
                </div>
              </div>
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
      const detectedValues = this.getValuesForField(currentField);
      const isDateField = this.isDateField(currentField, detectedValues);

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
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:0.72rem; color:var(--text-sub);">${this.discoveryData?.source === 'recorded' ? 'Recorded snapshot' : 'Live discovery'}</span>
              <button type="button" class="btn btn-secondary btn-sm" id="btnRefreshLoopData" style="font-size:0.7rem; padding:0.25rem 0.6rem;" title="Visit the portal and capture the latest items and fields">↻ Refresh data</button>
            </div>
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

            <!-- Section 2a: Which column or field to fetch? -->
            <div style="display:flex; flex-direction:column; gap:0.25rem;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <label style="font-size:0.75rem; font-weight:700; color:var(--text-main);">
                  📋 Which column or field to fetch / filter on?
                </label>
                <span style="font-size:0.68rem; color:var(--text-sub);">${this.availableFields.length} detected</span>
              </div>
              ${hasFields ? `
                <div class="exec-pill-group" id="execFieldPills">
                  ${this.availableFields.map(f => `
                    <button type="button" class="exec-pill exec-pill-field ${f.toLowerCase() === currentField.toLowerCase() ? 'active' : ''}" data-field="${escapeHtml(f)}">
                      ${escapeHtml(f)}
                    </button>
                  `).join('')}
                  <button type="button" class="exec-pill exec-pill-field ${this.filterField === '__custom__' ? 'active' : ''}" data-field="__custom__">
                    Custom…
                  </button>
                </div>
              ` : ''}
            </div>

            <!-- Section 2b: Smart Date & Lifecycle Logic (When Date field detected) -->
            ${isDateField ? `
              <div class="exec-smart-date-box" style="margin-top:0.15rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
                  <span style="font-size:0.75rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.35rem;">
                    <span>📅 Smart Date &amp; Lifecycle Logic for &ldquo;${escapeHtml(currentField)}&rdquo;:</span>
                  </span>
                  <span style="font-size:0.68rem; color:var(--brand-forest); font-weight:700;">Live Runtime Filtering</span>
                </div>
                <div class="exec-pill-group" id="execSmartDatePills">
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.filterEnabled && this.filterOperator === '<=' && (this.filterValue === 'today' || this.isTodayValue(this.filterValue)) ? 'active' : ''}" data-action="overdue" title="Due date has passed (Due Date <= Today)">
                    🔴 Overdue (Due date is over)
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.filterEnabled && this.filterOperator === '>=' && (this.filterValue === 'today' || this.isTodayValue(this.filterValue)) ? 'active' : ''}" data-action="upcoming" title="Due date has not arrived yet (Due Date >= Today)">
                    🟢 Upcoming (Due date not met)
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.itemMode === 'old' ? 'active' : ''}" data-action="in_folder" title="Process only items already downloaded in folder">
                    📁 Already in Folder (${this.getDownloadedCount()})
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.itemMode === 'new' ? 'active' : ''}" data-action="not_in_folder" title="Skip items already in folder, process new only">
                    ✨ New (Not in folder)
                  </button>
                </div>
              </div>
            ` : ''}

            <!-- Section 2c: Which value or option to fetch? -->
            ${detectedValues.length > 0 ? `
              <div style="display:flex; flex-direction:column; gap:0.25rem; margin-top:0.15rem;">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub);">
                    🔍 Detected Options for &ldquo;${escapeHtml(currentField)}&rdquo;:
                  </span>
                  <span style="font-size:0.68rem; color:var(--text-sub);">${detectedValues.length} option(s)</span>
                </div>
                <div class="exec-pill-group" id="execValuePills">
                  ${detectedValues.map(v => `
                    <button type="button" class="exec-pill exec-pill-val ${this.filterEnabled && this.filterValue.toLowerCase() === v.toLowerCase() ? 'active' : ''}" data-value="${escapeHtml(v)}" title="Filter by '${escapeHtml(v)}'">
                      ${escapeHtml(v)}
                    </button>
                  `).join('')}
                  <button type="button" class="exec-pill exec-pill-val ${!this.filterEnabled ? 'active' : ''}" data-value="__all__" title="Fetch all without filtering">
                    Fetch All
                  </button>
                </div>
                ${isDateField && this.filterEnabled && this.filterValue && this.filterValue !== 'today' && this.isDateString(this.filterValue) ? `
                  <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.4rem; padding:0.35rem 0.6rem; background:rgba(0,0,0,0.03); border-radius:6px; font-size:0.72rem; margin-top:0.25rem;">
                    <span style="color:var(--text-sub); font-weight:700;">Condition for &ldquo;${escapeHtml(this.filterValue)}&rdquo;:</span>
                    <button type="button" class="exec-pill exec-pill-date-op ${this.filterOperator === '<=' ? 'active' : ''}" data-op="<=" title="Due date is on or before ${escapeHtml(this.filterValue)} (Due date is over)">
                      📅 Due date is over (&le; ${escapeHtml(this.filterValue)})
                    </button>
                    <button type="button" class="exec-pill exec-pill-date-op ${this.filterOperator === '>=' ? 'active' : ''}" data-op=">=" title="Due date not met / on or after ${escapeHtml(this.filterValue)}">
                      📅 Due date not met (&ge; ${escapeHtml(this.filterValue)})
                    </button>
                    <button type="button" class="exec-pill exec-pill-date-op ${this.filterOperator === 'equals' ? 'active' : ''}" data-op="equals" title="Exact match on ${escapeHtml(this.filterValue)}">
                      🎯 Exact (= ${escapeHtml(this.filterValue)})
                    </button>
                  </div>
                ` : ''}
              </div>
            ` : ''}

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
                  <option value="<=" ${this.filterOperator === '<=' ? 'selected' : ''}>&lt;= (Due date is over / on or before)</option>
                  <option value=">=" ${this.filterOperator === '>=' ? 'selected' : ''}>&gt;= (Due date not met / on or after)</option>
                  <option value="<" ${this.filterOperator === '<' ? 'selected' : ''}>&lt; (before or &lt;)</option>
                  <option value=">" ${this.filterOperator === '>' ? 'selected' : ''}>&gt; (after or &gt;)</option>
                </select>
              </div>

              <!-- Value Input -->
              <div class="exec-field-group">
                <label for="execFilterValueInput">Match Value</label>
                <input type="text" id="execFilterValueInput" class="exec-control-input" value="${escapeHtml(this.filterValue)}" placeholder="e.g. Invoice, today, 9/12/2026">
              </div>
            </div>

            <!-- Custom field name input if '__custom__' selected with available fields -->
            <div id="execCustomFieldContainer" style="display:${this.filterField === '__custom__' ? 'flex' : 'none'}; flex-direction:column; gap:0.25rem;">
              <label for="execFilterCustomFieldInput" style="font-size:0.7rem; font-weight:700; color:var(--text-sub);">Custom Column / Field Name</label>
              <input type="text" id="execFilterCustomFieldInput" class="exec-control-input" value="${escapeHtml(this.customFieldName)}" placeholder="Enter exact column name...">
            </div>

            <!-- Explanatory rule text -->
            <p class="exec-filter-rule-explainer" id="execFilterExplanation">
              ${this.renderFilterExplanation(currentField, isDateField)}
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
        <div class="exec-alert-banner error" role="alert" style="overflow-wrap:anywhere; word-break:break-word; max-height:160px; overflow-y:auto;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div style="flex:1; min-width:0; overflow-wrap:anywhere; word-break:break-word;">
            <strong>Filter Configuration Error:</strong>
            <div style="margin-top:0.15rem; font-size:0.75rem; line-height:1.4;">${this.filterPreview.errors.slice(0, 3).map(e => escapeHtml(e)).join(' · ')}</div>
          </div>
        </div>
      `;
    }

    if (this.filterEnabled && this.filterPreview.totalCount > 0 && this.filterPreview.selectedCount === 0) {
      const hasDownloadedMatches = Array.isArray(this.filterPreview.skippedPreview) &&
        this.filterPreview.skippedPreview.some(s => s.reason && s.reason.includes('Already downloaded'));

      if (hasDownloadedMatches) {
        return `
          <div class="exec-alert-banner warning" role="alert" style="overflow-wrap:anywhere; word-break:break-word;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <div style="flex:1;">
              <strong>Item Already Downloaded in Previous Run:</strong>
              <p style="margin:0.15rem 0 0.4rem; font-size:0.75rem;">The selected item was already downloaded. To process it again, enable Force Re-download or switch to All Data.</p>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.35rem;">
                <button type="button" class="btn btn-secondary btn-sm" id="btnBannerForceRedownload" style="font-size:0.72rem; padding:0.25rem 0.65rem;">
                  ⚡ Force Re-download
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="btnBannerAllData" style="font-size:0.72rem; padding:0.25rem 0.65rem;">
                  📦 Switch to All Data
                </button>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="exec-alert-banner warning" role="alert" style="overflow-wrap:anywhere; word-break:break-word;">
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

    // Step Selector: Where to implement loop?
    const loopStepSelect = this.container.querySelector('#selExecLoopStep');
    if (loopStepSelect) {
      loopStepSelect.onchange = () => {
        const newIdx = parseInt(loopStepSelect.value, 10);
        if (Number.isInteger(newIdx) && newIdx >= 0) {
          this.loopStepIndex = newIdx;
          this.runPreflight();
        }
      };
    }

    // Data Requirement Mode Radios (New vs All vs Old)
    const dataModeRadios = this.container.querySelectorAll('input[name="execDataModeRadio"]');
    dataModeRadios.forEach(radio => {
      radio.onchange = () => {
        this.itemMode = radio.value;
        const labels = this.container.querySelectorAll('.exec-data-radio-label');
        labels.forEach(lbl => {
          const r = lbl.querySelector('input[type="radio"]');
          if (r && r.value === this.itemMode) {
            lbl.classList.add('active');
          } else {
            lbl.classList.remove('active');
          }
        });
        this.evaluateFilterPreview();
      };
    });

    // Force Redownload Checkbox
    const chkRedownload = this.container.querySelector('#chkExecForceRedownload');
    if (chkRedownload) {
      chkRedownload.onchange = () => {
        this.forceRedownload = !!chkRedownload.checked;
        this.evaluateFilterPreview();
      };
    }

    this.bindPreflightEvents();

    if (confirmBtn) {
      confirmBtn.onclick = () => this.execute();
    }
  },

  bindPreflightEvents() {
    const preflightContainer = this.container.querySelector('#execPreflightContainer');
    if (!preflightContainer) return;

    // Explicit refresh: this is the only action that intentionally revisits the portal.
    const btnRefresh = preflightContainer.querySelector('#btnRefreshLoopData');
    if (btnRefresh) btnRefresh.onclick = () => this.runPreflight(true);

    // Retry button if preflight errored
    const btnRetry = preflightContainer.querySelector('#btnRetryPreflight');
    if (btnRetry) {
      btnRetry.onclick = () => this.runPreflight();
    }

    const btnStartCheck = preflightContainer.querySelector('#btnStartPreflightCheck');
    if (btnStartCheck) {
      btnStartCheck.onclick = () => this.runPreflight();
    }

    // Action buttons inside downloaded-item warning banner
    const btnBannerForce = preflightContainer.querySelector('#btnBannerForceRedownload');
    if (btnBannerForce) {
      btnBannerForce.onclick = () => {
        this.forceRedownload = true;
        const chk = this.container.querySelector('#chkExecForceRedownload');
        if (chk) chk.checked = true;
        this.evaluateFilterPreview();
      };
    }

    const btnBannerAll = preflightContainer.querySelector('#btnBannerAllData');
    if (btnBannerAll) {
      btnBannerAll.onclick = () => {
        this.itemMode = 'all';
        const radio = this.container.querySelector('input[name="execDataModeRadio"][value="all"]');
        if (radio) {
          radio.checked = true;
          const labels = this.container.querySelectorAll('.exec-data-radio-label');
          labels.forEach(lbl => {
            const r = lbl.querySelector('input[type="radio"]');
            lbl.classList.toggle('active', r && r.value === 'all');
          });
        }
        this.evaluateFilterPreview();
      };
    }

    // Interactive Column / Field Pills
    const fieldPills = preflightContainer.querySelectorAll('.exec-pill-field');
    fieldPills.forEach(pill => {
      pill.onclick = () => {
        const fieldName = pill.dataset.field;
        this.filterField = fieldName;
        const customWrapper = preflightContainer.querySelector('#execCustomFieldContainer');
        const customInput = preflightContainer.querySelector('#execFilterCustomFieldInput');
        if (fieldName === '__custom__') {
          if (customWrapper) customWrapper.style.display = 'flex';
          this.customFieldName = customInput?.value.trim() || '';
        } else {
          if (customWrapper) customWrapper.style.display = 'none';
        }

        const activeFieldName = fieldName === '__custom__' ? this.customFieldName : fieldName;
        const values = this.getValuesForField(activeFieldName);
        if (values && values.length > 0) {
          this.filterValue = values[0];
          this.filterEnabled = true;
        }

        if (this.discoveryData) {
          this.discoveryData.filterPreview = null;
        }

        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
        this.evaluateFilterPreview();
      };
    });

    // Smart Date & Lifecycle Logic Pills
    const smartDatePills = preflightContainer.querySelectorAll('.exec-pill-smart-date');
    smartDatePills.forEach(pill => {
      pill.onclick = () => {
        const action = pill.dataset.action;
        const hasFields = this.availableFields.length > 0;
        const isCustomField = this.filterField === '__custom__' || (!hasFields && !!this.filterField);
        const currentField = isCustomField ? (this.customFieldName || this.filterField || 'Type') : (this.filterField || 'Type');

        if (action === 'overdue') {
          this.filterEnabled = true;
          this.filterField = currentField;
          this.filterOperator = '<=';
          this.filterValue = 'today';
        } else if (action === 'upcoming') {
          this.filterEnabled = true;
          this.filterField = currentField;
          this.filterOperator = '>=';
          this.filterValue = 'today';
        } else if (action === 'in_folder') {
          this.itemMode = 'old';
          const r = this.container.querySelector('input[name="execDataModeRadio"][value="old"]');
          if (r) r.checked = true;
          this.updateDataModeStyles();
        } else if (action === 'not_in_folder') {
          this.itemMode = 'new';
          const r = this.container.querySelector('input[name="execDataModeRadio"][value="new"]');
          if (r) r.checked = true;
          this.updateDataModeStyles();
        }

        if (this.discoveryData) {
          this.discoveryData.filterPreview = null;
        }

        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
        this.evaluateFilterPreview();
      };
    });

    // Quick Date Operator Pills (<=, >=, equals)
    const dateOpPills = preflightContainer.querySelectorAll('.exec-pill-date-op');
    dateOpPills.forEach(pill => {
      pill.onclick = () => {
        this.filterOperator = pill.dataset.op;
        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
        this.evaluateFilterPreview();
      };
    });

    // Interactive Option / Value Pills
    const valPills = preflightContainer.querySelectorAll('.exec-pill-val');
    valPills.forEach(pill => {
      pill.onclick = () => {
        const val = pill.dataset.value;
        if (val === '__all__') {
          this.filterEnabled = false;
        } else {
          this.filterEnabled = true;
          this.filterValue = val;
          const hasFields = this.availableFields.length > 0;
          const isCustomField = this.filterField === '__custom__' || (!hasFields && !!this.filterField);
          const currentField = isCustomField ? (this.customFieldName || this.filterField || 'Type') : (this.filterField || 'Type');
          const isDate = this.isDateField(currentField, this.getValuesForField(currentField));
          if (isDate && (this.filterOperator === 'contains' || !this.filterOperator)) {
            this.filterOperator = '<=';
          }
          // If specific clicked item is already downloaded and itemMode is 'new', auto-enable forceRedownload
          const items = Array.isArray(this.discoveryData?.discovery?.items) ? this.discoveryData.discovery.items : [];
          const activeField = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
          const targetItem = items.find(it => {
            const ext = this.extractFieldValue(it, activeField);
            return ext.found && String(ext.value).toLowerCase() === val.toLowerCase();
          });
          if (targetItem?.isDownloaded && this.itemMode === 'new') {
            this.forceRedownload = true;
            const chk = this.container.querySelector('#chkExecForceRedownload');
            if (chk) chk.checked = true;
          }
        }

        if (this.discoveryData) {
          this.discoveryData.filterPreview = null;
        }

        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
        this.evaluateFilterPreview();
      };
    });

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
        if (this.discoveryData) {
          this.discoveryData.filterPreview = null;
        }
        if (this.filterField === '__custom__') {
          if (customFieldWrapper) customFieldWrapper.style.display = 'flex';
          this.customFieldName = customFieldInput?.value.trim() || '';
        } else {
          if (customFieldWrapper) customFieldWrapper.style.display = 'none';
        }
        const activeFieldName = this.filterField === '__custom__' ? this.customFieldName : this.filterField;
        const values = this.getValuesForField(activeFieldName);
        if (values && values.length > 0) {
          this.filterValue = values[0];
          this.filterEnabled = true;
        }
        preflightContainer.innerHTML = this.renderPreflightContent();
        this.bindPreflightEvents();
        this.evaluateFilterPreview();
      };
    }

    if (customFieldInput) {
      customFieldInput.oninput = () => {
        this.customFieldName = customFieldInput.value;
        if (this.discoveryData) this.discoveryData.filterPreview = null;
        this.evaluateFilterPreview();
      };
    }

    if (standaloneCustomField) {
      standaloneCustomField.oninput = () => {
        this.filterField = standaloneCustomField.value;
        if (this.discoveryData) this.discoveryData.filterPreview = null;
        this.evaluateFilterPreview();
      };
    }

    // Operator Selector
    const operatorSelect = preflightContainer.querySelector('#execFilterOperatorSelect');
    if (operatorSelect) {
      operatorSelect.onchange = () => {
        this.filterOperator = operatorSelect.value;
        if (this.discoveryData) this.discoveryData.filterPreview = null;
        this.evaluateFilterPreview();
      };
    }

    // Value Input
    const valInput = preflightContainer.querySelector('#execFilterValueInput');
    if (valInput) {
      valInput.oninput = () => {
        this.filterValue = valInput.value;
        if (this.discoveryData) this.discoveryData.filterPreview = null;
        const pills = preflightContainer.querySelectorAll('.exec-pill-val');
        pills.forEach(p => {
          const pVal = p.dataset.value;
          if (pVal !== '__all__') {
            p.classList.toggle('active', pVal.toLowerCase() === this.filterValue.trim().toLowerCase());
          }
        });
        this.evaluateFilterPreview();
      };
    }
  },

  async runPreflight(forceRefresh = false) {
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

      const requestedField = itemFilterPayload ? itemFilterPayload.field : null;
      const fieldBeforeDiscovery = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();

      let data;
      if (!forceRefresh) {
        // Normal preflight reads the recorded snapshot. This does not open Chrome.
        try {
          data = await Api.getLoopData(this.currentWorkflowId, {
            field: itemFilterPayload?.field,
            operator: itemFilterPayload?.operator,
            value: itemFilterPayload?.value
          });
        } catch (savedErr) {
          // Upgrade older workflows without snapshots through one live discovery.
          if (typeof Api.discoverWorkflow !== 'function') throw savedErr;
          data = await Api.discoverWorkflow(this.currentWorkflowId, {
            loopStepIndex: this.loopStepIndex,
            itemFilter: itemFilterPayload,
            refresh: true
          });
        }
      } else {
        // Explicit Refresh is the only normal path that revisits the portal.
        if (typeof Api.discoverWorkflow !== 'function') {
          throw new Error('Live refresh is unavailable');
        }
        data = await Api.discoverWorkflow(this.currentWorkflowId, {
          loopStepIndex: this.loopStepIndex,
          itemFilter: itemFilterPayload,
          refresh: true
        });
      }

      this.preflightStatus = 'success';
      this.discoveryData = data;
      this.availableFields = this.extractAvailableFields(data);
      this.fieldValues = (data.fieldValues && Object.keys(data.fieldValues).length > 0)
        ? data.fieldValues
        : this.extractFieldValues(data);

      if (Array.isArray(data.steps) && data.steps.length) {
        this.workflowSteps = data.steps;
        this.updateStepSelectorUI();
      }

      // If filterField is not set or not in availableFields, pick the best discovered field
      if (this.availableFields.length > 0) {
        const hasField = this.availableFields.some(f => f.toLowerCase() === (this.filterField || '').toLowerCase());
        if (!hasField || !this.filterField) {
          const hasType = this.availableFields.some(f => f.toLowerCase() === 'type');
          const hasInv = this.availableFields.find(f => f.toLowerCase().includes('invoice'));
          this.filterField = hasType ? 'Type' : (hasInv || this.availableFields[0]);
        }
      }

      const activeField = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
      const detectedVals = this.getValuesForField(activeField);
      if (detectedVals && detectedVals.length > 0) {
        const hasCurrentVal = detectedVals.some(v => v.toLowerCase() === (this.filterValue || '').toLowerCase());
        if (!hasCurrentVal || !this.filterValue) {
          const hasInvoice = detectedVals.some(v => v.toLowerCase() === 'invoice');
          this.filterValue = hasInvoice ? 'Invoice' : detectedVals[0];
        }
      }

      // Check if server returned a filterPreview that matches the currently selected field and filter
      const serverPreview = data.filterPreview;
      const serverField = (serverPreview?.field || serverPreview?.itemFilter?.field || '').trim();
      const isFieldUnchanged = fieldBeforeDiscovery && activeField.toLowerCase() === fieldBeforeDiscovery.toLowerCase();
      const isServerFieldMatching = !serverField || serverField.toLowerCase() === activeField.toLowerCase();
      const isRequestedFieldMatching = !requestedField || requestedField.toLowerCase() === activeField.toLowerCase();

      const canUseServerPreview = serverPreview &&
        typeof serverPreview.selectedCount === 'number' &&
        this.filterEnabled &&
        isFieldUnchanged &&
        isServerFieldMatching &&
        isRequestedFieldMatching;

      if (canUseServerPreview) {
        this.filterPreview = {
          totalCount: Number(serverPreview.totalCount ?? data.discovery?.itemCount ?? 0),
          selectedCount: Number(serverPreview.selectedCount ?? 0),
          skippedCount: Number(serverPreview.skippedCount ?? 0),
          selectedPreview: Array.isArray(serverPreview.selectedPreview) ? serverPreview.selectedPreview : [],
          skippedPreview: Array.isArray(serverPreview.skippedPreview) ? serverPreview.skippedPreview : [],
          errors: Array.isArray(serverPreview.errors) ? serverPreview.errors : []
        };
      } else {
        // Discard stale or mismatched server preview; evaluate client-side for the current field and filter
        if (data.filterPreview) {
          data.filterPreview = null;
        }
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

    if (data.pageSummary && Array.isArray(data.pageSummary.entities)) {
      data.pageSummary.entities.forEach(entity => {
        if (Array.isArray(entity.columns)) {
          entity.columns.forEach(c => c && fields.add(String(c).trim()));
        }
      });
    }

    const items = Array.isArray(data.discovery?.items) ? data.discovery.items : [];
    items.forEach(item => {
      if (item && item.fields && typeof item.fields === 'object') {
        Object.keys(item.fields).forEach(k => k && fields.add(k.trim()));
      } else if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => {
          const lower = k.toLowerCase();
          if (!['index', 'text', 'id', 'element', 'selector', 'target', 'fingerprint', 'itemkey', 'itemlabel', 'tagname', 'hascheckbox', 'childrencount'].includes(lower)) {
            fields.add(k.trim());
          }
        });
      }
    });

    return Array.from(fields);
  },

  extractFieldValues(data) {
    if (data.fieldValues && typeof data.fieldValues === 'object' && Object.keys(data.fieldValues).length > 0) {
      return data.fieldValues;
    }
    const fieldValues = {};
    const items = Array.isArray(data.discovery?.items) ? data.discovery.items : [];
    items.forEach(item => {
      if (item && item.fields && typeof item.fields === 'object') {
        Object.entries(item.fields).forEach(([k, v]) => {
          if (v == null || v === '') return;
          const key = String(k).trim();
          const val = String(v).trim();
          if (!fieldValues[key]) fieldValues[key] = new Set();
          fieldValues[key].add(val);
        });
      }
      if (item && item.text) {
        const textVal = String(item.text).trim();
        if (textVal) {
          if (!fieldValues['Text']) fieldValues['Text'] = new Set();
          fieldValues['Text'].add(textVal);
        }
      }
    });
    const result = {};
    Object.entries(fieldValues).forEach(([k, vSet]) => {
      result[k] = Array.from(vSet).slice(0, 30);
    });
    return result;
  },

  getValuesForField(fieldName) {
    if (!fieldName) return [];
    const norm = String(fieldName).trim().toLowerCase();
    for (const [k, vals] of Object.entries(this.fieldValues || {})) {
      if (String(k).trim().toLowerCase() === norm && Array.isArray(vals)) {
        return vals;
      }
    }
    // Fallback: extract directly from discovered items
    const items = Array.isArray(this.discoveryData?.discovery?.items) ? this.discoveryData.discovery.items : [];
    const foundVals = new Set();
    items.forEach(item => {
      const extracted = this.extractFieldValue(item, fieldName);
      if (extracted.found && extracted.value != null && extracted.value !== '') {
        foundVals.add(String(extracted.value).trim());
      }
    });
    return Array.from(foundVals).slice(0, 30);
  },

  isDateField(fieldName, sampleValues = []) {
    if (!fieldName) return false;
    const name = String(fieldName).toLowerCase().trim();
    if (name.includes('date') || name.includes('due') || name.includes('created') || name.includes('posted') || name.includes('time') || name.includes('expire')) {
      return true;
    }
    if (Array.isArray(sampleValues) && sampleValues.length > 0) {
      const dateCount = sampleValues.filter(v => this.isDateString(v)).length;
      return dateCount >= Math.min(2, sampleValues.length);
    }
    return false;
  },

  isDateString(val) {
    if (val instanceof Date) return true;
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim().toLowerCase();
    if (trimmed === 'today' || trimmed === 'now' || trimmed === 'yesterday' || trimmed === 'tomorrow') return true;
    if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return false;
    if (!/[/\-.]|[a-zA-Z]/.test(trimmed)) return false;
    const parsed = Date.parse(trimmed);
    return !isNaN(parsed);
  },

  isTodayValue(val) {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim().toLowerCase();
    if (trimmed === 'today' || trimmed === 'now') return true;
    const d = new Date(Date.parse(trimmed));
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  },

  getDownloadedCount() {
    const items = Array.isArray(this.discoveryData?.discovery?.items) ? this.discoveryData.discovery.items : [];
    return items.filter(it => it.isDownloaded).length;
  },

  renderFilterExplanation(currentField, isDateField) {
    if (!this.filterEnabled) {
      return `⚡ All discovered items will be processed sequentially (no filter).`;
    }
    const op = this.filterOperator;
    const val = this.filterValue;
    if (isDateField) {
      if (op === '<=') {
        const desc = val === 'today' ? 'today (due date is over)' : `"${val}" (due date is over / on or before)`;
        return `⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(currentField)} &le; ${escapeHtml(desc)}</strong> will execute. Other rows are skipped as <code>SKIPPED_FILTER</code>.`;
      }
      if (op === '>=') {
        const desc = val === 'today' ? 'today (due date not met / upcoming)' : `"${val}" (due date not met / on or after)`;
        return `⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(currentField)} &ge; ${escapeHtml(desc)}</strong> will execute. Other rows are skipped as <code>SKIPPED_FILTER</code>.`;
      }
    }
    return `⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(currentField)} ${escapeHtml(this.filterOperator)} "${escapeHtml(this.filterValue)}"</strong> will execute. Other rows are skipped as <code>SKIPPED_FILTER</code>.`;
  },

  updateDataModeStyles() {
    const labels = this.container?.querySelectorAll('.exec-data-radio-label') || [];
    labels.forEach(lbl => {
      const r = lbl.querySelector('input[type="radio"]');
      if (r && r.value === this.itemMode) {
        lbl.classList.add('active');
      } else {
        lbl.classList.remove('active');
      }
    });
  },

  evaluateFilterPreview() {
    const discovery = this.discoveryData?.discovery || {};
    const items = Array.isArray(discovery.items) ? discovery.items : [];
    const totalCount = Number(discovery.itemCount ?? items.length);

    if (!this.filterEnabled) {
      const selectedList = [];
      const skippedList = [];

      items.forEach((item, idx) => {
        const itemIndex = idx + 1;
        const label = this.getItemLabel(item, itemIndex);
        let matches = true;
        let reason = '';

        if (this.itemMode === 'new' && item.isDownloaded && !this.forceRedownload) {
          matches = false;
          reason = `Already downloaded in folder (${item.downloadedFile || 'file'})`;
        } else if (this.itemMode === 'old' && !item.isDownloaded && !item.isOldData) {
          matches = false;
          reason = 'New item (mode is "Old data only")';
        }

        if (matches) {
          selectedList.push({
            index: itemIndex,
            label,
            raw: item
          });
        } else {
          skippedList.push({
            index: itemIndex,
            label,
            reason,
            raw: item
          });
        }
      });

      this.filterPreview = {
        totalCount: items.length || totalCount,
        selectedCount: selectedList.length,
        skippedCount: skippedList.length,
        selectedPreview: selectedList.slice(0, 5),
        skippedPreview: skippedList.slice(0, 5),
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
    const validOps = ['contains', 'equals', '<=', '>=', '<', '>', 'before', 'after', 'starts_with', 'ends_with'];
    if (!validOps.includes(operator)) {
      errors.push(`Unsupported operator "${operator}". Use contains, equals, <=, >=, <, or >.`);
    }

    if (errors.length > 0) {
      this.filterPreview = {
        totalCount: items.length || totalCount,
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

    // Check if at least one item provides the configured field
    const anyItemHasField = items.some(it => this.extractFieldValue(it, field).found);
    if (items.length > 0 && !anyItemHasField) {
      errors.push(`Configured field "${field}" was not found on any discovered items.`);
    }

    items.forEach((item, idx) => {
      const itemIndex = idx + 1;
      const label = this.getItemLabel(item, itemIndex);
      const extracted = this.extractFieldValue(item, field);

      if (!extracted.found) {
        // Individual item lacking the configured field (e.g. summary or footer row) simply does not match
        skippedList.push({
          index: itemIndex,
          label,
          field,
          fieldValue: undefined,
          reason: `Field "${field}" not found on item`,
          raw: item
        });
        return;
      }

      const itemVal = String(extracted.value ?? '').trim().toLowerCase();
      let matches = false;
      let reason = '';

      const isDateOrNumOp = ['<=', '>=', '<', '>', 'before', 'after'].includes(operator);
      if (isDateOrNumOp) {
        let isDateComp = false;
        let itemDate = null;
        let targetDate = null;

        if (this.isDateString(extracted.value) || this.isDateString(value)) {
          const rawItem = Date.parse(extracted.value);
          if (!isNaN(rawItem)) {
            itemDate = new Date(rawItem);
            if (value.toLowerCase() === 'today' || value.toLowerCase() === 'now') {
              targetDate = new Date();
            } else if (value.toLowerCase() === 'yesterday') {
              targetDate = new Date();
              targetDate.setDate(targetDate.getDate() - 1);
            } else if (value.toLowerCase() === 'tomorrow') {
              targetDate = new Date();
              targetDate.setDate(targetDate.getDate() + 1);
            } else {
              const rawTarget = Date.parse(value);
              if (!isNaN(rawTarget)) targetDate = new Date(rawTarget);
            }
            if (itemDate && targetDate) {
              isDateComp = true;
            }
          }
        }

        if (isDateComp) {
          if (operator === '<' || operator === 'before') {
            targetDate.setHours(0, 0, 0, 0);
            itemDate.setHours(0, 0, 0, 0);
            matches = itemDate.getTime() < targetDate.getTime();
          } else if (operator === '<=') {
            targetDate.setHours(23, 59, 59, 999);
            itemDate.setHours(23, 59, 59, 999);
            matches = itemDate.getTime() <= targetDate.getTime();
          } else if (operator === '>' || operator === 'after') {
            targetDate.setHours(23, 59, 59, 999);
            itemDate.setHours(23, 59, 59, 999);
            matches = itemDate.getTime() > targetDate.getTime();
          } else if (operator === '>=') {
            targetDate.setHours(0, 0, 0, 0);
            itemDate.setHours(0, 0, 0, 0);
            matches = itemDate.getTime() >= targetDate.getTime();
          }
          reason = matches ? 'Matches date filter' : `Date "${extracted.value}" does not satisfy ${operator} "${value}"`;
        } else {
          const itemNum = parseFloat(String(extracted.value).replace(/[^0-9.-]/g, ''));
          const targetNum = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
          if (!isNaN(itemNum) && !isNaN(targetNum)) {
            if (operator === '<') matches = itemNum < targetNum;
            else if (operator === '<=') matches = itemNum <= targetNum;
            else if (operator === '>') matches = itemNum > targetNum;
            else if (operator === '>=') matches = itemNum >= targetNum;
            reason = matches ? 'Matches numeric filter' : `Value "${extracted.value}" does not satisfy ${operator} "${value}"`;
          } else {
            matches = itemVal === normTargetVal;
            reason = matches ? 'Matches filter' : `Cannot compare "${extracted.value}" with "${value}"`;
          }
        }
      } else if (operator === 'contains') {
        matches = itemVal.includes(normTargetVal);
        reason = matches ? 'Matches filter' : `Field "${field}" ("${extracted.value}") does not contain "${value}"`;
      } else if (operator === 'equals') {
        matches = itemVal === normTargetVal;
        reason = matches ? 'Matches filter' : `Field "${field}" ("${extracted.value}") does not equal "${value}"`;
      }

      // Check itemMode requirement (New data only vs Old data only)
      if (matches) {
        if (this.itemMode === 'new' && item.isDownloaded && !this.forceRedownload) {
          matches = false;
          reason = `Already downloaded in folder (${item.downloadedFile || 'file'})`;
        } else if (this.itemMode === 'old' && !item.isDownloaded && !item.isOldData) {
          matches = false;
          reason = 'New item (mode is "Old data only")';
        }
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
      totalCount: items.length || totalCount,
      selectedCount: errors.length > 0 ? 0 : selectedList.length,
      skippedCount: skippedList.length,
      selectedPreview: errors.length > 0 ? [] : selectedList.slice(0, 5),
      skippedPreview: skippedList.slice(0, 5),
      errors
    };

    this.updateFilterPreviewUI();
  },

  getItemLabel(item, fallbackIndex = 1) {
    if (!item) return `Item #${fallbackIndex}`;
    let label = '';
    // First, check for clean key identifying fields
    if (item.fields && typeof item.fields === 'object') {
      const idFields = ['Invoice Number', 'Invoice No', 'Type', 'Option', 'Document Type', 'Status', 'Due Date', 'Customer Name', 'Label'];
      const picked = [];
      for (const k of idFields) {
        if (item.fields[k] && typeof item.fields[k] === 'string' && item.fields[k].length < 40) {
          picked.push(item.fields[k]);
        }
      }
      if (picked.length > 0) {
        label = picked.slice(0, 3).join(' · ');
      }
    }
    if (!label) {
      const raw = typeof item === 'string' ? item : (item.label || item.text || item.id || `Item #${fallbackIndex}`);
      const clean = String(raw).replace(/\s+/g, ' ').trim();
      label = clean.length > 60 ? clean.slice(0, 57) + '…' : (clean || `Item #${fallbackIndex}`);
    }

    if (item.isDownloaded) {
      label += ' 📁(In Folder)';
    }
    return label;
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

    // Fallback derivation for Document Type
    if ((targetKey === 'type' || targetKey === 'document type') && item.text) {
      if (/\bcredit\s*memo\b/i.test(item.text)) return { found: true, value: 'Credit Memo' };
      if (/\binvoice\b/i.test(item.text)) return { found: true, value: 'Invoice' };
      if (/\border\b/i.test(item.text)) return { found: true, value: 'Order' };
      if (/\bstatement\b/i.test(item.text)) return { found: true, value: 'Statement' };
    }

    // Fallback derivation for Invoice / Record Number
    if ((targetKey === 'invoice number' || targetKey === 'invoice no' || targetKey === 'invoice') && item.text) {
      const match = item.text.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
      if (match) return { found: true, value: match[1] };
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
      if (confirmText) confirmText.textContent = 'Continue (Single Macro Replay)';
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
        confirmBtn.title = 'Fix filter configuration error: ' + (this.filterPreview.errors[0] || '');
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
      confirmBtn.title = `Continue and execute loop on ${count} item${count === 1 ? '' : 's'}`;
      if (confirmText) {
        confirmText.textContent = `Continue (Execute Loop on ${count} item${count === 1 ? '' : 's'})`;
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

    // Execution options
    const itemMode = this.itemMode || 'new';
    const maxItemsRaw = parseInt(this.container.querySelector('#inpExecMaxItems')?.value, 10);
    const maxItems = Number.isInteger(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : null;
    const chkPaginate = this.container.querySelector('#chkExecPaginate');
    const paginate = chkPaginate ? !!chkPaginate.checked : undefined;

    // Build itemFilter payload according to shared filter contract
    let itemFilter = null;
    let rowFilter = null;

    if (isLoopMode && this.filterEnabled) {
      const field = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
      const operator = this.filterOperator || 'contains';
      const value = this.filterValue.trim();

      // Guard against zero-match or invalid filter execution
      if (!field || (!value && value !== '0') || this.filterPreview.selectedCount === 0 || (Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0)) {
        Toast.error('Cannot execute: filter has errors, zero matches, or invalid field.');
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
        itemMode,
        maxItems,
        paginate,
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
