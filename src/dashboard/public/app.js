/**
 * Workflow Capture — Quixotic Dashboard Client Application
 */

(function () {
  'use strict';

  // DOM Elements
  const elCdpDot = document.getElementById('cdpDot');
  const elCdpText = document.getElementById('cdpText');
  const elBtnRefreshStatus = document.getElementById('btnRefreshStatus');
  const elSystemStateText = document.getElementById('systemStateText');
  const elCardCdpStatusDisplay = document.getElementById('cardCdpStatusDisplay');
  const elCardActiveTabsCount = document.getElementById('cardActiveTabsCount');

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
        if (elRecActionCount) {
          elRecActionCount.textContent = data.count || 0;
        }
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
          if (elBtnRunUnitTests) elBtnRunUnitTests.disabled = true;
          if (elBtnRunE2ETests) elBtnRunE2ETests.disabled = true;
        } else {
          if (elBtnRunUnitTests) elBtnRunUnitTests.disabled = false;
          if (elBtnRunE2ETests) elBtnRunE2ETests.disabled = false;
          if (data.success) {
            showToast(`${data.type.toUpperCase()} Tests Passed!`, 'success');
          } else {
            showToast(`${data.type.toUpperCase()} Tests Failed (Exit code ${data.exitCode})`, 'error');
          }
        }
      } catch {}
    });
  }

  function appendLogEntry(log) {
    if (!elConsoleTerminal) return;
    const entry = document.createElement('div');
    const levelClass = (log.level || 'INFO').toLowerCase();
    entry.className = 'log-entry';

    entry.innerHTML = `
      <span class="log-time">${log.time || new Date().toLocaleTimeString()}</span>
      <span class="log-badge ${levelClass}">${log.level || 'INFO'}</span>
      <span class="log-message">${escapeHtml(log.text)}</span>
    `;

    elConsoleTerminal.appendChild(entry);

    if (elChkAutoScroll && elChkAutoScroll.checked) {
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

      // CDP Status Pill & Emerald Card
      if (data.cdp && data.cdp.online) {
        if (elCdpDot) elCdpDot.className = 'status-dot online';
        const tabCount = data.cdp.tabs ? data.cdp.tabs.length : 0;
        if (elCdpText) elCdpText.textContent = `CDP Online (${tabCount} tab${tabCount === 1 ? '' : 's'})`;
        if (elCardCdpStatusDisplay) elCardCdpStatusDisplay.textContent = 'Chrome Active';
        if (elCardActiveTabsCount) elCardActiveTabsCount.textContent = `Tabs: ${tabCount} Connected`;
      } else {
        if (elCdpDot) elCdpDot.className = 'status-dot offline';
        if (elCdpText) elCdpText.textContent = 'CDP Standby (Port 9222)';
        if (elCardCdpStatusDisplay) elCardCdpStatusDisplay.textContent = 'CDP Standby';
        if (elCardActiveTabsCount) elCardActiveTabsCount.textContent = 'Tabs: 0 Connected';
      }

      // Engine State
      if (data.recorder && data.recorder.isRecording) {
        if (elSystemStateText) {
          elSystemStateText.textContent = 'RECORDING';
          elSystemStateText.style.color = '#ef4444';
        }
        updateRecordingUI(true, data.recorder);
      } else if (data.replay && data.replay.isReplaying) {
        if (elSystemStateText) {
          elSystemStateText.textContent = 'REPLAYING';
          elSystemStateText.style.color = '#0284c7';
        }
      } else {
        if (elSystemStateText) {
          elSystemStateText.textContent = 'IDLE';
          elSystemStateText.style.color = 'var(--brand-forest)';
        }
      }

    } catch (err) {
      if (elCdpDot) elCdpDot.className = 'status-dot offline';
      if (elCdpText) elCdpText.textContent = 'Server Offline';
    }
  }

  // =========================================================================
  // 4. Recorder UI Handlers
  // =========================================================================
  function updateRecordingUI(isRecording, meta = {}) {
    if (isRecording) {
      if (elBtnStartRecord) elBtnStartRecord.classList.add('hidden');
      if (elBtnStopRecord) elBtnStopRecord.classList.remove('hidden');
      if (elRecBadge) elRecBadge.classList.remove('hidden');
      if (elRecLiveStats) elRecLiveStats.classList.remove('hidden');
      if (elRecordName) elRecordName.disabled = true;

      if (elSystemStateText) {
        elSystemStateText.textContent = 'RECORDING';
        elSystemStateText.style.color = '#ef4444';
      }

      recordStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : Date.now();
      if (!recordTimer) {
        recordTimer = setInterval(updateRecordTimer, 1000);
      }
    } else {
      if (elBtnStartRecord) elBtnStartRecord.classList.remove('hidden');
      if (elBtnStopRecord) elBtnStopRecord.classList.add('hidden');
      if (elRecBadge) elRecBadge.classList.add('hidden');
      if (elRecLiveStats) elRecLiveStats.classList.add('hidden');
      if (elRecordName) elRecordName.disabled = false;

      if (elSystemStateText) {
        elSystemStateText.textContent = 'IDLE';
        elSystemStateText.style.color = 'var(--brand-forest)';
      }

      if (recordTimer) {
        clearInterval(recordTimer);
        recordTimer = null;
      }
      if (elRecElapsedTime) elRecElapsedTime.textContent = '00:00';
    }
  }

  function updateRecordTimer() {
    const elapsedSec = Math.floor((Date.now() - recordStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    if (elRecElapsedTime) elRecElapsedTime.textContent = `${mins}:${secs}`;
  }

  async function startRecording() {
    const name = (elRecordName && elRecordName.value.trim()) || `workflow-${Date.now()}`;
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

      showToast(`Saved workflow: ${data.summary.actionCount} actions captured`, 'success');
      loadWorkflows();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 5. Replay UI Handlers
  // =========================================================================
  function updateReplayProgress(index, total, action) {
    if (!elReplayProgressContainer) return;
    elReplayProgressContainer.classList.remove('hidden');
    const percent = Math.round((index / total) * 100);
    if (elReplayStepText) elReplayStepText.textContent = `Action #${index}/${total} [${action ? action.type : 'STEP'}]`;
    if (elReplayPercentText) elReplayPercentText.textContent = `${percent}%`;
    if (elReplayProgressBar) elReplayProgressBar.style.width = `${percent}%`;
  }

  function updateReplayStateUI(state) {
    if (!elBtnStartReplay) return;
    if (state.isReplaying) {
      elBtnStartReplay.disabled = true;
      elBtnStartReplay.innerHTML = '<span>⏳ Replaying...</span>';
      if (elReplayProgressContainer) elReplayProgressContainer.classList.remove('hidden');
      if (elSystemStateText) {
        elSystemStateText.textContent = 'REPLAYING';
        elSystemStateText.style.color = '#0284c7';
      }
    } else {
      elBtnStartReplay.disabled = false;
      elBtnStartReplay.innerHTML = '<span>▶ Run Playback</span>';
      if (elSystemStateText) {
        elSystemStateText.textContent = 'IDLE';
        elSystemStateText.style.color = 'var(--brand-forest)';
      }

      if (state.success) {
        showToast(`Workflow Replay Completed Successfully!`, 'success');
      } else if (state.error) {
        showToast(`Replay Halted: ${state.error}`, 'error');
      }
    }
  }

  async function startReplay(workflowFilename) {
    const filename = workflowFilename || (elSelectWorkflow && elSelectWorkflow.value);
    if (!filename) {
      showToast('Please select a workflow to replay', 'error');
      return;
    }

    const speed = elReplaySpeedRange ? parseFloat(elReplaySpeedRange.value) : 1.0;
    const timeoutMs = elReplayTimeoutInput ? parseInt(elReplayTimeoutInput.value, 10) : 5000;

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
  // 6. Workflows Explorer & List Table (Quixotic Styled Table)
  // =========================================================================
  async function loadWorkflows() {
    try {
      const res = await fetch('/api/recordings');
      const data = await res.json();
      cachedWorkflows = data.recordings || [];

      if (elWorkflowCountBadge) {
        elWorkflowCountBadge.textContent = cachedWorkflows.length;
      }

      // Update dropdown
      if (elSelectWorkflow) {
        elSelectWorkflow.innerHTML = '';
        if (cachedWorkflows.length === 0) {
          elSelectWorkflow.innerHTML = '<option value="" disabled selected>No recordings found</option>';
        } else {
          cachedWorkflows.forEach(wf => {
            const opt = document.createElement('option');
            opt.value = wf.filename;
            opt.textContent = `${wf.name} (${wf.actionCount} steps)`;
            elSelectWorkflow.appendChild(opt);
          });
        }
      }

      // Render Quixotic Table Rows
      if (elWorkflowsList) {
        if (cachedWorkflows.length === 0) {
          elWorkflowsList.innerHTML = `
            <tr>
              <td colspan="5" style="text-align:center; padding:2rem; color:var(--text-sub);">
                No recorded workflows found. Use the <strong>Workflow Recorder</strong> to capture your first flow!
              </td>
            </tr>
          `;
          return;
        }

        elWorkflowsList.innerHTML = '';
        cachedWorkflows.forEach((wf, idx) => {
          const row = document.createElement('tr');
          const createdDate = wf.startedAt ? new Date(wf.startedAt) : new Date();
          const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const timeStr = createdDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

          row.innerHTML = `
            <td>
              <div class="wf-icon-cell">
                <div class="wf-avatar">#${idx + 1}</div>
                <div>
                  <strong style="color:var(--text-main); font-weight:700;">${escapeHtml(wf.name)}</strong>
                  <div style="font-size:0.68rem; color:var(--text-sub); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(wf.startUrl || 'about:blank')}
                  </div>
                </div>
              </div>
            </td>
            <td>
              <span class="badge-tag success">⚡ ${wf.actionCount} steps</span>
            </td>
            <td>
              <div style="font-size:0.75rem; font-weight:600; color:var(--text-body);">${dateStr}</div>
              <div style="font-size:0.68rem; color:var(--text-sub);">${timeStr}</div>
            </td>
            <td>
              <span class="badge-tag success">● Verified</span>
            </td>
            <td style="text-align:right;">
              <div style="display:inline-flex; gap:0.35rem;">
                <button class="btn btn-sm btn-primary btn-card-replay" data-file="${wf.filename}" title="Replay Flow">
                  ▶ Replay
                </button>
                <button class="btn btn-sm btn-secondary btn-card-inspect" data-file="${wf.filename}" title="Inspect Selectors">
                  🔍 Inspect
                </button>
                <button class="btn btn-sm btn-ghost btn-card-delete" data-file="${wf.filename}" title="Delete Workflow">
                  🗑
                </button>
              </div>
            </td>
          `;
          elWorkflowsList.appendChild(row);
        });

        // Attach Card Actions
        elWorkflowsList.querySelectorAll('.btn-card-replay').forEach(btn => {
          btn.onclick = () => {
            if (elSelectWorkflow) elSelectWorkflow.value = btn.dataset.file;
            startReplay(btn.dataset.file);
          };
        });

        elWorkflowsList.querySelectorAll('.btn-card-inspect').forEach(btn => {
          btn.onclick = () => inspectWorkflow(btn.dataset.file);
        });

        elWorkflowsList.querySelectorAll('.btn-card-delete').forEach(btn => {
          btn.onclick = () => deleteWorkflow(btn.dataset.file);
        });
      }

    } catch (err) {
      if (elWorkflowsList) {
        elWorkflowsList.innerHTML = `<tr><td colspan="5" style="color:var(--color-danger); padding:1rem;">Error: ${err.message}</td></tr>`;
      }
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
    if (!wf || !elModal) return;

    if (elModalTitle) elModalTitle.textContent = `${wf.name} (${wf.filename})`;

    if (elModalMetaGrid) {
      elModalMetaGrid.innerHTML = `
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Total Actions</span><strong style="font-size:1.1rem; color:var(--brand-forest);">${wf.actionCount}</strong></div>
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Start URL</span><strong style="font-size:0.75rem; word-break:break-all;">${escapeHtml(wf.startUrl)}</strong></div>
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Captured Date</span><strong style="font-size:0.75rem;">${new Date(wf.startedAt).toLocaleString()}</strong></div>
      `;
    }

    if (elModalStepsTimeline) {
      elModalStepsTimeline.innerHTML = '';
      (wf.actions || []).forEach(act => {
        const stepRow = document.createElement('div');
        stepRow.className = 'step-row';

        const fp = (act.target && act.target.fingerprint) ? act.target.fingerprint : {};

        let candidatesHtml = '';
        if (act.target && act.target.candidates) {
          candidatesHtml = act.target.candidates.map(c => `
            <div class="candidate-item">
              <span class="strat-tag">[${c.strategy}]</span>
              <code>${escapeHtml(c.value)}</code>
              <span style="color:var(--text-sub);">(prio: ${c.priority}, count: ${c.uniqueness})</span>
            </div>
          `).join('');
        }

        stepRow.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <strong style="font-size:0.85rem; color:var(--text-main);">#${act.index + 1}</strong>
              <span class="badge-tag success">${act.type}</span>
            </div>
            ${act.value !== undefined ? `<span style="font-size:0.75rem; color:var(--text-sub); font-family:var(--font-mono);">Value: "<strong>${escapeHtml(act.value)}</strong>"</span>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:0.35rem; margin-top:0.35rem;">
            <span style="font-size:0.7rem; color:var(--text-sub); font-weight:700;">Candidate Selectors:</span>
            ${candidatesHtml}
          </div>
          <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.35rem; font-family:var(--font-mono); background:#ffffff; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid rgba(0,0,0,0.06);">
            Tag: <code>&lt;${fp.tagName || 'elem'}&gt;</code> | Text: <em>"${escapeHtml(fp.innerText || '')}"</em> | Classes: <code>${(fp.classList || []).join(', ') || 'none'}</code>
          </div>
        `;

        elModalStepsTimeline.appendChild(stepRow);
      });
    }

    elModal.classList.remove('hidden');
  }

  // =========================================================================
  // 8. Event Listeners & Initialization
  // =========================================================================
  function init() {
    initSSE();
    refreshStatus();
    loadWorkflows();

    // Periodic CDP check every 4 seconds
    setInterval(refreshStatus, 4000);

    if (elBtnRefreshStatus) elBtnRefreshStatus.onclick = refreshStatus;
    if (elBtnReloadWorkflows) elBtnReloadWorkflows.onclick = loadWorkflows;

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

    // Quick Open Selected Portal from Header
    const btnOpenSelectedPortal = document.getElementById('btnOpenSelectedPortal');
    if (btnOpenSelectedPortal && selectTestPortal) {
      btnOpenSelectedPortal.onclick = () => {
        openTestPortalInChrome(selectTestPortal.value);
      };
    }

    // Connect Test Environments Quick Cards
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
    if (elBtnStartRecord) elBtnStartRecord.onclick = startRecording;
    if (elBtnStopRecord) elBtnStopRecord.onclick = stopRecording;

    // Replay
    if (elReplaySpeedRange) {
      elReplaySpeedRange.oninput = (e) => {
        if (elReplaySpeedVal) elReplaySpeedVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
      };
    }
    if (elBtnStartReplay) elBtnStartReplay.onclick = () => startReplay();

    // Tests
    if (elBtnRunUnitTests) {
      elBtnRunUnitTests.onclick = async () => {
        showToast('Running selector resolver unit tests...', 'info');
        await fetch('/api/test/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'unit' })
        });
      };
    }

    if (elBtnRunE2ETests) {
      elBtnRunE2ETests.onclick = async () => {
        showToast('Running E2E smoke tests...', 'info');
        await fetch('/api/test/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'e2e' })
        });
      };
    }

    // Console
    if (elBtnClearLogs && elConsoleTerminal) {
      elBtnClearLogs.onclick = () => {
        elConsoleTerminal.innerHTML = '';
      };
    }

    // Modal
    if (elBtnCloseModal && elModal) {
      elBtnCloseModal.onclick = () => elModal.classList.add('hidden');
    }
    if (elModal) {
      elModal.onclick = (e) => {
        if (e.target === elModal) elModal.classList.add('hidden');
      };
    }

    // Navigation Tab Pills Scroll/Active Switch
    document.querySelectorAll('.nav-pill-link').forEach(link => {
      link.onclick = () => {
        document.querySelectorAll('.nav-pill-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const tab = link.getAttribute('data-tab');
        if (tab === 'workflows') {
          const sec = document.getElementById('workflowsCardSection');
          if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'console') {
          const sec = document.getElementById('consoleCardSection');
          if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'dashboard') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      };
    });
  }

  // Bootstrap
  window.addEventListener('DOMContentLoaded', init);

})();
