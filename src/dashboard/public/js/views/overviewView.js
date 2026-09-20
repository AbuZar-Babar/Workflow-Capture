/**
 * Workflow Capture — Overview View (Executive Control Room)
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Header } from '../components/header.js';

export const OverviewView = {
  recordTimer: null,
  recordStartTime: 0,
  recordings: [],

  async render(container, router) {
    container.innerHTML = `
      <div class="dashboard-shell">
        <section class="dashboard-hero">
          <div class="dashboard-hero-copy">
            <span class="eyebrow">Automation control center</span>
            <h1>Build once. Run repeatedly.</h1>
            <p>Record a browser workflow, discover the items it should process, then execute it with progress and recovery.</p>
          </div>
          <div class="dashboard-hero-actions">
            <button class="btn btn-primary dashboard-primary-action" id="btnOverviewStartRec">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
              <span>Start Recording</span>
            </button>
            <button class="btn btn-secondary" id="btnOverviewLaunchChrome">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.5 14.5a6 6 0 1 1-5.8-7.4h1.8a4 4 0 0 0-3.6 2.5m1.3-3.1 4.2-4.2a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4l-4.2 4.2"/></svg>
              <span>Launch Chrome</span>
            </button>
          </div>
        </section>

        <section class="dashboard-stats">
          <article class="stat-card">
            <span class="stat-label">Workflows</span>
            <strong id="overviewWorkflowCount">0</strong>
            <span class="stat-meta">Saved recordings</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Recorded steps</span>
            <strong id="overviewTotalSteps">0</strong>
            <span class="stat-meta">Across all workflows</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Browser</span>
            <strong id="overviewCdpMetric">CDP Standby</strong>
            <span class="stat-meta" id="overviewTabsCount">Tabs: 0 Connected</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Engine</span>
            <strong>Ready</strong>
            <span class="stat-meta">Deterministic replay</span>
          </article>
        </section>

        <div class="dashboard-main-grid">
          <section class="card dashboard-workflows-card">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Recent Workflows</h3>
                <p>Your latest recorded automation procedures</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnOverviewViewAllWorkflows">View All</button>
            </div>
            <div class="table-responsive">
              <table class="quixotic-table">
                <thead><tr><th>Workflow</th><th>Steps</th><th>Date</th><th style="text-align:right">Action</th></tr></thead>
                <tbody id="overviewRecentList">
                  <tr><td colspan="4" class="dashboard-empty">Loading workflows...</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <aside class="dashboard-side-stack">
            <section class="card dashboard-action-card">
              <div class="card-header-row">
                <div class="card-title-wrap">
                  <h3>Quick Replay</h3>
                  <p>Run a saved workflow</p>
                </div>
              </div>
              <div class="form-group">
                <label for="overviewSelectWorkflow">Workflow</label>
                <select id="overviewSelectWorkflow" class="form-control">
                  <option value="" disabled selected>Loading recordings...</option>
                </select>
              </div>
              <div class="slider-wrap">
                <div class="slider-header"><label>Speed</label><span class="slider-val" id="overviewSpeedVal">1.00x</span></div>
                <input type="range" id="overviewSpeedRange" min="0.5" max="3.0" step="0.25" value="1.0">
              </div>
              <div class="dashboard-button-row">
                <button class="btn btn-dark" id="btnOverviewRunReplay">Run Replay</button>
                <button class="btn btn-danger" id="btnOverviewStopReplay">Stop</button>
              </div>
              <div class="progress-container hidden" id="overviewReplayProgress">
                <div class="dashboard-progress-head"><span id="overviewReplayStep">Action #0/0</span><span id="overviewReplayPercent">0%</span></div>
                <div class="dashboard-progress-track"><div id="overviewReplayBar"></div></div>
              </div>
            </section>

            <section class="card dashboard-system-card">
              <div class="card-header-row">
                <div class="card-title-wrap">
                  <h3>System Status</h3>
                  <p>Browser and automation engine</p>
                </div>
              </div>
              <div class="system-status-row">
                <span><i class="status-dot online"></i> Automation engine</span><strong>Ready</strong>
              </div>
              <div class="system-status-row">
                <span><i class="status-dot" id="overviewBrowserDot"></i> Chrome / CDP</span><strong id="overviewBrowserStatus">Standby</strong>
              </div>
              <button class="btn btn-secondary" id="btnOverviewViewArtifacts">Open Artifacts</button>
            </section>
          </aside>
        </div>

        <section class="card dashboard-recorder-card">
          <div class="dashboard-recorder-main">
            <div>
              <span class="eyebrow">Current recording</span>
              <h3>Capture a workflow</h3>
              <p>Name your procedure, interact with the browser, and save the captured actions for replay.</p>
            </div>
            <div class="dashboard-recorder-controls">
              <input type="text" id="overviewRecName" class="form-control" placeholder="e.g. process-invoices" spellcheck="false">
              <button class="btn btn-danger hidden" id="btnOverviewStopRec">Stop & Save</button>
            </div>
          </div>
          <div class="progress-container hidden" id="overviewRecStats">
            <div class="dashboard-progress-head"><span><strong id="overviewRecActionCount">0</strong> actions captured</span><span id="overviewRecElapsed">00:00</span></div>
          </div>
        </section>
      </div>

      <div class="discovery-overlay hidden" id="workflowDiscoveryOverlay" role="dialog" aria-modal="true" aria-labelledby="discoveryTitle">
        <div class="discovery-modal">
          <div class="discovery-modal-header">
            <div><span class="eyebrow">Preflight check</span><h2 id="discoveryTitle">Workflow Ready</h2><p id="discoverySubtitle">We are checking the page for repeated items before execution.</p></div>
            <button class="btn btn-secondary btn-sm" id="btnDiscoveryClose">Close</button>
          </div>
          <div id="discoveryLoading" class="discovery-loading"><div class="discovery-spinner"></div><div><strong>Discovering repeated items…</strong><span>Inspecting the current page and validating the recorded target.</span></div></div>
          <div id="discoveryResult" class="hidden"><div class="discovery-summary-grid"><div class="discovery-metric"><span>Items found</span><strong id="discoveryItemCount">0</strong></div><div class="discovery-metric"><span>Confidence</span><strong id="discoveryConfidence">0%</strong></div><div class="discovery-metric"><span>Actions / item</span><strong id="discoveryActions">0</strong></div><div class="discovery-metric"><span>Collection</span><strong id="discoveryCollection">—</strong></div></div><div class="discovery-preview"><div class="card-header-row"><div class="card-title-wrap"><h3>Preview items</h3><p>These are the records the automation will process.</p></div></div><div id="discoveryItemsList" class="discovery-items-list"></div></div><div class="discovery-confirm-note"><span class="status-dot online"></span><span>The workflow will run once per discovered item. Failed items remain isolated and can be retried.</span></div></div>
          <div id="discoveryError" class="hidden discovery-error"></div>
          <div class="discovery-modal-actions"><button class="btn btn-secondary" id="btnDiscoveryCancel">Cancel</button><button class="btn btn-primary" id="btnDiscoveryContinue" disabled>Continue &amp; Run</button></div>
        </div>
      </div>
    `;



    this.bindEvents(router);
    this.loadData();
  },

  bindEvents(router) {
    // Launch Chrome & Debug
    const btnLaunch = document.getElementById('btnOverviewLaunchChrome');
    if (btnLaunch) {
      btnLaunch.onclick = async () => {
        Toast.info('Launching Google Chrome with remote debugging on port 9222...');
        try {
          const res = await Api.launchBrowser('ecommerce');
          if (res.success) {
            Toast.success('Chrome is running with CDP remote debugging (port 9222)!');
            this.loadData();
          }
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    // Recorder bindings
    const btnStart = document.getElementById('btnOverviewStartRec');
    const btnStop = document.getElementById('btnOverviewStopRec');
    const inputName = document.getElementById('overviewRecName');

    if (btnStart) {
      btnStart.onclick = async () => {
        const name = (inputName && inputName.value.trim()) || `workflow-${Date.now()}`;
        try {
          await Api.startRecording(name);
          Toast.success(`Recording started for "${name}"`);
          this.setRecordingState(true, { startedAt: new Date() });
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    if (btnStop) {
      btnStop.onclick = async () => {
        try {
          const res = await Api.stopRecording();
          Toast.success(`Recording saved: ${res.summary.actionCount} steps captured`);
          this.setRecordingState(false);
          await this.loadData();
          const filename = (res.summary.filePath || '').split(/[\\\\/]/).pop() || '';
          const workflowId = filename.replace(/\\.json$/i, '');
          if (workflowId) await this.openDiscovery(workflowId);
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    // Replay bindings
    const speedRange = document.getElementById('overviewSpeedRange');
    const speedVal = document.getElementById('overviewSpeedVal');
    const btnReplay = document.getElementById('btnOverviewRunReplay');
    const selectWf = document.getElementById('overviewSelectWorkflow');

    if (speedRange && speedVal) {
      speedRange.oninput = (e) => {
        speedVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
      };
    }

    if (btnReplay) {
      btnReplay.onclick = async () => {
        const filename = selectWf ? selectWf.value : '';
        if (!filename) {
          Toast.error('Please select a workflow to replay');
          return;
        }
        const speed = speedRange ? parseFloat(speedRange.value) : 1.0;
        try {
          await Api.startReplay({ filename, speed });
          Toast.info(`Launched playback for ${filename}`);
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    const btnStopReplay = document.getElementById('btnOverviewStopReplay');
    if (btnStopReplay) {
      btnStopReplay.onclick = async () => {
        btnStopReplay.disabled = true;
        btnStopReplay.style.opacity = '0.7';
        Toast.info('Stopping execution...');
        try {
          const res = await Api.stopExecution();
          Toast.success(res.message || 'Execution stopped successfully');
        } catch (err) {
          Toast.error(err.message || 'Failed to stop execution');
        } finally {
          setTimeout(() => {
            if (btnStopReplay) {
              btnStopReplay.disabled = false;
              btnStopReplay.style.opacity = '1';
            }
          }, 800);
        }
      };
    }

    // View All Workflows button
    const btnViewAll = document.getElementById('btnOverviewViewAllWorkflows');
    if (btnViewAll) {
      btnViewAll.onclick = () => router.navigate('workflows');
    }

    // View All Artifacts Vault button
    const btnViewArtifacts = document.getElementById('btnOverviewViewArtifacts');
    if (btnViewArtifacts) {
      btnViewArtifacts.onclick = () => router.navigate('artifacts');
    }

    // Quick Artifact Rows Click -> Navigate to artifacts vault with toast
    document.querySelectorAll('.artifact-quick-row').forEach(row => {
      row.onclick = () => {
        const file = row.dataset.file;
        Toast.info(`Inspecting artifact ${file} in vault...`);
        router.navigate('artifacts');
      };
    });
  },

  async openDiscovery(workflowId) {
    const overlay = document.getElementById('workflowDiscoveryOverlay');
    const loading = document.getElementById('discoveryLoading');
    const result = document.getElementById('discoveryResult');
    const errorBox = document.getElementById('discoveryError');
    const continueBtn = document.getElementById('btnDiscoveryContinue');
    if (!overlay) return;
    overlay.classList.remove('hidden'); loading.classList.remove('hidden'); result.classList.add('hidden'); errorBox.classList.add('hidden'); continueBtn.disabled = true;
    const close = () => overlay.classList.add('hidden');
    document.getElementById('btnDiscoveryClose').onclick = close; document.getElementById('btnDiscoveryCancel').onclick = close;
    try {
      const data = await Api.discoverWorkflow(workflowId); const discovery = data.discovery || {};
      document.getElementById('discoveryItemCount').textContent = discovery.itemCount ?? 0;
      document.getElementById('discoveryConfidence').textContent = Math.round((discovery.confidence || 0) * 100) + '%';
      document.getElementById('discoveryActions').textContent = data.actionsPerItem ?? 0;
      document.getElementById('discoveryCollection').textContent = discovery.collection ? discovery.collection.itemTag + ' items' : '—';
      document.getElementById('discoverySubtitle').textContent = 'Found ' + (discovery.itemCount || 0) + ' repeated items on the target page. Review before execution.';
      const list = document.getElementById('discoveryItemsList');
      list.innerHTML = (discovery.items || []).slice(0, 8).map((item, index) => '<div class="discovery-item-row"><span class="discovery-item-index">' + (index + 1) + '</span><span class="discovery-item-text">' + this.escapeHtml(item.text || item.id || ('Item ' + (index + 1))) + '</span></div>').join('') || '<div class="dashboard-empty">No preview items available.</div>';
      loading.classList.add('hidden'); result.classList.remove('hidden'); continueBtn.disabled = !discovery.success || !discovery.itemCount;
      continueBtn.onclick = async () => { continueBtn.disabled = true; continueBtn.textContent = 'Starting…'; try { const run = await Api.executeWorkflow(workflowId, data.loopStepIndex ?? 0); close(); Toast.success('Automation started — run ' + (run.runId || 'queued')); } catch (err) { Toast.error(err.message); continueBtn.disabled = false; continueBtn.textContent = 'Continue & Run'; } };
    } catch (err) { loading.classList.add('hidden'); errorBox.textContent = err.message || 'Discovery failed. Make sure Chrome is connected and the target page is open.'; errorBox.classList.remove('hidden'); }
  },

  escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); },
  async loadData() {
    try {
      const status = await Api.getStatus();
      const elMetric = document.getElementById('overviewCdpMetric');
      const elTabs = document.getElementById('overviewTabsCount');

      if (status.cdp && status.cdp.online) {
        if (elMetric) elMetric.textContent = 'Chrome Active';
        const count = status.cdp.tabs ? status.cdp.tabs.length : 0;
        if (elTabs) elTabs.textContent = `Tabs: ${count} Connected`;\n        const dot = document.getElementById('overviewBrowserDot');\n        const browserStatus = document.getElementById('overviewBrowserStatus');\n        if (dot) dot.classList.add('online');\n        if (browserStatus) browserStatus.textContent = 'Connected';
      } else {
        if (elMetric) elMetric.textContent = 'CDP Standby';
        if (elTabs) elTabs.textContent = 'Tabs: 0 Connected';\n        const dot = document.getElementById('overviewBrowserDot');\n        const browserStatus = document.getElementById('overviewBrowserStatus');\n        if (dot) dot.classList.remove('online');\n        if (browserStatus) browserStatus.textContent = 'Standby';
      }

      const res = await Api.getRecordings();
      this.recordings = res.recordings || [];

      // Update dropdown
      const selectWf = document.getElementById('overviewSelectWorkflow');
      if (selectWf) {
        selectWf.innerHTML = '';
        if (this.recordings.length === 0) {
          selectWf.innerHTML = '<option value="" disabled selected>No recordings found</option>';
        } else {
          this.recordings.forEach(wf => {
            const opt = document.createElement('option');
            opt.value = wf.filename;
            opt.textContent = `${wf.name} (${wf.actionCount} steps)`;
            selectWf.appendChild(opt);
          });
        }
      }

      // Total steps metric
      const totalSteps = this.recordings.reduce((sum, wf) => sum + (wf.actionCount || 0), 0);\n      const elWorkflowCount = document.getElementById('overviewWorkflowCount');\n      if (elWorkflowCount) elWorkflowCount.textContent = this.recordings.length.toLocaleString();
      const elTotalSteps = document.getElementById('overviewTotalSteps');
      if (elTotalSteps) elTotalSteps.textContent = `${totalSteps.toLocaleString()} Steps`;

      // Render Recent List
      const list = document.getElementById('overviewRecentList');
      if (list) {
        if (this.recordings.length === 0) {
          list.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1.25rem; color:var(--text-sub);">No recordings captured yet.</td></tr>`;
          return;
        }

        list.innerHTML = '';
        this.recordings.slice(0, 4).forEach(wf => {
          const tr = document.createElement('tr');
          const d = wf.startedAt ? new Date(wf.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recent';
          tr.innerHTML = `
            <td><strong>${wf.name}</strong></td>
            <td><span class="badge-tag success" style="display:inline-flex; align-items:center; gap:0.25rem;"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>${wf.actionCount} steps</span></td>
            <td><span style="font-size:0.72rem; color:var(--text-sub);">${d}</span></td>
            <td style="text-align:right;">
              <button class="btn btn-sm btn-primary btn-quick-play" data-file="${wf.filename}" style="display:inline-flex; align-items:center; gap:0.25rem;"><svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</button>
            </td>
          `;
          list.appendChild(tr);
        });

        list.querySelectorAll('.btn-quick-play').forEach(btn => {
          btn.onclick = () => {
            const wfId = (btn.dataset.file || '').replace('.json', '');
            Api.executeWorkflow(wfId)
              .then(() => Toast.info(`Executing workflow: ${wfId}`))
              .catch(e => Toast.error(e.message));
          };
        });
      }

    } catch (err) {
      console.error('Error loading overview data:', err);
    }
  },

  setRecordingState(isRecording, meta = {}) {
    const btnStart = document.getElementById('btnOverviewStartRec');
    const btnStop = document.getElementById('btnOverviewStopRec');
    const badge = document.getElementById('overviewRecBadge');
    const stats = document.getElementById('overviewRecStats');
    const input = document.getElementById('overviewRecName');
    const elElapsed = document.getElementById('overviewRecElapsed');

    if (isRecording) {
      if (btnStart) btnStart.classList.add('hidden');
      if (btnStop) btnStop.classList.remove('hidden');
      if (badge) badge.classList.remove('hidden');
      if (stats) stats.classList.remove('hidden');
      if (input) input.disabled = true;

      Header.setEngineState('RECORDING');
      this.recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : Date.now();
      if (!this.recordTimer) {
        this.recordTimer = setInterval(() => {
          const sec = Math.floor((Date.now() - this.recordStartTime) / 1000);
          const mins = String(Math.floor(sec / 60)).padStart(2, '0');
          const secs = String(sec % 60).padStart(2, '0');
          if (elElapsed) elElapsed.textContent = `${mins}:${secs}`;
        }, 1000);
      }
    } else {
      if (btnStart) btnStart.classList.remove('hidden');
      if (btnStop) btnStop.classList.add('hidden');
      if (badge) badge.classList.add('hidden');
      if (stats) stats.classList.add('hidden');
      if (input) input.disabled = false;

      Header.setEngineState('IDLE');
      if (this.recordTimer) {
        clearInterval(this.recordTimer);
        this.recordTimer = null;
      }
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
