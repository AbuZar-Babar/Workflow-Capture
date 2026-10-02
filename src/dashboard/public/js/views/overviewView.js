/**
 * Workflow Capture — Modernized Dashboard (Overview View)
 * Clean, fast, Linear-style automation command center.
 * Features:
 * - Primary CTA: + Create Workflow
 * - Compact metrics: Total Workflows, Active Runs, Successful Runs, Recent Activity
 * - Recent Workflows (compact cards with quick Run and details)
 * - Recent Activity timeline
 * - Full recording lifecycle & SSE preservation
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Header } from '../components/header.js';
import { ExecutionModal } from '../components/executionModal.js';

function extractDomain(url) {
  if (!url || url === 'about:blank' || url === 'unknown') return 'Web Application';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const last = parts[parts.length - 1].replace(/\.html?$/i, '');
        return last.replace(/[-_]/g, ' ');
      }
      return 'Local Portal';
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'Web Application';
  }
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return 'Recently';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'Recently';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const OverviewView = {
  recordTimer: null,
  recordStartTime: 0,
  recordings: [],
  recentRuns: [],
  isRecording: false,
  isStarting: false,
  isStopping: false,
  router: null,

  escapeHtml(val) {
    return String(val || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  },

  async render(container, router) {
    this.router = router;
    window.OverviewView = this;

    container.innerHTML = `
      <div class="dashboard-shell" role="region" aria-label="Dashboard Overview" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Top Page Header -->
        <div class="wf-page-header">
          <div>
            <h1 class="wf-page-title">Dashboard</h1>
            <p class="wf-page-subtitle">Real-time overview of your automated browser workflows and system health.</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btnOverviewLaunchChrome" title="Launch connected Chrome browser">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="4"></circle>
                <line x1="21.17" y1="8" x2="12" y2="8"></line>
                <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
              </svg>
              <span id="overviewLaunchChromeLabel">Open Browser</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnOverviewCreateWorkflow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>+ Create Workflow</span>
            </button>
          </div>
        </div>

        <!-- Inline Create Workflow Modal / Recording Banner -->
        <div id="overviewCreateModal" class="card hidden" style="margin-bottom:1.5rem; padding:1.25rem 1.5rem; border-left:4px solid var(--accent-primary); background:var(--bg-surface);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:0.9rem; font-weight:700; color:var(--text-primary);">Record New Browser Workflow</span>
              <span class="badge-tag info" style="font-size:0.68rem;">Interactive</span>
            </div>
            <button class="btn-icon" id="btnCloseCreateModal" title="Close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <input type="text" id="overviewRecName" class="form-control" style="max-width:320px;" placeholder="Workflow name (e.g. invoice-collection)" spellcheck="false" aria-label="Workflow Name">
            <button class="btn btn-primary" id="btnOverviewStartRec">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
              <span id="overviewRecordButtonLabel">Start Recording</span>
            </button>
            <span style="font-size:var(--text-xs); color:var(--text-sub);">Navigate and perform clicks on the target portal. Workflow engine captures selectors automatically.</span>
          </div>
        </div>

        <!-- Active Recording Live Strip (Visible only when recording) -->
        <div id="overviewActiveControls" class="card hidden" style="margin-bottom:1.5rem; padding:1rem 1.25rem; border-left:4px solid var(--color-danger); background:var(--color-danger-bg); display:none; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="status-dot recording" style="width:10px; height:10px;"></span>
            <div>
              <strong style="color:var(--color-danger); font-size:var(--text-sm); display:block;">Recording in progress</strong>
              <span id="overviewActiveWorkflowName" style="color:var(--text-primary); font-size:var(--text-xs); font-weight:600;">workflow</span>
              <span id="overviewActiveMeta" class="mono" style="color:var(--text-sub); font-size:var(--text-xs); margin-left:0.5rem;">00:00 · 0 actions</span>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" id="btnOverviewStopRec">
            <span>■</span> <span>Stop &amp; Save Workflow</span>
          </button>
          <span id="overviewRecActionCount" class="hidden" aria-hidden="true">0</span>
        </div>

        <!-- Compact Useful Statistics (4 Cards) -->
        <section class="dashboard-stat-grid" aria-label="Workflow Statistics" style="margin-bottom:1.75rem;">
          <!-- 1. Total Workflows -->
          <article class="dashboard-stat-card" id="cardTotalWorkflows">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">Total Workflows</span>
              <div class="stat-card-icon" style="color:var(--accent-primary);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16"></path>
                </svg>
              </div>
            </div>
            <strong class="dashboard-stat-value" id="overviewWorkflowCount">0</strong>
            <span class="dashboard-stat-meta" id="overviewWorkflowMeta">Saved &amp; ready to run</span>
          </article>

          <!-- 2. Active Runs -->
          <article class="dashboard-stat-card" id="cardActiveRuns">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">Active Runs</span>
              <div class="stat-card-icon" style="color:var(--color-success);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
            </div>
            <div style="display:flex; align-items:baseline; gap:0.5rem;">
              <strong class="dashboard-stat-value" id="overviewActiveRunsCount">0</strong>
              <span id="overviewActiveRunsBadge" class="status-dot online" style="display:none;" title="Active execution running"></span>
            </div>
            <span class="dashboard-stat-meta" id="overviewActiveRunsMeta">No runs currently executing</span>
          </article>

          <!-- 3. Successful Runs -->
          <article class="dashboard-stat-card" id="cardSuccessfulRuns">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">Successful Runs</span>
              <div class="stat-card-icon" style="color:var(--color-success);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
            </div>
            <strong class="dashboard-stat-value" id="overviewSuccessfulRunsCount">0</strong>
            <span class="dashboard-stat-meta" id="overviewSuccessRateMeta">100% completion rate</span>
          </article>

          <!-- 4. Recent Activity -->
          <article class="dashboard-stat-card" id="cardRecentActivity">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">Recent Activity</span>
              <div class="stat-card-icon" style="color:var(--tech-purple);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
            </div>
            <strong class="dashboard-stat-value" id="overviewRecentActivityTitle" style="font-size:1.15rem; font-weight:700;">Idle</strong>
            <span class="dashboard-stat-meta" id="overviewRecentActivityMeta">No recent events</span>
          </article>
        </section>

        <!-- Main Dashboard Split: Recent Workflows (Left) & Recent Activity (Right) -->
        <div style="display:grid; grid-template-columns: 1.6fr 1fr; gap:1.5rem; align-items:start;">

          <!-- Recent Workflows -->
          <section class="card" style="padding:1.25rem 1.5rem; border-radius:var(--radius-lg);" aria-labelledby="headingRecentWorkflows">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.15rem;">
              <div>
                <h2 id="headingRecentWorkflows" style="font-size:1rem; font-weight:700; color:var(--text-primary); margin:0;">Recent Workflows</h2>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0.15rem 0 0;">Browser workflows available for automated execution</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnDashboardViewAllWorkflows">View All</button>
            </div>

            <!-- Workflow items list -->
            <div id="overviewWorkflowsContainer" class="wf-list" style="margin-top:0.5rem;">
              <div style="padding:2rem; text-align:center; color:var(--text-muted); font-size:var(--text-sm);">Loading workflows…</div>
            </div>
          </section>

          <!-- Recent Activity Timeline -->
          <section class="card" style="padding:1.25rem 1.5rem; border-radius:var(--radius-lg);" aria-labelledby="headingRecentActivity">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.15rem;">
              <div>
                <h2 id="headingRecentActivity" style="font-size:1rem; font-weight:700; color:var(--text-primary); margin:0;">Recent Activity</h2>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0.15rem 0 0;">Latest execution timeline</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnDashboardViewAllActivity">View All</button>
            </div>

            <!-- Activity Items -->
            <div id="overviewActivityContainer" class="act-timeline">
              <div style="padding:2rem; text-align:center; color:var(--text-muted); font-size:var(--text-sm);">Loading activity…</div>
            </div>
          </section>

        </div>

      </div>
    `;

    this.bindEvents(router);
    await this.loadData();
  },

  bindEvents(router) {
    // Primary Action: + Create Workflow
    const btnCreate = document.getElementById('btnOverviewCreateWorkflow');
    const modalCreate = document.getElementById('overviewCreateModal');
    const btnCloseModal = document.getElementById('btnCloseCreateModal');
    const inputRecName = document.getElementById('overviewRecName');

    if (btnCreate && modalCreate) {
      btnCreate.onclick = () => {
        const isHidden = modalCreate.classList.contains('hidden');
        if (isHidden) {
          modalCreate.classList.remove('hidden');
          if (inputRecName) {
            inputRecName.focus();
          }
        } else {
          modalCreate.classList.add('hidden');
        }
      };
    }

    if (btnCloseModal && modalCreate) {
      btnCloseModal.onclick = () => {
        modalCreate.classList.add('hidden');
      };
    }

    // Launch Chrome Browser
    const btnLaunch = document.getElementById('btnOverviewLaunchChrome');
    const labelLaunch = document.getElementById('overviewLaunchChromeLabel');
    if (btnLaunch) {
      btnLaunch.onclick = async () => {
        if (btnLaunch.disabled) return;
        btnLaunch.disabled = true;
        if (labelLaunch) labelLaunch.textContent = 'Connecting…';
        Toast.info('Connecting to Google Chrome…');
        try {
          const res = await Api.launchBrowser('ecommerce');
          if (res && res.success !== false) {
            Toast.success('Browser connected and ready!');
            await this.loadData();
          }
        } catch (err) {
          Toast.error(err.message || 'Failed to connect browser');
        } finally {
          btnLaunch.disabled = false;
          if (labelLaunch) labelLaunch.textContent = 'Open Browser';
        }
      };
    }

    // Start Recording
    const btnStart = document.getElementById('btnOverviewStartRec');
    const startRecording = async () => {
      if (this.isStarting || this.isRecording) return;
      this.isStarting = true;
      const name = (inputRecName && inputRecName.value.trim()) || `workflow-${Date.now()}`;
      const label = document.getElementById('overviewRecordButtonLabel');

      if (btnStart) btnStart.disabled = true;
      if (label) label.textContent = 'Starting…';
      Toast.info(`Starting workflow recording for "${name}"…`);

      try {
        await Api.startRecording(name);
        Toast.success(`Recording started: "${name}"`);
        this.setRecordingState(true, { startedAt: new Date(), name });
        if (modalCreate) modalCreate.classList.add('hidden');
      } catch (err) {
        Toast.error(err.message || 'Failed to start recording');
        this.setRecordingState(false);
      } finally {
        this.isStarting = false;
        if (btnStart && !this.isRecording) {
          btnStart.disabled = false;
          if (label) label.textContent = 'Start Recording';
        }
      }
    };

    if (btnStart) btnStart.onclick = startRecording;
    if (inputRecName) {
      inputRecName.onkeydown = (e) => {
        if (e.key === 'Enter') startRecording();
      };
    }

    // Stop & Save Recording
    const btnStop = document.getElementById('btnOverviewStopRec');
    if (btnStop) {
      btnStop.onclick = async () => {
        if (this.isStopping) return;
        this.isStopping = true;
        btnStop.disabled = true;
        Toast.info('Saving workflow recording…');
        try {
          const res = await Api.stopRecording();
          const actionCount = res.summary?.actionCount || 0;
          Toast.success(`Workflow saved successfully (${actionCount} step${actionCount === 1 ? '' : 's'})`);
          this.setRecordingState(false);
          if (inputRecName) inputRecName.value = '';
          await this.loadData();
        } catch (err) {
          Toast.error(err.message || 'Failed to stop recording');
        } finally {
          this.isStopping = false;
          if (btnStop) btnStop.disabled = false;
        }
      };
    }

    // Navigation links
    const btnAllWf = document.getElementById('btnDashboardViewAllWorkflows');
    if (btnAllWf) btnAllWf.onclick = () => router.navigate('workflows');

    const btnAllAct = document.getElementById('btnDashboardViewAllActivity');
    if (btnAllAct) btnAllAct.onclick = () => router.navigate('console');
  },

  async loadData() {
    try {
      const [status, recRes, runsRes] = await Promise.all([
        Api.getStatus().catch(() => null),
        Api.getWorkflows().catch(() => ({ workflows: [] })),
        Api.getRuns().catch(() => ({ runs: [] }))
      ]);

      if (status && status.recorder && status.recorder.isRecording && !this.isRecording) {
        this.setRecordingState(true, {
          name: status.recorder.name,
          startedAt: status.recorder.startedAt,
          actionCount: status.recorder.actionCount
        });
      }

      this.recordings = recRes.workflows || recRes.recordings || [];
      this.recentRuns = runsRes.runs || [];

      this.updateStats(this.recordings, this.recentRuns, status);
      this.renderRecentWorkflows(this.recordings);
      this.renderRecentActivity(this.recentRuns);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  },

  updateStats(workflows, runs, status) {
    // 1. Total Workflows
    const elWfCount = document.getElementById('overviewWorkflowCount');
    if (elWfCount) elWfCount.textContent = workflows.length;

    // 2. Active Runs
    const activeRuns = runs.filter(r => r.status === 'RUNNING' || r.status === 'STARTING' || r.status === 'PROCESSING_ITEMS');
    const elActiveCount = document.getElementById('overviewActiveRunsCount');
    const elActiveBadge = document.getElementById('overviewActiveRunsBadge');
    const elActiveMeta = document.getElementById('overviewActiveRunsMeta');

    if (elActiveCount) elActiveCount.textContent = activeRuns.length;
    if (elActiveBadge) elActiveBadge.style.display = activeRuns.length > 0 ? 'inline-block' : 'none';
    if (elActiveMeta) {
      elActiveMeta.textContent = activeRuns.length > 0
        ? `${activeRuns.length} run${activeRuns.length === 1 ? '' : 's'} in progress`
        : 'No runs currently executing';
    }

    // 3. Successful Runs
    const completedRuns = runs.filter(r => r.status === 'COMPLETED' || r.status === 'SUCCESS');
    const elSuccessCount = document.getElementById('overviewSuccessfulRunsCount');
    const elSuccessRate = document.getElementById('overviewSuccessRateMeta');
    if (elSuccessCount) elSuccessCount.textContent = completedRuns.length;
    if (elSuccessRate && runs.length > 0) {
      const rate = Math.round((completedRuns.length / runs.length) * 100);
      elSuccessRate.textContent = `${rate}% completion rate (${runs.length} total)`;
    }

    // 4. Recent Activity
    const elActivityTitle = document.getElementById('overviewRecentActivityTitle');
    const elActivityMeta = document.getElementById('overviewRecentActivityMeta');
    if (runs.length > 0) {
      const latest = runs[0];
      const rel = formatRelativeTime(latest.completedAt || latest.startedAt || latest.createdAt);
      if (elActivityTitle) elActivityTitle.textContent = rel;
      if (elActivityMeta) elActivityMeta.textContent = latest.workflowName || `Run #${(latest.id || '').slice(0, 8)}`;
    } else {
      if (elActivityTitle) elActivityTitle.textContent = 'Idle';
      if (elActivityMeta) elActivityMeta.textContent = 'No executions yet';
    }
  },

  renderRecentWorkflows(workflows) {
    const container = document.getElementById('overviewWorkflowsContainer');
    if (!container) return;

    if (!workflows || workflows.length === 0) {
      container.innerHTML = `
        <div class="modern-empty-state" style="padding:2.5rem 1rem;">
          <div class="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </div>
          <h3 class="empty-state-title">No workflows created yet</h3>
          <p class="empty-state-desc">Capture your first web automation sequence to get started.</p>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('btnOverviewCreateWorkflow')?.click()">+ Create Workflow</button>
        </div>
      `;
      return;
    }

    const recent = workflows.slice(0, 5);
    container.innerHTML = recent.map(wf => {
      const wfId = wf.id || wf.filename?.replace('.json', '') || 'workflow';
      const name = wf.name || wfId;
      const targetUrl = wf.startUrl || wf.targetUrl || '';
      const domain = extractDomain(targetUrl);
      const stepCount = wf.actionCount || wf.stepCount || (wf.steps ? wf.steps.length : 0);
      const lastRun = wf.lastRunAt ? formatRelativeTime(wf.lastRunAt) : 'Ready';

      return `
        <div class="wf-row" data-id="${this.escapeHtml(wfId)}" style="cursor:pointer;">
          <div style="display:flex; align-items:center; gap:0.85rem; min-width:0; flex:1;">
            <div class="wf-avatar-icon" style="flex-shrink:0;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span class="wf-name" style="font-size:0.88rem;">${this.escapeHtml(name)}</span>
                <span class="wf-domain-pill">${this.escapeHtml(domain)}</span>
              </div>
              <div class="wf-card-meta" style="margin-top:0.2rem; font-size:var(--text-xs);">
                <span>${stepCount} step${stepCount === 1 ? '' : 's'}</span>
                <span>&middot;</span>
                <span>${lastRun}</span>
              </div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
            <button class="btn btn-primary btn-sm btn-quick-run" data-id="${this.escapeHtml(wfId)}" title="Execute this workflow">
              <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Run</span>
            </button>
            <button class="btn btn-secondary btn-sm btn-quick-edit" data-id="${this.escapeHtml(wfId)}" title="Open Editor">
              <span>Open</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind item clicks
    container.querySelectorAll('.btn-quick-run').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const wf = workflows.find(w => (w.id || w.filename?.replace('.json', '')) === id);
        ExecutionModal.open({
          workflowId: id,
          workflowName: wf?.name || id,
          stepCount: wf?.stepCount || wf?.steps?.length || 0,
          loopStepIndex: wf?.loopStepIndex,
          isLoop: wf?.isLoop || wf?.mode === 'LOOP'
        });
      };
    });

    container.querySelectorAll('.btn-quick-edit').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.router.navigate(`workflow-editor/${id}`);
      };
    });

    container.querySelectorAll('.wf-row').forEach(row => {
      row.onclick = () => {
        const id = row.getAttribute('data-id');
        this.router.navigate(`workflow-editor/${id}`);
      };
    });
  },

  renderRecentActivity(runs) {
    const container = document.getElementById('overviewActivityContainer');
    if (!container) return;

    if (!runs || runs.length === 0) {
      container.innerHTML = `
        <div class="modern-empty-state" style="padding:2.5rem 1rem;">
          <div class="empty-state-icon" style="background:var(--bg-surface-sunken); color:var(--text-muted);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <h3 class="empty-state-title" style="font-size:0.95rem;">No recent executions</h3>
          <p class="empty-state-desc" style="font-size:var(--text-xs);">When workflows execute, real-time activity and file downloads appear here.</p>
        </div>
      `;
      return;
    }

    const recent = runs.slice(0, 5);
    container.innerHTML = recent.map(run => {
      const isSuccess = run.status === 'COMPLETED' || run.status === 'SUCCESS';
      const isFailed = run.status === 'FAILED';
      const isRunning = run.status === 'RUNNING' || run.status === 'STARTING' || run.status === 'PROCESSING_ITEMS';

      let statusCls = 'completed';
      let icon = '✓';
      let statusText = 'Workflow completed';

      if (isFailed) {
        statusCls = 'failed';
        icon = '✕';
        statusText = 'Workflow failed';
      } else if (isRunning) {
        statusCls = 'running';
        icon = '●';
        statusText = 'Workflow running';
      }

      const wfName = run.workflowName || run.workflowId || 'Workflow Run';
      const time = formatRelativeTime(run.completedAt || run.startedAt || run.createdAt);
      const filesProcessed = run.processedCount || run.itemsProcessed || (run.downloads ? run.downloads.length : 0);
      const detail = isRunning
        ? `Processing records…`
        : (isFailed ? (run.error || 'Execution encountered an error') : `${filesProcessed} items processed`);

      return `
        <div class="act-item" style="cursor:pointer;" onclick="location.hash='#execution/${this.escapeHtml(run.id)}'">
          <div class="act-icon ${statusCls}">${icon}</div>
          <div class="act-content">
            <div class="act-title-row">
              <span class="act-title">${statusText}</span>
              <span class="act-time">${time}</span>
            </div>
            <div style="font-weight:600; font-size:var(--text-xs); color:var(--text-secondary); margin-bottom:0.15rem;">
              ${this.escapeHtml(wfName)}
            </div>
            <div class="act-meta">${this.escapeHtml(detail)}</div>
          </div>
        </div>
      `;
    }).join('');
  },

  setRecordingState(isRec, meta = {}) {
    this.isRecording = Boolean(isRec);
    const activeControls = document.getElementById('overviewActiveControls');
    const activeName = document.getElementById('overviewActiveWorkflowName');
    const activeMeta = document.getElementById('overviewActiveMeta');

    if (activeControls) {
      if (this.isRecording) {
        activeControls.classList.remove('hidden');
        activeControls.style.display = 'flex';
        if (activeName) activeName.textContent = meta.name || 'Workflow Recording';
        this.recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : Date.now();
        this.updateRecordingMeta();
        if (!this.recordTimer) {
          this.recordTimer = setInterval(() => this.updateRecordingMeta(), 1000);
        }
      } else {
        activeControls.classList.add('hidden');
        activeControls.style.display = 'none';
        if (this.recordTimer) {
          clearInterval(this.recordTimer);
          this.recordTimer = null;
        }
      }
    }
  },

  updateRecordingMeta() {
    const activeMeta = document.getElementById('overviewActiveMeta');
    const actionCountEl = document.getElementById('overviewRecActionCount');
    if (!activeMeta || !this.recordStartTime) return;
    const sec = Math.max(0, Math.floor((Date.now() - this.recordStartTime) / 1000));
    const mins = String(Math.floor(sec / 60)).padStart(2, '0');
    const secs = String(sec % 60).padStart(2, '0');
    const count = actionCountEl ? actionCountEl.textContent : '0';
    activeMeta.textContent = `${mins}:${secs} · ${count} action${count === '1' ? '' : 's'}`;
  },

  destroy() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
  }
};
