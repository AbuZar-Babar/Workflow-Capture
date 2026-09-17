/**
 * Workflow Capture — Workflows View (Archive & Detailed Inspector)
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';

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
              <span class="search-icon-pos">🔍</span>
              <input type="text" id="wfSearchInput" class="form-control" placeholder="Search by name, URL, or step count...">
            </div>
            <button class="btn btn-secondary btn-sm" id="btnRefreshWorkflows">
              <span>🔄 Refresh List</span>
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
      const data = await Api.getRecordings();
      this.recordings = data.recordings || [];
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
        (wf.startUrl && wf.startUrl.toLowerCase().includes(this.searchFilter)) ||
        (wf.filename && wf.filename.toLowerCase().includes(this.searchFilter))
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
      const createdDate = wf.startedAt ? new Date(wf.startedAt) : new Date();
      const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = createdDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        <td>
          <div class="wf-icon-cell">
            <div class="wf-avatar">#${idx + 1}</div>
            <div>
              <strong style="color:var(--text-main); font-weight:700;">${escapeHtml(wf.name)}</strong>
              <div style="font-size:0.68rem; color:var(--text-sub); font-family:var(--font-mono);">
                ${escapeHtml(wf.filename)}
              </div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge-tag success">⚡ ${wf.actionCount} steps</span>
        </td>
        <td>
          <div style="font-size:0.75rem; color:var(--text-body); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(wf.startUrl)}">
            🔗 ${escapeHtml(wf.startUrl || 'about:blank')}
          </div>
        </td>
        <td>
          <div style="font-size:0.75rem; font-weight:600; color:var(--text-body);">${dateStr}</div>
          <div style="font-size:0.68rem; color:var(--text-sub);">${timeStr}</div>
        </td>
        <td>
          <span class="badge-tag success">● Verified</span>
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:0.35rem;">
            <button class="btn btn-sm btn-primary btn-replay-flow" data-file="${wf.filename}" title="Replay Flow">
              ▶ Replay
            </button>
            <button class="btn btn-sm btn-secondary btn-inspect-flow" data-file="${wf.filename}" title="Inspect Action Fingerprints">
              🔍 Inspect
            </button>
            <a class="btn btn-sm btn-secondary" href="/recordings/${encodeURIComponent(wf.filename)}" download="${wf.filename}" title="Download JSON" target="_blank">
              💾 JSON
            </a>
            <button class="btn btn-sm btn-ghost btn-delete-flow" data-file="${wf.filename}" title="Delete Flow">
              🗑
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });

    // Bind action buttons
    tbody.querySelectorAll('.btn-replay-flow').forEach(btn => {
      btn.onclick = async () => {
        Toast.info(`Starting playback for ${btn.dataset.file}...`);
        try {
          await Api.startReplay({ filename: btn.dataset.file });
          Toast.success(`Playback running!`);
        } catch (err) {
          Toast.error(err.message);
        }
      };
    });

    tbody.querySelectorAll('.btn-inspect-flow').forEach(btn => {
      btn.onclick = () => {
        const wf = this.recordings.find(w => w.filename === btn.dataset.file);
        if (wf) Modal.inspect(wf);
      };
    });

    tbody.querySelectorAll('.btn-delete-flow').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Are you sure you want to delete "${btn.dataset.file}"?`)) return;
        try {
          await Api.deleteRecording(btn.dataset.file);
          Toast.info(`Deleted ${btn.dataset.file}`);
          this.loadWorkflows();
        } catch (err) {
          Toast.error(err.message);
        }
      };
    });
  }
};
