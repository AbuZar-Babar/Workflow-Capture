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
import { renderRobotAvatar } from '../components/robotAvatar.js';
import { escapeHtml } from '../utils/dom.js';

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
    return escapeHtml(val);
  },

  async render(container, router, routeArg) {
    this.router = router;
    window.OverviewView = this;

    container.innerHTML = `
      <div class="dashboard-shell" role="region" aria-label="Dashboard Overview" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Overview Actions -->
        <div class="wf-page-header">
          <div></div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" id="btnOverviewCreateWorkflow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>+ Train Agent</span>
            </button>
          </div>
        </div>

        <!-- Inline Train Agent Modal / Recording Banner -->
        <div id="overviewCreateModal" class="card hidden" style="margin-bottom:1.5rem; padding:1.25rem 1.5rem; border-left:4px solid var(--accent-cyan); background:var(--card-bg);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.65rem;">
              ${renderRobotAvatar({ size: 'mini', state: 'analyzing' })}
              <span style="font-size:0.95rem; font-weight:700; color:var(--text-primary);">TRAIN YOUR AGENT</span>
              <span class="badge-tag info" style="font-size:var(--text-2xs);">Interactive Training</span>
            </div>
            <button class="btn-icon" id="btnCloseCreateModal" title="Close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0 0 0.85rem;">Show the agent how the task should be done once on the live website. It learns the pattern and automates it.</p>
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <input type="text" id="overviewRecName" class="form-control" style="max-width:320px;" placeholder="Workflow name (e.g. invoice-collector)" spellcheck="false" aria-label="Workflow Name">
            <button class="btn btn-primary" id="btnOverviewStartRec">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
              <span id="overviewRecordButtonLabel">Start Teaching</span>
            </button>
          </div>
        </div>

        <!-- Active Recording Live Strip (Visible only when recording) -->
        <div id="overviewActiveControls" class="card hidden" style="margin-bottom:1.5rem; padding:1rem 1.25rem; border-left:4px solid var(--accent-cyan); background:rgba(0,240,255,0.06); display:none; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div style="display:flex; align-items:center; gap:0.85rem;">
            ${renderRobotAvatar({ size: 'badge', state: 'running' })}
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span class="status-dot recording" style="width:10px; height:10px;"></span>
                <strong style="color:var(--accent-cyan); font-size:var(--text-sm); text-transform:uppercase; letter-spacing:0.05em;">AGENT LEARNING IN PROGRESS</strong>
              </div>
              <div style="margin-top:0.15rem;">
                <span id="overviewActiveWorkflowName" style="color:var(--text-primary); font-size:var(--text-xs); font-weight:600;">workflow</span>
                <span id="overviewActiveMeta" class="mono" style="color:var(--text-sub); font-size:var(--text-xs); margin-left:0.5rem;">00:00 · 0 actions captured</span>
              </div>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" id="btnOverviewStopRec">
            <span>■</span> <span>Finish &amp; Save Workflow</span>
          </button>
          <span id="overviewRecActionCount" class="hidden" aria-hidden="true">0</span>
        </div>

        <!-- Overview Statistics -->
        <section class="dashboard-stat-grid overview-summary-grid" aria-label="Workflow Statistics">
          <article class="dashboard-stat-card" id="cardTotalWorkflows">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">WORKFLOWS</span>
              <span class="stat-card-icon" aria-hidden="true">↗</span>
            </div>
            <strong class="dashboard-stat-value" id="overviewWorkflowCount">0</strong>
            <span class="dashboard-stat-meta">Saved workflows</span>
          </article>

          <article class="dashboard-stat-card" id="cardTotalRuns">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">TOTAL RUNS</span>
              <span class="stat-card-icon" aria-hidden="true">▶</span>
            </div>
            <strong class="dashboard-stat-value" id="overviewTotalRunsCount">0</strong>
            <span class="dashboard-stat-meta">Workflow executions</span>
          </article>

          <article class="dashboard-stat-card" id="cardDownloadedFiles">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">FILES DOWNLOADED</span>
              <span class="stat-card-icon" aria-hidden="true">↓</span>
            </div>
            <strong class="dashboard-stat-value" id="overviewDownloadedFilesCount">0</strong>
            <span class="dashboard-stat-meta">Files captured by runs</span>
          </article>

          <article class="dashboard-stat-card" id="cardSuccessfulRuns">
            <div class="stat-card-header">
              <span class="dashboard-stat-label">SUCCESS RATE</span>
              <span class="stat-card-icon" aria-hidden="true">✓</span>
            </div>
            <strong class="dashboard-stat-value" id="overviewSuccessRate">100%</strong>
            <span class="dashboard-stat-meta" id="overviewSuccessRateMeta">No runs yet</span>
          </article>
        </section>

        <!-- Overview Charts -->
        <section class="overview-chart-grid" aria-label="Workflow Analytics">
          <article class="overview-chart-card">
            <div class="overview-chart-header">
              <div>
                <h2>Run outcomes</h2>
                <p>Completed, failed, and active workflow runs.</p>
              </div>
            </div>
            <div id="overviewRunOutcomesChart" class="overview-bar-chart" aria-label="Workflow run outcomes chart"></div>
          </article>

          <article class="overview-chart-card">
            <div class="overview-chart-header">
              <div>
                <h2>Files downloaded</h2>
                <p>Downloads recorded by the latest workflow runs.</p>
              </div>
            </div>
            <div id="overviewDownloadsChart" class="overview-bar-chart" aria-label="Files downloaded chart"></div>
          </article>
        </section>

      </div>
    `;

    this.bindEvents(router);
    await this.loadData();

    if (routeArg === 'create' || routeArg === 'new') {
      this.openCreateModal();
    }
  },

  openCreateModal() {
    const modalCreate = document.getElementById('overviewCreateModal');
    const inputRecName = document.getElementById('overviewRecName');
    if (modalCreate) {
      modalCreate.classList.remove('hidden');
      modalCreate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (inputRecName) {
        inputRecName.focus();
        inputRecName.select?.();
      }
    }
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
          this.openCreateModal();
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
          this.setRecordingState(false);
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

      if (status && status.recorder) {
        if (status.recorder.isRecording && !this.isRecording) {
          this.setRecordingState(true, {
            name: status.recorder.name,
            startedAt: status.recorder.startedAt,
            actionCount: status.recorder.actionCount
          });
        } else if (!status.recorder.isRecording && this.isRecording) {
          this.setRecordingState(false);
        }
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
    const completedRuns = runs.filter(r => r.status === 'COMPLETED' || r.status === 'SUCCESS');
    const failedRuns = runs.filter(r => r.status === 'FAILED');
    const activeRuns = runs.filter(r => ['RUNNING', 'STARTING', 'PROCESSING_ITEMS'].includes(r.status));

    const downloadCount = (run) => {
      if (Array.isArray(run?.downloads)) return run.downloads.length;
      if (Number.isFinite(run?.downloadCount)) return run.downloadCount;
      if (Number.isFinite(run?.filesDownloaded)) return run.filesDownloaded;
      return 0;
    };

    const totalDownloads = runs.reduce((sum, run) => sum + downloadCount(run), 0);
    const successRate = runs.length > 0 ? Math.round((completedRuns.length / runs.length) * 100) : 100;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };

    setText('overviewWorkflowCount', workflows.length);
    setText('overviewTotalRunsCount', runs.length);
    setText('overviewDownloadedFilesCount', totalDownloads);
    setText('overviewSuccessRate', `${successRate}%`);
    setText(
      'overviewSuccessRateMeta',
      runs.length > 0 ? `${completedRuns.length} of ${runs.length} runs completed` : 'No runs yet'
    );

    this.renderOverviewCharts({
      completed: completedRuns.length,
      failed: failedRuns.length,
      active: activeRuns.length,
      runs
    }, downloadCount);

    // Keep the existing recording state synchronized with the backend.
    if (status?.recorder && status.recorder.isRecording && !this.isRecording) {
      this.setRecordingState(true, {
        name: status.recorder.name,
        startedAt: status.recorder.startedAt,
        actionCount: status.recorder.actionCount
      });
    }
  },

  renderOverviewCharts(outcomes, getDownloadCount) {
    const renderBars = (containerId, rows, emptyText) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      const max = Math.max(...rows.map(row => row.value), 0);
      if (max === 0) {
        container.innerHTML = `<div class="overview-chart-empty">${emptyText}</div>`;
        return;
      }

      container.innerHTML = rows.map(row => {
        const width = Math.max(4, Math.round((row.value / max) * 100));
        return `
          <div class="overview-bar-row">
            <div class="overview-bar-label" title="${this.escapeHtml(row.label)}">${this.escapeHtml(row.label)}</div>
            <div class="overview-bar-track">
              <div class="overview-bar-fill" style="width:${width}%"></div>
            </div>
            <strong class="overview-bar-value">${row.value}</strong>
          </div>
        `;
      }).join('');
    };

    renderBars(
      'overviewRunOutcomesChart',
      [
        { label: 'Completed', value: outcomes.completed },
        { label: 'Failed', value: outcomes.failed },
        { label: 'Active', value: outcomes.active }
      ],
      'No workflow runs yet.'
    );

    const latestRuns = outcomes.runs
      .slice()
      .sort((a, b) => new Date(b.completedAt || b.startedAt || b.createdAt || 0) - new Date(a.completedAt || a.startedAt || a.createdAt || 0))
      .slice(0, 7)
      .reverse();

    const downloadRows = latestRuns.map((run, index) => ({
      label: run.workflowName || run.workflowId || `Run ${index + 1}`,
      value: getDownloadCount(run)
    }));

    renderBars(
      'overviewDownloadsChart',
      downloadRows,
      'No downloaded files yet.'
    );
  },


  renderRecentWorkflows(workflows) {
    const container = document.getElementById('overviewWorkflowsContainer');
    if (!container) return;

    if (!workflows || workflows.length === 0) {
      container.innerHTML = `
        <div class="modern-empty-state" style="padding:2.5rem 1rem; text-align:center;">
          <div style="margin-bottom:1rem; display:inline-block;">
            ${renderRobotAvatar({ size: 'medium', state: 'waving' })}
          </div>
          <h3 class="empty-state-title" style="color:var(--text-primary); font-size:1.05rem;">No agent workflows yet</h3>
          <p class="empty-state-desc" style="color:var(--text-sub); max-width:320px; margin:0.35rem auto 1rem;">Show the agent how you work once. It will learn the pattern and repeat it reliably.</p>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('btnOverviewCreateWorkflow')?.click()">+ Train First Agent</button>
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
        <div class="wf-row" data-id="${this.escapeHtml(wfId)}" style="cursor:pointer; background:rgba(13,19,36,0.65); border:1px solid rgba(255,255,255,0.07); border-radius:var(--radius-lg); margin-bottom:0.6rem; padding:0.85rem 1rem; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s ease;">
          <div style="display:flex; align-items:center; gap:0.85rem; min-width:0; flex:1;">
            <div style="flex-shrink:0;">
              ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
            </div>
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <span class="wf-name" style="font-size:0.9rem; font-weight:700; color:var(--text-primary);">${this.escapeHtml(name)}</span>
                <span class="wf-domain-pill" style="font-size:0.7rem; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:var(--accent-cyan); padding:0.1rem 0.5rem; border-radius:var(--radius-pill);">${this.escapeHtml(domain)}</span>
              </div>
              <div class="wf-card-meta" style="margin-top:0.25rem; font-size:var(--text-xs); color:var(--text-sub); display:flex; align-items:center; gap:0.5rem;">
                <span>${stepCount} step${stepCount === 1 ? '' : 's'}</span>
                <span>&middot;</span>
                <span style="color:var(--accent-cyan); font-weight:600;">${lastRun}</span>
              </div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
            <button class="btn btn-primary btn-sm btn-quick-run" data-id="${this.escapeHtml(wfId)}" title="Execute this agent" style="font-weight:700; letter-spacing:0.04em;">
              <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>RUN AGENT</span>
            </button>
            <button class="btn btn-secondary btn-sm btn-quick-edit" data-id="${this.escapeHtml(wfId)}" title="Open Editor">
              <span>Inspect</span>
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
          isLoop: wf?.isLoop || wf?.mode === 'LOOP' || (Number.isInteger(wf?.loopStepIndex) && wf?.loopStepIndex >= 0),
          steps: wf?.steps || []
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
        <div class="modern-empty-state" style="padding:2.5rem 1rem; text-align:center;">
          <div style="margin-bottom:0.75rem; display:inline-block;">
            ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
          </div>
          <h3 class="empty-state-title" style="font-size:0.95rem; color:var(--text-primary);">No recent executions</h3>
          <p class="empty-state-desc" style="font-size:var(--text-xs); color:var(--text-sub);">When agents execute, live telemetry and downloaded assets will stream here.</p>
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
