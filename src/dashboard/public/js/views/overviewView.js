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
      <div class="overview-fixed-grid">
        
        <!-- Left Section (Col 1-3): CDP Emerald Card, Quick Recorder, Replay Launcher -->
        <div class="overview-col col-span-3">
          
          <!-- Quixotic Emerald Visa-Style CDP Session Card -->
          <article class="emerald-cdp-card">
            <div class="cdp-card-top">
              <span class="cdp-badge-title">CDP Automation</span>
              <span style="font-size:0.75rem; font-weight:800; background:rgba(255,255,255,0.2); padding:0.15rem 0.5rem; border-radius:999px;">PORT 9222</span>
            </div>
            <div class="cdp-card-body">
              <p class="cdp-label">Engine Protocol</p>
              <p class="cdp-metric" id="overviewCdpMetric">Chrome Active</p>
            </div>
            <div class="cdp-card-footer" style="margin-bottom:0.75rem;">
              <span id="overviewTabsCount">Tabs: 1 Connected</span>
              <span>DEVTOOLS v22</span>
            </div>

            <!-- Launch Chrome & Debug Action -->
            <button class="btn" id="btnOverviewLaunchChrome" style="width:100%; display:flex; align-items:center; justify-content:center; gap:0.5rem; padding:0.6rem 0.85rem; font-weight:800; border-radius:var(--radius-md); background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.25); color:#ffffff; backdrop-filter:blur(4px); transition:all 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.55)'" onmouseout="this.style.background='rgba(0,0,0,0.35)'">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-1.8a4 4 0 002.5-3.66m-7.07-5.05a6 6 0 017.38-5.84h1.8a4 4 0 00-3.66 2.5m1.34-3.14l4.24-4.24a1 1 0 011.42 0l1.41 1.41a1 1 0 010 1.42l-4.24 4.24m-2.83 2.83l-2.12 2.12a1 1 0 01-1.42 0l-1.41-1.41a1 1 0 010-1.42l2.12-2.12"/>
              </svg>
              <span>Launch Chrome & Debug</span>
            </button>
          </article>

          <!-- Quick Recorder Card -->
          <section class="card">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Workflow Recorder</h3>
                <p>Capture real-time user browser interactions</p>
              </div>
              <span class="badge-tag amber hidden" id="overviewRecBadge" style="display:inline-flex; align-items:center; gap:0.35rem;">
                <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>
                <span>REC LIVE</span>
              </span>
            </div>

            <div class="form-group">
              <label for="overviewRecName">Workflow Name</label>
              <input type="text" id="overviewRecName" class="form-control" placeholder="e.g. portal-order-flow" spellcheck="false">
            </div>

            <div style="display:flex; gap:0.5rem;">
              <button class="btn btn-primary" id="btnOverviewStartRec" style="flex:1; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
                <span>Start Record</span>
              </button>
              <button class="btn btn-danger hidden" id="btnOverviewStopRec" style="flex:1; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                <span>Stop & Save</span>
              </button>
            </div>

            <div class="progress-container hidden" id="overviewRecStats" style="margin-top:0.5rem; background:var(--brand-tint); border:1px solid var(--brand-light); border-radius:var(--radius-md); padding:0.5rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.72rem; font-weight:700; color:var(--brand-forest);">
                <span>Captured: <strong id="overviewRecActionCount">0</strong></span>
                <span>Time: <strong id="overviewRecElapsed">00:00</strong></span>
              </div>
            </div>
          </section>

          <!-- Quick Replay Controller Card -->
          <section class="card">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Quick Replay</h3>
                <p>Run workflow automation</p>
              </div>
            </div>

            <div class="form-group">
              <label for="overviewSelectWorkflow">Select Workflow</label>
              <select id="overviewSelectWorkflow" class="form-control">
                <option value="" disabled selected>Loading recordings...</option>
              </select>
            </div>

            <div class="slider-wrap">
              <div class="slider-header">
                <label>Speed Multiplier</label>
                <span class="slider-val" id="overviewSpeedVal">1.00x</span>
              </div>
              <input type="range" id="overviewSpeedRange" min="0.5" max="3.0" step="0.25" value="1.0">
            </div>

            <button class="btn btn-dark" id="btnOverviewRunReplay" style="width:100%; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span>Run Playback</span>
            </button>

            <div class="progress-container hidden" id="overviewReplayProgress" style="margin-top:0.5rem; background:var(--brand-tint); border:1px solid var(--brand-light); border-radius:var(--radius-md); padding:0.5rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.7rem; font-weight:700; color:var(--brand-forest); margin-bottom:0.25rem;">
                <span id="overviewReplayStep">Action #0/0</span>
                <span id="overviewReplayPercent">0%</span>
              </div>
              <div style="width:100%; height:5px; background:rgba(12,92,63,0.15); border-radius:999px; overflow:hidden;">
                <div id="overviewReplayBar" style="height:100%; background:var(--brand-forest); width:0%; transition:width 0.3s;"></div>
              </div>
            </div>
          </section>

        </div>

        <!-- Middle Section (Col 4-8): Activity Striped Chart & Recent Workflows Snippet -->
        <div class="overview-col col-span-5">
          
          <!-- Striped Engagement / Capture Density Chart Card -->
          <article class="card">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Workflow Activity & Execution</h3>
                <p>Weekly automation runs and selector density</p>
              </div>
              <div style="display:flex; gap:0.25rem; background:#f3f4f6; padding:0.2rem; border-radius:999px;">
                <button class="btn btn-sm" style="background:#ffffff; color:#111827; box-shadow:0 1px 3px rgba(0,0,0,0.05); padding:0.15rem 0.55rem;">Weekly</button>
                <button class="btn btn-sm" style="background:transparent; color:#6b7280; padding:0.15rem 0.55rem;">Monthly</button>
              </div>
            </div>

            <div class="chart-bars-wrap">
              <div class="chart-grid-lines">
                <div class="grid-line-row"><span>50</span><div class="line"></div></div>
                <div class="grid-line-row"><span>40</span><div class="line"></div></div>
                <div class="grid-line-row"><span>30</span><div class="line"></div></div>
                <div class="grid-line-row"><span>20</span><div class="line"></div></div>
                <div class="grid-line-row"><span>10</span><div class="line"></div></div>
                <div class="grid-line-row"><span>0</span><div class="line"></div></div>
              </div>

              <div class="bars-container">
                <div class="bar-col">
                  <div class="bar-pill striped-bar-sage" style="height: 45px;"></div>
                  <span class="bar-label">Mon</span>
                </div>
                <div class="bar-col">
                  <div class="bar-pill striped-bar-sage" style="height: 80px;"></div>
                  <span class="bar-label">Tue</span>
                </div>
                <div class="bar-col">
                  <div class="bar-pill striped-bar-sage" style="height: 60px;"></div>
                  <span class="bar-label">Wed</span>
                </div>
                <div class="bar-col">
                  <div class="bar-tooltip-bubble">+99.4% Pass</div>
                  <div class="bar-pill striped-bar-dark" style="height: 105px;"></div>
                  <span class="bar-label" style="color:var(--brand-forest); font-weight:800;">Thu</span>
                </div>
                <div class="bar-col">
                  <div class="bar-pill striped-bar-sage" style="height: 70px;"></div>
                  <span class="bar-label">Fri</span>
                </div>
                <div class="bar-col">
                  <div class="bar-pill striped-bar-sage" style="height: 85px;"></div>
                  <span class="bar-label">Sat</span>
                </div>
              </div>
            </div>
          </article>

          <!-- Recent Workflows Preview -->
          <section class="card" style="flex:1;">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Recent Workflows</h3>
                <p>Quick access to recent captures</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnOverviewViewAllWorkflows" style="display:flex; align-items:center; gap:0.35rem;">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                <span>View All</span>
              </button>
            </div>

            <div class="table-responsive">
              <table class="quixotic-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Steps</th>
                    <th>Date</th>
                    <th style="text-align:right;">Action</th>
                  </tr>
                </thead>
                <tbody id="overviewRecentList">
                  <tr><td colspan="4" style="text-align:center; padding:1.25rem; color:var(--text-sub);">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </section>

        </div>

        <!-- Right Section (Col 9-12): Heuristic Accuracy, Wave Chart & Quick Test Bench -->
        <div class="overview-col col-span-4">
          
          <article class="card">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Heuristic Accuracy</h3>
                <p>Selector multi-candidate confidence</p>
              </div>
              <span class="badge-tag success">99.8% OK</span>
            </div>

            <div style="text-align:center; margin:0.35rem 0;">
              <span style="font-size:0.7rem; color:var(--text-sub); font-weight:600;">Total Selector Matches</span>
              <p style="font-size:1.6rem; font-weight:800; color:var(--text-main); letter-spacing:-0.02em;" id="overviewTotalSteps">0 Steps</p>
            </div>

            <div class="wave-chart-container">
              <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 300 80">
                <defs>
                  <linearGradient id="waveGradient2" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="#7dbfa3" stop-opacity="0.45"></stop>
                    <stop offset="100%" stop-color="#7dbfa3" stop-opacity="0.0"></stop>
                  </linearGradient>
                </defs>
                <path d="M0,45 C40,45 50,20 85,25 C120,30 130,58 170,30 C200,8 215,35 245,45 C270,55 285,30 300,20 L300,80 L0,80 Z" fill="url(#waveGradient2)"></path>
                <path d="M0,45 C40,45 50,20 85,25 C120,30 130,58 170,30 C200,8 215,35 245,45 C270,55 285,30 300,20" fill="none" stroke="#0c5c3f" stroke-linecap="round" stroke-width="2.2"></path>
              </svg>
            </div>
          </article>

          <!-- Extracted Artifacts & Scraped Data Vault Card -->
          <section class="card" style="flex:1;">
            <div class="card-header-row">
              <div class="card-title-wrap">
                <h3>Extracted Artifacts</h3>
                <p>Scraped PDFs, spreadsheets & data</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnOverviewViewArtifacts" title="Open Data Vault" style="display:flex; align-items:center; gap:0.35rem;">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                <span>Vault</span>
              </button>
            </div>

            <div style="display:flex; flex-direction:column; gap:0.45rem;">
              <div class="portal-quick-card artifact-quick-row" data-file="monthly_invoice_sep_2026.pdf" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.65rem; background:#f9fafb; border-radius:var(--radius-md); border:1px solid rgba(0,0,0,0.06); cursor:pointer;">
                <div style="display:flex; align-items:center; gap:0.6rem;">
                  <div style="color:#ef4444; display:flex; align-items:center;">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                  </div>
                  <div>
                    <strong style="font-size:0.75rem; color:var(--text-main); display:block;">monthly_invoice_sep_2026.pdf</strong>
                    <small style="display:block; font-size:0.65rem; color:var(--text-sub);">PDF Document • 342 KB</small>
                  </div>
                </div>
                <span class="badge-tag danger" style="font-size:0.62rem;">PDF</span>
              </div>

              <div class="portal-quick-card artifact-quick-row" data-file="ecommerce_products_catalog.csv" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.65rem; background:#f9fafb; border-radius:var(--radius-md); border:1px solid rgba(0,0,0,0.06); cursor:pointer;">
                <div style="display:flex; align-items:center; gap:0.6rem;">
                  <div style="color:var(--brand-forest); display:flex; align-items:center;">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                  </div>
                  <div>
                    <strong style="font-size:0.75rem; color:var(--text-main); display:block;">products_catalog_export.csv</strong>
                    <small style="display:block; font-size:0.65rem; color:var(--brand-forest); font-weight:700;">CSV Dataset • 450 Records</small>
                  </div>
                </div>
                <span class="badge-tag success" style="font-size:0.62rem;">CSV</span>
              </div>

              <div class="portal-quick-card artifact-quick-row" data-file="b2b_leads_pipeline_manifest.json" style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.65rem; background:#f9fafb; border-radius:var(--radius-md); border:1px solid rgba(0,0,0,0.06); cursor:pointer;">
                <div style="display:flex; align-items:center; gap:0.6rem;">
                  <div style="color:#f59e0b; display:flex; align-items:center;">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                  </div>
                  <div>
                    <strong style="font-size:0.75rem; color:var(--text-main); display:block;">leads_manifest.json</strong>
                    <small style="display:block; font-size:0.65rem; color:var(--text-sub);">JSON Output • 88 KB</small>
                  </div>
                </div>
                <span class="badge-tag amber" style="font-size:0.62rem;">JSON</span>
              </div>
            </div>
          </section>

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
          this.loadData();
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

  async loadData() {
    try {
      const status = await Api.getStatus();
      const elMetric = document.getElementById('overviewCdpMetric');
      const elTabs = document.getElementById('overviewTabsCount');

      if (status.cdp && status.cdp.online) {
        if (elMetric) elMetric.textContent = 'Chrome Active';
        const count = status.cdp.tabs ? status.cdp.tabs.length : 0;
        if (elTabs) elTabs.textContent = `Tabs: ${count} Connected`;
      } else {
        if (elMetric) elMetric.textContent = 'CDP Standby';
        if (elTabs) elTabs.textContent = 'Tabs: 0 Connected';
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
      const totalSteps = this.recordings.reduce((sum, wf) => sum + (wf.actionCount || 0), 0);
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
