/**
 * Workflow Capture — Live Execution View with Embedded Console & Step Progression
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { SSE } from '../sse.js';

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

function formatLabel(str) {
  return String(str || 'UNKNOWN').replace(/_/g, ' ');
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
  terminalEl: null,
  workflowSteps: [],

  async render(container, router, runId) {
    this.container = container;
    this.router = router;
    this.runId = runId || sessionStorage.getItem('workflowCaptureActiveRunId');

    if (!this.runId) {
      container.innerHTML = `
        <section class="card execution-empty" style="text-align:center; padding:3rem 1.5rem;">
          <h2 style="font-size:1.3rem; margin-bottom:0.5rem; color:var(--text-main);">No active execution selected</h2>
          <p style="color:var(--text-sub); margin-bottom:1.5rem;">Select a recorded workflow to execute, or view saved workflows.</p>
          <div style="display:flex; justify-content:center; gap:0.75rem;">
            <button class="btn btn-primary" id="btnExecutionGoWorkflows">View Workflows</button>
            <button class="btn btn-secondary" id="btnExecutionGoDashboard">Dashboard</button>
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
        <!-- Hero Header -->
        <section class="card execution-hero">
          <div>
            <span class="eyebrow" style="color:var(--brand-forest); font-weight:800; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.08em;">Live Execution Monitor</span>
            <h1 id="executionTitle" style="font-size:1.45rem; font-weight:800; margin:0.2rem 0; color:var(--text-main);">Workflow Execution</h1>
            <p style="margin:0.25rem 0 0; color:var(--text-sub); font-size:0.75rem;">
              Run <span class="mono" id="executionRunId">${escapeHtml(this.runId)}</span>
              <span id="executionWorkflowSubtitle" style="margin-left:0.5rem;"></span>
            </p>
          </div>
          <div class="execution-hero-actions">
            <button class="btn btn-secondary btn-sm" id="btnExecutionBack" title="Return to Workflows">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
              <span>Workflows</span>
            </button>
            <span class="run-status-badge queued" id="executionStatusBadge">QUEUED</span>
            <button class="btn btn-danger btn-sm" id="btnExecutionStop" title="Halt current execution">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              <span>Stop Execution</span>
            </button>
            <button class="btn btn-primary btn-sm hidden" id="btnExecutionViewResults" title="Inspect full results and artifacts">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span>View Results</span>
            </button>
          </div>
        </section>

        <!-- Summary Metric Cards (Prominently displaying REMAINING) -->
        <section class="execution-summary-grid">
          <article class="stat-card" style="border-color: rgba(12, 92, 63, 0.25); background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 80%);">
            <span class="stat-label" id="executionRemainingLabel" style="color:var(--brand-forest); font-weight:700;">Remaining</span>
            <strong id="executionRemaining" style="color:var(--brand-forest); font-size:1.6rem;">—</strong>
            <span class="stat-meta" id="executionRemainingMeta">Queued to run</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Progress</span>
            <strong id="executionProcessed">0 / 0</strong>
            <span class="stat-meta" id="executionProcessedMeta">Completed</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Passed</span>
            <strong id="executionSucceeded" style="color:#16a34a;">0</strong>
            <span class="stat-meta">Successful</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Failed</span>
            <strong id="executionFailed" style="color:#dc2626;">0</strong>
            <span class="stat-meta">Errors caught</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Skipped</span>
            <strong id="executionSkipped" style="color:#d97706;">0</strong>
            <span class="stat-meta">Duplicates</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Downloads</span>
            <strong id="executionDownloads">0</strong>
            <span class="stat-meta">Artifact files</span>
          </article>
        </section>

        <!-- Progress Track Bar -->
        <section class="card execution-progress-card">
          <div class="execution-progress-head">
            <div>
              <strong id="executionProgressLabel">Preparing execution…</strong>
              <span id="executionProgressDetail">Connecting to browser and initializing steps.</span>
            </div>
            <strong id="executionProgressPercent" style="font-size:1rem; color:var(--brand-forest); font-family:var(--font-mono);">0%</strong>
          </div>
          <div class="execution-progress-track">
            <div id="executionProgressBar" style="width:0%;"></div>
          </div>
        </section>

        <!-- Main Execution Grid: Steps Queue on Left, Live Merged Console on Right -->
        <div class="execution-grid">
          <!-- Left Column: Step-by-step Execution Queue -->
          <section class="card execution-steps-card">
            <div class="card-header-row" style="margin-bottom:0.75rem;">
              <div class="card-title-wrap">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <h2 id="executionStepCardTitle" style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Execution Queue</h2>
                  <span class="badge-tag info" id="executionStepCountBadge">0 steps</span>
                </div>
                <p id="executionStepCardDesc">Live status showing completed, active, and remaining items</p>
              </div>
            </div>
            <div class="execution-items" id="executionItems" style="max-height:460px; overflow-y:auto; padding-right:0.35rem;">
              <div class="execution-item-empty">Loading workflow steps…</div>
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
                <p>Real-time Chrome DevTools Protocol logs &amp; step replay events</p>
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
            <div class="console-terminal-wrapper" id="execConsoleLogOutput" style="height:410px; max-height:460px; overflow-y:auto;">
              <!-- Live logs stream here -->
            </div>
          </section>
        </div>

        <div class="execution-error hidden" id="executionError"></div>
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

    document.getElementById('btnExecutionStop')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnExecutionStop');
      if (btn) btn.disabled = true;
      try {
        await Api.stopRun(this.runId);
        Toast.info('Execution stop signal sent.');
        await this.refresh();
      } catch (e) {
        Toast.error(e.message);
        if (btn) btn.disabled = false;
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
    });

    // Initial render of existing logs
    this.renderLogs();
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

    // Remove empty placeholder if present
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
      this.refresh().catch(e => this.showError(e.message));
    }, 800);
  },

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  async refresh() {
    const data = await Api.getRunStatus(this.runId);
    const run = data.run || {};
    const m = run.manifest || {};
    const results = Array.isArray(m.results) ? m.results : [];

    // Extract workflow steps definition (from response or manifest)
    if (Array.isArray(run.workflowSteps) && run.workflowSteps.length > 0) {
      this.workflowSteps = run.workflowSteps;
    }

    // Determine mode and labels
    const isLoopMode = (run.mode === 'LOOP') || (m.mode === 'LOOP');
    const unitSingular = isLoopMode ? 'item' : 'step';
    const unitPlural = isLoopMode ? 'items' : 'steps';
    const UnitCapital = isLoopMode ? 'Item' : 'Step';
    const UnitsCapital = isLoopMode ? 'Items' : 'Steps';

    // Determine counts
    const totalCount = isLoopMode
      ? Number(m.itemsTotal ?? run.itemsTotal ?? (results.length > 0 ? results.length : this.workflowSteps.length) ?? 0)
      : (this.workflowSteps.length > 0 ? this.workflowSteps.length : Number(m.itemsTotal ?? run.itemsTotal ?? results.length ?? 0));

    const ok = Number(m.itemsSucceeded ?? run.itemsSucceeded ?? 0);
    const fail = Number(m.itemsFailed ?? run.itemsFailed ?? 0);
    const processed = results.filter(x => ['SUCCESS', 'FAILED', 'STOPPED'].includes(x.status)).length;
    const remaining = Math.max(0, totalCount - processed);
    const files = Array.isArray(m.downloadedFiles) ? m.downloadedFiles.length : Number((run.downloadedFiles || []).length);
    const pct = totalCount > 0 ? Math.min(100, Math.round((processed / totalCount) * 100)) : 0;
    const status = m.status || run.status || 'QUEUED';
    const isTerminal = terminalStates.has(status);

    // Update Header
    const titleEl = document.getElementById('executionTitle');
    if (titleEl) {
      const name = run.workflowName || run.workflowId || 'Workflow';
      titleEl.textContent = `Workflow: ${name}`;
    }

    const subEl = document.getElementById('executionWorkflowSubtitle');
    if (subEl) {
      subEl.textContent = `· Mode: ${isLoopMode ? 'AUTO-DISCOVERY LOOP' : 'STANDARD'}`;
    }

    // Update Status Badge
    const badge = document.getElementById('executionStatusBadge');
    if (badge) {
      badge.textContent = formatLabel(status);
      badge.className = `run-status-badge ${String(status).toLowerCase()}`;
    }

    // Update Metrics (REMAINING prominently highlighted)
    const elRemLabel = document.getElementById('executionRemainingLabel');
    if (elRemLabel) {
      elRemLabel.textContent = `${UnitsCapital} Remaining`;
    }

    const elRem = document.getElementById('executionRemaining');
    if (elRem) {
      elRem.textContent = isTerminal ? '0' : String(remaining);
      const remMeta = document.getElementById('executionRemainingMeta');
      if (remMeta) {
        remMeta.textContent = isTerminal ? 'Completed' : `${remaining} ${remaining === 1 ? unitSingular : unitPlural} remaining`;
      }
    }

    const elProc = document.getElementById('executionProcessed');
    if (elProc) {
      elProc.textContent = `${processed} / ${totalCount || processed}`;
    }

    const elProcMeta = document.getElementById('executionProcessedMeta');
    if (elProcMeta) {
      elProcMeta.textContent = `${UnitsCapital} completed`;
    }

    const elSucc = document.getElementById('executionSucceeded');
    if (elSucc) elSucc.textContent = ok;

    const elFail = document.getElementById('executionFailed');
    if (elFail) elFail.textContent = fail;

    const elSkip = document.getElementById('executionSkipped');
    const skippedCount = m.itemsSkipped ?? run.itemsSkipped ?? results.filter(r => r.status === 'SKIPPED_DUPLICATE').length;
    if (elSkip) elSkip.textContent = skippedCount;

    const elDown = document.getElementById('executionDownloads');
    if (elDown) elDown.textContent = files;

    // Update Progress Bar
    const elPct = document.getElementById('executionProgressPercent');
    if (elPct) elPct.textContent = isTerminal && status === 'COMPLETED' ? '100%' : `${pct}%`;

    const elBar = document.getElementById('executionProgressBar');
    if (elBar) {
      elBar.style.width = isTerminal && status === 'COMPLETED' ? '100%' : `${pct}%`;
      if (status === 'COMPLETED') elBar.style.backgroundColor = '#16a34a';
      else if (status === 'FAILED') elBar.style.backgroundColor = '#dc2626';
      else elBar.style.backgroundColor = 'var(--brand-forest)';
    }

    const elProgLabel = document.getElementById('executionProgressLabel');
    if (elProgLabel) {
      if (isTerminal) {
        elProgLabel.textContent = status === 'COMPLETED'
          ? (isLoopMode ? 'All Discovered Items Processed Successfully!' : 'Execution Finished Successfully!')
          : `Execution Finished: ${formatLabel(status)}`;
      } else if (processed > 0) {
        elProgLabel.textContent = `Processing ${UnitCapital} ${processed + 1} of ${totalCount} (${remaining} remaining)`;
      } else {
        elProgLabel.textContent = `Starting ${isLoopMode ? 'auto-discovery loop' : 'execution'} (${totalCount} ${totalCount === 1 ? unitSingular : unitPlural} queued)…`;
      }
    }

    const elProgDetail = document.getElementById('executionProgressDetail');
    if (elProgDetail) {
      elProgDetail.textContent = totalCount > 0
        ? `${ok} succeeded · ${fail} failed${skippedCount > 0 ? ` · ${skippedCount} skipped` : ''} · ${remaining} ${remaining === 1 ? unitSingular : unitPlural} remaining`
        : 'Running workflow automation…';
    }

    // Update Step/Item Count Badge and Titles
    const countBadge = document.getElementById('executionStepCountBadge');
    if (countBadge) {
      countBadge.textContent = `${totalCount} ${totalCount === 1 ? unitSingular : unitPlural}`;
    }

    const queueTitle = document.getElementById('executionStepCardTitle');
    if (queueTitle) {
      queueTitle.textContent = isLoopMode ? 'Collection Loop Queue' : 'Step Execution Queue';
    }

    const queueDesc = document.getElementById('executionStepCardDesc');
    if (queueDesc) {
      queueDesc.textContent = isLoopMode
        ? 'Live status showing completed, active, and remaining discovered items'
        : 'Live status showing completed, active, and remaining workflow steps';
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
    if (btnResults && isTerminal) {
      btnResults.classList.remove('hidden');
    }

    // Handle terminal status
    if (isTerminal) {
      this.stopPolling();
      sessionStorage.setItem('workflowCaptureLastRunId', this.runId);
      const liveBadge = document.getElementById('execConsoleLiveBadge');
      if (liveBadge) {
        liveBadge.className = 'badge-tag success';
        liveBadge.innerHTML = `<span>FINISHED (${escapeHtml(status)})</span>`;
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
      list.innerHTML = `<div class="execution-item-empty">Waiting for runner to initialize…</div>`;
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
          <div class="execution-item-row ${setupState}" style="border-left: 3px solid #64748b;">
            <span class="execution-item-icon">${setupIcon}</span>
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
          <span>🔁 Collection Loop Phase (${count} discovered item${count === 1 ? '' : 's'})</span>
        </div>
      `);
    }

    for (let i = 1; i <= count; i++) {
      const res = resultMap.get(i);
      let titleLabel = '';
      let badgeLabel = '';
      let targetDetail = '';

      if (isLoopMode) {
        titleLabel = (res && res.label) ? `Item #${i} · ${escapeHtml(res.label)}` : `Item #${i}`;
        badgeLabel = 'LOOP ROW';
        if (res && res.status === 'SKIPPED_DUPLICATE') {
          targetDetail = res.skippedReason || 'Skipped duplicate: already downloaded';
        } else if (res && Array.isArray(res.downloadedFiles) && res.downloadedFiles.length > 0) {
          targetDetail = `Downloaded: ${res.downloadedFiles.map(f => typeof f === 'string' ? f : f.filename).join(', ')}`;
        } else if (res && Array.isArray(res.actions)) {
          targetDetail = `Executed ${res.actions.length} action(s) on row #${i}`;
        } else {
          targetDetail = `Discovered repeating collection item #${i}`;
        }
      } else {
        const stepDef = this.workflowSteps[i - 1] || {};
        const stepFriendly = (res && (res.elementName || res.name)) || stepDef.elementName || stepDef.name || stepDef.target?.elementName || '';
        titleLabel = stepFriendly ? `Step #${i} · ${escapeHtml(stepFriendly)}` : `Step #${i}`;
        badgeLabel = (res && res.type) || stepDef.type || stepDef.action || 'STEP';
        targetDetail = (stepDef.value)
          ? `Input: "${stepDef.value}"`
          : (stepDef.url ? `URL: ${stepDef.url}` : (stepFriendly ? `${badgeLabel} on ${stepFriendly}` : (stepDef.selector ? `Target: ${stepDef.selector}` : '')));
      }

      let state = 'remaining';
      let icon = '⏱';
      let stateLabel = 'Remaining';
      let errorText = '';

      if (res) {
        const s = String(res.status || '').toUpperCase();
        if (s === 'SUCCESS') {
          state = 'success';
          icon = '✓';
          stateLabel = 'Completed';
        } else if (s === 'SKIPPED_DUPLICATE') {
          state = 'skipped';
          icon = '↷';
          stateLabel = 'Skipped';
        } else if (s === 'FAILED') {
          state = 'failed';
          icon = '✗';
          stateLabel = 'Failed';
          errorText = res.error ? ` — ${escapeHtml(res.error)}` : '';
        } else if (s === 'STOPPED') {
          state = 'stopped';
          icon = '■';
          stateLabel = 'Stopped';
        } else if (s === 'PENDING') {
          state = 'pending';
          icon = '⟳';
          stateLabel = 'Running';
        }
      } else if (!isTerminal && i === results.length + 1) {
        state = 'pending';
        icon = '⟳';
        stateLabel = 'Running';
      } else if (isTerminal) {
        state = 'stopped';
        icon = '—';
        stateLabel = 'Not Reached';
      }

      rows.push(`
        <div class="execution-item-row ${state}">
          <span class="execution-item-icon">${icon}</span>
          <div class="execution-item-copy">
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <strong>${escapeHtml(titleLabel)}</strong>
              <span class="badge-tag info" style="font-size:0.6rem; padding:1px 5px;">${escapeHtml(badgeLabel)}</span>
            </div>
            <span>${escapeHtml(targetDetail || titleLabel)}${errorText}</span>
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
      b.textContent = message || 'Unable to load execution status.';
      b.classList.remove('hidden');
    }
  },

  destroy() {
    this.stopPolling();
    if (this.unsubscribeSSE) {
      this.unsubscribeSSE();
      this.unsubscribeSSE = null;
    }
  }
};