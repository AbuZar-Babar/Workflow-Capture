/**
 * Workflow Capture — Workflow Library View
 * Clean, production-grade library with real metrics, search,
 * accessible actions, and seamless recorder integration.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDomain(url) {
  if (!url || url === 'about:blank') return '—';
  try {
    const raw = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    const parsed = new URL(raw);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.length > 30 ? url.slice(0, 27) + '…' : url;
  }
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return 'Never run';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'Never run';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const WorkflowsView = {
  recordings: [],
  lastRunMap: new Map(),
  searchFilter: '',
  cachedWorkflows: null,
  isInitialRender: true,
  searchDebounceTimer: null,
  isFetching: false,
  keydownHandler: null,
  router: null,

  async render(container, router) {
    this.router = router;
    this.isInitialRender = true;

    // Use cached workflows immediately if available (0ms instant render)
    const hasCache = Array.isArray(this.cachedWorkflows) && this.cachedWorkflows.length > 0;
    if (hasCache) {
      this.recordings = this.cachedWorkflows;
    }

    container.innerHTML = `
      <div class="wf-view-container" style="display:flex; flex-direction:column; gap:1.25rem;">

        <!-- Workflow Library Header & Summary Strip -->
        <header class="card" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <h1 style="font-size:1.25rem; font-weight:800; color:var(--text-primary); margin:0; letter-spacing:-0.02em;">Workflow Library</h1>
              <span class="badge-tag success" id="wfCountBadge" style="font-size:0.75rem; font-weight:700;">
                ${this.recordings.length} Workflows
              </span>
            </div>
            <p style="font-size:0.825rem; color:var(--text-sub); margin:0;">
              Manage, run, and edit your recorded browser automation workflows.
            </p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <button class="btn btn-primary" id="btnHeaderRecordWorkflow" title="Record a new browser automation workflow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="7"></circle>
              </svg>
              <span>Record Workflow</span>
            </button>
          </div>
        </header>

        <!-- Real Metrics Summary Strip (Calculated Strictly From Live Data) -->
        <section class="wf-real-stats-strip" id="wfStatsStrip" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem;">
          <div class="card" style="padding:1rem 1.25rem; display:flex; align-items:center; gap:1rem;">
            <div style="width:40px; height:40px; border-radius:var(--radius-md); background:var(--accent-subtle); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </div>
            <div>
              <span style="font-size:0.72rem; font-weight:600; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.04em; display:block;">Total Workflows</span>
              <strong id="statTotalWorkflows" style="font-size:1.25rem; font-weight:800; color:var(--text-primary); line-height:1.2;">${this.recordings.length}</strong>
            </div>
          </div>

          <div class="card" style="padding:1rem 1.25rem; display:flex; align-items:center; gap:1rem;">
            <div style="width:40px; height:40px; border-radius:var(--radius-md); background:var(--color-success-bg); color:var(--color-success); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
            </div>
            <div>
              <span style="font-size:0.72rem; font-weight:600; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.04em; display:block;">Recorded Steps</span>
              <strong id="statTotalSteps" style="font-size:1.25rem; font-weight:800; color:var(--text-primary); line-height:1.2;">
                ${this.recordings.reduce((sum, w) => sum + (w.stepCount || 0), 0)}
              </strong>
            </div>
          </div>

          <div class="card" style="padding:1rem 1.25rem; display:flex; align-items:center; gap:1rem;">
            <div style="width:40px; height:40px; border-radius:var(--radius-md); background:var(--color-info-bg); color:var(--color-info); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </div>
            <div>
              <span style="font-size:0.72rem; font-weight:600; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.04em; display:block;">Target Websites</span>
              <strong id="statTargetWebsites" style="font-size:1.25rem; font-weight:800; color:var(--text-primary); line-height:1.2;">
                ${new Set(this.recordings.map(w => formatDomain(w.targetUrl)).filter(d => d && d !== '—')).size}
              </strong>
            </div>
          </div>
        </section>

        <!-- Main Workflows Catalog Card -->
        <section class="card" style="padding:0; overflow:hidden;">

          <!-- Search Toolbar -->
          <div style="padding:1rem 1.5rem; border-bottom:1px solid var(--border-light); display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
            <div style="position:relative; flex:1; min-width:240px; max-width:420px;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute; left:0.85rem; top:50%; transform:translateY(-50%); color:var(--text-muted); pointer-events:none;">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="search"
                id="wfSearchInput"
                class="form-control"
                placeholder="Search workflows…"
                aria-label="Search workflows"
                style="padding-left:2.4rem; padding-right:2.8rem;"
                autocomplete="off"
              />
              <span style="position:absolute; right:0.75rem; top:50%; transform:translateY(-50%); font-size:0.68rem; font-family:var(--font-mono); color:var(--text-muted); background:var(--bg-surface-sunken); padding:2px 5px; border-radius:4px; border:1px solid var(--border-light); pointer-events:none;">
                ⌘K
              </span>
            </div>

            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btnRefreshWorkflows" title="Refresh workflows list" aria-label="Refresh workflows list">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <!-- Workflows Table Container -->
          <div class="table-responsive" id="wfTableWrapper">
            <table class="quixotic-table" id="wfTable" style="margin:0;">
              <thead>
                <tr>
                  <th style="width:28%; padding-left:1.5rem;">Workflow Name</th>
                  <th style="width:22%;">Target Website</th>
                  <th style="width:12%;">Steps</th>
                  <th style="width:14%;">Created</th>
                  <th style="width:12%;">Last Run</th>
                  <th style="text-align:right; padding-right:1.5rem;">Actions</th>
                </tr>
              </thead>
              <tbody id="wfTableBody">
                ${hasCache ? '' : `
                  <tr>
                    <td colspan="6" style="text-align:center; padding:3rem 1.5rem; color:var(--text-sub);">
                      Loading workflows…
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>

          <!-- Dedicated Empty State Container (rendered when 0 workflows) -->
          <div id="wfEmptyStateContainer" class="hidden" style="padding:3.5rem 1.5rem; text-align:center;">
            <div style="max-width:440px; margin:0 auto; display:flex; flex-direction:column; align-items:center; gap:1rem;">
              <div style="width:52px; height:52px; border-radius:50%; background:var(--accent-subtle); color:var(--accent-primary); display:flex; align-items:center; justify-content:center;">
                <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </div>
              <div>
                <h3 style="font-size:1.15rem; font-weight:800; color:var(--text-primary); margin:0 0 0.35rem 0;">No workflows yet</h3>
                <p style="font-size:0.875rem; color:var(--text-sub); margin:0; line-height:1.5;">
                  Record a workflow to automate a repeated task.
                </p>
              </div>
              <button class="btn btn-primary" id="btnEmptyRecordWorkflow" style="margin-top:0.5rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="7"></circle>
                </svg>
                <span>Record Workflow</span>
              </button>
            </div>
          </div>

        </section>

      </div>
    `;

    this.bindEvents(router);

    if (hasCache) {
      this.renderTable();
    }

    // Always fetch latest data in background (Stale-While-Revalidate)
    this.loadWorkflows(!hasCache);
  },

  bindEvents(router) {
    const searchInput = document.getElementById('wfSearchInput');
    const btnRefresh = document.getElementById('btnRefreshWorkflows');
    const tbody = document.getElementById('wfTableBody');
    const btnHeaderRecord = document.getElementById('btnHeaderRecordWorkflow');
    const btnEmptyRecord = document.getElementById('btnEmptyRecordWorkflow');

    // Connect Record Workflow CTA to existing recording flow
    const triggerRecordFlow = () => {
      Router.navigate('overview');
      setTimeout(() => {
        const input = document.getElementById('overviewRecName');
        if (input) {
          input.focus();
          input.select?.();
        }
      }, 120);
    };

    if (btnHeaderRecord) btnHeaderRecord.onclick = triggerRecordFlow;
    if (btnEmptyRecord) btnEmptyRecord.onclick = triggerRecordFlow;

    // Search input debouncer
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(this.searchDebounceTimer);
        const val = e.target.value.toLowerCase().trim();
        this.searchDebounceTimer = setTimeout(() => {
          this.searchFilter = val;
          this.renderTable(false);
        }, 80);
      };
    }

    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadWorkflows(true);
    }

    // Delegated single event listener for table actions
    if (tbody) {
      tbody.onclick = async (e) => {
        // 1. Run Workflow
        const runBtn = e.target.closest('.btn-run-wf');
        if (runBtn) {
          const wfId = runBtn.dataset.id;
          const wf = this.recordings.find(w => w.id === wfId) || {};
          ExecutionModal.open({
            workflowId: wfId,
            workflowName: wf.name || wfId,
            stepCount: wf.stepCount || 0,
            loopStepIndex: wf.loopStepIndex,
            isLoop: wf.isLoop || wf.mode === 'LOOP'
          });
          return;
        }

        // 2. Edit Workflow
        const editBtn = e.target.closest('.btn-edit-wf');
        if (editBtn) {
          Router.navigate(`workflow-editor/${editBtn.dataset.id}`);
          return;
        }

        // 3. Delete Workflow
        const deleteBtn = e.target.closest('.btn-delete-wf');
        if (deleteBtn) {
          const wfId = deleteBtn.dataset.id;
          const wf = this.recordings.find(w => w.id === wfId) || {};
          const wfName = wf.name || wfId;

          if (!confirm(`Are you sure you want to delete workflow "${wfName}"? This action cannot be undone.`)) {
            return;
          }

          try {
            await Api.deleteWorkflow(wfId);
            Toast.info(`Deleted workflow "${wfName}"`);
            this.loadWorkflows(true);
          } catch (err) {
            Toast.error(err.message || 'Failed to delete workflow');
          }
          return;
        }
      };
    }

    // Keyboard shortcut ⌘K or Ctrl+K to focus search
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const input = document.getElementById('wfSearchInput');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  },

  async loadWorkflows(showSpinner = false) {
    if (this.isFetching) return;
    this.isFetching = true;

    const btnRefresh = document.getElementById('btnRefreshWorkflows');
    if (btnRefresh) btnRefresh.style.opacity = '0.7';

    try {
      // Parallel fetch for workflows list and live runs to extract real last run timestamps
      const [wfData, runsData] = await Promise.all([
        Api.getWorkflows(),
        Api.getRuns().catch(() => ({ runs: [] }))
      ]);

      const freshList = wfData.workflows || [];
      this.cachedWorkflows = freshList;
      this.recordings = freshList;

      // Build real Last Run lookup from application runs database
      this.lastRunMap.clear();
      const runs = runsData?.runs || [];
      for (const run of runs) {
        if (!run.workflowId) continue;
        const existing = this.lastRunMap.get(run.workflowId);
        const runTime = new Date(run.completedAt || run.startedAt || 0).getTime();
        if (!existing || runTime > existing.time) {
          this.lastRunMap.set(run.workflowId, {
            time: runTime,
            date: run.completedAt || run.startedAt,
            status: run.status
          });
        }
      }

      this.updateStats();
      this.renderTable(this.isInitialRender);
      this.isInitialRender = false;
    } catch (err) {
      if (showSpinner) Toast.error(err.message || 'Failed to load workflows');
    } finally {
      this.isFetching = false;
      if (btnRefresh) btnRefresh.style.opacity = '1';
    }
  },

  updateStats() {
    const total = this.recordings.length;
    const badge = document.getElementById('wfCountBadge');
    if (badge) badge.textContent = `${total} Workflow${total === 1 ? '' : 's'}`;

    const statWf = document.getElementById('statTotalWorkflows');
    if (statWf) statWf.textContent = total;

    const totalSteps = this.recordings.reduce((sum, w) => sum + (w.stepCount || 0), 0);
    const statSteps = document.getElementById('statTotalSteps');
    if (statSteps) statSteps.textContent = totalSteps;

    const uniqueDomains = new Set(
      this.recordings.map(w => formatDomain(w.targetUrl)).filter(d => d && d !== '—')
    ).size;
    const statDomains = document.getElementById('statTargetWebsites');
    if (statDomains) statDomains.textContent = uniqueDomains;
  },

  renderTable(animate = false) {
    const tbody = document.getElementById('wfTableBody');
    const tableWrapper = document.getElementById('wfTableWrapper');
    const emptyState = document.getElementById('wfEmptyStateContainer');
    if (!tbody) return;

    let filtered = this.recordings;
    if (this.searchFilter) {
      const q = this.searchFilter.toLowerCase();
      filtered = filtered.filter(wf =>
        (wf.name && wf.name.toLowerCase().includes(q)) ||
        (wf.targetUrl && wf.targetUrl.toLowerCase().includes(q)) ||
        formatDomain(wf.targetUrl).toLowerCase().includes(q) ||
        String(wf.stepCount || '').includes(q)
      );
    }

    // Check if entire library is empty vs search yielded 0 results
    if (this.recordings.length === 0) {
      if (tableWrapper) tableWrapper.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (tableWrapper) tableWrapper.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:3rem 1.5rem; color:var(--text-sub);">
            <div style="display:flex; flex-direction:column; align-items:center; gap:0.5rem;">
              <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--text-muted);">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>No workflows match "<strong>${escapeHtml(this.searchFilter)}</strong>"</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const rowsHtml = filtered.map((wf) => {
      const createdDate = wf.createdAt ? new Date(wf.createdAt) : new Date();
      const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const domain = formatDomain(wf.targetUrl);

      // Real last run data from application
      const lastRunInfo = this.lastRunMap.get(wf.id);
      const lastRunText = lastRunInfo ? formatRelativeTime(lastRunInfo.date) : 'Never run';
      const lastRunStatus = lastRunInfo?.status || null;

      let lastRunBadge = '';
      if (lastRunStatus === 'COMPLETED' || lastRunStatus === 'SUCCESS') {
        lastRunBadge = `<span class="badge-tag success" style="font-size:0.65rem; padding:1px 6px;">Pass</span>`;
      } else if (lastRunStatus === 'FAILED' || lastRunStatus === 'ERROR') {
        lastRunBadge = `<span class="badge-tag danger" style="font-size:0.65rem; padding:1px 6px;">Failed</span>`;
      } else if (lastRunStatus === 'RUNNING') {
        lastRunBadge = `<span class="badge-tag warning" style="font-size:0.65rem; padding:1px 6px;">Running</span>`;
      }

      return `
        <tr>
          <td style="padding-left:1.5rem;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <div style="width:34px; height:34px; border-radius:var(--radius-md); background:var(--accent-subtle); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </div>
              <div style="min-width:0;">
                <strong style="color:var(--text-primary); font-weight:700; font-size:0.875rem; display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                  ${escapeHtml(wf.name || 'Untitled Workflow')}
                </strong>
                ${wf.description ? `
                  <div style="font-size:0.72rem; color:var(--text-sub); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:260px;">
                    ${escapeHtml(wf.description)}
                  </div>
                ` : ''}
              </div>
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.4rem; font-size:0.8125rem; color:var(--text-secondary);" title="${escapeHtml(wf.targetUrl || 'None')}">
              ${domain !== '—' ? `
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--accent-primary); flex-shrink:0;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                </svg>
                <span style="font-weight:600;">${escapeHtml(domain)}</span>
              ` : `
                <span style="color:var(--text-muted);">—</span>
              `}
            </div>
          </td>
          <td>
            <span class="badge-tag" style="background:var(--bg-surface-sunken); border:1px solid var(--border-light); color:var(--text-secondary); font-size:0.75rem; font-weight:600;">
              ${wf.stepCount || 0} steps
            </span>
          </td>
          <td>
            <span style="font-size:0.8125rem; color:var(--text-secondary);">
              ${dateStr}
            </span>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.35rem; font-size:0.8125rem; color:var(--text-secondary);">
              <span>${escapeHtml(lastRunText)}</span>
              ${lastRunBadge}
            </div>
          </td>
          <td style="text-align:right; padding-right:1.5rem;">
            <div style="display:inline-flex; gap:0.5rem; align-items:center;">
              <button
                class="btn btn-primary btn-sm btn-run-wf"
                data-id="${escapeHtml(wf.id)}"
                title="Run workflow"
                aria-label="Run workflow ${escapeHtml(wf.name || wf.id)}"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>Run</span>
              </button>

              <button
                class="btn btn-secondary btn-sm btn-edit-wf"
                data-id="${escapeHtml(wf.id)}"
                title="Edit workflow steps in editor"
                aria-label="Edit workflow ${escapeHtml(wf.name || wf.id)}"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Edit</span>
              </button>

              <button
                class="btn btn-secondary btn-sm btn-delete-wf"
                data-id="${escapeHtml(wf.id)}"
                title="Delete workflow"
                aria-label="Delete workflow ${escapeHtml(wf.name || wf.id)}"
                style="color:var(--color-danger);"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
  },

  destroy() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
};
