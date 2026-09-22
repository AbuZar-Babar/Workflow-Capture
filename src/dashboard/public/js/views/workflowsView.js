/**
 * Workflow Capture — Workflows View (Archive & Detailed Inspector)
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const WorkflowsView = {
  recordings: [],
  searchFilter: '',

  async render(container, router) {
    container.innerHTML = `
      <section class="card" style="min-height:70vh;">
        
        <!-- Header & Action Toolbar -->
        <div class="workflows-header-controls">
          <div class="card-title-wrap">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main);">Recorded Workflows Archive</h2>
              <span class="badge-tag success" id="wfCountBadge">0</span>
            </div>
            <p>Full catalog of browser recording sessions, selector fingerprints, and action sequences</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
            <div class="search-input-wrap">
              <span class="search-icon-pos" style="display:flex; align-items:center;">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </span>
              <input type="text" id="wfSearchInput" class="form-control" placeholder="Search by name, URL, or step count...">
            </div>
            <button class="btn btn-secondary btn-sm" id="btnRefreshWorkflows" style="display:flex; align-items:center; gap:0.35rem;">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              <span>Refresh List</span>
            </button>
          </div>
        </div>

        <!-- Workflows Table -->
        <div class="table-responsive" style="margin-top:0.5rem;">
          <table class="quixotic-table">
            <thead>
              <tr>
                <th style="width:30%;">Workflow Name</th>
                <th>Actions</th>
                <th>Start Target URL</th>
                <th>Captured Date</th>
                <th>Status</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="wfTableBody">
              <tr>
                <td colspan="6" style="text-align:center; padding:2rem; color:var(--text-sub);">
                  Loading recorded workflows...
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </section>
    `;

    this.bindEvents(router);
    this.loadWorkflows();
  },

  bindEvents(router) {
    const searchInput = document.getElementById('wfSearchInput');
    const btnRefresh = document.getElementById('btnRefreshWorkflows');

    if (searchInput) {
      searchInput.oninput = (e) => {
        this.searchFilter = e.target.value.toLowerCase().trim();
        this.renderTable();
      };
    }

    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadWorkflows();
    }
  },

  async loadWorkflows() {
    try {
      const data = await Api.getWorkflows();
      this.recordings = data.workflows || [];
      const badge = document.getElementById('wfCountBadge');
      if (badge) badge.textContent = this.recordings.length;
      this.renderTable();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  renderTable() {
    const tbody = document.getElementById('wfTableBody');
    if (!tbody) return;

    let filtered = this.recordings;
    if (this.searchFilter) {
      filtered = filtered.filter(wf => 
        (wf.name && wf.name.toLowerCase().includes(this.searchFilter)) ||
        (wf.targetUrl && wf.targetUrl.toLowerCase().includes(this.searchFilter)) ||
        (wf.id && wf.id.toLowerCase().includes(this.searchFilter))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:2.5rem; color:var(--text-sub);">
            ${this.searchFilter ? 'No workflows match your search query.' : 'No recorded workflows found. Use the Workflow Recorder on the Overview tab to record your first flow!'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach((wf, idx) => {
      const row = document.createElement('tr');
      const createdDate = wf.createdAt ? new Date(wf.createdAt) : new Date();
      const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = createdDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        <td>
          <div class="wf-icon-cell">
            <div class="wf-avatar">#${idx + 1}</div>
            <div>
              <strong style="color:var(--text-main); font-weight:700;">${escapeHtml(wf.name)}</strong>
              <div style="font-size:0.68rem; color:var(--text-sub); font-family:var(--font-mono);">
                ${escapeHtml(wf.id)}
              </div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge-tag success" style="display:inline-flex; align-items:center; gap:0.25rem;">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            ${wf.stepCount} steps
          </span>
        </td>
        <td>
          <div style="font-size:0.75rem; color:var(--text-body); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.3rem;" title="${escapeHtml(wf.targetUrl)}">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
            <span>${escapeHtml(wf.targetUrl || 'about:blank')}</span>
          </div>
        </td>
        <td>
          <div style="font-size:0.75rem; font-weight:600; color:var(--text-body);">${dateStr}</div>
          <div style="font-size:0.68rem; color:var(--text-sub);">${timeStr}</div>
        </td>
        <td>
          <span class="badge-tag success">Active</span>
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:0.35rem;">
            <button class="btn btn-sm btn-primary btn-replay-flow" data-id="${wf.id}" title="Execute Workflow" style="display:inline-flex; align-items:center; gap:0.25rem;">
              <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span>Execute</span>
            </button>
            <button class="btn btn-sm btn-secondary btn-edit-flow" data-id="${wf.id}" title="Edit Flow" style="display:inline-flex; align-items:center; gap:0.25rem;">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              <span>Edit</span>
            </button>
            <button class="btn btn-sm btn-ghost btn-delete-flow" data-id="${wf.id}" title="Delete Flow" style="color:#ef4444;">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });

    // Bind action buttons
    tbody.querySelectorAll('.btn-replay-flow').forEach(btn => {
      btn.onclick = () => {
        const wfId = btn.dataset.id;
        const wf = this.recordings.find(w => w.id === wfId) || {};
        ExecutionModal.open({
          workflowId: wfId,
          workflowName: wf.name || wfId,
          stepCount: wf.stepCount || 0,
          loopStepIndex: wf.loopStepIndex,
          isLoop: wf.isLoop || wf.mode === 'LOOP'
        });
      };
    });

    tbody.querySelectorAll('.btn-edit-flow').forEach(btn => {
      btn.onclick = () => {
        Router.navigate(`workflow-editor/${btn.dataset.id}`);
      };
    });

    tbody.querySelectorAll('.btn-delete-flow').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Are you sure you want to delete this workflow?`)) return;
        try {
          await Api.deleteWorkflow(btn.dataset.id);
          Toast.info(`Deleted workflow`);
          this.loadWorkflows();
        } catch (err) {
          Toast.error(err.message);
        }
      };
    });
  }
};
