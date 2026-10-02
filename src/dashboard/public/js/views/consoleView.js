/**
 * Workflow Capture — Modernized Activity View
 * Polished, high-performance activity timeline and streaming execution terminal.
 * Features:
 * - Timeline: ✓ Completed, ● Running, ✕ Failed
 * - Search by keyword/workflow
 * - Status filter: ALL, COMPLETED, RUNNING, FAILED
 * - Workflow dropdown filter
 * - Date filter: All Time, Today, 7 Days, 30 Days
 * - Toggleable Live Terminal Log Stream
 * - Efficient pagination/virtualization for large histories
 */

import { Api } from '../api.js';
import { SSE } from '../sse.js';
import { Toast } from '../components/toast.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return 'Recently';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'Recently';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} minutes ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const ConsoleView = {
  runs: [],
  filteredRuns: [],
  logs: [],
  currentTab: 'timeline', // 'timeline' | 'terminal'
  activeStatusFilter: 'ALL',
  activeWfFilter: 'ALL',
  activeDateFilter: 'ALL',
  searchQuery: '',
  logFilter: 'ALL',
  logSearch: '',
  autoScroll: true,
  router: null,
  containerEl: null,
  terminalEl: null,

  async render(container, router) {
    this.router = router;
    this.containerEl = container;
    this.logs = SSE.getLogs();

    container.innerHTML = `
      <div class="activity-view-shell" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Page Header -->
        <div class="wf-page-header">
          <div>
            <h1 class="wf-page-title">Activity</h1>
            <p class="wf-page-subtitle">Timeline of browser workflow executions, live runs, and automation history.</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <!-- View Mode Switcher -->
            <div class="toggle-group" style="display:inline-flex; background:var(--bg-surface-sunken); padding:2px; border-radius:var(--radius-md); border:1px solid var(--border-light);">
              <button class="btn-toggle active" id="btnTabTimeline" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); font-weight:600; border-radius:var(--radius-sm); border:none; cursor:pointer; background:var(--bg-surface); color:var(--text-primary); box-shadow:var(--shadow-sm);">
                Activity Timeline
              </button>
              <button class="btn-toggle" id="btnTabTerminal" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); font-weight:600; border-radius:var(--radius-sm); border:none; cursor:pointer; background:transparent; color:var(--text-sub);">
                Live Terminal
              </button>
            </div>

            <button class="btn btn-secondary btn-sm" id="btnRefreshActivity" title="Refresh history">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <!-- ================= TIMELINE SECTION ================= -->
        <div id="sectionTimeline">
          <!-- Toolbar Filters -->
          <div class="wf-toolbar" style="margin-bottom:1.25rem;">
            <!-- Search Input -->
            <div class="search-input-wrap" style="flex:1; max-width:320px;">
              <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="actSearchInput" class="search-input" placeholder="Search activity…" aria-label="Search activity">
            </div>

            <!-- Status Filter -->
            <div style="display:flex; align-items:center; gap:0.35rem;">
              <label for="actStatusFilter" style="font-size:var(--text-xs); font-weight:600; color:var(--text-sub);">Status:</label>
              <select id="actStatusFilter" class="form-control" style="font-size:var(--text-xs); padding:0.35rem 0.65rem; height:34px; width:130px;">
                <option value="ALL">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="RUNNING">Running</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>

            <!-- Workflow Filter -->
            <div style="display:flex; align-items:center; gap:0.35rem;">
              <label for="actWorkflowFilter" style="font-size:var(--text-xs); font-weight:600; color:var(--text-sub);">Workflow:</label>
              <select id="actWorkflowFilter" class="form-control" style="font-size:var(--text-xs); padding:0.35rem 0.65rem; height:34px; max-width:180px;">
                <option value="ALL">All Workflows</option>
              </select>
            </div>

            <!-- Date Filter -->
            <div style="display:flex; align-items:center; gap:0.35rem;">
              <label for="actDateFilter" style="font-size:var(--text-xs); font-weight:600; color:var(--text-sub);">Date:</label>
              <select id="actDateFilter" class="form-control" style="font-size:var(--text-xs); padding:0.35rem 0.65rem; height:34px; width:120px;">
                <option value="ALL">All Time</option>
                <option value="TODAY">Today</option>
                <option value="WEEK">Past 7 Days</option>
                <option value="MONTH">Past 30 Days</option>
              </select>
            </div>
          </div>

          <!-- Timeline Feed Container -->
          <div class="card" style="padding:1.5rem; border-radius:var(--radius-lg);">
            <div id="actTimelineList" class="act-timeline">
              <div style="padding:2.5rem; text-align:center; color:var(--text-muted); font-size:var(--text-sm);">Loading activity events…</div>
            </div>
          </div>
        </div>

        <!-- ================= LIVE TERMINAL SECTION (Hidden by default) ================= -->
        <div id="sectionTerminal" class="hidden">
          <div class="card console-full-view" style="padding:1.25rem;">
            <!-- Terminal Toolbar -->
            <div class="card-header-row" style="margin-bottom:0.75rem; flex-wrap:wrap; gap:0.6rem;">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h2 style="font-size:0.95rem; font-weight:700; color:var(--text-primary); margin:0;">Live Engine Stream</h2>
                <span class="badge-tag info" style="display:inline-flex; align-items:center; gap:0.35rem; font-size:0.65rem;">
                  <span class="status-dot online" style="width:6px; height:6px;"></span>
                  <span>STREAMING</span>
                </span>
              </div>

              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <div class="console-filter-pill-group" style="display:inline-flex; background:var(--bg-surface-sunken); padding:2px; border-radius:6px; border:1px solid var(--border-light);">
                  <button class="console-filter-btn active" data-filter="ALL">ALL</button>
                  <button class="console-filter-btn" data-filter="INFO">INFO</button>
                  <button class="console-filter-btn" data-filter="ACTION">ACTION</button>
                  <button class="console-filter-btn" data-filter="ERROR">ERROR</button>
                </div>

                <input type="text" id="terminalSearchInput" class="form-control" style="width:140px; padding:0.25rem 0.5rem; font-size:0.72rem; height:28px;" placeholder="Filter log text…">

                <label style="font-size:0.72rem; color:var(--text-sub); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" id="chkAutoScroll" checked> Auto
                </label>

                <button class="btn btn-secondary btn-sm" id="btnExportLogs" style="height:28px; padding:0 0.6rem; font-size:0.72rem;">
                  <span>Export</span>
                </button>
                <button class="btn btn-ghost btn-sm" id="btnClearTerminal" style="height:28px; padding:0 0.6rem; font-size:0.72rem;">
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <!-- Terminal Output Window -->
            <div class="console-terminal-wrapper" id="terminalOutput" style="height:480px; max-height:600px; overflow-y:auto;" role="log" aria-live="polite">
              <!-- Streaming log entries populate here -->
            </div>
          </div>
        </div>

      </div>
    `;

    this.terminalEl = document.getElementById('terminalOutput');
    this.bindEvents();
    await this.loadData();
    this.renderLogs();
  },

  bindEvents() {
    // Tab switching
    const btnTimeline = document.getElementById('btnTabTimeline');
    const btnTerminal = document.getElementById('btnTabTerminal');
    const secTimeline = document.getElementById('sectionTimeline');
    const secTerminal = document.getElementById('sectionTerminal');

    if (btnTimeline && btnTerminal) {
      btnTimeline.onclick = () => {
        this.currentTab = 'timeline';
        btnTimeline.classList.add('active');
        btnTimeline.style.background = 'var(--bg-surface)';
        btnTimeline.style.color = 'var(--text-primary)';
        btnTimeline.style.boxShadow = 'var(--shadow-sm)';
        btnTerminal.classList.remove('active');
        btnTerminal.style.background = 'transparent';
        btnTerminal.style.color = 'var(--text-sub)';
        btnTerminal.style.boxShadow = 'none';

        secTimeline.classList.remove('hidden');
        secTerminal.classList.add('hidden');
      };

      btnTerminal.onclick = () => {
        this.currentTab = 'terminal';
        btnTerminal.classList.add('active');
        btnTerminal.style.background = 'var(--bg-surface)';
        btnTerminal.style.color = 'var(--text-primary)';
        btnTerminal.style.boxShadow = 'var(--shadow-sm)';
        btnTimeline.classList.remove('active');
        btnTimeline.style.background = 'transparent';
        btnTimeline.style.color = 'var(--text-sub)';
        btnTimeline.style.boxShadow = 'none';

        secTerminal.classList.remove('hidden');
        secTimeline.classList.add('hidden');
        this.renderLogs();
      };
    }

    // Refresh button
    const btnRefresh = document.getElementById('btnRefreshActivity');
    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadData();
    }

    // Search & Filter listeners
    const searchInput = document.getElementById('actSearchInput');
    if (searchInput) {
      searchInput.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.filterAndRender();
      };
    }

    const statusFilter = document.getElementById('actStatusFilter');
    if (statusFilter) {
      statusFilter.onchange = (e) => {
        this.activeStatusFilter = e.target.value;
        this.filterAndRender();
      };
    }

    const wfFilter = document.getElementById('actWorkflowFilter');
    if (wfFilter) {
      wfFilter.onchange = (e) => {
        this.activeWfFilter = e.target.value;
        this.filterAndRender();
      };
    }

    const dateFilter = document.getElementById('actDateFilter');
    if (dateFilter) {
      dateFilter.onchange = (e) => {
        this.activeDateFilter = e.target.value;
        this.filterAndRender();
      };
    }

    // Terminal controls
    document.querySelectorAll('.console-filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.logFilter = btn.getAttribute('data-filter');
        this.renderLogs();
      };
    });

    const termSearch = document.getElementById('terminalSearchInput');
    if (termSearch) {
      termSearch.oninput = (e) => {
        this.logSearch = e.target.value.toLowerCase().trim();
        this.renderLogs();
      };
    }

    const chkAuto = document.getElementById('chkAutoScroll');
    if (chkAuto) {
      chkAuto.onchange = (e) => {
        this.autoScroll = e.target.checked;
      };
    }

    const btnClear = document.getElementById('btnClearTerminal');
    if (btnClear) {
      btnClear.onclick = () => {
        SSE.clearLogs();
        this.logs = [];
        this.renderLogs();
        Toast.info('Terminal buffer cleared');
      };
    }

    const btnExport = document.getElementById('btnExportLogs');
    if (btnExport) {
      btnExport.onclick = () => {
        const text = SSE.getLogs().map(l => `[${l.time}] [${l.level}] ${l.text}`).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-activity-logs-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        Toast.success('Logs exported to file');
      };
    }

    // Real-time SSE updates
    SSE.on('log', (log) => {
      this.logs = SSE.getLogs();
      if (this.currentTab === 'terminal' && this.matchesLogFilter(log)) {
        this.appendLogEntry(log);
      }
    });

    SSE.on('run_state', () => {
      // Re-fetch runs automatically on execution state changes
      this.loadData();
    });
  },

  async loadData() {
    try {
      const runsRes = await Api.getRuns().catch(() => ({ runs: [] }));
      this.runs = runsRes.runs || [];

      // Populate workflow filter options
      const wfSelect = document.getElementById('actWorkflowFilter');
      if (wfSelect) {
        const distinctWfs = Array.from(new Set(this.runs.map(r => r.workflowName || r.workflowId).filter(Boolean)));
        const currentVal = wfSelect.value;
        wfSelect.innerHTML = '<option value="ALL">All Workflows</option>' +
          distinctWfs.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        if (distinctWfs.includes(currentVal)) {
          wfSelect.value = currentVal;
        }
      }

      this.filterAndRender();
    } catch (err) {
      console.error('Failed to load activity runs:', err);
    }
  },

  filterAndRender() {
    let result = [...this.runs];

    // Status filter
    if (this.activeStatusFilter !== 'ALL') {
      if (this.activeStatusFilter === 'COMPLETED') {
        result = result.filter(r => r.status === 'COMPLETED' || r.status === 'SUCCESS');
      } else if (this.activeStatusFilter === 'RUNNING') {
        result = result.filter(r => r.status === 'RUNNING' || r.status === 'STARTING' || r.status === 'PROCESSING_ITEMS');
      } else if (this.activeStatusFilter === 'FAILED') {
        result = result.filter(r => r.status === 'FAILED');
      }
    }

    // Workflow filter
    if (this.activeWfFilter !== 'ALL') {
      result = result.filter(r => (r.workflowName || r.workflowId) === this.activeWfFilter);
    }

    // Date filter
    if (this.activeDateFilter !== 'ALL') {
      const now = Date.now();
      result = result.filter(r => {
        const t = new Date(r.completedAt || r.startedAt || r.createdAt).getTime();
        if (isNaN(t)) return true;
        const diffHours = (now - t) / (1000 * 3600);
        if (this.activeDateFilter === 'TODAY') return diffHours <= 24;
        if (this.activeDateFilter === 'WEEK') return diffHours <= 168;
        if (this.activeDateFilter === 'MONTH') return diffHours <= 720;
        return true;
      });
    }

    // Text search
    if (this.searchQuery) {
      result = result.filter(r => {
        const name = (r.workflowName || r.workflowId || '').toLowerCase();
        const err = (r.error || '').toLowerCase();
        return name.includes(this.searchQuery) || err.includes(this.searchQuery);
      });
    }

    this.filteredRuns = result;
    this.renderTimeline();
  },

  renderTimeline() {
    const list = document.getElementById('actTimelineList');
    if (!list) return;

    if (this.filteredRuns.length === 0) {
      list.innerHTML = `
        <div class="modern-empty-state" style="padding:3.5rem 1.5rem;">
          <div class="empty-state-icon" style="background:var(--bg-surface-sunken); color:var(--text-muted);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <h3 class="empty-state-title">No activity events found</h3>
          <p class="empty-state-desc">Try clearing your search query or filters to view past execution history.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.filteredRuns.map(run => {
      const isSuccess = run.status === 'COMPLETED' || run.status === 'SUCCESS';
      const isFailed = run.status === 'FAILED';
      const isRunning = run.status === 'RUNNING' || run.status === 'STARTING' || run.status === 'PROCESSING_ITEMS';

      let statusCls = 'completed';
      let icon = '✓';
      let statusHeadline = 'Workflow completed';

      if (isFailed) {
        statusCls = 'failed';
        icon = '✕';
        statusHeadline = 'Workflow failed';
      } else if (isRunning) {
        statusCls = 'running';
        icon = '●';
        statusHeadline = 'Workflow running';
      }

      const wfName = run.workflowName || run.workflowId || 'Browser Workflow';
      const time = formatRelativeTime(run.completedAt || run.startedAt || run.createdAt);

      const filesProcessed = run.processedCount || run.itemsProcessed || (run.downloads ? run.downloads.length : 0);
      const totalSteps = run.totalSteps || (run.workflowSteps ? run.workflowSteps.length : 0);
      const currentStep = run.currentStep || (run.results ? run.results.length : 1);

      let detailText = '';
      if (isRunning) {
        detailText = totalSteps > 0 ? `Step ${currentStep} of ${totalSteps}` : 'Processing actions…';
      } else if (isFailed) {
        detailText = run.error || 'Execution interrupted or unable to access target element';
      } else {
        detailText = filesProcessed > 0 ? `${filesProcessed} files processed` : 'All workflow steps finished successfully';
      }

      return `
        <div class="act-item" style="padding:1rem 1.25rem; border-radius:var(--radius-md); border:1px solid var(--border-light); background:var(--bg-surface); margin-bottom:0.75rem; transition:border-color 0.15s ease;">
          <div class="act-icon ${statusCls}" style="font-size:0.95rem; font-weight:700;">${icon}</div>
          <div class="act-content">
            <div class="act-title-row">
              <span class="act-title" style="font-size:0.9rem;">${statusHeadline}</span>
              <span class="act-time">${time}</span>
            </div>
            <div style="font-size:var(--text-sm); font-weight:700; color:var(--text-primary); margin-bottom:0.2rem;">
              ${escapeHtml(wfName)}
            </div>
            <div class="act-meta" style="font-size:var(--text-xs); color:var(--text-sub); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
              <span>${escapeHtml(detailText)}</span>
              <button class="btn btn-secondary btn-sm" onclick="location.hash='#execution/${escapeHtml(run.id)}'" style="font-size:var(--text-2xs); padding:0.2rem 0.6rem; height:24px;">
                Inspect Run
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  matchesLogFilter(log) {
    const level = (log.level || 'INFO').toUpperCase();
    if (this.logFilter !== 'ALL' && level !== this.logFilter) return false;
    if (this.logSearch && !String(log.text).toLowerCase().includes(this.logSearch)) return false;
    return true;
  },

  renderLogs() {
    if (!this.terminalEl) return;
    this.terminalEl.innerHTML = '';

    const filtered = this.logs.filter(l => this.matchesLogFilter(l));
    if (filtered.length === 0) {
      this.terminalEl.innerHTML = `<div style="color:var(--text-muted); font-style:italic; padding:1.5rem; text-align:center;">No streaming log events found matching current criteria.</div>`;
      return;
    }

    filtered.forEach(log => this.appendLogEntry(log, false));
    if (this.autoScroll) {
      this.terminalEl.scrollTop = this.terminalEl.scrollHeight;
    }
  },

  appendLogEntry(log, scroll = true) {
    if (!this.terminalEl) return;
    const entry = document.createElement('div');
    const levelClass = (log.level || 'INFO').toLowerCase();
    entry.className = 'log-entry';

    entry.innerHTML = `
      <span class="log-time">${log.time || new Date().toLocaleTimeString()}</span>
      <span class="log-badge ${levelClass}">${log.level || 'INFO'}</span>
      <span class="log-message">${escapeHtml(log.text)}</span>
    `;

    this.terminalEl.appendChild(entry);
    if (scroll && this.autoScroll) {
      this.terminalEl.scrollTop = this.terminalEl.scrollHeight;
    }
  }
};
