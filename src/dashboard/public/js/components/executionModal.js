/**
 * Workflow Capture — Workflow Execution Options Modal
 * 
 * Provides an explicit choice between:
 *  1. Single Macro Replay (exact recorded procedure)
 *  2. Collection Loop / Batch Replay (iterating across table/list items)
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';
import { Router } from '../router.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const ExecutionModal = {
  container: null,
  currentWorkflowId: null,

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
  },

  open({ workflowId, workflowName = 'Workflow', stepCount = 0, loopStepIndex = null, isLoop = false, onExecuted = null }) {
    if (!this.container) this.init();
    this.currentWorkflowId = workflowId;

    const hasLoopConfigured = isLoop === true || (Number.isInteger(loopStepIndex) && loopStepIndex >= 0);

    this.container.innerHTML = `
      <div class="modal-dialog" style="max-width: 540px; border-radius: 16px;">
        <div class="modal-header" style="padding: 1.25rem 1.5rem;">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(12, 92, 63, 0.1); color:var(--brand-forest); display:flex; align-items:center; justify-content:center;">
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-main);">${escapeHtml(workflowName)}</h3>
              <span style="font-size:0.75rem; color:var(--text-sub);">${stepCount > 0 ? `${stepCount} steps recorded` : 'Workflow Execution'}</span>
            </div>
          </div>
          <button class="btn-icon" id="btnCloseExecModal" title="Close" style="background:transparent; border:none; cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="modal-body" style="padding: 1.5rem; gap: 1.15rem;">
          <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0;">Select how you want to execute this workflow:</p>

          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            <!-- Option 1: Macro Execution (Single) -->
            <label class="exec-option-label" id="labelExecSingle" style="display:flex; gap:0.85rem; padding:0.9rem 1rem; border-radius:12px; border:2px solid ${!hasLoopConfigured ? 'var(--brand-forest)' : 'rgba(0,0,0,0.1)'}; background:${!hasLoopConfigured ? 'rgba(12, 92, 63, 0.04)' : '#ffffff'}; cursor:pointer; transition:all 0.2s;">
              <input type="radio" name="execModeRadio" value="single" ${!hasLoopConfigured ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);">
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong style="font-size:0.92rem; color:var(--text-main);">⚡ Run as Macro (Single Execution)</strong>
                  <span class="badge-tag success" style="font-size:0.65rem; padding:0.15rem 0.45rem;">Standard</span>
                </div>
                <span style="font-size:0.78rem; color:var(--text-sub);">Replays the exact recorded workflow once from start to finish. Does not iterate or loop through other rows/items.</span>
              </div>
            </label>

            <!-- Option 2: Loop Execution (Batch) -->
            <label class="exec-option-label" id="labelExecLoop" style="display:flex; gap:0.85rem; padding:0.9rem 1rem; border-radius:12px; border:2px solid ${hasLoopConfigured ? 'var(--brand-forest)' : 'rgba(0,0,0,0.1)'}; background:${hasLoopConfigured ? 'rgba(12, 92, 63, 0.04)' : '#ffffff'}; cursor:pointer; transition:all 0.2s;">
              <input type="radio" name="execModeRadio" value="loop" ${hasLoopConfigured ? 'checked' : ''} style="margin-top:0.25rem; accent-color:var(--brand-forest);">
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong style="font-size:0.92rem; color:var(--text-main);">🔁 Run as Loop (Batch / All Items)</strong>
                  ${hasLoopConfigured ? '<span class="badge-tag success" style="font-size:0.65rem; padding:0.15rem 0.45rem;">Configured</span>' : ''}
                </div>
                <span style="font-size:0.78rem; color:var(--text-sub);">Discovers repeated records (table rows, cards, or list options) on the target page and iterates the action across all items.</span>
              </div>
            </label>
          </div>

          <!-- Force Redownload Checkbox -->
          <div style="display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0.15rem;">
            <input type="checkbox" id="chkExecForceRedownload" style="accent-color:var(--brand-forest); cursor:pointer;">
            <label for="chkExecForceRedownload" style="font-size:0.8rem; color:var(--text-body); cursor:pointer; user-select:none;">Force redownload (re-download existing artifacts without skipping)</label>
          </div>

          <!-- Action Buttons -->
          <div style="display:flex; justify-content:flex-end; gap:0.65rem; margin-top:0.25rem; padding-top:1rem; border-top:1px solid rgba(0,0,0,0.06);">
            <button type="button" class="btn btn-secondary btn-sm" id="btnCancelExecModal">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" id="btnConfirmExecModal" style="display:inline-flex; align-items:center; gap:0.4rem; padding:0.55rem 1.25rem;">
              <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span id="btnConfirmExecText">Start Execution</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Highlight selected card dynamically
    const radioInputs = this.container.querySelectorAll('input[name="execModeRadio"]');
    const singleCard = this.container.querySelector('#labelExecSingle');
    const loopCard = this.container.querySelector('#labelExecLoop');

    radioInputs.forEach(radio => {
      radio.onchange = () => {
        if (radio.value === 'single') {
          singleCard.style.borderColor = 'var(--brand-forest)';
          singleCard.style.background = 'rgba(12, 92, 63, 0.04)';
          loopCard.style.borderColor = 'rgba(0,0,0,0.1)';
          loopCard.style.background = '#ffffff';
        } else {
          loopCard.style.borderColor = 'var(--brand-forest)';
          loopCard.style.background = 'rgba(12, 92, 63, 0.04)';
          singleCard.style.borderColor = 'rgba(0,0,0,0.1)';
          singleCard.style.background = '#ffffff';
        }
      };
    });

    const closeBtn = this.container.querySelector('#btnCloseExecModal');
    const cancelBtn = this.container.querySelector('#btnCancelExecModal');
    const confirmBtn = this.container.querySelector('#btnConfirmExecModal');
    const confirmText = this.container.querySelector('#btnConfirmExecText');
    const chkRedownload = this.container.querySelector('#chkExecForceRedownload');

    if (closeBtn) closeBtn.onclick = () => this.close();
    if (cancelBtn) cancelBtn.onclick = () => this.close();

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const selectedRadio = this.container.querySelector('input[name="execModeRadio"]:checked');
        const selectedMode = selectedRadio ? selectedRadio.value : 'single';
        const isLoopMode = selectedMode === 'loop';
        const forceRedownload = !!chkRedownload?.checked;

        confirmBtn.disabled = true;
        if (confirmText) confirmText.textContent = 'Launching…';
        Toast.info(`Starting ${isLoopMode ? 'batch loop' : 'single macro'} execution…`);

        try {
          const res = await Api.executeWorkflow(this.currentWorkflowId, {
            mode: selectedMode,
            isLoop: isLoopMode,
            loopStepIndex: isLoopMode ? (Number.isInteger(loopStepIndex) ? loopStepIndex : 0) : null,
            forceRedownload
          });

          this.close();
          Toast.success(`Workflow execution dispatched!`);

          if (typeof onExecuted === 'function') {
            onExecuted(res);
          } else if (res && res.runId) {
            sessionStorage.setItem('workflowCaptureActiveRunId', res.runId);
            Router.navigate(`execution/${encodeURIComponent(res.runId)}`);
          } else {
            Router.navigate('execution');
          }
        } catch (err) {
          Toast.error(err.message || 'Failed to start execution');
          confirmBtn.disabled = false;
          if (confirmText) confirmText.textContent = 'Start Execution';
        }
      };
    }

    this.container.classList.remove('hidden');
  },

  close() {
    if (this.container) {
      this.container.classList.add('hidden');
    }
  }
};
