/**
 * Workflow Capture — Live Execution View with Embedded Console & Step Progression
 * Modernized for UI-5: SaaS-grade clarity, accessible progress, real-time activity,
 * human intervention handling, and seamless terminal transition to Results & Files.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { SSE } from '../sse.js';
import { renderRobotAvatar } from '../components/robotAvatar.js';
import { Modal } from '../components/modal.js';

const terminalStates = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'STOPPED']);

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

function formatStatusLabel(status) {
  const s = String(status || 'QUEUED').toUpperCase();
  switch (s) {
    case 'QUEUED':
    case 'STARTING':
      return 'Starting';
    case 'RUNNING':
    case 'PROCESSING_ITEMS':
      return 'Running';
    case 'PAUSED':
    case 'WAITING_FOR_USER':
      return 'Action needed';
    case 'STOPPING':
      return 'Stopping';
    case 'COMPLETED':
      return 'Completed';
    case 'COMPLETED_WITH_ERRORS':
      return 'Completed with errors';
    case 'STOPPED':
      return 'Stopped';
    case 'FAILED':
      return 'Failed';
    default:
      return s.replace(/_/g, ' ');
  }
}

function formatRecordStatus(status) {
  const s = String(status || 'REMAINING').toUpperCase();
  switch (s) {
    case 'SUCCESS':
      return { label: 'Completed', cls: 'success', icon: '✓' };
    case 'FAILED':
      return { label: 'Failed', cls: 'failed', icon: '✗' };
    case 'STOPPED':
      return { label: 'Stopped', cls: 'stopped', icon: '■' };
    case 'SKIPPED_FILTER':
      return { label: 'Filtered out', cls: 'skipped-filter', icon: '⊘' };
    case 'SKIPPED_LIMIT':
      return { label: 'Limit reached', cls: 'skipped-limit', icon: '⇥' };
    case 'SKIPPED_DUPLICATE':
      return { label: 'Already processed', cls: 'skipped', icon: '↷' };
    case 'PENDING':
    case 'RUNNING':
      return { label: 'Running', cls: 'pending', icon: '⟳' };
    default:
      return { label: 'Remaining', cls: 'remaining', icon: '⏱' };
  }
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function extractDomain(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return url;
  }
}

export const ExecutionView = {
  timer: null,
  runId: null,
  router: null,
  container: null,
  activeFilter: 'ALL',
  searchQuery: '',
  autoScroll: true,
  logs: [],
  unsubscribeSSE: null,
  unsubscribeHumanIntervention: null,
  terminalEl: null,
  workflowSteps: [],
  currentActivity: 'Initializing workflow execution…',
  currentActivityDetail: '',
  isStopping: false,
  isPaused: false,
  connectionFailed: false,
  workflow: null,
  lastPollData: null,

  async render(container, router, runId) {
    this.container = container;
    this.router = router;
    this.runId = runId || sessionStorage.getItem('workflowCaptureActiveRunId');
    this.isStopping = false;
    this.isPaused = false;
    this.connectionFailed = false;

    if (!this.runId) {
      container.innerHTML = `
        <section class="card execution-empty" style="text-align:center; padding:3.5rem 1.5rem; max-width:560px; margin:2rem auto; border-radius:var(--radius-xl);">
          <div style="width:48px; height:48px; border-radius:50%; background:var(--brand-tint); color:var(--brand-forest); display:grid; place-items:center; margin:0 auto 1rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <h2 style="font-size:1.35rem; font-weight:800; margin-bottom:0.5rem; color:var(--text-main);">No active run selected</h2>
          <p style="color:var(--text-sub); font-size:0.85rem; margin-bottom:1.75rem; line-height:1.5;">Choose a workflow to execute, or inspect past results from your library.</p>
          <div style="display:flex; justify-content:center; gap:0.75rem; flex-wrap:wrap;">
            <button class="btn btn-primary" id="btnExecutionGoWorkflows">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
              <span>View Workflows</span>
            </button>
            <button class="btn btn-secondary" id="btnExecutionGoDashboard">Back to Dashboard</button>
          </div>
        </section>
      `;
      document.getElementById('btnExecutionGoWorkflows')?.addEventListener('click', () => router.navigate('workflows'));
      document.getElementById('btnExecutionGoDashboard')?.addEventListener('click', () => router.navigate('overview'));
      return;
    }

    sessionStorage.setItem('workflowCaptureActiveRunId', this.runId);

    // Initial log buffer
    this.logs = SSE.getLogs();

    container.innerHTML = `
      <div class="execution-shell">
        <!-- Reconnection Alert Banner -->
        <div class="execution-error hidden" id="connectionAlert" role="alert" style="display:flex; align-items:center; gap:0.6rem; padding:0.65rem 1rem; border-radius:var(--radius-md); background:#fffbeb; border:1px solid #fde68a; color:#92400e; font-size:0.78rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span id="connectionAlertText">Connection interrupted. Trying to reconnect…</span>
        </div>

        <!-- Human Intervention Banner (Hidden by default) -->
        <div class="card hidden" id="humanInterventionBanner" role="alert" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; padding:1rem 1.25rem; border-left:4px solid #f59e0b; background:#fffbeb; border-radius:var(--radius-lg);">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div style="width:34px; height:34px; border-radius:50%; background:#fef3c7; color:#b45309; display:grid; place-items:center; flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </div>
            <div>
              <strong style="color:#92400e; font-size:0.9rem; display:block;">Action needed in browser</strong>
              <p style="color:#78350f; font-size:0.78rem; margin:0.15rem 0 0;" id="humanInterventionText">Replay is paused awaiting your attention on the target page.</p>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="btnResumeExecution" style="background:#b45309; border-color:#b45309;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>Resume Run</span>
          </button>
        </div>

        <!-- Terminal Run Outcome Card (Hidden during active run) -->
        <div class="card hidden" id="terminalOutcomeCard" style="padding:1.15rem 1.4rem; border-radius:var(--radius-xl); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div style="display:flex; align-items:center; gap:0.85rem;">
            <div id="terminalOutcomeIcon" style="width:40px; height:40px; border-radius:50%; display:grid; place-items:center; font-size:1.1rem; flex-shrink:0;">✓</div>
            <div>
              <h2 id="terminalOutcomeTitle" style="margin:0; font-size:1.15rem; font-weight:800; color:var(--text-main);">Run Completed</h2>
              <p id="terminalOutcomeSummary" style="margin:0.25rem 0 0; font-size:0.78rem; color:var(--text-sub);"></p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btnTerminalFiles">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>View Files</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnTerminalResults">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span>Review Results</span>
            </button>
          </div>
        </div>

        <!-- Hero Header -->
        <section class="card execution-hero" aria-labelledby="executionTitle" style="background:rgba(13,19,36,0.85); border:1px solid rgba(0,240,255,0.2); box-shadow:0 0 25px rgba(0,240,255,0.06); border-radius:var(--radius-xl); margin-bottom:1rem;">
          <div style="display:flex; align-items:center; gap:1rem;">
            <div id="execHeroAvatar" style="flex-shrink:0;">
              ${renderRobotAvatar({ size: 'badge', state: 'running' })}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.25rem;">
                <span class="eyebrow" style="color:var(--accent-cyan); font-weight:800; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.1em;">AGENT MISSION CONTROL</span>
                <span class="badge-tag info" id="executionModeBadge" style="font-size:0.62rem; text-transform:uppercase;">AUTONOMOUS AGENT</span>
                <span class="badge-tag secondary" id="executionDomainBadge" style="display:none; font-size:0.62rem;"></span>
              </div>
              <h1 id="executionTitle" style="font-size:1.4rem; font-weight:800; margin:0.15rem 0; color:var(--text-primary);">Workflow Run</h1>
              <p style="margin:0.25rem 0 0; color:var(--text-sub); font-size:0.75rem; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <span>Mission ID <strong class="mono" id="executionRunId" style="font-weight:700; color:var(--text-primary);">${escapeHtml(this.runId)}</strong></span>
                <span id="executionStartedTime" style="color:var(--text-muted);"></span>
                <span id="executionPhaseBadge" style="font-weight:600; color:var(--accent-cyan);"></span>
              </p>
            </div>
          </div>
          <div class="execution-hero-actions">
            <button class="btn btn-secondary btn-sm" id="btnExecutionBack" title="Return to Workflows library">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
              <span>Workflows</span>
            </button>
            <span class="run-status-badge queued" id="executionStatusBadge" aria-live="polite">Starting</span>
            <button class="btn btn-danger btn-sm" id="btnExecutionStop" title="Stop current run">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              <span id="btnExecutionStopText">Abort Mission</span>
            </button>
            <button class="btn btn-secondary btn-sm hidden" id="btnExecutionViewFiles" title="View all files produced by this run">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              <span>Files</span>
            </button>
            <button class="btn btn-primary btn-sm hidden" id="btnExecutionViewResults" title="Inspect full results report">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span>Review Results</span>
            </button>
          </div>
        </section>

        <!-- Agent Mission Control Box (Robotic Worker Center) -->
        <section class="agent-mission-control-box" aria-label="Agent Mission Status">
          <div class="scanline-overlay"></div>
          <div style="display:flex; align-items:center; justify-content:center; gap:1.75rem; flex-wrap:wrap; position:relative; z-index:1;">
            <div id="execRobotCenterBox" style="position:relative;">
              <div class="orbital-ring"></div>
              ${renderRobotAvatar({ size: 'card', state: 'running' })}
            </div>
            <div style="text-align:left; max-width:520px;">
              <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem;">
                <span class="status-dot running" id="execRobotStatusDot"></span>
                <strong id="execRobotStatusText" style="font-size:0.8rem; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:0.08em;">● AGENT ACTIVE — AUTONOMOUS WORKER</strong>
              </div>
              <div id="activityTitle" style="font-size:1.15rem; font-weight:700; color:var(--text-primary); margin-bottom:0.3rem;">
                Initializing autonomous execution…
              </div>
              <div id="execRobotDetailText" style="font-size:0.8rem; color:var(--text-sub);">
                Observing live page structure, evaluating repeating entities, and executing user intent.
              </div>
            </div>
          </div>

          <!-- Futuristic Energy Progress Bar -->
          <div style="max-width:680px; margin:1.25rem auto 0; position:relative; z-index:1;">
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:0.35rem;">
              <span style="color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Mission Progress</span>
              <strong id="executionProgressPercent" style="color:var(--accent-cyan); font-family:var(--font-mono); font-size:0.88rem;">0%</strong>
            </div>
            <div class="mission-progress-bar-wrap">
              <div class="mission-progress-bar-fill" id="executionProgressBar" style="width:0%;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem;">
              <span id="executionProgressLabel">Connecting to browser…</span>
              <span id="executionProgressDetail">Preparing steps</span>
            </div>
          </div>
        </section>

        <!-- Engine Understanding Panel -->
        <section class="card" id="engineUnderstandingCard" style="padding:0.85rem 1.25rem; border-radius:var(--radius-lg); background:rgba(6,9,19,0.7); border:1px solid rgba(255,255,255,0.06); margin-bottom:0.85rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.45rem; flex-wrap:wrap; gap:0.5rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent-cyan);">Robotic Intelligence Engine</span>
              <span class="badge-tag success" id="engineLoopBadge" style="font-size:0.62rem;">Dynamic Pattern Detected ✓</span>
            </div>
            <span id="engineCollectionTag" style="font-size:0.72rem; color:var(--text-sub); font-family:var(--font-mono); font-weight:600;">Collection: Repeating Grid / Table</span>
          </div>
          <div style="display:flex; gap:1.5rem; flex-wrap:wrap; font-size:0.75rem; color:var(--text-sub);">
            <div><span>Discovered:</span> <strong id="engineItemsFound" style="color:var(--text-primary);">—</strong></div>
            <div><span>Matching:</span> <strong id="engineItemsMatching" style="color:var(--accent-cyan);">—</strong></div>
            <div><span>Condition Filter:</span> <strong id="engineActiveFilter" class="mono" style="color:var(--text-primary);">None</strong></div>
            <div><span>Artifact Destination:</span> <strong id="engineDownloadsFolder" class="mono" style="color:var(--accent-cyan); font-size:0.7rem;">downloads/run/</strong></div>
          </div>
        </section>

        <!-- Summary Metric Cards (Prominently displaying REMAINING) -->
        <section class="execution-summary-grid" aria-label="Run progress statistics">
          <article class="stat-card" style="border-color: rgba(12, 92, 63, 0.25); background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 80%);">
            <span class="stat-label" id="executionRemainingLabel" style="color:var(--brand-forest); font-weight:700;">Remaining</span>
            <strong id="executionRemaining" style="color:var(--brand-forest); font-size:1.6rem;" aria-live="polite">—</strong>
            <span class="stat-meta" id="executionRemainingMeta">Queued records</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Progress</span>
            <strong id="executionProcessed" aria-live="polite">0 / 0</strong>
            <span class="stat-meta" id="executionProcessedMeta">Records processed</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Completed</span>
            <strong id="executionSucceeded" style="color:#16a34a;" aria-live="polite">0</strong>
            <span class="stat-meta">Successful records</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Failed</span>
            <strong id="executionFailed" style="color:#dc2626;" aria-live="polite">0</strong>
            <span class="stat-meta">Errors caught</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Excluded</span>
            <strong id="executionSkipped" style="color:#d97706;" aria-live="polite">0</strong>
            <span class="stat-meta" id="executionSkippedMeta">Filtered / limit / dupes</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Files</span>
            <strong id="executionDownloads" style="color:var(--brand-forest);" aria-live="polite">0</strong>
            <span class="stat-meta">Generated files</span>
          </article>
        </section>

        <!-- Accessible Progress Track Bar -->
        <section class="card execution-progress-card">
          <div class="execution-progress-head">
            <div>
              <strong id="executionProgressLabel">Preparing execution…</strong>
              <span id="executionProgressDetail">Connecting to browser and initializing steps.</span>
            </div>
            <strong id="executionProgressPercent" style="font-size:1rem; color:var(--brand-forest); font-family:var(--font-mono);">0%</strong>
          </div>
          <div class="execution-progress-track" role="progressbar" id="executionProgressTrack" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Workflow run completion percentage">
            <div id="executionProgressBar" style="width:0%;"></div>
          </div>
        </section>

        <!-- Main Execution Grid: Steps Queue on Left, Live Merged Console on Right -->
        <div class="execution-grid">
          <!-- Left Column: Step-by-step Execution Queue -->
          <section class="card execution-steps-card">
            <div class="card-header-row" style="margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
              <div class="card-title-wrap">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <h2 id="executionStepCardTitle" style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Run Activity</h2>
                  <span class="badge-tag info" id="executionStepCountBadge">0 records</span>
                </div>
                <p id="executionStepCardDesc">Live status showing completed, active, and remaining records</p>
              </div>
            </div>
            <div class="execution-items" id="executionItems" style="max-height:460px; overflow-y:auto; padding-right:0.35rem;" role="list">
              <div class="execution-item-empty">Loading workflow records…</div>
            </div>
          </section>

          <!-- Right Column: Merged Live Console Terminal -->
          <section class="card execution-console-card">
            <div class="card-header-row" style="margin-bottom:0.65rem; flex-wrap:wrap; gap:0.5rem;">
              <div class="card-title-wrap">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <h2 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Live Console</h2>
                  <span class="badge-tag info" id="execConsoleLiveBadge" style="display:inline-flex; align-items:center; gap:0.35rem;">
                    <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>
                    <span>STREAMING</span>
                  </span>
                </div>
                <p>Real-time execution log events &amp; record status</p>
              </div>

              <!-- Console Filters & Controls -->
              <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                <div class="console-filter-pill-group" style="display:inline-flex; background:#f1f5f9; padding:2px; border-radius:6px;">
                  <button class="console-filter-btn active" data-filter="ALL">ALL</button>
                  <button class="console-filter-btn" data-filter="ACTION">ACTION</button>
                  <button class="console-filter-btn" data-filter="INFO">INFO</button>
                  <button class="console-filter-btn" data-filter="ERROR">ERROR</button>
                </div>

                <input type="text" id="execConsoleSearch" class="form-control" style="width:130px; padding:0.25rem 0.5rem; font-size:0.72rem;" placeholder="Search logs...">

                <label style="font-size:0.72rem; color:var(--text-sub); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" id="chkExecAutoScroll" checked> Auto
                </label>

                <button class="btn btn-ghost btn-sm" id="btnExecClearConsole" title="Clear output buffer">
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <!-- Terminal Output Window -->
            <div class="console-terminal-wrapper" id="execConsoleLogOutput" style="height:410px; max-height:460px; overflow-y:auto;" role="log" aria-live="polite">
              <!-- Live logs stream here -->
            </div>
          </section>
        </div>

        <div class="execution-error hidden" id="executionError" role="alert"></div>
      </div>
    `;

    this.terminalEl = document.getElementById('execConsoleLogOutput');
    this.bindEvents();
    this.bindConsoleEvents();

    try {
      await this.refresh();
      this.startPolling();
    } catch (e) {
      this.showError(e.message);
    }
  },

  bindEvents() {
    document.getElementById('btnExecutionBack')?.addEventListener('click', () => {
      this.router.navigate('workflows');
    });

    document.getElementById('btnExecutionViewResults')?.addEventListener('click', () => {
      this.router.navigate(`results/${encodeURIComponent(this.runId)}`);
    });

    document.getElementById('btnTerminalResults')?.addEventListener('click', () => {
      this.router.navigate(`results/${encodeURIComponent(this.runId)}`);
    });

    document.getElementById('btnExecutionViewFiles')?.addEventListener('click', () => {
      this.router.navigate('artifacts');
    });

    document.getElementById('btnTerminalFiles')?.addEventListener('click', () => {
      this.router.navigate('artifacts');
    });

    // Resume execution if paused for intervention
    document.getElementById('btnResumeExecution')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnResumeExecution');
      if (btn) btn.disabled = true;
      try {
        // Hide banner
        document.getElementById('humanInterventionBanner')?.classList.add('hidden');
        Toast.info('Resuming workflow execution…');
        this.isPaused = false;
        await this.refresh();
      } catch (err) {
        Toast.error(err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Stop execution button with confirmation
    document.getElementById('btnExecutionStop')?.addEventListener('click', async () => {
      if (this.isStopping) return;

      const confirmed = await Modal.confirm({
        title: 'Stop Execution',
        message: 'Are you sure you want to stop this run? Active steps will be aborted immediately.',
        confirmText: 'Stop Run',
        cancelText: 'Continue Running',
        danger: true
      });
      if (!confirmed) {
        return;
      }

      this.isStopping = true;
      const btn = document.getElementById('btnExecutionStop');
      const text = document.getElementById('btnExecutionStopText');
      if (btn) btn.disabled = true;
      if (text) text.textContent = 'Stopping…';

      try {
        await Api.stopRun(this.runId);
        Toast.info('Stop signal sent to run runner.');
        await this.refresh();
      } catch (e) {
        Toast.error(e.message);
        if (btn) btn.disabled = false;
        if (text) text.textContent = 'Stop Run';
        this.isStopping = false;
      }
    });
  },

  bindConsoleEvents() {
    // Console filter buttons
    this.container.querySelectorAll('.console-filter-btn').forEach(btn => {
      btn.onclick = () => {
        this.container.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter') || 'ALL';
        this.renderLogs();
      };
    });

    // Console search filter
    const search = document.getElementById('execConsoleSearch');
    if (search) {
      search.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderLogs();
      };
    }

    // Auto-scroll checkbox
    const chk = document.getElementById('chkExecAutoScroll');
    if (chk) {
      chk.onchange = (e) => {
        this.autoScroll = e.target.checked;
      };
    }

    // Clear console button
    const btnClear = document.getElementById('btnExecClearConsole');
    if (btnClear) {
      btnClear.onclick = () => {
        this.logs = [];
        this.renderLogs();
        Toast.info('Execution terminal logs cleared');
      };
    }

    // Subscribe to SSE logs for real-time streaming
    if (this.unsubscribeSSE) {
      this.unsubscribeSSE();
      this.unsubscribeSSE = null;
    }

    this.unsubscribeSSE = SSE.on('log', (log) => {
      this.logs = SSE.getLogs();
      if (this.terminalEl && this.matchesFilter(log)) {
        this.appendLogEntry(log);
      }
      this.updateActivityFromLog(log);
    });

    // Subscribe to human intervention alert
    if (this.unsubscribeHumanIntervention) {
      this.unsubscribeHumanIntervention();
      this.unsubscribeHumanIntervention = null;
    }

    this.unsubscribeHumanIntervention = SSE.on('human_intervention', (data) => {
      this.handleHumanIntervention(data);
    });

    // Initial render of existing logs
    this.renderLogs();
  },

  updateActivityFromLog(log) {
    if (!log || !log.text) return;
    const txt = String(log.text);

    if (txt.includes('Processing record') || txt.includes('Processing item')) {
      const match = txt.match(/Processing (?:record|item)\s*(?:#|\[)?(\d+)/i);
      const num = match ? match[1] : '';
      this.setActivity(`Processing Record ${num ? '#' + num : ''}`, txt);
    } else if (txt.includes('Downloading') || txt.includes('Download organized')) {
      this.setActivity('Downloading file…', txt);
    } else if (txt.includes('Skipping')) {
      this.setActivity('Evaluating filters…', txt);
    } else if (txt.includes('setup step')) {
      this.setActivity('Executing setup steps…', txt);
    }
  },

  setActivity(title, detail = '') {
    const elTitle = document.getElementById('activityTitle');
    const elInd = document.getElementById('activityPhaseIndicator');
    if (elTitle) elTitle.textContent = title;
    if (elInd && detail) elInd.textContent = detail.slice(0, 40);
  },

  handleHumanIntervention(data) {
    this.isPaused = true;
    const banner = document.getElementById('humanInterventionBanner');
    const txt = document.getElementById('humanInterventionText');
    if (banner) banner.classList.remove('hidden');
    if (txt) txt.textContent = data.message || `Attention needed on step ${data.stepIndex || ''}. Please check the browser window.`;
    this.setActivity('Action needed in browser', 'Replay is paused waiting for user action');
  },

  matchesFilter(log) {
    const level = (log.level || 'INFO').toUpperCase();
    if (this.activeFilter !== 'ALL' && level !== this.activeFilter) return false;
    if (this.searchQuery && !String(log.text).toLowerCase().includes(this.searchQuery)) return false;
    return true;
  },

  renderLogs() {
    if (!this.terminalEl) return;
    this.terminalEl.innerHTML = '';

    const filtered = this.logs.filter(l => this.matchesFilter(l));
    if (filtered.length === 0) {
      this.terminalEl.innerHTML = `<div style="color:#64748b; font-style:italic; padding:0.75rem;">Waiting for runner log events...</div>`;
      return;
    }

    filtered.forEach(log => this.appendLogEntry(log, false));

    if (this.autoScroll) {
      this.terminalEl.scrollTop = this.terminalEl.scrollHeight;
    }
  },

  appendLogEntry(log, scroll = true) {
    if (!this.terminalEl) return;

    if (this.terminalEl.children.length === 1 && this.terminalEl.firstElementChild.style.fontStyle === 'italic') {
      this.terminalEl.innerHTML = '';
    }

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
  },

  startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => {
      this.refresh().catch(e => {
        this.connectionFailed = true;
        const banner = document.getElementById('connectionAlert');
        if (banner) banner.classList.remove('hidden');
      });
    }, 800);
  },

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  async refresh() {
    let data;
    try {
      data = await Api.getRunStatus(this.runId);
      if (this.connectionFailed) {
        this.connectionFailed = false;
        document.getElementById('connectionAlert')?.classList.add('hidden');
      }
    } catch (e) {
      this.connectionFailed = true;
      const banner = document.getElementById('connectionAlert');
      if (banner) banner.classList.remove('hidden');
      throw e;
    }

    this.lastPollData = data;
    const run = data.run || {};
    const m = run.manifest || {};
    const results = Array.isArray(m.results) ? m.results : [];

    // Extract workflow steps definition
    if (Array.isArray(run.workflowSteps) && run.workflowSteps.length > 0) {
      this.workflowSteps = run.workflowSteps;
    }

    // Determine mode and labels
    const isLoopMode = (run.mode === 'LOOP') || (run.mode === 'loop') || (m.mode === 'LOOP') || (m.mode === 'loop');
    const unitSingular = isLoopMode ? 'record' : 'step';
    const unitPlural = isLoopMode ? 'records' : 'steps';
    const UnitCapital = isLoopMode ? 'Record' : 'Step';

    // Discovered / Total counts
    const totalCount = isLoopMode
      ? Number(m.itemsTotal ?? run.itemsTotal ?? (results.length > 0 ? results.length : this.workflowSteps.length) ?? 0)
      : (this.workflowSteps.length > 0 ? this.workflowSteps.length : Number(m.itemsTotal ?? run.itemsTotal ?? results.length ?? 0));

    const ok = Number(m.itemsSucceeded ?? run.itemsSucceeded ?? 0);
    const fail = Number(m.itemsFailed ?? run.itemsFailed ?? 0);
    const terminalItemStatuses = new Set(['SUCCESS', 'FAILED', 'STOPPED', 'SKIPPED_DUPLICATE', 'SKIPPED_FILTER', 'SKIPPED_LIMIT']);
    const processed = results.filter(x => terminalItemStatuses.has(x.status)).length;
    const remaining = Math.max(0, totalCount - processed);
    const files = Array.isArray(m.downloadedFiles) ? m.downloadedFiles.length : Number((run.downloadedFiles || []).length);
    const pct = totalCount > 0 ? Math.min(100, Math.round((processed / totalCount) * 100)) : 0;
    const status = m.status || run.status || 'QUEUED';
    const isTerminal = terminalStates.has(status);

    // Update Header Elements
    const titleEl = document.getElementById('executionTitle');
    if (titleEl) {
      const name = run.workflowName || run.workflowId || 'Workflow';
      titleEl.textContent = name;
    }

    const domainBadge = document.getElementById('executionDomainBadge');
    if (domainBadge) {
      const domain = extractDomain(run.targetUrl || run.url);
      if (domain) {
        domainBadge.textContent = domain;
        domainBadge.style.display = 'inline-block';
      } else {
        domainBadge.style.display = 'none';
      }
    }

    const modeBadge = document.getElementById('executionModeBadge');
    if (modeBadge) {
      modeBadge.textContent = isLoopMode ? 'Batch run (Loop)' : 'Single run';
    }

    const startedTimeEl = document.getElementById('executionStartedTime');
    if (startedTimeEl) {
      const started = run.startedAt || m.startTime;
      if (started) {
        startedTimeEl.textContent = `· Started at ${formatTime(started)}`;
      }
    }

    const phaseBadge = document.getElementById('executionPhaseBadge');
    if (phaseBadge) {
      if (isTerminal) {
        phaseBadge.textContent = '· Finished';
      } else if (isLoopMode) {
        phaseBadge.textContent = processed > 0 ? `· Processing record ${processed + 1} of ${totalCount}` : '· Starting records scan';
      } else {
        phaseBadge.textContent = `· Step ${processed + 1} of ${totalCount}`;
      }
    }

    // Update Status Badge
    const badge = document.getElementById('executionStatusBadge');
    if (badge) {
      const label = formatStatusLabel(status);
      badge.textContent = label;
      badge.className = `run-status-badge ${String(status).toLowerCase()}`;
    }

    // Update Metrics
    const elRemLabel = document.getElementById('executionRemainingLabel');
    if (elRemLabel) elRemLabel.textContent = `${unitPlural} Remaining`;

    const elRem = document.getElementById('executionRemaining');
    if (elRem) {
      elRem.textContent = isTerminal ? '0' : (totalCount > 0 ? String(remaining) : '—');
      const remMeta = document.getElementById('executionRemainingMeta');
      if (remMeta) {
        remMeta.textContent = isTerminal ? 'Run complete' : (totalCount > 0 ? `${remaining} remaining` : 'Calculating…');
      }
    }

    const elProc = document.getElementById('executionProcessed');
    if (elProc) {
      elProc.textContent = totalCount > 0 ? `${processed} / ${totalCount}` : (processed > 0 ? `${processed} processed` : 'Processing…');
    }

    const elProcMeta = document.getElementById('executionProcessedMeta');
    if (elProcMeta) {
      elProcMeta.textContent = `${unitPlural} processed`;
    }

    const elSucc = document.getElementById('executionSucceeded');
    if (elSucc) elSucc.textContent = ok;

    const elFail = document.getElementById('executionFailed');
    if (elFail) elFail.textContent = fail;

    const filterSkipped = results.filter(r => r.status === 'SKIPPED_FILTER').length;
    const limitSkipped = results.filter(r => r.status === 'SKIPPED_LIMIT').length;
    const dupSkipped = results.filter(r => r.status === 'SKIPPED_DUPLICATE').length;
    const skippedCount = m.itemsSkipped ?? run.itemsSkipped ?? (filterSkipped + limitSkipped + dupSkipped);

    const elSkip = document.getElementById('executionSkipped');
    if (elSkip) elSkip.textContent = skippedCount;

    const elSkipMeta = document.getElementById('executionSkippedMeta');
    if (elSkipMeta) {
      const parts = [];
      if (filterSkipped > 0) parts.push(`${filterSkipped} filtered out`);
      if (limitSkipped > 0) parts.push(`${limitSkipped} limit reached`);
      if (dupSkipped > 0) parts.push(`${dupSkipped} already processed`);
      elSkipMeta.textContent = parts.length > 0 ? parts.join(' · ') : 'Filtered / limit / dupes';
    }

    const elDown = document.getElementById('executionDownloads');
    if (elDown) elDown.textContent = files;

    // Update Engine Understanding Panel (Part 29)
    const elEngineLoopBadge = document.getElementById('engineLoopBadge');
    if (elEngineLoopBadge) {
      const isLoop = run.mode === 'LOOP' || run.isLoop;
      const conf = run.loopConfidence || 94;
      elEngineLoopBadge.textContent = isLoop ? `Loop: Detected ✓ (${conf}%)` : 'Standard Macro';
      elEngineLoopBadge.className = isLoop ? 'badge-tag success' : 'badge-tag secondary';
    }
    const elEngineColl = document.getElementById('engineCollectionTag');
    if (elEngineColl) {
      elEngineColl.textContent = `Collection: ${run.patternType || (run.mode === 'LOOP' ? 'Table / Grid' : 'Sequential Steps')}`;
    }
    const elEngineFound = document.getElementById('engineItemsFound');
    if (elEngineFound) {
      elEngineFound.textContent = totalCount > 0 ? String(totalCount) : '—';
    }
    const elEngineMatching = document.getElementById('engineItemsMatching');
    if (elEngineMatching) {
      elEngineMatching.textContent = m.matchingCount != null ? String(m.matchingCount) : (totalCount > 0 ? String(totalCount) : '—');
    }
    const elEngineFilter = document.getElementById('engineActiveFilter');
    if (elEngineFilter) {
      if (run.itemFilter) {
        if (run.itemFilter.conditions && run.itemFilter.conditions.length > 0) {
          elEngineFilter.textContent = run.itemFilter.conditions.map(c => `${c.field} ${c.operator} "${c.value}"`).join(' & ');
        } else if (run.itemFilter.field) {
          elEngineFilter.textContent = `${run.itemFilter.field} ${run.itemFilter.operator || 'contains'} "${run.itemFilter.value}"`;
        } else {
          elEngineFilter.textContent = 'Active Filter';
        }
      } else {
        elEngineFilter.textContent = 'All Records';
      }
    }
    const elEngineFolder = document.getElementById('engineDownloadsFolder');
    if (elEngineFolder) {
      elEngineFolder.textContent = `downloads/.../${this.runId}`;
    }

    // Update Progress Bar
    const track = document.getElementById('executionProgressTrack');
    const elPct = document.getElementById('executionProgressPercent');
    const elBar = document.getElementById('executionProgressBar');

    if (track && elBar) {
      const progressVal = isTerminal && status === 'COMPLETED' ? 100 : pct;
      track.setAttribute('aria-valuenow', String(progressVal));
      elBar.style.width = `${progressVal}%`;
      if (elPct) elPct.textContent = `${progressVal}%`;

      if (status === 'COMPLETED') elBar.style.backgroundColor = '#16a34a';
      else if (status === 'FAILED') elBar.style.backgroundColor = '#dc2626';
      else if (status === 'COMPLETED_WITH_ERRORS') elBar.style.backgroundColor = '#f59e0b';
      else elBar.style.backgroundColor = 'var(--brand-forest)';
    }

    const elProgLabel = document.getElementById('executionProgressLabel');
    if (elProgLabel) {
      if (isTerminal) {
        if (status === 'COMPLETED') {
          elProgLabel.textContent = `All ${totalCount} ${unitPlural} processed successfully!`;
        } else if (status === 'COMPLETED_WITH_ERRORS') {
          elProgLabel.textContent = `Run completed with ${fail} error(s).`;
        } else if (status === 'STOPPED') {
          elProgLabel.textContent = 'Run stopped.';
        } else {
          elProgLabel.textContent = `Run failed: ${formatStatusLabel(status)}`;
        }
      } else if (processed > 0) {
        elProgLabel.textContent = `Processing ${UnitCapital} ${processed + 1} of ${totalCount} (${remaining} remaining)`;
      } else if (totalCount > 0) {
        elProgLabel.textContent = `Starting ${isLoopMode ? 'batch run' : 'workflow'} (${totalCount} ${totalCount === 1 ? unitSingular : unitPlural} queued)…`;
      } else {
        elProgLabel.textContent = 'Processing records…';
      }
    }

    const elProgDetail = document.getElementById('executionProgressDetail');
    if (elProgDetail) {
      if (isTerminal) {
        elProgDetail.textContent = `${ok} completed · ${fail} failed · ${skippedCount} excluded · ${files} file(s) generated`;
      } else if (totalCount > 0) {
        elProgDetail.textContent = `${ok} completed · ${fail} failed · ${remaining} remaining`;
      } else {
        elProgDetail.textContent = 'Running automation steps…';
      }
    }

    // Update Current Activity Card
    const activityTitle = document.getElementById('activityTitle');
    const activityIndicator = document.getElementById('activityPhaseIndicator');
    const pulseDot = document.getElementById('activityPulseDot');

    if (activityTitle) {
      if (isTerminal) {
        activityTitle.textContent = status === 'COMPLETED' ? 'Run finished successfully.' : `Run ended: ${formatStatusLabel(status)}`;
        if (activityIndicator) activityIndicator.textContent = 'Completed';
        if (pulseDot) {
          pulseDot.style.animation = 'none';
          pulseDot.style.backgroundColor = status === 'COMPLETED' ? '#16a34a' : (status === 'STOPPED' ? '#ea580c' : '#dc2626');
        }
      } else {
        // Find current running item
        const runningItem = results.find(r => r.status === 'RUNNING' || r.status === 'PENDING');
        if (runningItem) {
          activityTitle.textContent = runningItem.label ? `Processing Record ${runningItem.label}…` : `Processing Record #${runningItem.index}…`;
          if (activityIndicator) activityIndicator.textContent = 'Active Step';
        } else if (processed > 0 && processed < totalCount) {
          activityTitle.textContent = `Processing Record #${processed + 1}…`;
          if (activityIndicator) activityIndicator.textContent = 'In Progress';
        }
      }
    }

    // Step/Item Count Badge and Titles
    const countBadge = document.getElementById('executionStepCountBadge');
    if (countBadge) {
      countBadge.textContent = `${totalCount} ${totalCount === 1 ? unitSingular : unitPlural}`;
    }

    const queueTitle = document.getElementById('executionStepCardTitle');
    if (queueTitle) {
      queueTitle.textContent = isLoopMode ? 'Batch Record Activity' : 'Step Activity';
    }

    // Determine loopStepIndex
    const loopStepIndex = Number.isInteger(run.loopStepIndex)
      ? run.loopStepIndex
      : (Number.isInteger(m.loopStepIndex)
          ? m.loopStepIndex
          : (this.workflowSteps.findIndex(s => s.role === 'LOOP') >= 0 ? this.workflowSteps.findIndex(s => s.role === 'LOOP') : 0));

    // Render Steps / Items Queue
    this.renderStepsQueue(results, totalCount, isTerminal, status, isLoopMode, loopStepIndex);

    // Update Action Buttons
    const btnStop = document.getElementById('btnExecutionStop');
    if (btnStop) {
      if (isTerminal) {
        btnStop.classList.add('hidden');
      } else {
        btnStop.classList.remove('hidden');
      }
    }

    const btnResults = document.getElementById('btnExecutionViewResults');
    const btnFiles = document.getElementById('btnExecutionViewFiles');
    if (btnResults && isTerminal) btnResults.classList.remove('hidden');
    if (btnFiles && isTerminal && files > 0) btnFiles.classList.remove('hidden');

    // Terminal Outcome Card Display
    const outcomeCard = document.getElementById('terminalOutcomeCard');
    if (outcomeCard && isTerminal) {
      outcomeCard.classList.remove('hidden');
      const oIcon = document.getElementById('terminalOutcomeIcon');
      const oTitle = document.getElementById('terminalOutcomeTitle');
      const oSummary = document.getElementById('terminalOutcomeSummary');

      // Update center robot avatar
      const centerRobot = document.getElementById('execRobotCenterBox');
      const heroRobot = document.getElementById('execHeroAvatar');
      const robotDot = document.getElementById('execRobotStatusDot');
      const robotStatusText = document.getElementById('execRobotStatusText');

      if (status === 'COMPLETED') {
        outcomeCard.style.border = '1px solid rgba(16,185,129,0.3)';
        outcomeCard.style.borderLeft = '4px solid #10b981';
        outcomeCard.style.background = 'rgba(16,185,129,0.08)';
        if (oIcon) {
          oIcon.style.background = 'rgba(16,185,129,0.2)';
          oIcon.style.color = '#34d399';
          oIcon.textContent = '✓';
        }
        if (oTitle) oTitle.textContent = 'Mission Completed Successfully';
        if (oSummary) oSummary.textContent = `All ${totalCount} records processed autonomously. ${files} files generated and verified.`;
        if (centerRobot) centerRobot.innerHTML = `<div class="orbital-ring"></div>` + renderRobotAvatar({ size: 'card', state: 'success' });
        if (heroRobot) heroRobot.innerHTML = renderRobotAvatar({ size: 'badge', state: 'success' });
        if (robotDot) robotDot.className = 'status-dot online';
        if (robotStatusText) {
          robotStatusText.style.color = '#34d399';
          robotStatusText.textContent = '● AGENT COMPLETED — MISSION SUCCESSFUL';
        }
      } else if (status === 'COMPLETED_WITH_ERRORS') {
        outcomeCard.style.border = '1px solid rgba(245,158,11,0.3)';
        outcomeCard.style.borderLeft = '4px solid #f59e0b';
        outcomeCard.style.background = 'rgba(245,158,11,0.08)';
        if (oIcon) {
          oIcon.style.background = 'rgba(245,158,11,0.2)';
          oIcon.style.color = '#fbbf24';
          oIcon.textContent = '⚠️';
        }
        if (oTitle) oTitle.textContent = 'Mission Completed with Warnings';
        if (oSummary) oSummary.textContent = `${ok} records succeeded, ${fail} failed. ${files} files produced.`;
        if (centerRobot) centerRobot.innerHTML = `<div class="orbital-ring"></div>` + renderRobotAvatar({ size: 'card', state: 'warning' });
        if (heroRobot) heroRobot.innerHTML = renderRobotAvatar({ size: 'badge', state: 'warning' });
      } else if (status === 'STOPPED') {
        outcomeCard.style.border = '1px solid rgba(234,88,12,0.3)';
        outcomeCard.style.borderLeft = '4px solid #ea580c';
        outcomeCard.style.background = 'rgba(234,88,12,0.08)';
        if (oIcon) {
          oIcon.style.background = 'rgba(234,88,12,0.2)';
          oIcon.style.color = '#fb923c';
          oIcon.textContent = '■';
        }
        if (oTitle) oTitle.textContent = 'Mission Aborted';
        if (oSummary) oSummary.textContent = `Halted by user. ${processed} records were processed before stopping.`;
        if (centerRobot) centerRobot.innerHTML = `<div class="orbital-ring"></div>` + renderRobotAvatar({ size: 'card', state: 'idle' });
      } else {
        outcomeCard.style.border = '1px solid rgba(239,68,68,0.3)';
        outcomeCard.style.borderLeft = '4px solid #ef4444';
        outcomeCard.style.background = 'rgba(239,68,68,0.08)';
        if (oIcon) {
          oIcon.style.background = 'rgba(239,68,68,0.2)';
          oIcon.style.color = '#f87171';
          oIcon.textContent = '✗';
        }
        if (oTitle) oTitle.textContent = 'Mission Failed';
        if (oSummary) oSummary.textContent = run.error || m.error || 'Execution encountered an error and could not complete.';
        if (centerRobot) centerRobot.innerHTML = `<div class="orbital-ring"></div>` + renderRobotAvatar({ size: 'card', state: 'error' });
        if (heroRobot) heroRobot.innerHTML = renderRobotAvatar({ size: 'badge', state: 'error' });
        if (robotDot) robotDot.className = 'status-dot recording';
        if (robotStatusText) {
          robotStatusText.style.color = '#f87171';
          robotStatusText.textContent = '● AGENT UNCERTAINTY — ERROR ENCOUNTERED';
        }
      }
    }

    // Handle terminal status
    if (isTerminal) {
      this.stopPolling();
      sessionStorage.setItem('workflowCaptureLastRunId', this.runId);
      const liveBadge = document.getElementById('execConsoleLiveBadge');
      if (liveBadge) {
        liveBadge.className = 'badge-tag success';
        liveBadge.innerHTML = `<span>FINISHED</span>`;
      }
    }
  },

  renderStepsQueue(results, totalCount, isTerminal, overallStatus, isLoopMode = false, loopStepIndex = 0) {
    const list = document.getElementById('executionItems');
    if (!list) return;

    // Build map of executed results by index
    const resultMap = new Map();
    results.forEach(r => {
      const idx = Number(r.index);
      resultMap.set(idx, r);
    });

    const rows = [];
    const count = Math.max(totalCount, results.length);

    if (count === 0 && (!this.workflowSteps || this.workflowSteps.length === 0)) {
      list.innerHTML = `<div class="execution-item-empty">Waiting for run to initialize…</div>`;
      return;
    }

    // In Loop Mode, render Setup Steps first if any exist
    if (isLoopMode && loopStepIndex > 0 && Array.isArray(this.workflowSteps) && this.workflowSteps.length > 0) {
      const setupCount = Math.min(loopStepIndex, this.workflowSteps.length);
      rows.push(`
        <div style="font-size:0.72rem; font-weight:800; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.06em; padding:0.35rem 0.2rem 0.2rem; display:flex; align-items:center; gap:0.4rem;">
          <span>⚙️ Setup Phase (${setupCount} step${setupCount === 1 ? '' : 's'})</span>
        </div>
      `);

      for (let s = 0; s < setupCount; s++) {
        const stepDef = this.workflowSteps[s] || {};
        const stepType = stepDef.type || stepDef.action || 'SETUP';
        const stepFriendly = stepDef.elementName || stepDef.name || stepDef.target?.elementName || '';
        const targetDetail = stepFriendly
          ? (stepDef.value ? `"${stepDef.value}" → ${stepFriendly}` : stepFriendly)
          : ((stepDef.selector || stepDef.target?.selectors?.cssPath || (typeof stepDef.target === 'string' ? stepDef.target : ''))
            ? `Target: ${stepDef.selector || stepDef.target?.selectors?.cssPath || (typeof stepDef.target === 'string' ? stepDef.target : '')}`
            : (stepDef.url ? `URL: ${stepDef.url}` : (stepDef.value ? `Input: "${stepDef.value}"` : 'Setup action')));

        const setupDone = results.length > 0 || ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(overallStatus);
        const setupState = setupDone ? 'success' : (overallStatus === 'FAILED' ? 'failed' : 'pending');
        const setupIcon = setupDone ? '✓' : (overallStatus === 'FAILED' ? '✗' : '⟳');
        const setupStateLabel = setupDone ? 'Completed' : (overallStatus === 'FAILED' ? 'Failed' : 'Running');

        rows.push(`
          <div class="execution-item-row ${setupState}" style="border-left: 3px solid #64748b;" role="listitem">
            <span class="execution-item-icon" aria-hidden="true">${setupIcon}</span>
            <div class="execution-item-copy">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <strong>Step #${s + 1}</strong>
                <span class="badge-tag info" style="font-size:0.6rem; padding:1px 5px; background:#f1f5f9; color:#475569;">${escapeHtml(stepType)}</span>
                <span class="df-role-badge role-setup" style="font-size:0.58rem; padding:1px 6px;">SETUP</span>
              </div>
              <span>${escapeHtml(targetDetail)}</span>
            </div>
            <span class="execution-item-status status-${setupState}">${setupStateLabel}</span>
          </div>
        `);
      }

      rows.push(`
        <div style="font-size:0.72rem; font-weight:800; color:var(--brand-forest); text-transform:uppercase; letter-spacing:0.06em; padding:0.75rem 0.2rem 0.2rem; display:flex; align-items:center; gap:0.4rem;">
          <span>🔁 Batch Run Phase (${count} record${count === 1 ? '' : 's'})</span>
        </div>
      `);
    }

    for (let i = 1; i <= count; i++) {
      const res = resultMap.get(i);
      let titleLabel = '';
      let targetDetail = '';

      if (isLoopMode) {
        titleLabel = (res && res.label) ? `Record #${i} · ${escapeHtml(res.label)}` : `Record #${i}`;
        if (res && res.status === 'SKIPPED_FILTER') {
          targetDetail = res.skippedReason ? `Filtered out: ${res.skippedReason}` : 'Excluded by record filter conditions';
        } else if (res && res.status === 'SKIPPED_LIMIT') {
          targetDetail = res.skippedReason ? `Limit reached: ${res.skippedReason}` : 'Limit reached: Maximum records capped';
        } else if (res && res.status === 'SKIPPED_DUPLICATE') {
          targetDetail = res.skippedReason || 'Already processed: duplicate download skipped';
        } else if (res && Array.isArray(res.downloadedFiles) && res.downloadedFiles.length > 0) {
          targetDetail = `File produced: ${res.downloadedFiles.map(f => typeof f === 'string' ? f : f.filename).join(', ')}`;
        } else if (res && Array.isArray(res.actions)) {
          targetDetail = `Completed ${res.actions.length} action(s) on record`;
        } else {
          targetDetail = `Record #${i}`;
        }
      } else {
        const stepDef = this.workflowSteps[i - 1] || {};
        const stepFriendly = (res && (res.elementName || res.name)) || stepDef.elementName || stepDef.name || stepDef.target?.elementName || '';
        titleLabel = stepFriendly ? `Step #${i} · ${escapeHtml(stepFriendly)}` : `Step #${i}`;
        targetDetail = (stepDef.value)
          ? `Input: "${stepDef.value}"`
          : (stepDef.url ? `URL: ${stepDef.url}` : (stepFriendly ? `${stepDef.type || 'Action'} on ${stepFriendly}` : (stepDef.selector ? `Target: ${stepDef.selector}` : '')));
      }

      let state = 'remaining';
      let icon = '⏱';
      let stateLabel = 'Remaining';
      let errorText = '';

      if (res) {
        const formatted = formatRecordStatus(res.status);
        state = formatted.cls;
        icon = formatted.icon;
        stateLabel = formatted.label;
        if (res.status === 'FAILED' && res.error) {
          errorText = ` — ${escapeHtml(res.error)}`;
        }
      } else if (!isTerminal && i === results.length + 1) {
        state = 'pending';
        icon = '⟳';
        stateLabel = 'Running';
      } else if (isTerminal) {
        state = 'stopped';
        icon = '—';
        stateLabel = 'Not reached';
      }

      // Check if file was produced
      let fileBadge = '';
      if (res && Array.isArray(res.downloadedFiles) && res.downloadedFiles.length > 0) {
        const firstFile = typeof res.downloadedFiles[0] === 'string' ? { filename: res.downloadedFiles[0] } : res.downloadedFiles[0];
        fileBadge = `
          <div style="margin-top:0.3rem; display:inline-flex; align-items:center; gap:0.4rem; padding:0.15rem 0.5rem; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:4px; font-size:0.68rem; color:#065f46;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <strong style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(firstFile.filename)}</strong>
          </div>
        `;
      }

      rows.push(`
        <div class="execution-item-row ${state}" role="listitem">
          <span class="execution-item-icon" aria-hidden="true">${icon}</span>
          <div class="execution-item-copy">
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <strong>${escapeHtml(titleLabel)}</strong>
            </div>
            <span>${escapeHtml(targetDetail)}${errorText}</span>
            ${fileBadge}
          </div>
          <span class="execution-item-status status-${state}">${stateLabel}</span>
        </div>
      `);
    }

    list.innerHTML = rows.join('');
  },

  showError(message) {
    const b = document.getElementById('executionError');
    if (b) {
      b.textContent = message || 'Unable to load run status.';
      b.classList.remove('hidden');
    }
  },

  destroy() {
    this.stopPolling();
    if (this.unsubscribeSSE) {
      this.unsubscribeSSE();
      this.unsubscribeSSE = null;
    }
    if (this.unsubscribeHumanIntervention) {
      this.unsubscribeHumanIntervention();
      this.unsubscribeHumanIntervention = null;
    }
  }
};