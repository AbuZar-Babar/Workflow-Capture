/**
 * Workflow Capture — Overview View (Executive Control Room)
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Header } from '../components/header.js';
import { ExecutionModal } from '../components/executionModal.js';

export const OverviewView = {
  recordTimer: null,
  recordStatusTimer: null,
  recordStartTime: 0,
  recordings: [],
  isRecording: false,
  _hasCountedUp: false,

  async render(container, router) {
    container.innerHTML = `
      <div class="dashboard-shell">
        <section class="dashboard-hero" style="position:relative; overflow:hidden;">
          <div style="display:flex; align-items:center; gap:1.25rem; position:relative; z-index:2;">
            <div class="overview-mascot-avatar ai-node-network" style="width:84px; height:84px; flex-shrink:0;">
              <svg viewBox="0 0 120 120" width="100%" height="100%" fill="none" class="ai-workflow-net-svg">
                <defs>
                  <linearGradient id="netGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#4F6EF7"/>
                    <stop offset="100%" stop-color="#6EE7F5"/>
                  </linearGradient>
                  <linearGradient id="netGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#6EE7F5"/>
                    <stop offset="100%" stop-color="#4F6EF7"/>
                  </linearGradient>
                  <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feMerge>
                      <feMergeNode in="blur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>
                <!-- Background connection lines -->
                <line x1="22" y1="60" x2="56" y2="26" stroke="url(#netGrad1)" stroke-width="1.8" stroke-dasharray="4 3" opacity="0.6"/>
                <line x1="22" y1="60" x2="56" y2="94" stroke="url(#netGrad1)" stroke-width="1.8" stroke-dasharray="4 3" opacity="0.6"/>
                <line x1="56" y1="26" x2="98" y2="60" stroke="url(#netGrad2)" stroke-width="1.8" stroke-dasharray="4 3" opacity="0.6"/>
                <line x1="56" y1="94" x2="98" y2="60" stroke="url(#netGrad2)" stroke-width="1.8" stroke-dasharray="4 3" opacity="0.6"/>
                <line x1="56" y1="26" x2="56" y2="94" stroke="#6EE7F5" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.45"/>
                <line x1="22" y1="60" x2="98" y2="60" stroke="#4F6EF7" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.35"/>

                <!-- Dynamic Flow Pulse Beams -->
                <path d="M22,60 L56,26 L98,60" fill="none" stroke="#6EE7F5" stroke-width="2" class="flow-pulse-path flow-1"/>
                <path d="M22,60 L56,94 L98,60" fill="none" stroke="#4F6EF7" stroke-width="2" class="flow-pulse-path flow-2"/>

                <!-- Expanding Pulse rings on key nodes -->
                <circle cx="22" cy="60" r="12" stroke="#4F6EF7" stroke-width="1.5" fill="none" class="node-ring ring-1" opacity="0.75"/>
                <circle cx="56" cy="26" r="14" stroke="#6EE7F5" stroke-width="1.5" fill="none" class="node-ring ring-2" opacity="0.75"/>
                <circle cx="98" cy="60" r="15" stroke="#4F6EF7" stroke-width="1.5" fill="none" class="node-ring ring-3" opacity="0.75"/>

                <!-- Nodes with glow -->
                <circle cx="22" cy="60" r="6.5" fill="#4F6EF7" filter="url(#nodeGlow)" class="net-node node-a"/>
                <circle cx="22" cy="60" r="2.5" fill="#FFFFFF"/>

                <circle cx="56" cy="26" r="7.5" fill="#6EE7F5" filter="url(#nodeGlow)" class="net-node node-b"/>
                <circle cx="56" cy="26" r="3" fill="#FFFFFF"/>

                <circle cx="56" cy="94" r="6.5" fill="#4F6EF7" filter="url(#nodeGlow)" class="net-node node-c"/>
                <circle cx="56" cy="94" r="2.5" fill="#FFFFFF"/>

                <circle cx="56" cy="60" r="5" fill="#6EE7F5" filter="url(#nodeGlow)" class="net-node node-center"/>
                <circle cx="56" cy="60" r="2" fill="#FFFFFF"/>

                <circle cx="98" cy="60" r="8.5" fill="#4F6EF7" filter="url(#nodeGlow)" class="net-node node-d"/>
                <circle cx="98" cy="60" r="3.5" fill="#FFFFFF"/>
              </svg>
            </div>
            <div class="dashboard-hero-copy">
              <span class="eyebrow" style="color:var(--brand-forest); display:inline-flex; align-items:center; gap:0.4rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981;"></span>
                FlowMind AI &middot; Autonomous Workflow Center
              </span>
              <h1 style="color:var(--text-main); font-weight:800; letter-spacing:-0.03em;">Show it once. It knows next time.</h1>
              <p>Teach your AI how you work. FlowMind observes your clicks, learns your workflows, and repeats them automatically with zero code.</p>
            </div>
          </div>
          <div class="dashboard-hero-actions" style="position:relative; z-index:2;">
            <input type="text" id="overviewRecName" class="form-control hero-rec-input-standalone" placeholder="Workflow name (e.g. process-invoices)" spellcheck="false" title="Workflow Name">
            <button class="btn btn-primary dashboard-primary-action" id="btnOverviewStartRec" aria-live="polite">
              <svg class="record-button-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
              <span id="overviewRecordButtonLabel">Start Recording</span>
              <span class="record-button-meta hidden" id="overviewRecordButtonMeta">00:00 · 0 actions</span>
            </button>
            <button class="btn btn-secondary" id="btnOverviewLaunchChrome" title="Launch Google Chrome with CDP Remote Debugging enabled">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.5 14.5a6 6 0 1 1-5.8-7.4h1.8a4 4 0 0 0-3.6 2.5m1.3-3.1 4.2-4.2a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4l-4.2 4.2"/></svg>
              <span>Launch Chrome</span>
            </button>
          </div>
        </section>

        <section class="dashboard-stats">
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Workflows">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
              </span>
              <span class="stat-label">Workflows</span>
            </div>
            <strong id="overviewWorkflowCount">0</strong>
            <span class="stat-meta">Saved recordings</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none">
              <path d="M0 26 Q 20 30, 35 16 T 70 18 T 100 6" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 26 Q 20 30, 35 16 T 70 18 T 100 6 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Recorded Steps">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              </span>
              <span class="stat-label">Recorded steps</span>
            </div>
            <strong id="overviewTotalSteps">0</strong>
            <span class="stat-meta">Across all workflows</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none">
              <path d="M0 30 L 25 22 L 45 28 L 70 12 L 100 4" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 30 L 25 22 L 45 28 L 70 12 L 100 4 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Browser Engine">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>
              </span>
              <span class="stat-label">Browser</span>
            </div>
            <strong id="overviewCdpMetric">CDP Standby</strong>
            <span class="stat-meta" id="overviewTabsCount">Tabs: 0 Connected</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none">
              <path d="M0 24 Q 25 32, 50 14 T 100 8" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 24 Q 25 32, 50 14 T 100 8 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>
          <article class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-icon" title="Automation Engine">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
              </span>
              <span class="stat-label">Engine</span>
            </div>
            <strong>Ready</strong>
            <span class="stat-meta">Deterministic replay</span>
            <svg class="stat-card-sparkline" viewBox="0 0 100 36" fill="none" preserveAspectRatio="none">
              <path d="M0 28 Q 30 8, 60 22 T 100 4" stroke="currentColor" stroke-width="3" fill="none"/>
              <path d="M0 28 Q 30 8, 60 22 T 100 4 L 100 36 L 0 36 Z" fill="currentColor" opacity="0.25"/>
            </svg>
          </article>
        </section>

        <section class="card dashboard-system-card" style="margin-top:0.75rem;">
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
      </div>

      <div class="discovery-overlay hidden" id="workflowDiscoveryOverlay" role="dialog" aria-modal="true" aria-labelledby="discoveryTitle">
        <div class="discovery-modal">
          <div class="discovery-modal-header">
            <div><span class="eyebrow">Preflight check</span><h2 id="discoveryTitle">Workflow Ready</h2><p id="discoverySubtitle">We are checking the page for repeated items before execution.</p></div>
            <button class="btn btn-secondary btn-sm" id="btnDiscoveryClose">Close</button>
          </div>
          <div id="discoveryLoading" class="discovery-loading"><div class="discovery-spinner"></div><div><strong>Discovering repeated items…</strong><span>Inspecting the current page and validating the recorded target.</span></div></div>
          <div id="discoveryResult" class="hidden">
            <div class="discovery-summary-grid">
              <div class="discovery-metric"><span>Items found</span><strong id="discoveryItemCount">0</strong></div>
              <div class="discovery-metric"><span>Confidence</span><strong id="discoveryConfidence">0%</strong></div>
              <div class="discovery-metric"><span>Actions / item</span><strong id="discoveryActions">0</strong></div>
              <div class="discovery-metric"><span>Collection</span><strong id="discoveryCollection">—</strong></div>
            </div>
            <div class="discovery-preview">
              <div class="card-header-row"><div class="card-title-wrap"><h3>Preview items</h3><p>These are the records the automation will process.</p></div></div>
              <div id="discoveryItemsList" class="discovery-items-list"></div>
            </div>
            <div class="discovery-options" style="margin-top:0.75rem; padding:0.6rem 0.8rem; background:var(--input-bg); border-radius:6px; border:1px solid var(--border-light); display:flex; align-items:center; justify-content:space-between;">
              <div>
                <strong style="display:block; font-size:0.75rem; color:var(--text-main);">Smart Deduplication</strong>
                <span style="font-size:0.68rem; color:var(--text-sub);">Skips items already downloaded in previous runs</span>
              </div>
              <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.72rem; color:var(--text-body); cursor:pointer; font-weight:600;">
                <input type="checkbox" id="chkDiscoveryForceRedownload"> Force Re-download
              </label>
            </div>
            <div class="discovery-confirm-note" style="margin-top:0.65rem;">
              <span class="status-dot online"></span>
              <span>The workflow will run once per discovered item. Previously downloaded files are safely preserved.</span>
            </div>
          </div>
          <div id="discoveryError" class="hidden discovery-error"></div>
          <div class="discovery-modal-actions"><button class="btn btn-secondary" id="btnDiscoveryCancel">Cancel</button><button class="btn btn-primary" id="btnDiscoveryContinue" disabled>Continue &amp; Run</button></div>
        </div>
      </div>
    `;



    this.router = router;
    this._hasCountedUp = false;
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

    // Unified Hero Recorder bindings
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
      Toast.info(`Connecting to Chrome to record "${name}"…`);

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
      loading.classList.add('hidden');
      result.classList.remove('hidden');
      continueBtn.disabled = !discovery.success || !discovery.itemCount;
      continueBtn.onclick = async () => {
        continueBtn.disabled = true;
        continueBtn.textContent = 'Starting…';
        const forceRedownload = !!document.getElementById('chkDiscoveryForceRedownload')?.checked;
        try {
          const run = await Api.executeWorkflow(workflowId, {
            loopStepIndex: data.loopStepIndex ?? 0,
            forceRedownload
          });
          close();
          if (run.runId) {
            sessionStorage.setItem('workflowCaptureActiveRunId', run.runId);
            this.router.navigate('execution/' + encodeURIComponent(run.runId));
          } else {
            Toast.success('Automation queued');
          }
        } catch (err) {
          Toast.error(err.message);
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continue & Run';
        }
      };
    } catch (err) { loading.classList.add('hidden'); errorBox.textContent = err.message || 'Discovery failed. Make sure Chrome is connected and the target page is open.'; errorBox.classList.remove('hidden'); }
  },

  animateCountUp(element, endVal, suffix = '', duration = 800) {
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

  escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); },
  async loadData() {
    try {
      const status = await Api.getStatus();
      const elMetric = document.getElementById('overviewCdpMetric');
      const elTabs = document.getElementById('overviewTabsCount');

      if (status.recorder && status.recorder.isRecording && !this.isRecording) {
        this.setRecordingState(true, { startedAt: status.recorder.startedAt });
      }

      if (status.cdp && status.cdp.online) {
        if (elMetric) elMetric.textContent = 'Chrome Active';
        const count = status.cdp.tabs ? status.cdp.tabs.length : 0;
        if (elTabs) elTabs.textContent = `Tabs: ${count} Connected`;
        const dot = document.getElementById('overviewBrowserDot');
        const browserStatus = document.getElementById('overviewBrowserStatus');
        if (dot) dot.classList.add('online');
        if (browserStatus) browserStatus.textContent = 'Connected';
      } else {
        if (elMetric) elMetric.textContent = 'CDP Standby';
        if (elTabs) elTabs.textContent = 'Tabs: 0 Connected';
        const dot = document.getElementById('overviewBrowserDot');
        const browserStatus = document.getElementById('overviewBrowserStatus');
        if (dot) dot.classList.remove('online');
        if (browserStatus) browserStatus.textContent = 'Standby';
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
      const elWorkflowCount = document.getElementById('overviewWorkflowCount');
      const elTotalSteps = document.getElementById('overviewTotalSteps');
      if (!this._hasCountedUp) {
        this._hasCountedUp = true;
        if (elWorkflowCount) this.animateCountUp(elWorkflowCount, this.recordings.length);
        if (elTotalSteps) this.animateCountUp(elTotalSteps, totalSteps, ' Steps');
      } else {
        if (elWorkflowCount) elWorkflowCount.textContent = this.recordings.length.toLocaleString();
        if (elTotalSteps) elTotalSteps.textContent = `${totalSteps.toLocaleString()} Steps`;
      }

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
            const filename = btn.dataset.file || '';
            const wfId = filename.replace('.json', '');
            const wf = this.recordings.find(w => w.filename === filename || w.id === wfId) || {};
            ExecutionModal.open({
              workflowId: wfId,
              workflowName: wf.name || wfId,
              stepCount: wf.actionCount || wf.stepCount || 0,
              loopStepIndex: wf.loopStepIndex,
              isLoop: wf.isLoop || wf.mode === 'LOOP'
            });
          };
        });
      }

    } catch (err) {
      console.error('Error loading overview data:', err);
    }
  },

  setRecordingState(isRecording, meta = {}) {
    const btnStart = document.getElementById('btnOverviewStartRec');
    const input = document.getElementById('overviewRecName');
    const btnLabel = document.getElementById('overviewRecordButtonLabel');
    const btnMeta = document.getElementById('overviewRecordButtonMeta');

    if (isRecording) {
      this.isRecording = true;
      this.isStarting = false;
      if (btnStart) {
        btnStart.classList.remove('hidden');
        btnStart.classList.remove('btn-loading');
        btnStart.classList.add('recording-active');
        btnStart.classList.add('is-recording');
        btnStart.setAttribute('aria-label', 'Recording in progress. Stop and save from the recording banner.');
        btnStart.disabled = true;
      }
      if (btnLabel) btnLabel.textContent = 'Recording in Progress';
      if (btnMeta) btnMeta.classList.remove('hidden');
      if (input) input.disabled = true;

      Header.setEngineState('RECORDING');
      this.recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : (this.recordStartTime || Date.now());
      const updateRecordingUi = async () => {
        const sec = Math.max(0, Math.floor((Date.now() - this.recordStartTime) / 1000));
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');
        const elapsed = mins + ':' + secs;
        if (btnMeta) btnMeta.textContent = elapsed + ' · 0 actions';
        try {
          const status = await Api.getStatus();
          const recorder = status.recorder || {};
          const actionCount = Number(recorder.actionCount || 0);
          const startedAt = recorder.startedAt ? new Date(recorder.startedAt).getTime() : this.recordStartTime;
          if (startedAt) this.recordStartTime = startedAt;
          if (btnMeta) btnMeta.textContent = elapsed + ' · ' + actionCount + ' action' + (actionCount === 1 ? '' : 's');
          if (!recorder.isRecording && this.isRecording) this.setRecordingState(false);
        } catch (err) {
          // Keep the local indicator alive if the status endpoint is temporarily unavailable.
        }
      };
      updateRecordingUi();
      if (!this.recordTimer) this.recordTimer = setInterval(updateRecordingUi, 1000);
    } else {
      this.isRecording = false;
      this.isStarting = false;
      this.isStopping = false;
      if (btnStart) {
        btnStart.classList.remove('hidden');
        btnStart.classList.remove('btn-loading');
        btnStart.classList.remove('recording-active');
        btnStart.classList.remove('is-recording');
        btnStart.disabled = false;
        btnStart.setAttribute('aria-label', 'Start recording');
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
    }
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
