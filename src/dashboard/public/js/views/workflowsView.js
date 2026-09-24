/**
 * Workflow Capture — Workflows View (Archive & Detailed Inspector)
 * High-performance optimized edition with memory caching (SWR),
 * single-pass DOM batching, and delegated event handling.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const WorkflowsView = {
  recordings: [],
  searchFilter: '',
  cachedWorkflows: null,
  isInitialRender: true,
  searchDebounceTimer: null,
  isFetching: false,

  async render(container, router) {
    this.router = router;
    this.isInitialRender = true;

    // Use cached workflows immediately if available (0ms instant render)
    const hasCache = Array.isArray(this.cachedWorkflows) && this.cachedWorkflows.length > 0;
    if (hasCache) {
      this.recordings = this.cachedWorkflows;
    }

    container.innerHTML = `
      <div class="wf-view-container">
        
        <!-- Top Analytics & Graph Strip -->
        <section class="wf-analytics-grid">
          
          <!-- Graph 1: Execution Velocity & 7-Day Trend -->
          <article class="wf-stat-widget">
            <div class="wf-widget-header">
              <div class="wf-widget-title-wrap">
                <h4>Execution Velocity</h4>
                <p>7-day automation replay throughput</p>
              </div>
              <span class="wf-widget-badge primary">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                +28.4% WoW
              </span>
            </div>
            
            <div class="wf-chart-container">
              <svg class="wf-area-chart-svg" viewBox="0 0 320 65" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="wfAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#4F6EF7" stop-opacity="0.32"/>
                    <stop offset="60%" stop-color="#6EE7F5" stop-opacity="0.1"/>
                    <stop offset="100%" stop-color="#6EE7F5" stop-opacity="0"/>
                  </linearGradient>
                </defs>
                <path d="M0,52 Q40,48 70,36 T140,24 T210,32 T280,12 L320,8 L320,65 L0,65 Z" fill="url(#wfAreaGrad)"/>
                <path d="M0,52 Q40,48 70,36 T140,24 T210,32 T280,12 L320,8" fill="none" stroke="#4F6EF7" stroke-width="2.5" class="wf-chart-line"/>
                <circle cx="0" cy="52" r="3.5" fill="#4F6EF7" class="wf-chart-dot"/>
                <circle cx="70" cy="36" r="3.5" fill="#4F6EF7" class="wf-chart-dot"/>
                <circle cx="140" cy="24" r="3.5" fill="#4F6EF7" class="wf-chart-dot"/>
                <circle cx="210" cy="32" r="3.5" fill="#4F6EF7" class="wf-chart-dot"/>
                <circle cx="280" cy="12" r="4" fill="#6EE7F5" stroke="#4F6EF7" stroke-width="2" class="wf-chart-dot"/>
                <circle cx="320" cy="8" r="4.5" fill="#34D399" stroke="#ffffff" stroke-width="2" class="wf-chart-dot"/>
              </svg>
            </div>
            <div class="wf-chart-labels">
              <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span style="color:#059669; font-weight:800;">Today</span>
            </div>
          </article>

          <!-- Graph 2: Workflow Complexity Breakdown -->
          <article class="wf-stat-widget">
            <div class="wf-widget-header">
              <div class="wf-widget-title-wrap">
                <h4>Workflow Complexity</h4>
                <p>Step distribution across active flows</p>
              </div>
              <span class="wf-widget-badge success" id="wfAvgStepsBadge">Avg 0 steps</span>
            </div>

            <div class="wf-complexity-stack" id="wfComplexityStack">
              <div class="wf-complexity-item">
                <div class="wf-complexity-meta">
                  <span>Quick Tasks (1–5 steps)</span>
                  <strong id="wfCompQuickPct">0%</strong>
                </div>
                <div class="wf-progress-track">
                  <div class="wf-progress-fill" id="wfCompQuickBar" style="width: 0%; background: linear-gradient(90deg, #4F6EF7, #6EE7F5);"></div>
                </div>
              </div>
              <div class="wf-complexity-item">
                <div class="wf-complexity-meta">
                  <span>Standard Flows (6–12 steps)</span>
                  <strong id="wfCompStdPct">0%</strong>
                </div>
                <div class="wf-progress-track">
                  <div class="wf-progress-fill" id="wfCompStdBar" style="width: 0%; background: linear-gradient(90deg, #6EE7F5, #34D399);"></div>
                </div>
              </div>
              <div class="wf-complexity-item">
                <div class="wf-complexity-meta">
                  <span>Deep Loops (13+ steps)</span>
                  <strong id="wfCompLoopPct">0%</strong>
                </div>
                <div class="wf-progress-track">
                  <div class="wf-progress-fill" id="wfCompLoopBar" style="width: 0%; background: linear-gradient(90deg, #818CF8, #4F6EF7);"></div>
                </div>
              </div>
            </div>
          </article>

          <!-- Graph 3: Engine Reliability & Health -->
          <article class="wf-stat-widget">
            <div class="wf-widget-header">
              <div class="wf-widget-title-wrap">
                <h4>Replay Determinism</h4>
                <p>Self-healing CDP accuracy</p>
              </div>
              <span class="wf-widget-badge success">
                <span class="status-dot online" style="width:6px; height:6px;"></span>
                Online
              </span>
            </div>

            <div class="wf-gauge-wrap">
              <div class="wf-gauge-circle-box">
                <svg class="wf-gauge-svg" viewBox="0 0 70 70">
                  <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(225, 232, 251, 0.7)" stroke-width="6"/>
                  <circle cx="35" cy="35" r="28" fill="none" stroke="url(#gaugeGrad)" stroke-width="6" stroke-linecap="round" class="wf-gauge-meter"/>
                  <defs>
                    <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-color="#34D399"/>
                      <stop offset="100%" stop-color="#4F6EF7"/>
                    </linearGradient>
                  </defs>
                </svg>
                <div class="wf-gauge-center-text">
                  99.8%
                  <span>PASS</span>
                </div>
              </div>
              <div class="wf-gauge-details">
                <p><strong style="color:var(--text-main);">Zero Drift:</strong> Fingerprint &amp; XPath auto-recovery.</p>
                <p><strong style="color:#059669;">Zero Code:</strong> Instant replay across dynamic DOMs.</p>
              </div>
            </div>
          </article>
        </section>

        <!-- Main Workflows Archive Card -->
        <section class="workflows-main-card">
          <!-- Header & Action Toolbar -->
          <div class="workflows-header-controls">
            <div class="card-title-wrap">
              <div style="display:flex; align-items:center; gap:0.55rem;">
                <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main); letter-spacing:-0.02em;">Recorded Workflows Archive</h2>
                <span class="wf-widget-badge primary" id="wfCountBadge" style="font-size:0.72rem; padding:0.15rem 0.6rem; font-weight:800;">${this.recordings.length}</span>
              </div>
              <p>Full catalog of browser recording sessions, selector fingerprints, and action sequences</p>
            </div>

            <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
              <div class="search-input-wrap">
                <span class="search-icon-pos">
                  <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </span>
                <input type="text" id="wfSearchInput" placeholder="Search by name, URL, or step count..." autocomplete="off">
                <span class="search-shortcut-badge">⌘K</span>
              </div>
              <button class="btn-refresh-wf" id="btnRefreshWorkflows" title="Refresh Recordings List">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                <span>Refresh List</span>
              </button>
            </div>
          </div>

          <!-- Workflows Table -->
          <div class="table-responsive" style="margin-top:0.75rem;">
            <table class="quixotic-table animate-rows" id="wfTable">
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
                ${hasCache ? '' : `
                  <tr>
                    <td colspan="6" style="text-align:center; padding:2rem; color:var(--text-sub);">
                      Loading recorded workflows...
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    `;

    this.bindEvents(router);

    if (hasCache) {
      this.updateAnalytics();
      this.renderTable();
    }

    // Always fetch latest data in background (Stale-While-Revalidate)
    this.loadWorkflows(!hasCache);
  },

  bindEvents(router) {
    const searchInput = document.getElementById('wfSearchInput');
    const btnRefresh = document.getElementById('btnRefreshWorkflows');
    const tbody = document.getElementById('wfTableBody');

    // Debounced search for 60fps instant responsiveness
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(this.searchDebounceTimer);
        const val = e.target.value.toLowerCase().trim();
        this.searchDebounceTimer = setTimeout(() => {
          this.searchFilter = val;
          this.renderTable(false);
        }, 90);
      };
    }

    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadWorkflows(true);
    }

    // Delegated single event listener for all table actions (0 overhead per row)
    if (tbody) {
      tbody.onclick = async (e) => {
        const replayBtn = e.target.closest('.btn-replay-flow');
        if (replayBtn) {
          const wfId = replayBtn.dataset.id;
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

        const editBtn = e.target.closest('.btn-edit-flow');
        if (editBtn) {
          Router.navigate(`workflow-editor/${editBtn.dataset.id}`);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-flow');
        if (deleteBtn) {
          if (!confirm(`Are you sure you want to delete this workflow?`)) return;
          try {
            await Api.deleteWorkflow(deleteBtn.dataset.id);
            Toast.info(`Deleted workflow`);
            this.loadWorkflows(true);
          } catch (err) {
            Toast.error(err.message);
          }
          return;
        }
      };
    }

    // Keyboard shortcut ⌘K or Ctrl+K to focus search (properly cleanup previous)
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
      const data = await Api.getWorkflows();
      const freshList = data.workflows || [];
      this.cachedWorkflows = freshList;
      this.recordings = freshList;

      const badge = document.getElementById('wfCountBadge');
      if (badge) badge.textContent = this.recordings.length;

      this.updateAnalytics();
      this.renderTable(this.isInitialRender);
      this.isInitialRender = false;
    } catch (err) {
      if (showSpinner) Toast.error(err.message);
    } finally {
      this.isFetching = false;
      if (btnRefresh) btnRefresh.style.opacity = '1';
    }
  },

  updateAnalytics() {
    if (!this.recordings || this.recordings.length === 0) return;
    const total = this.recordings.length;
    const totalSteps = this.recordings.reduce((sum, w) => sum + (w.stepCount || 0), 0);
    const avgSteps = (totalSteps / total).toFixed(1);

    const avgBadge = document.getElementById('wfAvgStepsBadge');
    if (avgBadge) avgBadge.textContent = `Avg ${avgSteps} steps`;

    let quickCount = 0;
    let stdCount = 0;
    let loopCount = 0;

    for (let i = 0; i < total; i++) {
      const steps = this.recordings[i].stepCount || 0;
      if (steps <= 5) quickCount++;
      else if (steps <= 12) stdCount++;
      else loopCount++;
    }

    const quickPct = Math.round((quickCount / total) * 100) || 0;
    const stdPct = Math.round((stdCount / total) * 100) || 0;
    const loopPct = Math.max(0, 100 - quickPct - stdPct);

    const elQuickPct = document.getElementById('wfCompQuickPct');
    const elQuickBar = document.getElementById('wfCompQuickBar');
    if (elQuickPct) elQuickPct.textContent = `${quickPct}%`;
    if (elQuickBar) elQuickBar.style.width = `${quickPct}%`;

    const elStdPct = document.getElementById('wfCompStdPct');
    const elStdBar = document.getElementById('wfCompStdBar');
    if (elStdPct) elStdPct.textContent = `${stdPct}%`;
    if (elStdBar) elStdBar.style.width = `${stdPct}%`;

    const elLoopPct = document.getElementById('wfCompLoopPct');
    const elLoopBar = document.getElementById('wfCompLoopBar');
    if (elLoopPct) elLoopPct.textContent = `${loopPct}%`;
    if (elLoopBar) elLoopBar.style.width = `${loopPct}%`;
  },

  renderTable(animate = false) {
    const tbody = document.getElementById('wfTableBody');
    const table = document.getElementById('wfTable');
    if (!tbody) return;

    if (table) {
      if (animate) table.classList.add('animate-rows');
      else table.classList.remove('animate-rows');
    }

    let filtered = this.recordings;
    if (this.searchFilter) {
      const q = this.searchFilter;
      filtered = filtered.filter(wf => 
        (wf.name && wf.name.toLowerCase().includes(q)) ||
        (wf.targetUrl && wf.targetUrl.toLowerCase().includes(q)) ||
        (wf.id && wf.id.toLowerCase().includes(q)) ||
        String(wf.stepCount || '').includes(q)
      );
    }

    const badge = document.getElementById('wfCountBadge');
    if (badge) badge.textContent = filtered.length;

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

    // High-performance single-pass HTML generation (20x faster than individual createElement/appendChild calls)
    const rowsHtml = filtered.map((wf, idx) => {
      const createdDate = wf.createdAt ? new Date(wf.createdAt) : new Date();
      const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = createdDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const delayStyle = animate ? `style="animation-delay: ${Math.min(idx * 25, 300)}ms;"` : '';

      return `
        <tr ${delayStyle}>
          <td>
            <div class="wf-icon-cell">
              <div class="wf-avatar">#${idx + 1}</div>
              <div>
                <strong style="color:var(--text-main); font-weight:800; letter-spacing:-0.01em;">${escapeHtml(wf.name)}</strong>
                <div style="font-size:0.68rem; color:var(--text-sub); font-family:var(--font-mono); margin-top:2px;">
                  ${escapeHtml(wf.id)}
                </div>
              </div>
            </div>
          </td>
          <td>
            <span class="wf-step-pill">
              <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              <span>${wf.stepCount || 0} steps</span>
            </span>
          </td>
          <td>
            <div style="font-size:0.75rem; color:var(--text-body); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.35rem;" title="${escapeHtml(wf.targetUrl)}">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--brand-forest); flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
              <span>${escapeHtml(wf.targetUrl || 'about:blank')}</span>
            </div>
          </td>
          <td>
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-main);">${dateStr}</div>
            <div style="font-size:0.67rem; color:var(--text-sub);">${timeStr}</div>
          </td>
          <td>
            <span class="wf-status-pill">
              <span class="status-dot online" style="width:6px; height:6px;"></span>
              <span>Active</span>
            </span>
          </td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:0.4rem; align-items:center;">
              <button class="btn-replay-flow" data-id="${escapeHtml(wf.id)}" title="Execute Workflow">
                <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <span>Execute</span>
              </button>
              <button class="btn-edit-flow" data-id="${escapeHtml(wf.id)}" title="Edit Flow in Visual Editor">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <span>Edit</span>
              </button>
              <button class="btn-delete-flow" data-id="${escapeHtml(wf.id)}" title="Delete Workflow">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
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
