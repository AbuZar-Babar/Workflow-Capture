/**
 * Workflow Capture — Run Results View
 * Modernized for UI-5: SaaS-grade results presentation, record-level outcomes,
 * direct file preview & download, and safe "Run Again" via ExecutionModal.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { ExecutionModal } from '../components/executionModal.js';
import { escapeHtml } from '../utils/dom.js';

function formatStatusLabel(status) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  switch (s) {
    case 'COMPLETED':
      return 'Completed';
    case 'COMPLETED_WITH_ERRORS':
      return 'Completed with errors';
    case 'STOPPED':
      return 'Stopped';
    case 'FAILED':
      return 'Failed';
    case 'RUNNING':
      return 'Running';
    default:
      return s.replace(/_/g, ' ');
  }
}

function formatRecordStatus(status) {
  const s = String(status || 'UNKNOWN').toUpperCase();
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
    default:
      return { label: s.replace(/_/g, ' '), cls: 'remaining', icon: '•' };
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoStr;
  }
}

function calculateDuration(startIso, endIso) {
  if (!startIso) return '';
  try {
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    if (isNaN(start) || isNaN(end) || end < start) return '';
    const diffSec = Math.round((end - start) / 100);
    if (diffSec < 60) return `${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins}m ${secs}s`;
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

export const ResultsView = {
  container: null,
  router: null,
  runId: null,
  runData: null,
  activeFilter: 'ALL',
  searchQuery: '',
  filesList: [],

  async render(container, router, runId) {
    this.container = container;
    this.router = router;
    this.runId = runId || sessionStorage.getItem('workflowCaptureLastRunId');

    if (!this.runId) {
      container.innerHTML = `
        <section class="card execution-empty" style="text-align:center; padding:3.5rem 1.5rem; max-width:560px; margin:2rem auto; border-radius:var(--radius-xl);">
          <div style="width:48px; height:48px; border-radius:50%; background:#f1f5f9; color:#475569; display:grid; place-items:center; margin:0 auto 1rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          </div>
          <h2 style="font-size:1.35rem; font-weight:800; margin-bottom:0.5rem; color:var(--text-main);">No run results to display</h2>
          <p style="color:var(--text-sub); font-size:0.85rem; margin-bottom:1.75rem;">Complete a workflow execution or select a run from your history to inspect its results.</p>
          <div style="display:flex; justify-content:center; gap:0.75rem; flex-wrap:wrap;">
            <button class="btn btn-primary" id="btnResultsGoWorkflows">View Workflows</button>
            <button class="btn btn-secondary" id="btnResultsGoDashboard">Back to Dashboard</button>
          </div>
        </section>
      `;
      document.getElementById('btnResultsGoWorkflows')?.addEventListener('click', () => router.navigate('workflows'));
      document.getElementById('btnResultsGoDashboard')?.addEventListener('click', () => router.navigate('overview'));
      return;
    }

    container.innerHTML = `
      <div style="text-align:center; padding:3.5rem 1.5rem; color:var(--text-sub);">
        <div class="discovery-spinner" style="margin:0 auto 1rem auto;"></div>
        <p style="font-size:0.9rem; font-weight:600;">Loading run results…</p>
      </div>
    `;

    try {
      const data = await Api.getRunStatus(this.runId);
      this.runData = data;
      this.renderResults(data.run || {}, data.run?.manifest || {});
    } catch (e) {
      container.innerHTML = `
        <section class="card execution-empty" style="text-align:center; padding:3rem 1.5rem; max-width:560px; margin:2rem auto; border-radius:var(--radius-xl);">
          <h2 style="font-size:1.25rem; font-weight:800; color:#b91c1c; margin-bottom:0.5rem;">Results unavailable</h2>
          <p style="color:var(--text-sub); font-size:0.85rem; margin-bottom:1.5rem;">${escapeHtml(e.message)}</p>
          <div style="display:flex; justify-content:center; gap:0.75rem;">
            <button class="btn btn-primary" id="btnResultsRetry">Retry</button>
            <button class="btn btn-secondary" id="btnResultsBack">Back to Workflows</button>
          </div>
        </section>
      `;
      document.getElementById('btnResultsRetry')?.addEventListener('click', () => this.render(container, router, this.runId));
      document.getElementById('btnResultsBack')?.addEventListener('click', () => router.navigate('workflows'));
    }
  },

  renderResults(run, m) {
    const status = m.status || run.status || 'UNKNOWN';
    const results = Array.isArray(m.results) ? m.results : [];
    const files = Array.isArray(m.downloadedFiles) ? m.downloadedFiles : (Array.isArray(run.downloadedFiles) ? run.downloadedFiles : []);
    this.filesList = files;

    const isLoopMode = (run.mode === 'LOOP') || (run.mode === 'loop') || (m.mode === 'LOOP') || (m.mode === 'loop');
    const unitSingular = isLoopMode ? 'record' : 'step';
    const unitPlural = isLoopMode ? 'records' : 'steps';

    const total = Number(m.itemsTotal ?? run.itemsTotal ?? results.length);
    const ok = Number(m.itemsSucceeded ?? run.itemsSucceeded ?? 0);
    const fail = Number(m.itemsFailed ?? run.itemsFailed ?? 0);

    const filterSkipped = results.filter(r => r.status === 'SKIPPED_FILTER').length;
    const limitSkipped = results.filter(r => r.status === 'SKIPPED_LIMIT').length;
    const dupSkipped = results.filter(r => r.status === 'SKIPPED_DUPLICATE').length;
    const skippedCount = m.itemsSkipped ?? run.itemsSkipped ?? (filterSkipped + limitSkipped + dupSkipped);

    const workflowName = run.workflowName || run.workflowId || 'Workflow';
    const targetDomain = extractDomain(run.targetUrl || run.url);
    const startedFormatted = formatDate(run.startedAt || m.startTime);
    const duration = calculateDuration(run.startedAt || m.startTime, run.completedAt || m.endTime);

    // Summary outcome line
    let outcomeText = '';
    let outcomeClass = 'info';
    let outcomeIcon = '✓';

    if (status === 'COMPLETED') {
      outcomeText = `All ${total} ${unitPlural} completed successfully without errors.`;
      outcomeClass = 'success';
      outcomeIcon = '✓';
    } else if (status === 'COMPLETED_WITH_ERRORS') {
      outcomeText = `Run completed with ${fail} error(s) out of ${total} ${unitPlural}.`;
      outcomeClass = 'warning';
      outcomeIcon = '⚠️';
    } else if (status === 'STOPPED') {
      outcomeText = `Run stopped by user. ${ok} ${unitPlural} were completed before halting.`;
      outcomeClass = 'warning';
      outcomeIcon = '■';
    } else if (status === 'FAILED') {
      outcomeText = run.error || m.error || 'Run failed due to an error during execution.';
      outcomeClass = 'danger';
      outcomeIcon = '✗';
    } else {
      outcomeText = `Run is currently ${formatStatusLabel(status).toLowerCase()}.`;
    }

    this.container.innerHTML = `
      <div class="results-shell">
        <!-- Hero Header -->
        <section class="card results-hero" aria-labelledby="resultsTitle">
          <div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.25rem;">
              <span class="eyebrow" style="color:var(--brand-forest); font-weight:800; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.08em;">Run Report</span>
              <span class="badge-tag info" style="font-size:0.62rem; text-transform:uppercase;">${isLoopMode ? 'BATCH RUN' : 'SINGLE RUN'}</span>
              ${targetDomain ? `<span class="badge-tag secondary" style="font-size:0.62rem;">🌐 ${escapeHtml(targetDomain)}</span>` : ''}
            </div>
            <h1 id="resultsTitle" style="font-size:1.45rem; font-weight:800; margin:0.15rem 0; color:var(--text-main);">${escapeHtml(workflowName)}</h1>
            <p style="margin:0.25rem 0 0; color:var(--text-sub); font-size:0.75rem; display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
              <span>Run reference <strong class="mono" style="font-weight:700;">${escapeHtml(this.runId)}</strong></span>
              <span>· ${startedFormatted}</span>
              ${duration ? `<span>· Duration: <strong>${escapeHtml(duration)}</strong></span>` : ''}
            </p>
          </div>
          <div class="execution-hero-actions">
            <span class="run-status-badge ${String(status).toLowerCase()}">${escapeHtml(formatStatusLabel(status))}</span>
            <button class="btn btn-secondary btn-sm" id="btnResultsBackWorkflows">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
              <span>Workflows</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnResultsRunAgain" title="Configure and execute workflow again">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              <span>Run Again</span>
            </button>
          </div>
        </section>

        <!-- Outcome Banner -->
        <div class="card" style="padding:1rem 1.25rem; border-radius:var(--radius-lg); display:flex; align-items:center; gap:0.85rem; border-left:4px solid ${status === 'COMPLETED' ? '#16a34a' : (status === 'COMPLETED_WITH_ERRORS' ? '#f59e0b' : (status === 'STOPPED' ? '#ea580c' : '#dc2626'))}; background:${status === 'COMPLETED' ? '#f0fdf4' : (status === 'COMPLETED_WITH_ERRORS' ? '#fffbeb' : (status === 'STOPPED' ? '#fff7ed' : '#fef2f2'))};">
          <div style="font-size:1.15rem; flex-shrink:0;">${outcomeIcon}</div>
          <div style="min-width:0; flex:1;">
            <strong style="font-size:0.88rem; color:var(--text-main); display:block;">${escapeHtml(formatStatusLabel(status))}</strong>
            <p style="font-size:0.78rem; color:var(--text-sub); margin:0.15rem 0 0;">${escapeHtml(outcomeText)}</p>
          </div>
        </div>

        <!-- Metric Summary Cards -->
        <section class="results-summary-grid" aria-label="Run summary metrics">
          <article class="stat-card">
            <span class="stat-label">Total ${unitPlural}</span>
            <strong style="font-size:1.55rem;">${total}</strong>
            <span class="stat-meta">Discovered &amp; queued</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Completed</span>
            <strong style="color:#16a34a; font-size:1.55rem;">${ok}</strong>
            <span class="stat-meta">Processed successfully</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Failed</span>
            <strong style="color:${fail > 0 ? '#dc2626' : 'var(--text-main)'}; font-size:1.55rem;">${fail}</strong>
            <span class="stat-meta">${fail > 0 ? 'Caught errors' : 'Zero errors'}</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">Excluded</span>
            <strong style="color:#d97706; font-size:1.55rem;">${skippedCount}</strong>
            <span class="stat-meta" title="${filterSkipped} filtered · ${limitSkipped} limit · ${dupSkipped} dupes">
              ${filterSkipped > 0 ? `${filterSkipped} filtered` : (skippedCount > 0 ? `${skippedCount} skipped` : 'None excluded')}
            </span>
          </article>
          <article class="stat-card" style="border-color: rgba(12, 92, 63, 0.25); background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 80%);">
            <span class="stat-label" style="color:var(--brand-forest); font-weight:700;">Files Generated</span>
            <strong style="color:var(--brand-forest); font-size:1.55rem;">${files.length}</strong>
            <span class="stat-meta">Downloadable files</span>
          </article>
        </section>

        <!-- Main Content Grid: Records Table on Left, Files on Right -->
        <div class="results-grid">
          <!-- Left Column: Record Results -->
          <section class="card" style="border-radius:var(--radius-xl); padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem; justify-content:space-between; align-items:center;">
              <div class="card-title-wrap">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <h2 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">${isLoopMode ? 'Record Results' : 'Step Results'}</h2>
                  <span class="badge-tag info" id="resultsCountBadge">${results.length} total</span>
                </div>
                <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.15rem;">Final execution outcome for each record</p>
              </div>

              <!-- Filter Pills for Record Results -->
              <div class="nav-pills" style="display:flex; gap:0.3rem; padding:0.2rem; border-radius:var(--radius-pill);">
                <button class="nav-pill-link active filter-results-btn" data-filter="ALL" style="font-size:0.72rem; padding:0.25rem 0.6rem;">All (${results.length})</button>
                <button class="nav-pill-link filter-results-btn" data-filter="SUCCESS" style="font-size:0.72rem; padding:0.25rem 0.6rem;">Completed (${ok})</button>
                ${fail > 0 ? `<button class="nav-pill-link filter-results-btn" data-filter="FAILED" style="font-size:0.72rem; padding:0.25rem 0.6rem; color:#dc2626;">Failed (${fail})</button>` : ''}
                ${skippedCount > 0 ? `<button class="nav-pill-link filter-results-btn" data-filter="SKIPPED" style="font-size:0.72rem; padding:0.25rem 0.6rem;">Excluded (${skippedCount})</button>` : ''}
              </div>
            </div>

            <!-- Record Items List -->
            <div class="execution-items" id="resultsRecordList" role="list">
              <!-- Rendered via renderRecordItems -->
            </div>
          </section>

          <!-- Right Column: Files Produced by this run -->
          <aside class="card" style="border-radius:var(--radius-xl); padding:1.25rem; display:flex; flex-direction:column;">
            <div class="card-header-row" style="margin-bottom:0.85rem; justify-content:space-between; align-items:center;">
              <div class="card-title-wrap">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <h2 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Files</h2>
                  <span class="badge-tag success" style="font-size:0.62rem;">${files.length}</span>
                </div>
                <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.15rem;">Files generated by this run</p>
              </div>
              <button class="btn btn-secondary btn-xs" id="btnResultsViewAllFiles" title="Open complete files vault" style="font-size:0.7rem;">
                <span>View All Files</span>
              </button>
            </div>

            <div class="results-files" id="resultsFilesList" style="flex:1;">
              <!-- Rendered via renderFilesList -->
            </div>
          </aside>
        </div>

        <!-- Bottom Actions Bar -->
        <section class="card results-actions" style="border-radius:var(--radius-xl); padding:1rem 1.4rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <button class="btn btn-secondary btn-sm" id="btnBottomWorkflows">Back to Workflows</button>
            <button class="btn btn-secondary btn-sm" id="btnBottomFiles">All Files Vault</button>
          </div>
          <button class="btn btn-primary" id="btnBottomRunAgain">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            <span>Run Again</span>
          </button>
        </section>
      </div>

      <!-- File Preview Modal -->
      <div id="resultsPreviewModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="resultsPreviewTitle">
        <div class="modal-dialog" style="max-width:880px; width:95%; max-height:90vh; display:flex; flex-direction:column;">
          <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3 id="resultsPreviewTitle" style="margin:0; font-size:1.1rem; font-weight:800; color:var(--text-main);">File Preview</h3>
              <p id="resultsPreviewSubtitle" style="margin:0.2rem 0 0 0; font-size:0.75rem; color:var(--text-sub); font-family:var(--font-mono);"></p>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btnResultsPreviewDownload">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>Download</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="btnResultsPreviewClose">✕</button>
            </div>
          </div>
          <div class="modal-body" id="resultsPreviewBody" style="padding:1.25rem; overflow-y:auto; flex:1; min-height:300px; max-height:calc(90vh - 120px);">
          </div>
        </div>
      </div>
    `;

    this.renderRecordItems(results, isLoopMode);
    this.renderFilesList(files);
    this.bindResultsEvents(run);
  },

  renderRecordItems(results, isLoopMode) {
    const listEl = document.getElementById('resultsRecordList');
    if (!listEl) return;

    let filtered = results;
    if (this.activeFilter === 'SUCCESS') {
      filtered = results.filter(r => r.status === 'SUCCESS');
    } else if (this.activeFilter === 'FAILED') {
      filtered = results.filter(r => r.status === 'FAILED');
    } else if (this.activeFilter === 'SKIPPED') {
      filtered = results.filter(r => ['SKIPPED_FILTER', 'SKIPPED_LIMIT', 'SKIPPED_DUPLICATE'].includes(r.status));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="execution-item-empty" style="padding:2.5rem; text-align:center; color:var(--text-sub);">
          No records match the selected filter.
        </div>
      `;
      return;
    }

    const rows = filtered.map(item => {
      const idx = Number(item.index || 0);
      const formatted = formatRecordStatus(item.status);
      const title = item.label ? `${isLoopMode ? 'Record' : 'Step'} #${idx} · ${escapeHtml(item.label)}` : `${isLoopMode ? 'Record' : 'Step'} #${idx}`;

      let detailText = '';
      if (item.status === 'SKIPPED_FILTER') {
        detailText = item.skippedReason ? `Filtered out: ${item.skippedReason}` : 'Excluded by record filter conditions';
      } else if (item.status === 'SKIPPED_LIMIT') {
        detailText = item.skippedReason ? `Limit reached: ${item.skippedReason}` : 'Excluded: maximum record limit reached';
      } else if (item.status === 'SKIPPED_DUPLICATE') {
        detailText = item.skippedReason || 'Already processed in previous run';
      } else if (item.status === 'FAILED') {
        detailText = item.error || 'Execution encountered an error';
      } else if (Array.isArray(item.actions)) {
        detailText = `Completed ${item.actions.length} action(s)`;
      } else {
        detailText = 'Completed successfully';
      }

      // Attached file chip
      let fileChip = '';
      if (Array.isArray(item.downloadedFiles) && item.downloadedFiles.length > 0) {
        fileChip = item.downloadedFiles.map(f => {
          const fname = typeof f === 'string' ? f : (f.filename || 'download');
          const relPath = typeof f === 'object' && f.relativePath ? f.relativePath : `downloads/${fname}`;
          return `
            <div style="margin-top:0.4rem; display:inline-flex; align-items:center; gap:0.45rem; padding:0.2rem 0.55rem; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:4px; font-size:0.7rem; color:#065f46;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <strong style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(fname)}</strong>
              <button class="btn btn-xs btn-secondary btn-inline-preview" data-name="${escapeHtml(fname)}" data-path="${escapeHtml(relPath)}" style="padding:0.1rem 0.35rem; font-size:0.62rem;">Preview</button>
              <button class="btn btn-xs btn-primary btn-inline-download" data-name="${escapeHtml(fname)}" data-path="${escapeHtml(relPath)}" style="padding:0.1rem 0.35rem; font-size:0.62rem;">Download</button>
            </div>
          `;
        }).join('');
      }

      return `
        <div class="execution-item-row ${formatted.cls}" role="listitem">
          <span class="execution-item-icon" aria-hidden="true">${formatted.icon}</span>
          <div class="execution-item-copy">
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <strong>${title}</strong>
            </div>
            <span>${escapeHtml(detailText)}</span>
            ${fileChip}
          </div>
          <span class="execution-item-status status-${formatted.cls}">${formatted.label}</span>
        </div>
      `;
    });

    listEl.innerHTML = rows.join('');

    // Wire inline file preview/download
    listEl.querySelectorAll('.btn-inline-preview').forEach(btn => {
      btn.onclick = () => {
        this.openFilePreview(btn.dataset.name, btn.dataset.path);
      };
    });

    listEl.querySelectorAll('.btn-inline-download').forEach(btn => {
      btn.onclick = () => {
        this.downloadFileDirect(btn.dataset.name, btn.dataset.path);
      };
    });
  },

  renderFilesList(files) {
    const listEl = document.getElementById('resultsFilesList');
    if (!listEl) return;

    if (!files || files.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-sub);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-tertiary); display:block; margin:0 auto 0.5rem auto;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          <p style="font-size:0.8rem; font-weight:600; color:var(--text-main); margin-bottom:0.2rem;">No files produced</p>
          <span style="font-size:0.72rem;">This run did not generate any downloaded files or artifacts.</span>
        </div>
      `;
      return;
    }

    const items = files.map((f, i) => {
      const fname = typeof f === 'string' ? f : (f.filename || `file-${i + 1}`);
      const relPath = typeof f === 'object' && (f.relativePath || f.relativeFilePath) ? (f.relativePath || f.relativeFilePath) : `downloads/${fname}`;
      const sizeText = typeof f === 'object' && f.sizeBytes ? formatBytes(f.sizeBytes) : '';
      const itemOrigin = typeof f === 'object' && f.itemKey ? `Record: ${f.itemKey}` : '';

      return `
        <div class="result-file" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.65rem 0.75rem;">
          <div style="min-width:0; flex:1;">
            <strong title="${escapeHtml(fname)}">${escapeHtml(fname)}</strong>
            <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.68rem; color:var(--text-sub); margin-top:0.15rem;">
              ${sizeText ? `<span>${sizeText}</span>` : ''}
              ${itemOrigin ? `<span>${escapeHtml(itemOrigin)}</span>` : ''}
            </span>
          </div>
          <div style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0;">
            <button class="btn btn-xs btn-secondary btn-file-preview" data-name="${escapeHtml(fname)}" data-path="${escapeHtml(relPath)}" title="Preview file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
            <button class="btn btn-xs btn-primary btn-file-download" data-name="${escapeHtml(fname)}" data-path="${escapeHtml(relPath)}" title="Download file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = items.join('');

    // Wire preview & download
    listEl.querySelectorAll('.btn-file-preview').forEach(btn => {
      btn.onclick = () => this.openFilePreview(btn.dataset.name, btn.dataset.path);
    });

    listEl.querySelectorAll('.btn-file-download').forEach(btn => {
      btn.onclick = () => this.downloadFileDirect(btn.dataset.name, btn.dataset.path);
    });
  },

  bindResultsEvents(run) {
    // Filter pills
    this.container.querySelectorAll('.filter-results-btn').forEach(btn => {
      btn.onclick = () => {
        this.container.querySelectorAll('.filter-results-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter || 'ALL';
        const m = run.manifest || {};
        const results = Array.isArray(m.results) ? m.results : [];
        const isLoopMode = (run.mode === 'LOOP') || (run.mode === 'loop') || (m.mode === 'LOOP') || (m.mode === 'loop');
        this.renderRecordItems(results, isLoopMode);
      };
    });

    // Navigation buttons
    document.getElementById('btnResultsBackWorkflows')?.addEventListener('click', () => {
      this.router.navigate('workflows');
    });

    document.getElementById('btnBottomWorkflows')?.addEventListener('click', () => {
      this.router.navigate('workflows');
    });

    document.getElementById('btnResultsViewAllFiles')?.addEventListener('click', () => {
      this.router.navigate('artifacts');
    });

    document.getElementById('btnBottomFiles')?.addEventListener('click', () => {
      this.router.navigate('artifacts');
    });

    // Run Again: Must open ExecutionModal and NOT direct-execute!
    const handleRunAgain = async () => {
      await this.triggerRunAgain(run);
    };

    document.getElementById('btnResultsRunAgain')?.addEventListener('click', handleRunAgain);
    document.getElementById('btnBottomRunAgain')?.addEventListener('click', handleRunAgain);

    // Preview modal close with focus restoration
    const modal = document.getElementById('resultsPreviewModal');
    const btnClose = document.getElementById('resultsPreviewClose');
    const closeModal = () => {
      if (!modal) return;
      modal.classList.add('hidden');
      if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
        this.previousActiveElement.focus();
        this.previousActiveElement = null;
      }
    };
    if (btnClose && modal) {
      btnClose.onclick = closeModal;
      modal.onclick = (e) => {
        if (e.target === modal) closeModal();
      };
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  },

  async triggerRunAgain(run) {
    if (!run || !run.workflowId) {
      Toast.error('Cannot run again: missing workflow reference.');
      return;
    }

    try {
      Toast.info('Preparing workflow run settings…');

      // Attempt to load freshest workflow record
      let wf = null;
      try {
        const wfData = await Api.getWorkflow(run.workflowId);
        wf = wfData.workflow;
      } catch {}

      const stepCount = wf?.steps?.length || run.workflowSteps?.length || 0;
      const isLoop = run.isLoop === true || run.mode === 'LOOP' || run.mode === 'loop' || (Number.isInteger(run.loopStepIndex) && run.loopStepIndex >= 0);
      const loopStepIndex = Number.isInteger(run.loopStepIndex)
        ? run.loopStepIndex
        : (wf?.loopStepIndex ?? 0);

      // Open ExecutionModal with pre-populated run parameters
      ExecutionModal.open({
        workflowId: run.workflowId,
        workflowName: run.workflowName || wf?.name || run.workflowId,
        stepCount,
        loopStepIndex,
        isLoop
      });
    } catch (err) {
      Toast.error('Failed to open execution setup: ' + err.message);
    }
  },

  downloadFileDirect(filename, relativePath) {
    const fileUrl = `/${relativePath}?download=1`;
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    Toast.success(`Downloading ${filename}`);
  },

  async openFilePreview(filename, relativePath) {
    const modal = document.getElementById('resultsPreviewModal');
    const titleEl = document.getElementById('resultsPreviewTitle');
    const subEl = document.getElementById('resultsPreviewSubtitle');
    const bodyEl = document.getElementById('resultsPreviewBody');
    const btnDownload = document.getElementById('btnResultsPreviewDownload');

    if (!modal || !bodyEl) return;

    this.previousActiveElement = document.activeElement;
    titleEl.textContent = filename;
    subEl.textContent = relativePath;

    if (btnDownload) {
      btnDownload.onclick = () => this.downloadFileDirect(filename, relativePath);
    }

    bodyEl.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding:3rem;">
        <div class="discovery-spinner"></div>
      </div>
    `;
    modal.classList.remove('hidden');
    const btnClose = document.getElementById('resultsPreviewClose');
    if (btnClose) btnClose.focus();

    const ext = (filename.split('.').pop() || '').toLowerCase();
    const fileUrl = `/${relativePath}`;

    try {
      if (ext === 'pdf') {
        bodyEl.innerHTML = `
          <div style="height:100%; min-height:550px;">
            <iframe id="resultsPreviewIframe" src="${fileUrl}" style="width:100%; height:550px; border:none; border-radius:8px;" title="${escapeHtml(filename)}" tabindex="-1"></iframe>
          </div>
        `;
        if (btnClose) btnClose.focus();
      } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)) {
        bodyEl.innerHTML = `
          <div style="text-align:center; padding:1rem; background:var(--input-bg); border-radius:8px;">
            <img src="${fileUrl}" alt="${escapeHtml(filename)}" style="max-width:100%; max-height:550px; border-radius:6px; object-fit:contain;">
          </div>
        `;
      } else if (ext === 'csv' || ext === 'tsv') {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: Unable to load CSV content`);
        const text = await res.text();
        const lines = text.trim().split(/\r?\n/).slice(0, 100);
        const delimiter = ext === 'tsv' ? '\t' : ',';
        const rows = lines.map(l => l.split(delimiter));

        if (rows.length === 0) {
          bodyEl.innerHTML = `<p style="text-align:center; color:var(--text-sub); padding:2rem;">The file is empty.</p>`;
          return;
        }

        const head = rows[0];
        const bodyRows = rows.slice(1);

        bodyEl.innerHTML = `
          <div class="table-responsive" style="max-height:500px; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px;">
            <table class="quixotic-table" style="font-size:0.75rem;">
              <thead>
                <tr>${head.map(h => `<th style="background:var(--input-bg);">${escapeHtml(h)}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${bodyRows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else if (ext === 'json') {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: Unable to load JSON content`);
        const jsonText = await res.text();
        let formatted = jsonText;
        try { formatted = JSON.stringify(JSON.parse(jsonText), null, 2); } catch {}
        bodyEl.innerHTML = `
          <pre style="background:#0f172a; color:#f8fafc; padding:1.25rem; border-radius:8px; font-family:var(--font-mono); font-size:0.75rem; max-height:520px; overflow:auto; margin:0;"><code>${escapeHtml(formatted)}</code></pre>
        `;
      } else {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: Unable to load content`);
        const text = await res.text();
        bodyEl.innerHTML = `
          <pre style="background:#0f172a; color:#f8fafc; padding:1.25rem; border-radius:8px; font-family:var(--font-mono); font-size:0.75rem; max-height:520px; overflow:auto; margin:0;"><code>${escapeHtml(text)}</code></pre>
        `;
      }
    } catch (err) {
      bodyEl.innerHTML = `
        <div style="text-align:center; padding:3rem; color:var(--text-sub);">
          <p style="font-weight:700; color:var(--text-main); margin-bottom:0.25rem;">Preview unavailable</p>
          <p style="font-size:0.75rem;">${escapeHtml(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btnResultsFallbackDownload" style="margin-top:1rem;">Download File</button>
        </div>
      `;
      document.getElementById('btnResultsFallbackDownload')?.addEventListener('click', () => {
        this.downloadFileDirect(filename, relativePath);
      });
    }
  }
};