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
import { renderRobotAvatar } from './robotAvatar.js';
import { escapeHtml } from '../utils/dom.js';

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
  filterEnabled: false,
  matchMode: 'all', // 'all' | 'any'
  filterConditions: [
    { id: 1, field: '', operator: 'contains', value: '', dateFrom: '', dateTo: '' }
  ],
  filterField: '',
  customFieldName: '',
  filterOperator: 'contains', // 'contains' | 'equals' | 'dateBetween'
  filterValue: '',
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

    // 1. Explicit loop candidate or sequential iteration from recorder/backend
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s && (s.isLoopCandidate || s.isLoop || s.role === 'LOOP' || s.role === 'LOOP_TARGET' || s.loopMode === 'sequential_iteration')) {
        return i;
      }
    }

    // 2. Look for table row action (e.g. click on a download link/button or row cell with :nth-of-type / :nth-child)
    // IMPORTANT: Exclude standalone form dropdowns (SELECT) and text inputs (TYPE) even if wrapped in layout tables
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s) continue;
      const type = (s.type || s.action || '').toUpperCase();
      const tagName = (s.target?.fingerprint?.tagName || '').toLowerCase();
      if (type === 'SELECT' || tagName === 'select' || type === 'TYPE' || tagName === 'input') {
        continue;
      }

      const id = s.target?.fingerprint?.id || '';
      const name = (s.name || s.elementName || '').toLowerCase();
      const text = (s.target?.fingerprint?.text || '').toLowerCase();
      const cssPath = s.target?.candidates?.find(c => c && c.strategy === 'css-path')?.value || '';

      // Skip navigation or chrome
      if (/menu-|navbar|nav-|toolbar/i.test(id) || /(^|\s|#)menu-|\bnavbar\b|\bnav-/i.test(cssPath) || /i21-menu|nav-top-item/i.test(name)) {
        continue;
      }

      // Check if action targets an indexed repeating row structure
      const isIndexedRow = /tr:nth-(?:child|of-type)|\[role="row"\]:nth/i.test(cssPath);
      const isItemAction = /download|export|view|detail|select|print|pdf/i.test(name) || /download|export|view|print|pdf/i.test(text);

      if (isIndexedRow || (isItemAction && /table|tbody|tr|td|gridcell|x-grid-cell/i.test(cssPath))) {
        return i;
      }
    }

    // 3. Fallback: Any valid non-setup action inside a table row or grid cell
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s) continue;
      const type = (s.type || s.action || '').toUpperCase();
      const tagName = (s.target?.fingerprint?.tagName || '').toLowerCase();
      if (type === 'SELECT' || tagName === 'select' || type === 'TYPE') continue;

      const id = s.target?.fingerprint?.id || '';
      const name = (s.name || '').toLowerCase();
      const cssPath = s.target?.candidates?.find(c => c && c.strategy === 'css-path')?.value || '';
      if (/menu-|navbar|nav-|toolbar/i.test(id) || /(^|\s|#)menu-|\bnavbar\b|\bnav-/i.test(cssPath)) continue;

      if (/table|tbody|tr|td|gridcell|x-grid-cell|mat-option|\[role="option"\]/i.test(cssPath)) {
        return i;
      }
    }

    // 4. If step 0 is navigation / menu link, skip to step 1
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

  open({ workflowId, workflowName = 'Workflow', stepCount = 0, loopStepIndex = null, isLoop = false, steps = [], onExecuted = null, defaultMode = 'single' }) {
    if (!this.container) this.init();

    this.currentWorkflowId = workflowId;
    this.workflowName = workflowName || 'Workflow';
    this.stepCount = stepCount || 0;
    const hasExplicitLoopStep = Number.isInteger(loopStepIndex) && loopStepIndex >= 0;
    this.workflowSteps = Array.isArray(steps) ? steps : [];
    this.loopStepIndex = hasExplicitLoopStep ? loopStepIndex : this.findBestLoopStepIndex(this.workflowSteps);
    this.isLoopConfigured = isLoop === true || hasExplicitLoopStep;
    this.selectedMode = defaultMode || 'single';
    this.fieldValues = {};
    this.itemMode = 'new';
    this.onExecuted = onExecuted;

    // Reset preflight state
    this.preflightStatus = 'idle';
    this.preflightError = '';
    this.discoveryData = null;
    this.availableFields = [];
    this.filterEnabled = false;
    this.matchMode = 'all';
    this.filterConditions = [
      { id: 1, field: '', operator: 'contains', value: '', dateFrom: '', dateTo: '' }
    ];
    this.filterField = '';
    this.customFieldName = '';
    this.filterOperator = 'contains';
    this.filterValue = '';
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
          const wfExplicitLoop = Number.isInteger(wf.loopStepIndex) && wf.loopStepIndex >= 0 && wf.loopStepIndex < wf.steps.length;
          if (wfExplicitLoop && (!hasExplicitLoopStep || this.loopStepIndex !== wf.loopStepIndex)) {
            this.loopStepIndex = wf.loopStepIndex;
            if (wf.isLoop || wf.mode === 'LOOP') {
              this.isLoopConfigured = true;
            }
            if (this.selectedMode === 'loop') {
              this.runPreflight();
            }
          } else if (!hasExplicitLoopStep) {
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
      <div class="modal-dialog exec-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="execModalTitle" style="background:var(--bg-surface); border:1px solid rgba(0,240,255,0.2); box-shadow:0 0 35px rgba(0,240,255,0.12); border-radius:var(--radius-xl);">
        <div class="modal-header" style="padding: 1.25rem 1.5rem; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(6,9,19,0.5);">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div style="flex-shrink:0;">
              ${renderRobotAvatar({ size: 'badge', state: 'analyzing' })}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h3 id="execModalTitle" style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-primary);">${escapeHtml(this.workflowName)}</h3>
                <span class="badge-tag info" style="font-size:var(--text-2xs); font-weight:700;">MISSION CONTROL</span>
              </div>
              <span style="font-size:var(--text-2xs); color:var(--text-sub); display:block; margin-top:0.15rem;">Autonomous browser worker setup &amp; dynamic DOM inspection</span>
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
                  <strong style="font-size:0.9rem; color:var(--text-main);"><svg class="exec-option-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg> Run Once (Single Workflow)</strong>
                  <span class="badge-tag success" style="font-size:var(--text-2xs); padding:0.15rem 0.45rem;">Standard</span>
                </div>
                <span style="font-size:0.76rem; color:var(--text-sub);">Replays the exact recorded workflow once from start to finish. Does not iterate through other rows.</span>
              </div>
            </label>

            <!-- Option 2: Loop Execution (Batch) -->
            <label class="exec-option-label ${isLoopSelected ? 'active' : ''}" id="labelExecLoop">
              <input type="radio" name="execModeRadio" value="loop" ${isLoopSelected ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);">
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong style="font-size:0.9rem; color:var(--text-main);"><svg class="exec-option-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Run as Loop (Batch / Filtered Items)</strong>
                  ${hasLoopConfigured ? '<span class="badge-tag success" style="font-size:var(--text-2xs); padding:0.15rem 0.45rem;">Configured</span>' : '<span class="badge-tag primary" style="font-size:var(--text-2xs); padding:0.15rem 0.45rem;">Auto-Discovery</span>'}
                </div>
                <span style="font-size:0.76rem; color:var(--text-sub);">Automatically detects table records and processes matching items based on your filter criteria.</span>
              </div>
            </label>
          </div>

          <!-- Loop Discovery & Preflight Section -->
          <div id="execLoopSection" style="display: ${isLoopSelected ? 'flex' : 'none'}; flex-direction:column; gap:0.85rem;">

            <!-- Step 1: Where to implement loop? -->
            <div class="exec-loop-step-picker-box" style="padding:0.75rem 0.85rem; background:var(--bg-surface-secondary, rgba(0,0,0,0.02)); border-radius:6px; border:1px solid var(--border-light, #e2e8f0);">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
                <label for="selExecLoopStep" style="font-size:0.8rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
                  <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg> Repeating Step</span>
                  <span style="font-size:var(--text-2xs); font-weight:normal; color:var(--text-sub);">(Choose which step repeats for each item in the list)</span>
                </label>
                <span class="badge-tag primary" style="font-size:var(--text-2xs);">Loop Target Step</span>
              </div>
              <select id="selExecLoopStep" class="exec-control-select" style="font-size:0.8rem; font-weight:600;">
                ${this.renderStepOptions()}
              </select>
            </div>

            <!-- Preflight Container (Mount point for Loading / Error / Preflight Review) -->
            <div id="execPreflightContainer" class="exec-preflight-container">
              ${this.renderPreflightContent()}
            </div>

            <!-- Section 3: Download & Sync Options (New vs Old vs All) -->
            <div class="exec-data-requirement-box" style="padding:0.75rem 0.85rem; background:var(--bg-surface-secondary, rgba(0,0,0,0.02)); border-radius:6px; border:1px solid var(--border-light, #e2e8f0);">
              <label style="font-size:0.8rem; font-weight:700; color:var(--text-main); display:block; margin-bottom:0.45rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg> Download &amp; Sync Options
              </label>
              <div class="exec-data-mode-radios" style="display:flex; flex-direction:column; gap:0.4rem;">
                <label class="exec-data-radio-label ${this.itemMode === 'new' ? 'active' : ''}">
                  <input type="radio" name="execDataModeRadio" value="new" ${this.itemMode === 'new' ? 'checked' : ''} style="accent-color:var(--brand-forest); margin-top:0.15rem;">
                  <div>
                    <strong style="font-size:0.82rem; color:var(--text-main);">Skip previously downloaded files <span class="badge-tag success" style="font-size:var(--text-2xs); padding:0.1rem 0.4rem;">Recommended</span></strong>
                    <span style="font-size:var(--text-2xs); color:var(--text-sub); display:block;">Only download new files from this run</span>
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
                    <strong style="font-size:0.82rem; color:var(--text-main);">Previously downloaded only</strong>
                    <span style="font-size:0.74rem; color:var(--text-sub); display:block;">Re-download or inspect files captured in earlier runs</span>
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
                    <label for="chkExecPaginate" style="font-size:0.76rem; color:var(--text-body); cursor:pointer; user-select:none;">Process all pages (Multi-page pagination)</label>
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

  syncPrimaryCondition() {
    if (this.filterConditions && this.filterConditions.length > 0) {
      const first = this.filterConditions[0];
      this.filterField = first.field;
      this.filterOperator = first.operator;
      this.filterValue = first.operator === 'dateBetween' ? `${first.dateFrom || ''}..${first.dateTo || ''}` : (first.value || '');
    }
  },

  renderConditionRows() {
    const hasFields = this.availableFields.length > 0;
    return (this.filterConditions || []).map((cond, idx) => {
      const isFirst = idx === 0;
      const connectorText = isFirst ? 'Where' : (this.matchMode === 'all' ? 'AND' : 'OR');
      const currentField = cond.field || (this.availableFields[0] || 'Field');
      const detectedValues = this.getValuesForField(currentField);
      const isDate = this.isDateField(currentField, detectedValues);
      const isDateBetween = cond.operator === 'dateBetween';

      return `
        <div class="exec-condition-row" data-cond-index="${idx}">
          <span class="exec-condition-connector ${isFirst ? 'initial' : ''}">${connectorText}</span>

          <!-- Field selector -->
          <div style="flex:1; min-width:140px;">
            ${hasFields ? `
              <select class="exec-control-select exec-cond-field-select" data-cond-index="${idx}" style="font-size:0.78rem; width:100%;">
                ${this.availableFields.map(f => `<option value="${escapeHtml(f)}" ${f.toLowerCase() === currentField.toLowerCase() ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                <option value="__custom__" ${cond.field === '__custom__' ? 'selected' : ''}>Custom field…</option>
              </select>
            ` : `
              <input type="text" class="exec-control-input exec-cond-field-input" data-cond-index="${idx}" value="${escapeHtml(currentField)}" placeholder="Field name" style="font-size:0.78rem; width:100%;">
            `}
          </div>

          <!-- Operator selector -->
          <div style="flex:0 0 130px;">
            <select class="exec-control-select exec-cond-operator-select" data-cond-index="${idx}" style="font-size:0.78rem; width:100%;">
              <option value="contains" ${cond.operator === 'contains' ? 'selected' : ''}>contains</option>
              <option value="equals" ${cond.operator === 'equals' ? 'selected' : ''}>equals</option>
              <option value="dateBetween" ${cond.operator === 'dateBetween' ? 'selected' : ''}>date between</option>
            </select>
          </div>

          <!-- Value input(s) -->
          <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:0.35rem;">
            ${isDateBetween ? `
              <input type="date" class="exec-control-input exec-cond-date-from" data-cond-index="${idx}" value="${escapeHtml(this.normalizeDateValue(cond.dateFrom || ''))}" title="From date" style="font-size:0.75rem; flex:1;">
              <span style="font-size:var(--text-2xs); color:var(--text-sub);">to</span>
              <input type="date" class="exec-control-input exec-cond-date-to" data-cond-index="${idx}" value="${escapeHtml(this.normalizeDateValue(cond.dateTo || ''))}" title="To date" style="font-size:0.75rem; flex:1;">
            ` : (isDate ? `
              <input type="date" class="exec-control-input exec-cond-val-input" data-cond-index="${idx}" value="${escapeHtml(this.normalizeDateValue(cond.value || ''))}" placeholder="YYYY-MM-DD" style="font-size:0.78rem; width:100%;">
            ` : `
              <input type="text" class="exec-control-input exec-cond-val-input" data-cond-index="${idx}" value="${escapeHtml(cond.value || '')}" placeholder="Match value…" style="font-size:0.78rem; width:100%;">
            `)}
          </div>

          <!-- Remove button -->
          ${this.filterConditions.length > 1 ? `
            <button type="button" class="btn-remove-cond" data-cond-index="${idx}" title="Remove rule #${idx + 1}" aria-label="Remove condition">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  buildItemFilterPayload() {
    if (!this.filterEnabled || !this.filterConditions || !this.filterConditions.length) {
      return null;
    }
    const conditions = [];
    for (const cond of this.filterConditions) {
      const field = (cond.field === '__custom__' ? this.customFieldName : cond.field).trim();
      if (!field) continue;
      const op = cond.operator || 'contains';
      let val = cond.value;
      if (op === 'dateBetween') {
        const from = this.normalizeDateValue(cond.dateFrom || '1970-01-01');
        const to = this.normalizeDateValue(cond.dateTo || '2099-12-31');
        val = { from, to };
      } else if (this.isDateField(field, this.getValuesForField(field))) {
        val = this.normalizeDateValue(cond.value);
      } else {
        val = String(cond.value || '').trim();
      }
      conditions.push({ field, operator: op, value: val });
    }

    if (conditions.length === 0) return null;

    const payload = {
      matchMode: this.matchMode || 'all',
      conditions
    };

    if (conditions.length === 1) {
      payload.field = conditions[0].field;
      payload.operator = conditions[0].operator;
      payload.value = conditions[0].value;
    }

    return payload;
  },

  renderPreflightContent() {
    if (this.preflightStatus === 'loading') {
      return `
        <div class="exec-preflight-loading" style="display:flex; align-items:center; gap:1rem; background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.3); border-radius:var(--radius-lg); padding:1rem 1.25rem;">
          <div style="flex-shrink:0;">
            ${renderRobotAvatar({ size: 'badge', state: 'analyzing' })}
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span class="status-dot analyzing"></span>
              <strong style="display:block; font-size:0.85rem; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.04em;">AGENT ANALYZING LIVE WEBPAGE…</strong>
            </div>
            <span style="display:block; margin-top:0.25rem; font-size:0.75rem; color:var(--text-sub);">Scanning page in Chrome to detect tables and data columns…</span>
          </div>
        </div>
      `;
    }

    if (this.preflightStatus === 'error') {
      return `
        <div class="exec-preflight-error" style="display:flex; align-items:flex-start; gap:1rem; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:var(--radius-lg); padding:1rem 1.25rem;">
          <div style="flex-shrink:0;">
            ${renderRobotAvatar({ size: 'badge', state: 'error' })}
          </div>
          <div style="flex:1;">
            <strong style="color:var(--color-danger); font-size:0.85rem;">Agent Discovery Failed</strong>
            <p style="margin:0.25rem 0 0; font-size:0.75rem; line-height:1.4; color:var(--text-sub);">${escapeHtml(this.preflightError || 'Target page not available or no repeating items could be found.')}</p>
            <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.5rem;">
              <button type="button" class="btn btn-secondary btn-sm" id="btnRetryPreflight" style="font-size:0.72rem; padding:0.25rem 0.65rem;">
                <span>Retry Page Analysis</span>
              </button>
            </div>
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
      const currentField = isCustomField ? (this.customFieldName || this.filterField || (this.availableFields[0] || 'Field')) : (this.filterField || (this.availableFields[0] || 'Field'));
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

        <!-- Filter Rules Section -->
        <div style="display:flex; flex-direction:column; gap:0.6rem; padding-top:0.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <span style="font-size:0.82rem; font-weight:800; color:var(--text-main);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg> Item Filter Rules</span>
              <span class="badge-tag primary" style="font-size:var(--text-2xs); padding:0.12rem 0.45rem;">Filter by Field Criteria</span>
            </div>
            <span style="font-size:var(--text-2xs); color:var(--text-sub);">Configure item selection criteria</span>
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

            <!-- Section 2a: Quick Column / Field Pills -->
            <div style="display:flex; flex-direction:column; gap:0.25rem;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <label style="font-size:0.75rem; font-weight:700; color:var(--text-main);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg> Quick Pick: Discovered Columns
                </label>
                <span style="font-size:var(--text-2xs); color:var(--text-sub);">${this.availableFields.length} detected</span>
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
                    <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> Quick Date Filter for &ldquo;${escapeHtml(currentField)}&rdquo;:</span>
                  </span>
                  <span style="font-size:var(--text-2xs); color:var(--brand-forest); font-weight:700;">Live Runtime Filtering</span>
                </div>
                <div class="exec-pill-group" id="execSmartDatePills">
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.filterEnabled && this.filterConditions[0]?.operator === 'dateBetween' && this.filterConditions[0]?.dateTo === this.normalizeDateValue('today') ? 'active' : ''}" data-action="overdue" title="Due date has passed (Due Date <= Today)">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg> Overdue (on or before today)
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.filterEnabled && this.filterConditions[0]?.operator === 'dateBetween' && this.filterConditions[0]?.dateFrom === this.normalizeDateValue('today') ? 'active' : ''}" data-action="upcoming" title="Due date has not arrived yet (Due Date >= Today)">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg> Upcoming (after today)
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.itemMode === 'old' ? 'active' : ''}" data-action="in_folder" title="Process only items already downloaded in folder">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/></svg> Already in Folder (${this.getDownloadedCount()})
                  </button>
                  <button type="button" class="exec-pill exec-pill-smart-date ${this.itemMode === 'new' ? 'active' : ''}" data-action="not_in_folder" title="Skip items already in folder, process new only">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/></svg> New (Not in folder)
                  </button>
                </div>
              </div>
            ` : ''}

            <!-- Section 2c: Quick Detected Options for current field -->
            ${detectedValues.length > 0 ? `
              <div style="display:flex; flex-direction:column; gap:0.25rem; margin-top:0.15rem;">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <span style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg> Detected Options for &ldquo;${escapeHtml(currentField)}&rdquo;:
                  </span>
                  <span style="font-size:var(--text-2xs); color:var(--text-sub);">${detectedValues.length} option(s)</span>
                </div>
                <div class="exec-pill-group" id="execValuePills">
                  ${detectedValues.map(v => `
                    <button type="button" class="exec-pill exec-pill-val ${this.filterEnabled && (this.filterConditions[0]?.value || '').toLowerCase() === v.toLowerCase() ? 'active' : ''}" data-value="${escapeHtml(v)}" title="Filter by '${escapeHtml(v)}'">
                      ${escapeHtml(v)}
                    </button>
                  `).join('')}
                  <button type="button" class="exec-pill exec-pill-val ${!this.filterEnabled ? 'active' : ''}" data-value="__all__" title="Fetch all without filtering">
                    Fetch All
                  </button>
                </div>
              </div>
            ` : ''}

            <!-- Section 2d: Natural Language Filter Condition Rules -->
            <div class="exec-filter-rules-container" style="display:flex; flex-direction:column; gap:0.45rem; margin-top:0.25rem;">
              <div class="exec-filter-rules-header">
                <div style="display:flex; align-items:center; gap:0.45rem;">
                  <span style="font-size:0.75rem; font-weight:700; color:var(--text-main);">Match Condition:</span>
                  <div class="btn-group" role="group" style="display:inline-flex; border:1px solid var(--border-light); border-radius:var(--radius-pill); overflow:hidden; background:var(--bg-surface);">
                    <button type="button" class="exec-pill-match-mode ${this.matchMode === 'all' ? 'active' : ''}" data-mode="all" title="All conditions must match (AND)">
                      ALL rules (AND)
                    </button>
                    <button type="button" class="exec-pill-match-mode ${this.matchMode === 'any' ? 'active' : ''}" data-mode="any" title="Any condition may match (OR)">
                      ANY rule (OR)
                    </button>
                  </div>
                </div>
                <button type="button" class="btn btn-secondary btn-xs" id="btnAddFilterRule" style="font-size:var(--text-2xs); padding:0.2rem 0.6rem; display:inline-flex; align-items:center; gap:0.3rem;">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Add Rule</span>
                </button>
              </div>

              <div class="exec-filter-rules-list" id="execFilterRulesList">
                ${this.renderConditionRows()}
              </div>
            </div>

            <!-- Custom field name input if '__custom__' selected -->
            <div id="execCustomFieldContainer" style="display:${this.filterConditions.some(c => c.field === '__custom__') || this.filterField === '__custom__' ? 'flex' : 'none'}; flex-direction:column; gap:0.25rem;">
              <label for="execFilterCustomFieldInput" style="font-size:0.7rem; font-weight:700; color:var(--text-sub);">Custom Column / Field Name</label>
              <input type="text" id="execFilterCustomFieldInput" class="exec-control-input" value="${escapeHtml(this.customFieldName)}" placeholder="Enter exact column name...">
            </div>

            <!-- Explanatory rule text -->
            <p class="exec-filter-rule-explainer" id="execFilterExplanation">
              ${this.renderFilterExplanation()}
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
                <span style="opacity:0.85; font-size:var(--text-2xs);">(${escapeHtml(item.reason || 'skipped')})</span>
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
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg> Force Re-download
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="btnBannerAllData" style="font-size:0.72rem; padding:0.25rem 0.65rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5"/></svg> Switch to All Data
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
        const firstVal = (values && values.length > 0) ? values[0] : '';
        const isDate = this.isDateField(activeFieldName, values);

        if (!this.filterConditions.length) {
          this.filterConditions = [{
            id: Date.now(),
            field: activeFieldName,
            operator: isDate ? 'dateBetween' : 'contains',
            value: firstVal,
            dateFrom: isDate ? this.normalizeDateValue('today') : '',
            dateTo: isDate ? this.normalizeDateValue('today') : ''
          }];
        } else {
          this.filterConditions[0].field = activeFieldName;
          if (firstVal && !this.filterConditions[0].value) {
            this.filterConditions[0].value = firstVal;
          }
        }
        this.syncPrimaryCondition();

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
        const currentField = isCustomField ? (this.customFieldName || this.filterField || (this.availableFields[0] || 'Field')) : (this.filterField || (this.availableFields[0] || 'Field'));

        if (action === 'overdue') {
          this.filterEnabled = true;
          this.filterConditions = [{
            id: Date.now(),
            field: currentField,
            operator: 'dateBetween',
            value: '',
            dateFrom: '1970-01-01',
            dateTo: this.normalizeDateValue('today')
          }];
          this.syncPrimaryCondition();
        } else if (action === 'upcoming') {
          this.filterEnabled = true;
          this.filterConditions = [{
            id: Date.now(),
            field: currentField,
            operator: 'dateBetween',
            value: '',
            dateFrom: this.normalizeDateValue('today'),
            dateTo: '2099-12-31'
          }];
          this.syncPrimaryCondition();
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

    // Interactive Option / Value Pills
    const valPills = preflightContainer.querySelectorAll('.exec-pill-val');
    valPills.forEach(pill => {
      pill.onclick = () => {
        const val = pill.dataset.value;
        if (val === '__all__') {
          this.filterEnabled = false;
        } else {
          this.filterEnabled = true;
          const hasFields = this.availableFields.length > 0;
          const isCustomField = this.filterField === '__custom__' || (!hasFields && !!this.filterField);
          const currentField = isCustomField ? (this.customFieldName || this.filterField || (this.availableFields[0] || 'Field')) : (this.filterField || (this.availableFields[0] || 'Field'));

          if (!this.filterConditions.length) {
            this.filterConditions = [{
              id: Date.now(),
              field: currentField,
              operator: 'contains',
              value: val,
              dateFrom: '',
              dateTo: ''
            }];
          } else {
            this.filterConditions[0].field = currentField;
            this.filterConditions[0].value = val;
            this.filterConditions[0].operator = 'contains';
          }
          this.syncPrimaryCondition();

          // If specific clicked item is already downloaded and itemMode is 'new', auto-enable forceRedownload
          const items = Array.isArray(this.discoveryData?.discovery?.items) ? this.discoveryData.discovery.items : [];
          const activeField = currentField.trim();
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

    // Match Mode Toggle Buttons (ALL vs ANY)
    const matchModePills = preflightContainer.querySelectorAll('.exec-pill-match-mode');
    matchModePills.forEach(pill => {
      pill.onclick = () => {
        this.matchMode = pill.dataset.mode;
        matchModePills.forEach(p => p.classList.toggle('active', p === pill));
        const list = preflightContainer.querySelector('#execFilterRulesList');
        if (list) {
          list.innerHTML = this.renderConditionRows();
          this.bindRuleRowEvents(preflightContainer);
        }
        this.evaluateFilterPreview();
      };
    });

    // Add Rule Button
    const btnAddRule = preflightContainer.querySelector('#btnAddFilterRule');
    if (btnAddRule) {
      btnAddRule.onclick = () => {
        const nextField = this.availableFields[0] || '';
        this.filterConditions.push({
          id: Date.now(),
          field: nextField,
          operator: 'contains',
          value: '',
          dateFrom: '',
          dateTo: ''
        });
        this.syncPrimaryCondition();
        const list = preflightContainer.querySelector('#execFilterRulesList');
        if (list) {
          list.innerHTML = this.renderConditionRows();
          this.bindRuleRowEvents(preflightContainer);
        }
        this.evaluateFilterPreview();
      };
    }

    // Custom field name input
    const customFieldInput = preflightContainer.querySelector('#execFilterCustomFieldInput');
    if (customFieldInput) {
      customFieldInput.oninput = () => {
        this.customFieldName = customFieldInput.value;
        if (this.discoveryData) this.discoveryData.filterPreview = null;
        this.evaluateFilterPreview();
      };
    }

    this.bindRuleRowEvents(preflightContainer);
  },

  bindRuleRowEvents(preflightContainer) {
    if (!preflightContainer) return;

    // Remove Condition Buttons
    const removeBtns = preflightContainer.querySelectorAll('.btn-remove-cond');
    removeBtns.forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions.splice(idx, 1);
          if (!this.filterConditions.length) {
            this.filterConditions = [{
              id: Date.now(),
              field: this.availableFields[0] || '',
              operator: 'contains',
              value: '',
              dateFrom: '',
              dateTo: ''
            }];
          }
          this.syncPrimaryCondition();
          const list = preflightContainer.querySelector('#execFilterRulesList');
          if (list) {
            list.innerHTML = this.renderConditionRows();
            this.bindRuleRowEvents(preflightContainer);
          }
          this.evaluateFilterPreview();
        }
      };
    });

    // Condition Field Selects
    const fieldSelects = preflightContainer.querySelectorAll('.exec-cond-field-select, .exec-cond-field-input');
    fieldSelects.forEach(el => {
      const handler = () => {
        const idx = parseInt(el.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions[idx].field = el.value;
          if (idx === 0) this.syncPrimaryCondition();
          const isDate = this.isDateField(el.value, this.getValuesForField(el.value));
          if (isDate && this.filterConditions[idx].operator === 'contains') {
            this.filterConditions[idx].operator = 'dateBetween';
            const list = preflightContainer.querySelector('#execFilterRulesList');
            if (list) {
              list.innerHTML = this.renderConditionRows();
              this.bindRuleRowEvents(preflightContainer);
            }
          }
          this.evaluateFilterPreview();
        }
      };
      el.onchange = handler;
      el.oninput = handler;
    });

    // Condition Operator Selects
    const opSelects = preflightContainer.querySelectorAll('.exec-cond-operator-select');
    opSelects.forEach(el => {
      el.onchange = () => {
        const idx = parseInt(el.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions[idx].operator = el.value;
          if (idx === 0) this.syncPrimaryCondition();
          const list = preflightContainer.querySelector('#execFilterRulesList');
          if (list) {
            list.innerHTML = this.renderConditionRows();
            this.bindRuleRowEvents(preflightContainer);
          }
          this.evaluateFilterPreview();
        }
      };
    });

    // Condition Value Inputs
    const valInputs = preflightContainer.querySelectorAll('.exec-cond-val-input');
    valInputs.forEach(el => {
      el.oninput = () => {
        const idx = parseInt(el.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions[idx].value = el.value;
          if (idx === 0) this.syncPrimaryCondition();
          this.evaluateFilterPreview();
        }
      };
    });

    // Condition Date Range Inputs
    const dateFromInputs = preflightContainer.querySelectorAll('.exec-cond-date-from');
    dateFromInputs.forEach(el => {
      const handler = () => {
        const idx = parseInt(el.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions[idx].dateFrom = el.value;
          if (idx === 0) this.syncPrimaryCondition();
          this.evaluateFilterPreview();
        }
      };
      el.oninput = handler;
      el.onchange = handler;
    });

    const dateToInputs = preflightContainer.querySelectorAll('.exec-cond-date-to');
    dateToInputs.forEach(el => {
      const handler = () => {
        const idx = parseInt(el.dataset.condIndex, 10);
        if (Number.isInteger(idx) && this.filterConditions[idx]) {
          this.filterConditions[idx].dateTo = el.value;
          if (idx === 0) this.syncPrimaryCondition();
          this.evaluateFilterPreview();
        }
      };
      el.oninput = handler;
      el.onchange = handler;
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
      // Build request body according to preview contract: { loopStepIndex, itemFilter }
      const currentField = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
      const isDate = this.isDateField(currentField, this.getValuesForField(currentField));
      const cleanVal = isDate ? this.normalizeDateValue(this.filterValue.trim()) : this.filterValue.trim();

      const itemFilterPayload = (this.filterEnabled && this.filterField && this.filterValue) ? {
        field: currentField,
        operator: this.filterOperator,
        value: cleanVal
      } : null;

      const requestedField = itemFilterPayload ? itemFilterPayload.field : null;
      const fieldBeforeDiscovery = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();

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
      this.fieldValues = (data.fieldValues && Object.keys(data.fieldValues).length > 0)
        ? data.fieldValues
        : this.extractFieldValues(data);

      if (Array.isArray(data.steps) && data.steps.length) {
        this.workflowSteps = data.steps;
        this.updateStepSelectorUI();
      }

      // Resolve target column and action value from server discovery if present
      const targetCol = data.discovery?.targetColumn || null;
      const targetVal = data.discovery?.targetActionValue || null;

      // If filterField is not set or not in availableFields, pick the best discovered field
      if (this.availableFields.length > 0) {
        const hasTargetCol = targetCol && this.availableFields.some(f => f.toLowerCase() === targetCol.toLowerCase());
        const hasField = this.availableFields.some(f => f.toLowerCase() === (this.filterField || '').toLowerCase());
        if (hasTargetCol && (!this.filterField || this.filterField === 'Type')) {
          this.filterField = this.availableFields.find(f => f.toLowerCase() === targetCol.toLowerCase()) || targetCol;
        } else if (!hasField || !this.filterField) {
          const hasType = this.availableFields.find(f => f.toLowerCase() === 'type');
          const hasInv = this.availableFields.find(f => f.toLowerCase().includes('invoice'));
          this.filterField = hasTargetCol ? targetCol : (hasType || hasInv || this.availableFields.find(f => !/^#$|^index$/i.test(f)) || this.availableFields[0]);
        }
      }

      const activeField = (this.filterField === '__custom__' ? this.customFieldName : this.filterField).trim();
      const detectedVals = this.getValuesForField(activeField);
      if (detectedVals && detectedVals.length > 0) {
        const hasTargetVal = targetVal && detectedVals.some(v => v.toLowerCase() === targetVal.toLowerCase());
        const hasCurrentVal = detectedVals.some(v => v.toLowerCase() === (this.filterValue || '').toLowerCase());
        if (hasTargetVal && (!this.filterValue || this.filterValue === 'Invoice')) {
          this.filterValue = detectedVals.find(v => v.toLowerCase() === targetVal.toLowerCase()) || targetVal;
        } else if (!hasCurrentVal || !this.filterValue) {
          const hasInvoice = detectedVals.find(v => v.toLowerCase() === 'invoice');
          this.filterValue = hasTargetVal ? targetVal : (hasInvoice || detectedVals[0]);
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

  normalizeDateValue(val) {
    if (!val || typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (trimmed.toLowerCase() === 'today' || trimmed.toLowerCase() === 'now') {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // Support M/D/YYYY or MM/DD/YYYY
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (slashMatch) {
      const m = slashMatch[1].padStart(2, '0');
      const d = slashMatch[2].padStart(2, '0');
      const y = slashMatch[3];
      return `${y}-${m}-${d}`;
    }

    // Support M-D-YYYY or MM-DD-YYYY
    const dashMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(trimmed);
    if (dashMatch) {
      const m = dashMatch[1].padStart(2, '0');
      const d = dashMatch[2].padStart(2, '0');
      const y = dashMatch[3];
      return `${y}-${m}-${d}`;
    }

    return trimmed;
  },

  getDownloadedCount() {
    const items = Array.isArray(this.discoveryData?.discovery?.items) ? this.discoveryData.discovery.items : [];
    return items.filter(it => it.isDownloaded).length;
  },

  renderFilterExplanation() {
    if (!this.filterEnabled) {
      return `⚡ All discovered items will be processed sequentially (no filter).`;
    }
    const conditions = this.filterConditions || [];
    if (!conditions.length) {
      return `⚡ No rules configured.`;
    }
    const mode = (this.matchMode === 'any') ? 'ANY' : 'ALL';
    const ruleDescs = conditions.map((c) => {
      const field = (c.field === '__custom__' ? this.customFieldName : c.field).trim() || 'Field';
      if (c.operator === 'dateBetween') {
        return `[${field} between ${c.dateFrom || '...'} and ${c.dateTo || '...'}]`;
      }
      return `[${field} ${c.operator} "${c.value || '...'}"]`;
    });
    return `⚡ Loop will execute on items matching <strong>${mode}</strong> of the following rules: ${escapeHtml(ruleDescs.join(this.matchMode === 'any' ? ' OR ' : ' AND '))}. Other rows are skipped.`;
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

    const errors = [];
    const conditions = this.filterConditions || [];

    if (!conditions.length) {
      errors.push('At least one filter condition is required');
    }

    for (let i = 0; i < conditions.length; i++) {
      const cond = conditions[i];
      const field = (cond.field === '__custom__' ? this.customFieldName : cond.field).trim();
      const op = cond.operator || 'contains';
      if (!field) {
        errors.push(`Rule #${i + 1}: Filter field is required`);
      }
      if (op === 'dateBetween') {
        const from = this.normalizeDateValue(cond.dateFrom);
        const to = this.normalizeDateValue(cond.dateTo);
        if (!from || !to) {
          errors.push(`Rule #${i + 1}: Both "From" and "To" dates are required`);
        }
      } else {
        const val = String(cond.value ?? '').trim();
        if (!val && val !== '0') {
          errors.push(`Rule #${i + 1}: Match value is required`);
        }
      }
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

    const selectedList = [];
    const skippedList = [];
    const matchMode = this.matchMode || 'all';

    items.forEach((item, idx) => {
      const itemIndex = idx + 1;
      const label = this.getItemLabel(item, itemIndex);

      const condResults = conditions.map((cond) => {
        const field = (cond.field === '__custom__' ? this.customFieldName : cond.field).trim();
        const op = cond.operator || 'contains';
        const extracted = this.extractFieldValue(item, field);

        if (!extracted.found) {
          return { pass: false, reason: `Field "${field}" not found on item` };
        }

        const itemVal = String(extracted.value ?? '').trim().toLowerCase();

        if (op === 'dateBetween') {
          const from = this.normalizeDateValue(cond.dateFrom);
          const to = this.normalizeDateValue(cond.dateTo);
          let dateStr = String(extracted.value ?? '').trim();
          const dMatch = dateStr.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/);
          if (dMatch) dateStr = dMatch[0];
          const itemDate = Date.parse(dateStr);
          const fromDate = Date.parse(from);
          const toDate = Date.parse(to);

          if (isNaN(itemDate)) {
            return { pass: false, reason: `Date "${extracted.value}" could not be parsed` };
          }
          const itemD = new Date(itemDate);
          itemD.setHours(12, 0, 0, 0);
          const fromD = new Date(fromDate);
          fromD.setHours(0, 0, 0, 0);
          const toD = new Date(toDate);
          toD.setHours(23, 59, 59, 999);

          const inRange = itemD.getTime() >= fromD.getTime() && itemD.getTime() <= toD.getTime();
          return {
            pass: inRange,
            reason: inRange ? 'Matches date range' : `Date "${extracted.value}" is outside range [${from} to ${to}]`
          };
        } else if (['<=', '>=', '<', '>', 'before', 'after'].includes(op)) {
          let itemDate = null;
          let targetDate = null;
          const dateLike = this.isDateString(extracted.value) || this.isDateString(cond.value);
          if (dateLike) {
            let dateStr = String(extracted.value ?? '').trim();
            const dMatch = dateStr.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/);
            if (dMatch) dateStr = dMatch[0];
            const parsedItem = Date.parse(dateStr);
            if (!isNaN(parsedItem)) itemDate = new Date(parsedItem);
            const target = String(cond.value ?? '').trim().toLowerCase();
            if (target === 'today' || target === 'now') targetDate = new Date();
            else if (target === 'yesterday') { targetDate = new Date(); targetDate.setDate(targetDate.getDate()-1); }
            else if (target === 'tomorrow') { targetDate = new Date(); targetDate.setDate(targetDate.getDate()+1); }
            else { const parsedTarget = Date.parse(String(cond.value ?? '')); if (!isNaN(parsedTarget)) targetDate = new Date(parsedTarget); }
          }
          let pass = false;
          if (itemDate && targetDate) {
            if (op === '<' || op === 'before') { itemDate.setHours(0,0,0,0); targetDate.setHours(0,0,0,0); pass = itemDate < targetDate; }
            else if (op === '<=') { itemDate.setHours(23,59,59,999); targetDate.setHours(23,59,59,999); pass = itemDate <= targetDate; }
            else if (op === '>' || op === 'after') { itemDate.setHours(23,59,59,999); targetDate.setHours(23,59,59,999); pass = itemDate > targetDate; }
            else if (op === '>=') { itemDate.setHours(0,0,0,0); targetDate.setHours(0,0,0,0); pass = itemDate >= targetDate; }
            return { pass, reason: pass ? 'Matches date filter' : `Date "${extracted.value}" does not satisfy ${op} "${cond.value}"` };
          }
          const itemNum = parseFloat(String(extracted.value ?? '').replace(/[^0-9.-]/g, ''));
          const targetNum = parseFloat(String(cond.value ?? '').replace(/[^0-9.-]/g, ''));
          if (!isNaN(itemNum) && !isNaN(targetNum)) {
            if (op === '<') pass = itemNum < targetNum;
            else if (op === '<=') pass = itemNum <= targetNum;
            else if (op === '>') pass = itemNum > targetNum;
            else if (op === '>=') pass = itemNum >= targetNum;
            return { pass, reason: pass ? 'Matches numeric filter' : `Value "${extracted.value}" does not satisfy ${op} "${cond.value}"` };
          }
          return { pass: false, reason: `Cannot compare "${extracted.value}" with "${cond.value}"` };
        } else if (op === 'equals') {
          const targetVal = String(cond.value ?? '').trim().toLowerCase();
          const pass = itemVal === targetVal;
          return { pass, reason: pass ? 'Matches exact filter' : `Field "${field}" does not equal "${cond.value}"` };
        } else {
          // contains
          const targetVal = String(cond.value ?? '').trim().toLowerCase();
          const pass = itemVal.includes(targetVal);
          return { pass, reason: pass ? 'Matches contains filter' : `Field "${field}" does not contain "${cond.value}"` };
        }
      });

      let matches = false;
      let reason = '';

      if (matchMode === 'any') {
        const passedCond = condResults.find(r => r.pass);
        if (passedCond) {
          matches = true;
        } else {
          matches = false;
          reason = condResults.map(r => r.reason).join(' OR ');
        }
      } else {
        const failedCond = condResults.find(r => !r.pass);
        if (!failedCond) {
          matches = true;
        } else {
          matches = false;
          reason = failedCond.reason;
        }
      }

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
      label += ' (In Folder)';
    }
    return label;
  },

  extractFieldValue(item, fieldName) {
    if (!item || !fieldName) return { found: false, value: undefined };
    const targetKey = fieldName.trim().toLowerCase();
    const normTarget = targetKey.replace(/[^a-z0-9]/g, '');

    // 1. Check item.fields object
    if (item.fields && typeof item.fields === 'object') {
      // 1a. Direct or case-insensitive match
      for (const [k, v] of Object.entries(item.fields)) {
        if (k.trim().toLowerCase() === targetKey && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
      // 1b. Normalized match
      for (const [k, v] of Object.entries(item.fields)) {
        if (k.replace(/[^a-z0-9]/gi, '').toLowerCase() === normTarget && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }

    // 2. Check direct properties of item
    if (typeof item === 'object') {
      for (const [k, v] of Object.entries(item)) {
        if (k.trim().toLowerCase() === targetKey && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
      for (const [k, v] of Object.entries(item)) {
        if (k.replace(/[^a-z0-9]/gi, '').toLowerCase() === normTarget && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }

    // 3. Semantic aliases on item.fields or item
    const sourceObj = (item.fields && typeof item.fields === 'object') ? Object.assign({}, item, item.fields) : item;
    if (normTarget.includes('due') || normTarget.includes('duedate')) {
      for (const [k, v] of Object.entries(sourceObj)) {
        if (/\bdue\b/i.test(k) && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }
    if (normTarget.includes('trans') || normTarget.includes('txdate')) {
      for (const [k, v] of Object.entries(sourceObj)) {
        if (/\btrans(action)?\b/i.test(k) && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }
    if (normTarget.includes('post') || normTarget.includes('posting')) {
      for (const [k, v] of Object.entries(sourceObj)) {
        if (/\bpost(ing)?\b/i.test(k) && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }
    if (normTarget.includes('invoice') || normTarget.includes('voucher')) {
      for (const [k, v] of Object.entries(sourceObj)) {
        if (/\b(invoice|voucher)\b/i.test(k) && v !== undefined && v !== null && v !== '') {
          return { found: true, value: v };
        }
      }
    }

    // 4. Positional fallback if availableFields or headerColumns exist
    const cols = (this.availableFields && this.availableFields.length > 0)
      ? this.availableFields
      : (this.discoveryData?.discovery?.collection?.headerColumns || []);

    if (cols.length > 0) {
      const colIdx = cols.findIndex(c => c.trim().toLowerCase() === targetKey || c.replace(/[^a-z0-9]/gi, '').toLowerCase() === normTarget);

      // If item._cells array exists
      if (colIdx >= 0 && Array.isArray(item._cells) && item._cells[colIdx] !== undefined && item._cells[colIdx] !== '') {
        return { found: true, value: item._cells[colIdx] };
      }

      // If item.text contains dates and this is a date column:
      const itemText = String(item.text || item._rawText || (item.fields && (item.fields.Text || item.fields._rawText)) || '').trim();
      if (itemText && (normTarget.includes('date') || normTarget.includes('due'))) {
        const dates = itemText.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) || [];
        if (dates.length > 0) {
          const dateCols = cols.filter(c => this.isDateField(c));
          const dateIdx = dateCols.findIndex(c => c.trim().toLowerCase() === targetKey || c.replace(/[^a-z0-9]/gi, '').toLowerCase() === normTarget);
          if (dateIdx >= 0 && dateIdx < dates.length) {
            return { found: true, value: dates[dateIdx] };
          }
          if (normTarget.includes('due') && dates.length > 1) {
            return { found: true, value: dates[1] };
          }
          if ((normTarget.includes('trans') || normTarget === 'date') && dates.length > 0) {
            return { found: true, value: dates[0] };
          }
          if (normTarget.includes('post') && dates.length > 2) {
            return { found: true, value: dates[2] };
          }
          return { found: true, value: dates[0] };
        }
      }
    }

    // 5. Fallback derivation for Document Type
    if ((targetKey === 'type' || targetKey === 'document type') && item.text) {
      if (/\bcredit\s*memo\b/i.test(item.text)) return { found: true, value: 'Credit Memo' };
      if (/\binvoice\b/i.test(item.text)) return { found: true, value: 'Invoice' };
      if (/\border\b/i.test(item.text)) return { found: true, value: 'Order' };
      if (/\bstatement\b/i.test(item.text)) return { found: true, value: 'Statement' };
    }

    // 6. Fallback derivation for Invoice / Record Number
    if ((targetKey === 'invoice number' || targetKey === 'invoice no' || targetKey === 'invoice') && item.text) {
      const match = item.text.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i);
      if (match) return { found: true, value: match[1] };
    }

    // 7. If targetKey is 'text' or 'label'
    if (['text', 'label', 'name', 'fulltext', '_rawtext'].includes(targetKey)) {
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
        expText.innerHTML = `⚡ Loop will inspect each item: only rows where <strong style="color:var(--brand-forest);">${escapeHtml(field)} ${escapeHtml(op)} "${escapeHtml(val)}"</strong> will execute. Other rows are skipped.`;
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
        confirmBtn.title = 'No items match this filter. Adjust your filter criteria to continue.';
        if (confirmText) confirmText.textContent = 'No Matching Items';
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
      itemFilter = this.buildItemFilterPayload();

      // Guard against zero-match or invalid filter execution
      if (!itemFilter || this.filterPreview.selectedCount === 0 || (Array.isArray(this.filterPreview.errors) && this.filterPreview.errors.length > 0)) {
        Toast.error('Cannot execute: filter has errors, zero matches, or invalid field.');
        return;
      }

      // Legacy rowFilter shape for backward compatibility
      if (itemFilter.field && typeof itemFilter.value === 'string') {
        rowFilter = {
          column: itemFilter.field,
          value: itemFilter.value
        };
      }
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (confirmText) confirmText.textContent = 'Launching…';

    const condCount = this.filterConditions?.length || 1;
    const launchDesc = isLoopMode
      ? (itemFilter ? `loop (${condCount} rule${condCount === 1 ? '' : 's'})` : 'batch loop (all items)')
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
        if (this.workflowName) {
          sessionStorage.setItem(`workflowCaptureName_${res.runId}`, this.workflowName);
          sessionStorage.setItem('workflowCaptureActiveWorkflowName', this.workflowName);
        }
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
