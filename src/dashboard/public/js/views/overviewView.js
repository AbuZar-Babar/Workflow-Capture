/**
 * Workflow Capture — Overview View (Dashboard & Recording Modernization)
 *
 * Provides an intuitive, professional control center for business users:
 * - Immediate browser connection visibility and one-click launch
 * - Clear, unambiguous recording workflow (Ready → Recording → Stop & Save → Saved)
 * - Real saved workflows with domain indicators, step counts, Run and Edit actions
 * - Real activity tracking (completed runs, recordings saved, files generated)
 * - Zero fake metrics, zero developer/CDP jargon, zero disconnected controls
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Header } from '../components/header.js';
import { ExecutionModal } from '../components/executionModal.js';

function extractDomain(url) {
  if (!url || url === 'about:blank' || url === 'unknown') return 'Web Application';
  try {
    const parsed = new URL(url);
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
  const now = Date.now();
  const diffSec = Math.floor((now - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const OverviewView = {
  recordTimer: null,
  recordStatusTimer: null,
  recordStartTime: 0,
  recordings: [],
  recentRuns: [],
  isRecording: false,
  isStarting: false,
  isStopping: false,
  _hasCountedUp: false,

  async render(container, router) {
    this.router = router;
    this._hasCountedUp = false;
    window.OverviewView = this;

    container.innerHTML = `
      <div class="dashboard-shell" role="region" aria-label="Dashboard Overview">

        <!-- Hero Section: Modern Workflow Capture Hero with Unambiguous Recording State -->
        <section class="dashboard-hero" id="overviewDashboardHero" style="position:relative; overflow:hidden;" aria-labelledby="heroTitle">
          <div style="display:flex; align-items:center; gap:1.25rem; position:relative; z-index:2;">
            <div class="overview-mascot-avatar ai-node-network" style="width:72px; height:72px; flex-shrink:0;" aria-hidden="true">
              <svg viewBox="0 0 120 120" width="100%" height="100%" fill="none" class="ai-workflow-net-svg">
                <defs>
                  <linearGradient id="wfGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#2563eb"/>
                    <stop offset="100%" stop-color="#0284c7"/>
                  </linearGradient>
                  <linearGradient id="wfGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#0284c7"/>
                    <stop offset="100%" stop-color="#2563eb"/>
                  </linearGradient>
                  <filter id="wfGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feMerge>
                      <feMergeNode in="blur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>
                <line x1="22" y1="60" x2="56" y2="26" stroke="url(#wfGrad1)" stroke-width="2" stroke-dasharray="4 3" opacity="0.65"/>
                <line x1="22" y1="60" x2="56" y2="94" stroke="url(#wfGrad1)" stroke-width="2" stroke-dasharray="4 3" opacity="0.65"/>
                <line x1="56" y1="26" x2="98" y2="60" stroke="url(#wfGrad2)" stroke-width="2" stroke-dasharray="4 3" opacity="0.65"/>
                <line x1="56" y1="94" x2="98" y2="60" stroke="url(#wfGrad2)" stroke-width="2" stroke-dasharray="4 3" opacity="0.65"/>
                <line x1="56" y1="26" x2="56" y2="94" stroke="#0284c7" stroke-width="1.6" stroke-dasharray="3 3" opacity="0.45"/>
                <line x1="22" y1="60" x2="98" y2="60" stroke="#2563eb" stroke-width="1.6" stroke-dasharray="2 3" opacity="0.35"/>

                <path d="M22,60 L56,26 L98,60" fill="none" stroke="#0284c7" stroke-width="2" class="flow-pulse-path flow-1"/>
                <path d="M22,60 L56,94 L98,60" fill="none" stroke="#2563eb" stroke-width="2" class="flow-pulse-path flow-2"/>

                <circle cx="22" cy="60" r="10" stroke="#2563eb" stroke-width="1.5" fill="none" class="node-ring ring-1" opacity="0.75"/>
                <circle cx="56" cy="26" r="12" stroke="#0284c7" stroke-width="1.5" fill="none" class="node-ring ring-2" opacity="0.75"/>
                <circle cx="98" cy="60" r="14" stroke="#2563eb" stroke-width="1.5" fill="none" class="node-ring ring-3" opacity="0.75"/>

                <circle cx="22" cy="60" r="6" fill="#2563eb" filter="url(#wfGlow)" class="net-node node-a"/>
                <circle cx="22" cy="60" r="2.5" fill="#FFFFFF"/>
                <circle cx="56" cy="26" r="7" fill="#0284c7" filter="url(#wfGlow)" class="net-node node-b"/>
                <circle cx="56" cy="26" r="2.5" fill="#FFFFFF"/>
                <circle cx="56" cy="94" r="6" fill="#2563eb" filter="url(#wfGlow)" class="net-node node-c"/>
                <circle cx="56" cy="94" r="2.5" fill="#FFFFFF"/>
                <circle cx="98" cy="60" r="8" fill="#2563eb" filter="url(#wfGlow)" class="net-node node-d"/>
                <circle cx="98" cy="60" r="3" fill="#FFFFFF"/>
              </svg>
            </div>
            <div class="dashboard-hero-copy">
              <span class="eyebrow" style="color:var(--brand-forest); display:inline-flex; align-items:center; gap:0.4rem;">
                <span class="status-dot online" style="width:6px; height:6px;" aria-hidden="true"></span>
                Workflow Capture &middot; Automation Control Center
              </span>
              <h1 id="heroTitle" style="color:var(--text-main); font-weight:800; letter-spacing:-0.03em;">Record and automate your browser workflows</h1>
              <p>Capture your repeated web actions once, then replay them reliably on demand with deterministic automation and zero code.</p>
            </div>
          </div>

          <!-- Hero Action Strip -->
          <div class="dashboard-hero-actions" style="position:relative; z-index:2;" role="region" aria-label="Workflow Recording Controls">

            <!-- Idle Controls: Workflow name input, Start Recording, Open Browser -->
            <div id="overviewIdleControls" style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
              <input type="text" id="overviewRecName" class="form-control hero-rec-input-standalone" placeholder="Workflow name (e.g. process-invoices)" spellcheck="false" title="Workflow Name" aria-label="Workflow Name">
              <button class="btn btn-primary dashboard-primary-action" id="btnOverviewStartRec" aria-label="Start Recording Workflow">
                <svg class="record-button-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
                <span id="overviewRecordButtonLabel">Start Recording</span>
                <span class="record-button-meta hidden" id="overviewRecordButtonMeta">00:00 · 0 actions</span>
              </button>
              <button class="btn btn-secondary" id="btnOverviewLaunchChrome" title="Open Google Chrome for automation" aria-label="Open Browser">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="4"></circle>
                  <line x1="21.17" y1="8" x2="12" y2="8"></line>
                  <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                  <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
                </svg>
                <span id="overviewLaunchChromeLabel">Open Browser</span>
              </button>
            </div>

            <!-- Active Recording Controls (Shown only while actively recording) -->
            <div id="overviewActiveControls" class="hidden" style="display:none; align-items:center; gap:0.75rem; flex-wrap:wrap;" aria-live="assertive" role="status">
              <div class="recording-live-pill" style="display:inline-flex; align-items:center; gap:0.55rem; padding:0.45rem 0.9rem; background:rgba(220, 38, 38, 0.08); border:1px solid rgba(220, 38, 38, 0.3); border-radius:var(--radius-md); color:#dc2626; font-size:0.78rem;">
                <span class="recording-pulse-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#dc2626;" aria-hidden="true"></span>
                <span style="font-weight:700;">Recording Active</span>
                <span style="opacity:0.4;">|</span>
                <span id="overviewActiveWorkflowName" style="font-weight:600; color:var(--text-main); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">workflow</span>
                <span class="badge-tag danger" id="overviewActiveMeta" style="font-family:var(--font-mono); font-size:0.7rem; padding:0.15rem 0.45rem; font-weight:700;">00:00 · 0 actions</span>
              </div>
              <button class="btn btn-danger dashboard-hero-stop" id="btnOverviewStopRec" title="Stop recording and save workflow" aria-label="Stop recording and save workflow">
                <span aria-hidden="true" style="font-size:0.9rem;">■</span>
                <span id="overviewStopButtonLabel">Stop &amp; Save</span>
              </button>
            </div>

            <!-- Hidden counter element for SSE action_captured updates -->
            <span id="overviewRecActionCount" class="hidden" aria-hidden="true">0</span>
          </div>
        </section>

        <!-- Stat Cards Grid: Real Metrics Only -->
        <section class="dashboard-stats" aria-label="Overview Metrics">
          <!-- Card 1: Browser Connection State -->
          <article class="stat-card" id="cardBrowserStatus">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Browser Connection">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>
              </span>
              <span class="stat-label">Browser Connection</span>
            </div>
            <strong id="overviewBrowserStatusCard" style="font-size:1.15rem;">Checking…</strong>
            <span class="stat-meta" id="overviewBrowserMeta">Connecting to browser…</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 24 Q 25 32, 50 14 T 100 8" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 24 Q 25 32, 50 14 T 100 8 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>

          <!-- Card 2: Saved Workflows -->
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Workflows">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
              </span>
              <span class="stat-label">Saved Workflows</span>
            </div>
            <strong id="overviewWorkflowCount">0</strong>
            <span class="stat-meta">Ready to automate</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 26 Q 20 30, 35 16 T 70 18 T 100 6" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 26 Q 20 30, 35 16 T 70 18 T 100 6 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>

          <!-- Card 3: Recorded Steps -->
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Recorded Steps">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              </span>
              <span class="stat-label">Recorded Steps</span>
            </div>
            <strong id="overviewTotalSteps">0</strong>
            <span class="stat-meta">Across all workflows</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 30 L 25 22 L 45 28 L 70 12 L 100 4" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 30 L 25 22 L 45 28 L 70 12 L 100 4 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>

          <!-- Card 4: Total Executions / Runs -->
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Automation Runs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </span>
              <span class="stat-label">Total Executions</span>
            </div>
            <strong id="overviewRunsCount">0 Runs</strong>
            <span class="stat-meta" id="overviewRunsMeta">No runs recorded yet</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 28 Q 30 8, 60 22 T 100 4" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 28 Q 30 8, 60 22 T 100 4 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>
        </section>

        <!-- Main Content Area: Workflows (Left) and Recent Activity / System (Right) -->
        <div class="dashboard-main-grid">

          <!-- Left Column: Recent Workflows List with Domain, Steps, Run & Edit CTAs -->
          <section class="card dashboard-workflows-card" aria-labelledby="recentWorkflowsHeading">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3 id="recentWorkflowsHeading">Recent Workflows</h3>
                <p>Saved browser automations ready to execute or edit</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnOverviewViewAllWorkflows" title="View all workflows">View All</button>
            </div>

            <!-- Table Container -->
            <div class="table-responsive" style="margin-top:0.5rem;">
              <table class="data-table quixotic-table" style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="text-align:left; font-size:0.7rem; color:var(--text-sub); text-transform:uppercase; padding:0.6rem 0.85rem;">Workflow</th>
                    <th style="text-align:left; font-size:0.7rem; color:var(--text-sub); text-transform:uppercase; padding:0.6rem 0.85rem;">Target Website</th>
                    <th style="text-align:left; font-size:0.7rem; color:var(--text-sub); text-transform:uppercase; padding:0.6rem 0.85rem;">Steps</th>
                    <th style="text-align:left; font-size:0.7rem; color:var(--text-sub); text-transform:uppercase; padding:0.6rem 0.85rem;">Recorded</th>
                    <th style="text-align:right; font-size:0.7rem; color:var(--text-sub); text-transform:uppercase; padding:0.6rem 0.85rem;">Actions</th>
                  </tr>
                </thead>
                <tbody id="overviewRecentList">
                  <tr>
                    <td colspan="5" style="text-align:center; padding:2rem 1rem; color:var(--text-sub);">
                      Loading workflows…
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Right Column: Recent Activity & System Status -->
          <div class="dashboard-side-stack">

            <!-- Card 1: Recent Activity (Real Run & Recording Logs) -->
            <section class="card dashboard-activity-card" aria-labelledby="recentActivityHeading">
              <div class="card-header-row">
                <div class="card-title-wrap">
                  <h3 id="recentActivityHeading">Recent Activity</h3>
                  <p>Latest runs, recordings, and files</p>
                </div>
                <button class="btn btn-ghost btn-sm" id="btnOverviewViewActivity" title="Open Activity Console">View All</button>
              </div>
              <div id="overviewRecentActivityList" style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem;" role="feed" aria-label="Activity Feed">
                <div style="text-align:center; padding:1.5rem 1rem; color:var(--text-sub);">Loading activity…</div>
              </div>
            </section>

            <!-- Card 2: System Status & Browser Readiness -->
            <section class="card dashboard-system-card" aria-labelledby="systemStatusHeading">
              <div class="card-header-row">
                <div class="card-title-wrap">
                  <h3 id="systemStatusHeading">System Status</h3>
                  <p>Browser and automation readiness</p>
                </div>
              </div>

              <div class="system-status-row">
                <span>
                  <i class="status-dot offline" id="overviewBrowserDot" aria-hidden="true"></i>
                  <span>Browser connection</span>
                </span>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <strong id="overviewBrowserStatus">Checking…</strong>
                  <button class="btn btn-secondary btn-sm" id="btnOverviewQuickConnect" style="display:none; padding:0.2rem 0.5rem; height:24px; font-size:0.7rem;" title="Open Browser">Connect</button>
                </div>
              </div>

              <div class="system-status-row">
                <span>
                  <i class="status-dot online" id="overviewEngineDot" aria-hidden="true"></i>
                  <span>Automation engine</span>
                </span>
                <strong id="overviewEngineStatus">Ready</strong>
              </div>

              <div class="dashboard-button-row" style="margin-top:0.75rem; display:flex; gap:0.5rem;">
                <button class="btn btn-secondary btn-sm" id="btnOverviewViewArtifacts" style="flex:1;">Open Files</button>
                <button class="btn btn-ghost btn-sm" id="btnOverviewOpenSettings" style="flex:1;">Settings</button>
              </div>
            </section>

          </div>
        </div>

      </div>
    `;

    this.bindEvents(router);
    this.loadData();
  },

  bindEvents(router) {
    // Open Browser Secondary Action
    const btnLaunch = document.getElementById('btnOverviewLaunchChrome');
    const labelLaunch = document.getElementById('overviewLaunchChromeLabel');
    if (btnLaunch) {
      btnLaunch.onclick = async () => {
        if (btnLaunch.disabled) return;
        btnLaunch.disabled = true;
        if (labelLaunch) labelLaunch.textContent = 'Connecting…';
        Toast.info('Opening browser for automation…');
        try {
          const res = await Api.launchBrowser('ecommerce');
          if (res && res.success !== false) {
            Toast.success('Browser connected and ready!');
            await this.loadData();
          }
        } catch (err) {
          Toast.error(err.message || 'Failed to open browser');
        } finally {
          btnLaunch.disabled = false;
          if (labelLaunch) labelLaunch.textContent = 'Open Browser';
        }
      };
    }

    // Quick Connect button in system status card
    const btnQuickConnect = document.getElementById('btnOverviewQuickConnect');
    if (btnQuickConnect && btnLaunch) {
      btnQuickConnect.onclick = () => btnLaunch.click();
    }

    // Start Recording Primary Action
    const btnStart = document.getElementById('btnOverviewStartRec');
    const inputName = document.getElementById('overviewRecName');

    const startRecording = async () => {
      if (this.isStarting || this.isRecording) return;
      this.isStarting = true;

      const name = (inputName && inputName.value.trim()) || `workflow-${Date.now()}`;
      const label = document.getElementById('overviewRecordButtonLabel');

      if (btnStart) {
        btnStart.disabled = true;
        btnStart.classList.add('btn-loading');
      }
      if (label) label.textContent = 'Connecting…';
      Toast.info(`Connecting to browser to record "${name}"…`);

      try {
        await Api.startRecording(name);
        Toast.success(`Recording started for "${name}"`);
        this.setRecordingState(true, { startedAt: new Date(), name });
      } catch (err) {
        Toast.error(err.message || 'Failed to start recording');
        this.setRecordingState(false);
      } finally {
        this.isStarting = false;
        if (btnStart && !this.isRecording) {
          btnStart.disabled = false;
          btnStart.classList.remove('btn-loading');
          if (label) label.textContent = 'Start Recording';
        }
      }
    };

    if (btnStart) {
      btnStart.onclick = startRecording;
    }

    if (inputName) {
      inputName.onkeydown = (e) => {
        if (e.key === 'Enter' && !this.isRecording) {
          startRecording();
        }
      };
    }

    // Stop & Save Recording Action
    const btnStop = document.getElementById('btnOverviewStopRec');
    if (btnStop) {
      btnStop.onclick = async () => {
        if (this.isStopping) return;
        this.isStopping = true;
        btnStop.disabled = true;
        const stopLabel = document.getElementById('overviewStopButtonLabel');
        if (stopLabel) stopLabel.textContent = 'Saving…';
        Toast.info('Stopping and saving workflow…');

        try {
          const res = await Api.stopRecording();
          const actionCount = res.summary?.actionCount || 0;
          Toast.success(`Workflow saved successfully (${actionCount} step${actionCount === 1 ? '' : 's'} captured)`);
          this.setRecordingState(false);
          if (inputName) inputName.value = '';
          await this.loadData();
        } catch (err) {
          Toast.error(err.message || 'Failed to stop recording');
        } finally {
          this.isStopping = false;
          if (btnStop) {
            btnStop.disabled = false;
            if (stopLabel) stopLabel.textContent = 'Stop & Save';
          }
        }
      };
    }

    // Navigation buttons
    const btnViewAll = document.getElementById('btnOverviewViewAllWorkflows');
    if (btnViewAll) {
      btnViewAll.onclick = () => router.navigate('workflows');
    }

    const btnViewActivity = document.getElementById('btnOverviewViewActivity');
    if (btnViewActivity) {
      btnViewActivity.onclick = () => router.navigate('console');
    }

    const btnViewArtifacts = document.getElementById('btnOverviewViewArtifacts');
    if (btnViewArtifacts) {
      btnViewArtifacts.onclick = () => router.navigate('artifacts');
    }

    const btnOpenSettings = document.getElementById('btnOverviewOpenSettings');
    if (btnOpenSettings) {
      btnOpenSettings.onclick = () => router.navigate('bot-config');
    }
  },

  animateCountUp(element, endVal, suffix = '', duration = 700) {
    if (!element) return;
    const startVal = 0;
    const startTime = performance.now();
    const update = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.round(startVal + (endVal - startVal) * easeOut);
      element.textContent = `${currentVal.toLocaleString()}${suffix}`;
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = `${endVal.toLocaleString()}${suffix}`;
      }
    };
    requestAnimationFrame(update);
  },

  escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  },

  async loadData() {
    try {
      // 1. Fetch System Status
      const status = await Api.getStatus().catch(() => null);

      if (status) {
        // Sync active recorder state
        if (status.recorder && status.recorder.isRecording && !this.isRecording) {
          this.setRecordingState(true, {
            name: status.recorder.name,
            startedAt: status.recorder.startedAt,
            actionCount: status.recorder.actionCount
          });
        }

        // Update Browser Connection Status
        this.updateBrowserStatus(status);
      }

      // 2. Fetch Recordings
      const recRes = await Api.getRecordings().catch(() => ({ recordings: [] }));
      this.recordings = recRes.recordings || [];

      // 3. Fetch Runs for Activity & Counts
      const runsRes = await Api.getRuns().catch(() => ({ runs: [] }));
      this.recentRuns = runsRes.runs || [];

      // 4. Fetch Downloads
      const dlRes = await Api.getDownloads().catch(() => ({ downloads: [] }));
      const downloads = dlRes.downloads || [];

      // 5. Update Metrics Counters
      this.updateMetrics(this.recordings, this.recentRuns);

      // 6. Render Recent Workflows Table
      this.renderWorkflowsTable(this.recordings);

      // 7. Render Recent Activity Feed
      this.renderActivityFeed(this.recordings, this.recentRuns, downloads);

    } catch (err) {
      console.error('Error loading dashboard overview data:', err);
    }
  },

  updateBrowserStatus(status) {
    const elCardStatus = document.getElementById('overviewBrowserStatusCard');
    const elCardMeta = document.getElementById('overviewBrowserMeta');
    const elSystemStatus = document.getElementById('overviewBrowserStatus');
    const elSystemDot = document.getElementById('overviewBrowserDot');
    const elEngineStatus = document.getElementById('overviewEngineStatus');
    const elEngineDot = document.getElementById('overviewEngineDot');
    const btnQuickConnect = document.getElementById('btnOverviewQuickConnect');

    if (!status) {
      if (elCardStatus) elCardStatus.textContent = 'Browser Not Connected';
      if (elCardMeta) elCardMeta.textContent = 'Click Open Browser to connect';
      if (elSystemStatus) elSystemStatus.textContent = 'Browser Not Connected';
      if (elSystemDot) elSystemDot.className = 'status-dot offline';
      if (btnQuickConnect) btnQuickConnect.style.display = 'inline-block';
      return;
    }

    const isRec = Boolean(status.recorder && status.recorder.isRecording);
    const isReplay = Boolean(status.replay && status.replay.isReplaying);
    const isRun = Boolean(status.runs && status.runs.hasActive);
    const isOnline = Boolean(status.cdp && status.cdp.online);

    if (isRec) {
      if (elCardStatus) elCardStatus.textContent = 'Recording Active';
      if (elCardMeta) elCardMeta.textContent = 'Capturing workflow steps';
      if (elSystemStatus) elSystemStatus.textContent = 'Recording Active';
      if (elSystemDot) elSystemDot.className = 'status-dot recording';
      if (elEngineStatus) elEngineStatus.textContent = 'Recording';
      if (elEngineDot) elEngineDot.className = 'status-dot recording';
      if (btnQuickConnect) btnQuickConnect.style.display = 'none';
    } else if (isReplay || isRun) {
      if (elCardStatus) elCardStatus.textContent = 'Running';
      if (elCardMeta) elCardMeta.textContent = 'Automation in progress';
      if (elSystemStatus) elSystemStatus.textContent = 'Running';
      if (elSystemDot) elSystemDot.className = 'status-dot running';
      if (elEngineStatus) elEngineStatus.textContent = 'Executing';
      if (elEngineDot) elEngineDot.className = 'status-dot running';
      if (btnQuickConnect) btnQuickConnect.style.display = 'none';
    } else if (isOnline) {
      const tabCount = status.cdp.tabs ? status.cdp.tabs.length : 0;
      if (elCardStatus) elCardStatus.textContent = 'Browser Ready';
      if (elCardMeta) elCardMeta.textContent = tabCount > 0 ? `${tabCount} tab${tabCount === 1 ? '' : 's'} connected` : 'Ready for automation';
      if (elSystemStatus) elSystemStatus.textContent = 'Browser Ready';
      if (elSystemDot) elSystemDot.className = 'status-dot online';
      if (elEngineStatus) elEngineStatus.textContent = 'Ready';
      if (elEngineDot) elEngineDot.className = 'status-dot online';
      if (btnQuickConnect) btnQuickConnect.style.display = 'none';
    } else {
      if (elCardStatus) elCardStatus.textContent = 'Browser Not Connected';
      if (elCardMeta) elCardMeta.textContent = 'Click Open Browser to connect';
      if (elSystemStatus) elSystemStatus.textContent = 'Browser Not Connected';
      if (elSystemDot) elSystemDot.className = 'status-dot offline';
      if (elEngineStatus) elEngineStatus.textContent = 'Standby';
      if (elEngineDot) elEngineDot.className = 'status-dot offline';
      if (btnQuickConnect) btnQuickConnect.style.display = 'inline-block';
    }
  },

  updateMetrics(recordings, runs) {
    const totalSteps = recordings.reduce((sum, wf) => sum + (wf.actionCount || wf.stepCount || 0), 0);
    const elWorkflowCount = document.getElementById('overviewWorkflowCount');
    const elTotalSteps = document.getElementById('overviewTotalSteps');
    const elRunsCount = document.getElementById('overviewRunsCount');
    const elRunsMeta = document.getElementById('overviewRunsMeta');

    if (!this._hasCountedUp) {
      this._hasCountedUp = true;
      if (elWorkflowCount) this.animateCountUp(elWorkflowCount, recordings.length);
      if (elTotalSteps) this.animateCountUp(elTotalSteps, totalSteps, ' Steps');
      if (elRunsCount) this.animateCountUp(elRunsCount, runs.length, ` Run${runs.length === 1 ? '' : 's'}`);
    } else {
      if (elWorkflowCount) elWorkflowCount.textContent = recordings.length.toLocaleString();
      if (elTotalSteps) elTotalSteps.textContent = `${totalSteps.toLocaleString()} Steps`;
      if (elRunsCount) elRunsCount.textContent = `${runs.length.toLocaleString()} Run${runs.length === 1 ? '' : 's'}`;
    }

    if (elRunsMeta) {
      if (runs.length === 0) {
        elRunsMeta.textContent = 'No runs recorded yet';
      } else {
        const lastRun = runs[runs.length - 1];
        const time = formatRelativeTime(lastRun.completedAt || lastRun.startedAt || lastRun.createdAt);
        elRunsMeta.textContent = `Latest run: ${time}`;
      }
    }
  },

  renderWorkflowsTable(recordings) {
    const list = document.getElementById('overviewRecentList');
    if (!list) return;

    if (recordings.length === 0) {
      list.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding:3rem 1.5rem;">
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.6rem;">
              <div style="width:48px; height:48px; border-radius:50%; background:var(--brand-tint, rgba(37,99,235,0.08)); color:var(--brand-forest, #2563eb); display:flex; align-items:center; justify-content:center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  <line x1="12" y1="11" x2="12" y2="17"></line>
                  <line x1="9" y1="14" x2="15" y2="14"></line>
                </svg>
              </div>
              <strong style="font-size:0.95rem; color:var(--text-main);">No workflows yet</strong>
              <p style="font-size:0.78rem; color:var(--text-sub); max-width:340px; margin:0 0 0.75rem;">Record your first workflow to automate a repeated task.</p>
              <button class="btn btn-primary btn-sm" id="btnEmptyStartRec" style="display:inline-flex; align-items:center; gap:0.4rem;">
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
                <span>Start Recording</span>
              </button>
            </div>
          </td>
        </tr>
      `;

      const btnEmptyStart = document.getElementById('btnEmptyStartRec');
      if (btnEmptyStart) {
        btnEmptyStart.onclick = () => {
          const input = document.getElementById('overviewRecName');
          if (input) {
            input.focus();
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        };
      }
      return;
    }

    list.innerHTML = '';
    recordings.slice(0, 5).forEach(wf => {
      const wfId = wf.id || wf.filename?.replace('.json', '') || 'workflow';
      const wfName = wf.name || wfId;
      const targetUrl = wf.startUrl || wf.targetUrl || '';
      const domain = extractDomain(targetUrl);
      const stepCount = wf.actionCount || wf.stepCount || 0;
      const createdDate = wf.startedAt || wf.createdAt;
      const dateDisplay = formatRelativeTime(createdDate);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:0.75rem 0.85rem;">
          <div style="display:flex; flex-direction:column; gap:0.15rem;">
            <strong style="color:var(--text-main); font-size:0.82rem; letter-spacing:-0.01em;">${this.escapeHtml(wfName)}</strong>
            <span style="font-size:0.68rem; color:var(--text-sub); font-family:var(--font-mono);">${this.escapeHtml(wfId)}</span>
          </div>
        </td>
        <td style="padding:0.75rem 0.85rem;">
          <div style="display:flex; align-items:center; gap:0.35rem; font-size:0.75rem; color:var(--text-body); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(targetUrl || 'Web Application')}">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--brand-forest); flex-shrink:0;" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span>${this.escapeHtml(domain)}</span>
          </div>
        </td>
        <td style="padding:0.75rem 0.85rem;">
          <span class="badge-tag success" style="display:inline-flex; align-items:center; gap:0.25rem;">
            <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            <span>${stepCount} step${stepCount === 1 ? '' : 's'}</span>
          </span>
        </td>
        <td style="padding:0.75rem 0.85rem;">
          <span style="font-size:0.75rem; color:var(--text-sub);">${dateDisplay}</span>
        </td>
        <td style="padding:0.75rem 0.85rem; text-align:right;">
          <div style="display:inline-flex; align-items:center; justify-content:flex-end; gap:0.4rem;">
            <button class="btn btn-sm btn-primary btn-run-workflow" data-id="${this.escapeHtml(wfId)}" title="Execute this workflow" aria-label="Run ${this.escapeHtml(wfName)}">
              <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
              <span>Run</span>
            </button>
            <button class="btn btn-sm btn-secondary btn-edit-workflow" data-id="${this.escapeHtml(wfId)}" title="Edit in visual workflow editor" aria-label="Edit ${this.escapeHtml(wfName)}">
              <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              <span>Edit</span>
            </button>
          </div>
        </td>
      `;
      list.appendChild(tr);
    });

    // Bind Run buttons
    list.querySelectorAll('.btn-run-workflow').forEach(btn => {
      btn.onclick = () => {
        const wfId = btn.dataset.id;
        const wf = this.recordings.find(w => (w.id === wfId) || (w.filename === `${wfId}.json`) || (w.name === wfId)) || {};
        ExecutionModal.open({
          workflowId: wfId,
          workflowName: wf.name || wfId,
          stepCount: wf.actionCount || wf.stepCount || 0,
          loopStepIndex: wf.loopStepIndex,
          isLoop: Boolean(wf.isLoop || wf.mode === 'LOOP')
        });
      };
    });

    // Bind Edit buttons
    list.querySelectorAll('.btn-edit-workflow').forEach(btn => {
      btn.onclick = () => {
        const wfId = btn.dataset.id;
        this.router.navigate(`workflow-editor/${encodeURIComponent(wfId)}`);
      };
    });
  },

  renderActivityFeed(recordings, runs, downloads) {
    const feed = document.getElementById('overviewRecentActivityList');
    if (!feed) return;

    // Gather real activities
    const events = [];

    // 1. Completed & Failed Runs
    runs.forEach(r => {
      const time = r.completedAt || r.startedAt || r.createdAt;
      if (!time) return;
      let label = 'Run completed';
      let badgeType = 'success';
      if (r.status === 'FAILED') {
        label = 'Run failed';
        badgeType = 'danger';
      } else if (r.status === 'RUNNING') {
        label = 'Run started';
        badgeType = 'info';
      } else if (r.status === 'STOPPED') {
        label = 'Run stopped';
        badgeType = 'amber';
      }
      events.push({
        type: 'RUN',
        label,
        name: r.workflowName || r.workflowId || 'Workflow Run',
        time: new Date(time).getTime(),
        badgeType,
        id: r.id
      });
    });

    // 2. Saved Recordings
    recordings.forEach(w => {
      const time = w.completedAt || w.startedAt || w.createdAt;
      if (!time) return;
      const stepCount = w.actionCount || w.stepCount || 0;
      events.push({
        type: 'RECORDING',
        label: 'Workflow saved',
        name: `${w.name || w.id} (${stepCount} step${stepCount === 1 ? '' : 's'})`,
        time: new Date(time).getTime(),
        badgeType: 'info',
        id: w.id || w.filename
      });
    });

    // 3. Generated Files
    downloads.forEach(d => {
      const time = d.downloadedAt || d.createdAt;
      if (!time) return;
      events.push({
        type: 'FILE',
        label: 'File generated',
        name: d.fileName || d.relativeFilePath || 'Artifact file',
        time: new Date(time).getTime(),
        badgeType: 'success',
        id: d.id
      });
    });

    // Sort by timestamp descending
    events.sort((a, b) => b.time - a.time);

    if (events.length === 0) {
      feed.innerHTML = `
        <div style="text-align:center; padding:1.75rem 1rem; color:var(--text-sub);">
          <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="margin-bottom:0.5rem; opacity:0.5;" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
          <div style="font-size:0.82rem; font-weight:700; color:var(--text-main); margin-bottom:0.25rem;">No recent activity</div>
          <p style="font-size:0.75rem; margin:0;">Runs and recordings will appear here as you automate workflows.</p>
        </div>
      `;
      return;
    }

    feed.innerHTML = '';
    events.slice(0, 5).forEach(ev => {
      const item = document.createElement('div');
      item.className = 'activity-item-row';
      item.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:0.75rem; padding:0.6rem 0.75rem; background:var(--bg-surface-sunken, rgba(0,0,0,0.02)); border-radius:var(--radius-md); font-size:0.75rem; border:1px solid var(--border-light);';

      item.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:0.55rem; min-width:0; flex:1;">
          <span class="badge-tag ${ev.badgeType}" style="flex-shrink:0; font-size:0.65rem; padding:0.12rem 0.45rem;">${ev.label}</span>
          <span style="font-weight:600; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(ev.name)}">
            ${this.escapeHtml(ev.name)}
          </span>
        </div>
        <span style="color:var(--text-sub); font-size:0.7rem; flex-shrink:0;">${formatRelativeTime(ev.time)}</span>
      `;
      feed.appendChild(item);
    });
  },

  setRecordingState(isRecording, meta = {}) {
    const idleControls = document.getElementById('overviewIdleControls');
    const activeControls = document.getElementById('overviewActiveControls');
    const activeName = document.getElementById('overviewActiveWorkflowName');
    const activeMeta = document.getElementById('overviewActiveMeta');
    const btnMeta = document.getElementById('overviewRecordButtonMeta');
    const input = document.getElementById('overviewRecName');

    if (isRecording) {
      this.isRecording = true;
      this.isStarting = false;
      this._statusConfirmedRecording = Boolean(meta.serverConfirmed);

      // Toggle Hero Controls
      if (idleControls) idleControls.style.display = 'none';
      if (activeControls) {
        activeControls.classList.remove('hidden');
        activeControls.style.display = 'inline-flex';
      }

      const wfName = meta.name || (input && input.value.trim()) || 'Workflow Recording';
      if (activeName) activeName.textContent = wfName;
      if (input) input.disabled = true;

      Header.setEngineState('RECORDING');
      this.recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : (this.recordStartTime || Date.now());

      const updateRecordingUi = async () => {
        const sec = Math.max(0, Math.floor((Date.now() - this.recordStartTime) / 1000));
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');
        const elapsed = `${mins}:${secs}`;

        let actionCount = meta.actionCount !== undefined ? Number(meta.actionCount) : 0;
        try {
          const status = await Api.getStatus();
          const recorder = status.recorder || {};
          if (recorder.isRecording) {
            this._statusConfirmedRecording = true;
          }
          if (recorder.actionCount !== undefined) {
            actionCount = Number(recorder.actionCount);
          }
          if (recorder.startedAt) {
            this.recordStartTime = new Date(recorder.startedAt).getTime();
          }
          if (this._statusConfirmedRecording && !recorder.isRecording && this.isRecording) {
            this.setRecordingState(false);
            return;
          }
        } catch {
          // Keep local counter running if status endpoint is temporarily busy
        }

        const countText = `${actionCount} action${actionCount === 1 ? '' : 's'}`;
        if (activeMeta) activeMeta.textContent = `${elapsed} · ${countText}`;
        if (btnMeta) btnMeta.textContent = `${elapsed} · ${countText}`;
      };

      updateRecordingUi();
      if (!this.recordTimer) this.recordTimer = setInterval(updateRecordingUi, 1000);

      // Update System Status card to Recording Active
      const elSystemStatus = document.getElementById('overviewBrowserStatus');
      const elSystemDot = document.getElementById('overviewBrowserDot');
      const elCardStatus = document.getElementById('overviewBrowserStatusCard');
      const elCardMeta = document.getElementById('overviewBrowserMeta');
      if (elSystemStatus) elSystemStatus.textContent = 'Recording Active';
      if (elSystemDot) elSystemDot.className = 'status-dot recording';
      if (elCardStatus) elCardStatus.textContent = 'Recording Active';
      if (elCardMeta) elCardMeta.textContent = 'Capturing workflow steps';

    } else {
      this.isRecording = false;
      this.isStarting = false;
      this.isStopping = false;

      // Toggle Hero Controls back
      if (activeControls) {
        activeControls.classList.add('hidden');
        activeControls.style.display = 'none';
      }
      if (idleControls) idleControls.style.display = 'flex';

      const btnStart = document.getElementById('btnOverviewStartRec');
      const btnLabel = document.getElementById('overviewRecordButtonLabel');
      if (btnStart) {
        btnStart.disabled = false;
        btnStart.classList.remove('btn-loading');
      }
      if (btnLabel) btnLabel.textContent = 'Start Recording';
      if (btnMeta) btnMeta.classList.add('hidden');
      if (input) input.disabled = false;

      Header.setEngineState('IDLE');
      if (this.recordTimer) {
        clearInterval(this.recordTimer);
        this.recordTimer = null;
      }
      if (this.recordStatusTimer) {
        clearInterval(this.recordStatusTimer);
        this.recordStatusTimer = null;
      }

      // Re-evaluate real browser status
      Api.getStatus().then(status => this.updateBrowserStatus(status)).catch(() => {});
    }
  },

  async openDiscovery(workflowId) {
    const filename = `${workflowId}.json`;
    const wf = this.recordings.find(w => w.id === workflowId || w.filename === filename || w.name === workflowId) || {};
    ExecutionModal.open({
      workflowId,
      workflowName: wf.name || workflowId,
      stepCount: wf.actionCount || wf.stepCount || 0,
      loopStepIndex: wf.loopStepIndex,
      isLoop: true
    });
  },

  destroy() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    if (this.recordStatusTimer) {
      clearInterval(this.recordStatusTimer);
      this.recordStatusTimer = null;
    }
  },

  updateReplayProgress(index, total, action) {
    const box = document.getElementById('overviewReplayProgress');
    const elStep = document.getElementById('overviewReplayStep');
    const elPct = document.getElementById('overviewReplayPercent');
    const elBar = document.getElementById('overviewReplayBar');

    if (box) box.classList.remove('hidden');
    const pct = Math.round((index / total) * 100);
    if (elStep) elStep.textContent = `Action #${index}/${total} [${action ? action.type : 'STEP'}]`;
    if (elPct) elPct.textContent = `${pct}%`;
    if (elBar) elBar.style.width = `${pct}%`;
  }
};
