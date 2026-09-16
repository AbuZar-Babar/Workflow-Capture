/**
 * Workflow Capture — Dashboard Client Application
 */

(function () {
  'use strict';

  // DOM Elements
  const elCdpDot = document.getElementById('cdpDot');
  const elCdpText = document.getElementById('cdpText');
  const elBtnRefreshStatus = document.getElementById('btnRefreshStatus');
  const elSystemStateText = document.getElementById('systemStateText');

  // Recorder Elements
  const elRecordName = document.getElementById('recordWorkflowName');
  const elBtnStartRecord = document.getElementById('btnStartRecord');
  const elBtnStopRecord = document.getElementById('btnStopRecord');
  const elRecBadge = document.getElementById('recBadge');
  const elRecLiveStats = document.getElementById('recLiveStats');
  const elRecActionCount = document.getElementById('recActionCount');
  const elRecElapsedTime = document.getElementById('recElapsedTime');

  // Replay Elements
  const elSelectWorkflow = document.getElementById('selectReplayWorkflow');
  const elReplaySpeedRange = document.getElementById('replaySpeedRange');
  const elReplaySpeedVal = document.getElementById('replaySpeedVal');
  const elReplayTimeoutInput = document.getElementById('replayTimeoutInput');
  const elBtnStartReplay = document.getElementById('btnStartReplay');
  const elReplayProgressContainer = document.getElementById('replayProgressContainer');
  const elReplayStepText = document.getElementById('replayStepText');
  const elReplayPercentText = document.getElementById('replayPercentText');
  const elReplayProgressBar = document.getElementById('replayProgressBar');

  // Test Runner
  const elBtnRunUnitTests = document.getElementById('btnRunUnitTests');
  const elBtnRunE2ETests = document.getElementById('btnRunE2ETests');

  // Explorer & Console
  const elWorkflowsList = document.getElementById('workflowsList');
  const elWorkflowCountBadge = document.getElementById('workflowCountBadge');
  const elBtnReloadWorkflows = document.getElementById('btnReloadWorkflows');
  const elConsoleTerminal = document.getElementById('consoleTerminal');
  const elChkAutoScroll = document.getElementById('chkAutoScroll');
  const elBtnClearLogs = document.getElementById('btnClearLogs');

  // Modal
  const elModal = document.getElementById('stepInspectorModal');
  const elBtnCloseModal = document.getElementById('btnCloseModal');
  const elModalTitle = document.getElementById('modalWorkflowTitle');
  const elModalMetaGrid = document.getElementById('modalMetaGrid');
  const elModalStepsTimeline = document.getElementById('modalStepsTimeline');
  const elToastContainer = document.getElementById('toastContainer');

  // State
  let recordTimer = null;
  let recordStartTime = 0;
  let cachedWorkflows = [];

  // =========================================================================
  // 1. Toast Notifications
  // =========================================================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elToastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // 2. Server-Sent Events (SSE) Live Stream
  // =========================================================================
  function initSSE() {
    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        appendLogEntry(data);
      } catch {}
    });

    eventSource.addEventListener('action_captured', (e) => {
      try {
        const data = JSON.parse(e.data);
        elRecActionCount.textContent = data.count || 0;
      } catch {}
    });

    eventSource.addEventListener('recording_state', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateRecordingUI(data.isRecording, data);
        loadWorkflows();
      } catch {}
    });

    eventSource.addEventListener('replay_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateReplayProgress(data.index, data.total, data.action);
      } catch {}
    });

    eventSource.addEventListener('replay_state', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateReplayStateUI(data);
      } catch {}
    });

    eventSource.addEventListener('test_state', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isRunning) {
          elBtnRunUnitTests.disabled = true;
          elBtnRunE2ETests.disabled = true;
        } else {
          elBtnRunUnitTests.disabled = false;
          elBtnRunE2ETests.disabled = false;
          if (data.success) {
            showToast(`${data.type.toUpperCase()} Tests Passed!`, 'success');
          } else {
            showToast(`${data.type.toUpperCase()} Tests Failed (Code ${data.exitCode})`, 'error');
          }
        }
      } catch {}
    });
  }

  function appendLogEntry(log) {
    const entry = document.createElement('div');
    const levelClass = (log.level || 'INFO').toLowerCase();
    entry.className = `log-entry log-${levelClass}`;

    entry.innerHTML = `
      <span class="log-time">${log.time || new Date().toLocaleTimeString()}</span>
      <span class="log-badge ${levelClass}">${log.level || 'INFO'}</span>
      <span class="log-message">${escapeHtml(log.text)}</span>
    `;

    elConsoleTerminal.appendChild(entry);

    if (elChkAutoScroll.checked) {
      elConsoleTerminal.scrollTop = elConsoleTerminal.scrollHeight;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // =========================================================================
  // 3. System & CDP Status Check
  // =========================================================================
  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      // CDP Pill
      if (data.cdp && data.cdp.online) {
        elCdpDot.className = 'status-indicator online';
        const tabCount = data.cdp.tabs ? data.cdp.tabs.length : 0;
        elCdpText.textContent = `Online (${tabCount} tab${tabCount === 1 ? '' : 's'})`;
      } else {
        elCdpDot.className = 'status-indicator offline';
        elCdpText.textContent = 'Offline (Port 9222)';
      }

      // Engine State
      if (data.recorder && data.recorder.isRecording) {
        elSystemStateText.textContent = 'RECORDING';
        elSystemStateText.className = 'pill-value state-recording';
        updateRecordingUI(true, data.recorder);
      } else if (data.replay && data.replay.isReplaying) {
        elSystemStateText.textContent = 'REPLAYING';
        elSystemStateText.className = 'pill-value state-replaying';
      } else {
        elSystemStateText.textContent = 'IDLE';
        elSystemStateText.className = 'pill-value state-idle';
      }

    } catch (err) {
      elCdpDot.className = 'status-indicator offline';
      elCdpText.textContent = 'Server Disconnected';
    }
  }

  // =========================================================================
  // 4. Recorder UI Handlers
  // =========================================================================
  function updateRecordingUI(isRecording, meta = {}) {
    if (isRecording) {
      elBtnStartRecord.classList.add('hidden');
      elBtnStopRecord.classList.remove('hidden');
      elRecBadge.classList.remove('hidden');
      elRecLiveStats.classList.remove('hidden');
      elRecordName.disabled = true;

      elSystemStateText.textContent = 'RECORDING';
      elSystemStateText.className = 'pill-value state-recording';

      recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : Date.now();
      if (!recordTimer) {
        recordTimer = setInterval(updateRecordTimer, 1000);
      }
    } else {
      elBtnStartRecord.classList.remove('hidden');
      elBtnStopRecord.classList.add('hidden');
      elRecBadge.classList.add('hidden');
      elRecLiveStats.classList.add('hidden');
      elRecordName.disabled = false;

      elSystemStateText.textContent = 'IDLE';
      elSystemStateText.className = 'pill-value state-idle';

      if (recordTimer) {
        clearInterval(recordTimer);
        recordTimer = null;
      }
      elRecElapsedTime.textContent = '00:00';
    }
  }

  function updateRecordTimer() {
    const elapsedSec = Math.floor((Date.now() - recordStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    elRecElapsedTime.textContent = `${mins}:${secs}`;
  }

  async function startRecording() {
    const name = elRecordName.value.trim() || `workflow-${Date.now()}`;
    try {
      const res = await fetch('/api/record/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start recording');

      showToast(`Recording started for "${name}"`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function stopRecording() {
    try {
      const res = await fetch('/api/record/stop', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to stop recording');

      showToast(`Recording saved: ${data.summary.actionCount} actions captured`, 'success');
      loadWorkflows();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 5. Replay UI Handlers
  // =========================================================================
  function updateReplayProgress(index, total, action) {
    elReplayProgressContainer.classList.remove('hidden');
    const percent = Math.round((index / total) * 100);
    elReplayStepText.textContent = `Action #${index}/${total} [${action ? action.type : 'STEP'}]`;
    elReplayPercentText.textContent = `${percent}%`;
    elReplayProgressBar.style.width = `${percent}%`;
  }

  function updateReplayStateUI(state) {
    if (state.isReplaying) {
      elBtnStartReplay.disabled = true;
      elBtnStartReplay.innerHTML = '<span>⏳ Replaying...</span>';
      elReplayProgressContainer.classList.remove('hidden');
      elSystemStateText.textContent = 'REPLAYING';
      elSystemStateText.className = 'pill-value state-replaying';
    } else {
      elBtnStartReplay.disabled = false;
      elBtnStartReplay.innerHTML = '<span>▶ Run Playback</span>';
      elSystemStateText.textContent = 'IDLE';
      elSystemStateText.className = 'pill-value state-idle';

      if (state.success) {
        showToast(`Workflow Replay Completed Successfully!`, 'success');
      } else if (state.error) {
        showToast(`Replay Halted: ${state.error}`, 'error');
      }
    }
  }

  async function startReplay(workflowFilename) {
    const filename = workflowFilename || elSelectWorkflow.value;
    if (!filename) {
      showToast('Please select a workflow to replay', 'error');
      return;
    }

    const speed = parseFloat(elReplaySpeedRange.value);
    const timeoutMs = parseInt(elReplayTimeoutInput.value, 10);

    try {
      const res = await fetch('/api/replay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, speed, timeoutMs })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start replay');

      showToast(`Playback launched for ${filename}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 6. Workflows Explorer & List
  // =========================================================================
  async function loadWorkflows() {
    try {
      const res = await fetch('/api/recordings');
      const data = await res.json();
      cachedWorkflows = data.recordings || [];

      elWorkflowCountBadge.textContent = cachedWorkflows.length;

      // Update dropdown
      elSelectWorkflow.innerHTML = '';
      if (cachedWorkflows.length === 0) {
        elSelectWorkflow.innerHTML = '<option value="" disabled selected>No recordings found</option>';
        elWorkflowsList.innerHTML = '<div class="empty-state">No recorded workflows found. Use the Recorder on the left to capture your first flow!</div>';
        return;
      }

      cachedWorkflows.forEach(wf => {
        const opt = document.createElement('option');
        opt.value = wf.filename;
        opt.textContent = `${wf.name} (${wf.actionCount} steps)`;
        elSelectWorkflow.appendChild(opt);
      });

      // Render Workflow Cards Grid
      elWorkflowsList.innerHTML = '';
      cachedWorkflows.forEach(wf => {
        const card = document.createElement('div');
        card.className = 'workflow-card';

        const createdStr = wf.startedAt ? new Date(wf.startedAt).toLocaleString() : 'Unknown';

        card.innerHTML = `
          <div class="wf-header">
            <div class="wf-title">${escapeHtml(wf.name)}</div>
          </div>
          <div class="wf-meta">
            <span class="wf-tag">⚡ ${wf.actionCount} actions</span>
            <span class="wf-tag">📅 ${createdStr}</span>
          </div>
          <div class="wf-url" title="${escapeHtml(wf.startUrl)}">🔗 ${escapeHtml(wf.startUrl)}</div>
          <div class="wf-actions">
            <button class="btn btn-sm btn-accent btn-card-replay" data-file="${wf.filename}">▶ Replay</button>
            <button class="btn btn-sm btn-secondary btn-card-inspect" data-file="${wf.filename}">🔍 Inspect</button>
            <button class="btn btn-sm btn-ghost btn-card-delete" data-file="${wf.filename}">🗑</button>
          </div>
        `;
        elWorkflowsList.appendChild(card);
      });

      // Attach Card Actions
      elWorkflowsList.querySelectorAll('.btn-card-replay').forEach(btn => {
        btn.onclick = () => {
          elSelectWorkflow.value = btn.dataset.file;
          startReplay(btn.dataset.file);
        };
      });

      elWorkflowsList.querySelectorAll('.btn-card-inspect').forEach(btn => {
        btn.onclick = () => inspectWorkflow(btn.dataset.file);
      });

      elWorkflowsList.querySelectorAll('.btn-card-delete').forEach(btn => {
        btn.onclick = () => deleteWorkflow(btn.dataset.file);
      });

    } catch (err) {
      elWorkflowsList.innerHTML = `<div class="empty-state">Failed to load recordings: ${err.message}</div>`;
    }
  }

  async function deleteWorkflow(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const res = await fetch(`/api/recordings/${filename}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');

      showToast(`Deleted ${filename}`, 'info');
      loadWorkflows();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 7. Step Inspector Modal
  // =========================================================================
  function inspectWorkflow(filename) {
    const wf = cachedWorkflows.find(w => w.filename === filename);
    if (!wf) return;

    elModalTitle.textContent = `${wf.name} (${wf.filename})`;

    elModalMetaGrid.innerHTML = `
      <div class="stat-item"><span class="stat-label">Total Actions</span><span class="stat-value">${wf.actionCount}</span></div>
      <div class="stat-item"><span class="stat-label">Start URL</span><span class="stat-value" style="font-size:0.8rem">${escapeHtml(wf.startUrl)}</span></div>
      <div class="stat-item"><span class="stat-label">Captured Date</span><span class="stat-value" style="font-size:0.8rem">${new Date(wf.startedAt).toLocaleString()}</span></div>
    `;

    elModalStepsTimeline.innerHTML = '';
    (wf.actions || []).forEach(act => {
      const stepRow = document.createElement('div');
      stepRow.className = 'step-row';

      const topCand = (act.target && act.target.candidates && act.target.candidates[0]) ? act.target.candidates[0].value : 'none';
      const fp = (act.target && act.target.fingerprint) ? act.target.fingerprint : {};

      let candidatesHtml = '';
      if (act.target && act.target.candidates) {
        candidatesHtml = act.target.candidates.map(c => `
          <div class="candidate-item">
            <span class="strat-tag">[${c.strategy}]</span>
            <code>${escapeHtml(c.value)}</code>
            <span style="color:var(--text-dim)">(priority ${c.priority}, count: ${c.uniqueness})</span>
          </div>
        `).join('');
      }

      stepRow.innerHTML = `
        <div class="step-row-top">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <strong>#${act.index + 1}</strong>
            <span class="step-badge ${act.type}">${act.type}</span>
          </div>
          ${act.value !== undefined ? `<span class="step-value-preview">Value: "${escapeHtml(act.value)}"</span>` : ''}
        </div>
        <div class="candidate-list">
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">Selector Candidates:</span>
          ${candidatesHtml}
        </div>
        <div class="fp-box">
          Tag: <code>&lt;${fp.tagName || 'elem'}&gt;</code> | Text: <em>"${escapeHtml(fp.innerText || '')}"</em> | Non-transient classes: <code>${(fp.classList || []).join(', ') || 'none'}</code>
        </div>
      `;

      elModalStepsTimeline.appendChild(stepRow);
    });

    elModal.classList.remove('hidden');
  }

  // =========================================================================
  // 8. Event Listeners & Initialization
  // =========================================================================
  function init() {
    initSSE();
    refreshStatus();
    loadWorkflows();

    // Periodic CDP check every 5 seconds
    setInterval(refreshStatus, 5000);

    elBtnRefreshStatus.onclick = refreshStatus;
    elBtnReloadWorkflows.onclick = loadWorkflows;

    // Quick Launch Chrome
    const btnLaunchChrome = document.getElementById('btnLaunchChrome');
    const selectTestPortal = document.getElementById('selectTestPortal');

    if (btnLaunchChrome) {
      btnLaunchChrome.onclick = async () => {
        const portal = selectTestPortal ? selectTestPortal.value : 'ecommerce';
        showToast('Launching Google Chrome with CDP...', 'info');
        try {
          const res = await fetch('/api/browser/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portal })
          });
          const data = await res.json();
          if (data.success) {
            showToast('Google Chrome is open & test portal loaded!', 'success');
            refreshStatus();
          } else {
            showToast(data.error || 'Failed to launch Chrome', 'error');
          }
        } catch (e) {
          showToast(e.message, 'error');
        }
      };
    }

    // Helper to open test portal in Chrome
    async function openTestPortalInChrome(portalKey) {
      const portalNames = {
        ecommerce: 'NovaGear E-Commerce',
        sales: 'Stratos Sales CRM',
        library: 'Alexandria Digital Library'
      };
      const label = portalNames[portalKey] || portalKey;
      showToast(`Opening ${label} in Chrome...`, 'info');

      try {
        const res = await fetch('/api/browser/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: portalKey })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Loaded ${label} in Chrome!`, 'success');
          refreshStatus();
        } else {
          showToast(data.error || 'Failed to open portal', 'error');
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    }

    // Quick Open Selected Portal from Nav
    const btnOpenSelectedPortal = document.getElementById('btnOpenSelectedPortal');
    if (btnOpenSelectedPortal && selectTestPortal) {
      btnOpenSelectedPortal.onclick = () => {
        openTestPortalInChrome(selectTestPortal.value);
      };
    }

    // Connect Test Environments Card Buttons
    document.querySelectorAll('.btn-portal-quick').forEach(btn => {
      btn.onclick = () => {
        const portal = btn.getAttribute('data-portal');
        if (portal) {
          if (selectTestPortal) selectTestPortal.value = portal;
          openTestPortalInChrome(portal);
        }
      };
    });

    // Recorder
    elBtnStartRecord.onclick = startRecording;
    elBtnStopRecord.onclick = stopRecording;

    // Replay
    elReplaySpeedRange.oninput = (e) => {
      elReplaySpeedVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
    };
    elBtnStartReplay.onclick = () => startReplay();

    // Tests
    elBtnRunUnitTests.onclick = async () => {
      await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'unit' })
      });
    };

    elBtnRunE2ETests.onclick = async () => {
      await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'e2e' })
      });
    };

    // Console
    elBtnClearLogs.onclick = () => {
      elConsoleTerminal.innerHTML = '';
    };

    // Modal
    elBtnCloseModal.onclick = () => elModal.classList.add('hidden');
    elModal.onclick = (e) => {
      if (e.target === elModal) elModal.classList.add('hidden');
    };
  }

  // Bootstrap
  window.addEventListener('DOMContentLoaded', init);

})();
