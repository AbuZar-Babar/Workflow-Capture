/**
 * Workflow Capture — Extracted Artifacts & Scraped Data Vault
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
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

function getFileCategory(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(ext)) return 'document';
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return 'dataset';
  if (['json'].includes(ext)) return 'json';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)) return 'media';
  return 'document';
}

function getFileType(filename) {
  return (filename.split('.').pop() || 'file').toLowerCase();
}

export const ArtifactsView = {
  activeFilter: 'all',
  searchQuery: '',
  artifacts: [],
  workflows: [],
  isLoading: false,

  async render(container, router) {
    this.router = router;
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:1.25rem;">
        
        <!-- Header Controls Row -->
        <div class="workflows-header-controls" style="background:#ffffff; padding:1.25rem 1.5rem; border-radius:var(--radius-xl); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <div style="display:flex; align-items:center; gap:0.65rem;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-forest);"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              <h2 style="font-size:1.25rem; font-weight:800; color:var(--text-main); letter-spacing:-0.02em;">Scraped Data & Artifacts Vault</h2>
            </div>
            <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.2rem;">Collected documents, spreadsheets, PDFs, and extraction manifests from automated loop runs</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem;">
            <button class="btn btn-secondary btn-sm" id="btnExportAllArtifacts" title="Download all captured artifacts as a consolidated ZIP file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Export All ZIP</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnRefreshArtifacts" title="Reload artifacts vault from storage">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              <span>Refresh Vault</span>
            </button>
          </div>
        </div>

        <!-- Metrics Overview Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem;">
          
          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Total Artifacts</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-forest);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalArtifacts">—</p>
            <small style="font-size:0.68rem; color:var(--brand-forest); font-weight:600;">Persisted with SHA-256 integrity</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Storage Volume</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-forest);"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalSize">—</p>
            <small style="font-size:0.68rem; color:var(--text-sub);">Zero-duplication storage</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Origin Workflows</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-forest);"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalWorkflows">—</p>
            <small style="font-size:0.68rem; color:var(--brand-forest); font-weight:600;">Active automated pipelines</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Storage Target</span>
              <button id="btnCopyStoragePath" class="btn btn-xs btn-secondary" style="font-size:0.65rem; padding:0.15rem 0.45rem;" title="Copy relative path">Copy</button>
            </div>
            <p style="font-size:0.85rem; font-weight:800; color:var(--text-main); font-family:var(--font-mono); margin-top:0.35rem; word-break:break-all;">downloads/</p>
            <small style="font-size:0.68rem; color:var(--text-sub);">Structured per workflow &amp; date</small>
          </div>

        </div>

        <!-- Filter & Search Toolbar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          
          <div style="display:flex; gap:0.35rem; background:#ffffff; padding:0.3rem; border-radius:var(--radius-pill); border:1px solid rgba(0,0,0,0.06); flex-wrap:wrap;">
            <button class="nav-pill-link active filter-btn" data-filter="all">All Formats (<span id="countAll">0</span>)</button>
            <button class="nav-pill-link filter-btn" data-filter="document" style="display:inline-flex; align-items:center; gap:0.35rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
              <span>PDFs &amp; Docs (<span id="countDocs">0</span>)</span>
            </button>
            <button class="nav-pill-link filter-btn" data-filter="dataset" style="display:inline-flex; align-items:center; gap:0.35rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              <span>CSV &amp; Excel (<span id="countDatasets">0</span>)</span>
            </button>
            <button class="nav-pill-link filter-btn" data-filter="json" style="display:inline-flex; align-items:center; gap:0.35rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
              <span>JSON Data (<span id="countJson">0</span>)</span>
            </button>
            <button class="nav-pill-link filter-btn" data-filter="media" style="display:inline-flex; align-items:center; gap:0.35rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              <span>Media (<span id="countMedia">0</span>)</span>
            </button>
          </div>

          <div class="search-input-wrap" style="max-width:340px; width:100%;">
            <span class="search-icon-pos" style="display:flex; align-items:center;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input type="text" id="inputSearchArtifacts" class="form-control" placeholder="Search files, workflows, item keys, hashes...">
          </div>

        </div>

        <!-- Artifacts Table Card -->
        <div class="card" style="background:#ffffff; border-radius:var(--radius-xl); border:1px solid rgba(0,0,0,0.06); padding:1.25rem; box-shadow:var(--shadow-card);">
          <div class="table-responsive">
            <table class="quixotic-table">
              <thead>
                <tr>
                  <th>File Name &amp; Item</th>
                  <th>Origin Workflow</th>
                  <th>Format &amp; Size</th>
                  <th>SHA-256 Checksum</th>
                  <th>Extraction Time</th>
                  <th>Status</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="artifactsTableBody">
                <tr>
                  <td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-sub);">
                    <div class="discovery-spinner" style="margin:0 auto 0.75rem auto;"></div>
                    Loading artifacts vault…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Preview Modal -->
      <div id="artifactPreviewModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="previewModalTitle">
        <div class="modal-dialog" style="max-width:880px; width:95%; max-height:90vh; display:flex; flex-direction:column;">
          <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3 id="previewModalTitle" style="margin:0; font-size:1.1rem; font-weight:800; color:var(--text-main);">Artifact Preview</h3>
              <p id="previewModalSubtitle" style="margin:0.2rem 0 0 0; font-size:0.75rem; color:var(--text-sub); font-family:var(--font-mono);"></p>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btnPreviewDownload">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>Download</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="btnPreviewClose">✕</button>
            </div>
          </div>
          <div class="modal-body" id="previewModalBody" style="padding:1.25rem; overflow-y:auto; flex:1; min-height:300px; max-height:calc(90vh - 120px);">
            <!-- Dynamic Preview Content -->
          </div>
        </div>
      </div>
    `;

    this.bindEvents(router);
    await this.loadData();
  },

  bindEvents(router) {
    const inputSearch = document.getElementById('inputSearchArtifacts');
    if (inputSearch) {
      inputSearch.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderTable();
      };
    }

    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.onclick = () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.renderTable();
      };
    });

    const btnRefresh = document.getElementById('btnRefreshArtifacts');
    if (btnRefresh) {
      btnRefresh.onclick = async () => {
        btnRefresh.classList.add('btn-loading');
        Toast.info('Refreshing artifacts vault...');
        await this.loadData();
        btnRefresh.classList.remove('btn-loading');
        Toast.success('Artifacts vault is up-to-date!');
      };
    }

    const btnExport = document.getElementById('btnExportAllArtifacts');
    if (btnExport) {
      btnExport.onclick = async () => {
        if (!this.artifacts.length) {
          Toast.warning('No artifacts available to export.');
          return;
        }
        try {
          btnExport.classList.add('btn-loading');
          Toast.info('Preparing consolidated ZIP package...');
          await Api.exportDownloads();
          Toast.success('Consolidated archive downloaded successfully!');
        } catch (err) {
          Toast.error(err.message || 'Failed to export artifacts');
        } finally {
          btnExport.classList.remove('btn-loading');
        }
      };
    }

    const btnCopyPath = document.getElementById('btnCopyStoragePath');
    if (btnCopyPath) {
      btnCopyPath.onclick = () => {
        navigator.clipboard.writeText('downloads/');
        Toast.info('Path "downloads/" copied to clipboard');
      };
    }

    // Modal close events
    const modal = document.getElementById('artifactPreviewModal');
    const btnClose = document.getElementById('btnPreviewClose');
    if (btnClose && modal) {
      btnClose.onclick = () => modal.classList.add('hidden');
      modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      };
    }
  },

  async loadData() {
    this.isLoading = true;
    try {
      const [dlRes, wfRes] = await Promise.allSettled([
        Api.getDownloads(),
        Api.getRecordings().catch(() => ({ recordings: [] }))
      ]);

      const rawDownloads = dlRes.status === 'fulfilled' && dlRes.value?.downloads ? dlRes.value.downloads : [];
      const recordings = wfRes.status === 'fulfilled' && wfRes.value?.recordings ? wfRes.value.recordings : [];

      const wfMap = new Map();
      recordings.forEach(r => {
        if (r.id) wfMap.set(r.id, r.name);
        if (r.name) wfMap.set(r.name, r.name);
      });

      this.artifacts = rawDownloads.map(d => {
        const fname = d.filename || d.originalFilename || 'artifact';
        const type = getFileType(fname);
        const category = getFileCategory(fname);
        return {
          id: d.id,
          name: fname,
          originalName: d.originalFilename || fname,
          type,
          category,
          relativeFilePath: d.relativeFilePath || `downloads/${fname}`,
          sizeBytes: d.fileSizeBytes || 0,
          formattedSize: formatBytes(d.fileSizeBytes || 0),
          workflowId: d.workflowId || '—',
          workflowName: d.workflowName || wfMap.get(d.workflowId) || d.workflowId || 'Workflow',
          runId: d.runId || '—',
          itemKey: d.itemKey || '',
          itemLabel: d.itemLabel || '',
          sha256: d.sha256 || '',
          downloadedAt: d.downloadedAt || '',
          formattedDate: formatDate(d.downloadedAt),
          fileExists: d.fileExists !== false
        };
      });

      this.updateMetrics();
      this.updateCounts();
      this.renderTable();
    } catch (err) {
      console.error('[Artifacts] Load error:', err);
      Toast.error('Failed to load artifacts: ' + err.message);
      const tbody = document.getElementById('artifactsTableBody');
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-sub);">
              <p style="color:#ef4444; font-weight:700;">Unable to load artifacts</p>
              <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.25rem;">${esc(err.message)}</p>
              <button class="btn btn-secondary btn-sm" id="btnRetryArtifacts" style="margin-top:0.75rem;">Retry</button>
            </td>
          </tr>
        `;
        document.getElementById('btnRetryArtifacts')?.addEventListener('click', () => this.loadData());
      }
    } finally {
      this.isLoading = false;
    }
  },

  updateMetrics() {
    const elTotal = document.getElementById('statTotalArtifacts');
    const elSize = document.getElementById('statTotalSize');
    const elWf = document.getElementById('statTotalWorkflows');

    if (!elTotal) return;

    const totalCount = this.artifacts.length;
    const totalBytes = this.artifacts.reduce((acc, a) => acc + (a.sizeBytes || 0), 0);
    const uniqueWfs = new Set(this.artifacts.map(a => a.workflowName).filter(Boolean)).size;

    elTotal.textContent = `${totalCount} ${totalCount === 1 ? 'File' : 'Files'}`;
    elSize.textContent = formatBytes(totalBytes);
    elWf.textContent = `${uniqueWfs} ${uniqueWfs === 1 ? 'Workflow' : 'Workflows'}`;
  },

  updateCounts() {
    const countAll = document.getElementById('countAll');
    const countDocs = document.getElementById('countDocs');
    const countDatasets = document.getElementById('countDatasets');
    const countJson = document.getElementById('countJson');
    const countMedia = document.getElementById('countMedia');

    if (!countAll) return;

    countAll.textContent = this.artifacts.length;
    countDocs.textContent = this.artifacts.filter(a => a.category === 'document').length;
    countDatasets.textContent = this.artifacts.filter(a => a.category === 'dataset').length;
    countJson.textContent = this.artifacts.filter(a => a.category === 'json').length;
    countMedia.textContent = this.artifacts.filter(a => a.category === 'media').length;
  },

  renderTable() {
    const tbody = document.getElementById('artifactsTableBody');
    if (!tbody) return;

    let filtered = this.artifacts.filter(art => {
      const matchesFilter = this.activeFilter === 'all' || art.category === this.activeFilter;
      const matchesSearch = !this.searchQuery || 
        art.name.toLowerCase().includes(this.searchQuery) ||
        art.originalName.toLowerCase().includes(this.searchQuery) ||
        art.workflowName.toLowerCase().includes(this.searchQuery) ||
        art.itemKey.toLowerCase().includes(this.searchQuery) ||
        art.itemLabel.toLowerCase().includes(this.searchQuery) ||
        art.sha256.toLowerCase().includes(this.searchQuery) ||
        art.runId.toLowerCase().includes(this.searchQuery) ||
        art.type.toLowerCase().includes(this.searchQuery);
      return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
      if (this.artifacts.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:3.5rem 1.5rem; color:var(--text-sub);">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-tertiary); display:block; margin:0 auto 1rem auto;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:0.35rem;">No artifacts extracted yet</h4>
              <p style="font-size:0.75rem; color:var(--text-sub); max-width:420px; margin:0 auto 1.25rem auto;">
                When you run a workflow with repetitive loop iterations (such as downloading monthly invoices or exporting tables), all files and metadata will be indexed here automatically.
              </p>
              <button class="btn btn-primary btn-sm" id="btnEmptyExploreWorkflows">Explore Workflows</button>
            </td>
          </tr>
        `;
        document.getElementById('btnEmptyExploreWorkflows')?.addEventListener('click', () => {
          this.router.navigate('workflows');
        });
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-sub);">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-tertiary); display:block; margin:0 auto 0.75rem auto;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              No artifacts match your filter or search query.
              <div style="margin-top:0.75rem;">
                <button class="btn btn-secondary btn-xs" id="btnResetFilters">Reset Filters</button>
              </div>
            </td>
          </tr>
        `;
        document.getElementById('btnResetFilters')?.addEventListener('click', () => {
          this.activeFilter = 'all';
          this.searchQuery = '';
          const searchInput = document.getElementById('inputSearchArtifacts');
          if (searchInput) searchInput.value = '';
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
          this.renderTable();
        });
      }
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach(art => {
      const tr = document.createElement('tr');
      
      let typeBadgeClass = 'info';
      let iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
      
      if (art.type === 'pdf') {
        typeBadgeClass = 'danger';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line></svg>`;
      } else if (art.type === 'csv' || art.type === 'tsv') {
        typeBadgeClass = 'success';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line><line x1="12" y1="9" x2="12" y2="21"></line></svg>`;
      } else if (art.type === 'xlsx' || art.type === 'xls') {
        typeBadgeClass = 'success';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
      } else if (art.type === 'json') {
        typeBadgeClass = 'amber';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
      } else if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(art.type)) {
        typeBadgeClass = 'info';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
      }

      const shortSha = art.sha256 ? `${art.sha256.substring(0, 6)}...${art.sha256.substring(art.sha256.length - 4)}` : '—';
      const itemSubLabel = art.itemLabel || art.itemKey || art.originalName;

      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="display:flex; align-items:center; flex-shrink:0;">${iconSvg}</span>
            <div style="min-width:0;">
              <strong style="font-size:0.8rem; color:var(--text-main); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:260px;" title="${esc(art.name)}">
                ${esc(art.name)}
              </strong>
              <small style="font-size:0.68rem; color:var(--text-sub); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:260px;" title="${esc(itemSubLabel)}">
                ${esc(itemSubLabel)}
              </small>
            </div>
          </div>
        </td>
        <td>
          <span style="font-size:0.75rem; font-weight:700; color:var(--text-main); display:block;">${esc(art.workflowName)}</span>
          <small style="font-size:0.65rem; color:var(--text-sub); font-family:var(--font-mono);">${esc(art.runId)}</small>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <span class="badge-tag ${typeBadgeClass}">${art.type.toUpperCase()}</span>
            <span style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-sub);">${art.formattedSize}</span>
          </div>
        </td>
        <td>
          <div style="display:inline-flex; align-items:center; gap:0.35rem;">
            <span style="font-size:0.72rem; font-family:var(--font-mono); color:var(--text-sub);" title="Full SHA-256: ${esc(art.sha256)}">${shortSha}</span>
            ${art.sha256 ? `<button class="btn btn-xs btn-secondary btn-copy-hash" data-hash="${esc(art.sha256)}" title="Copy full SHA-256 hash" style="padding:0.1rem 0.35rem; font-size:0.62rem;">Copy</button>` : ''}
          </div>
        </td>
        <td>
          <span style="font-size:0.72rem; color:var(--text-sub);">${art.formattedDate}</span>
        </td>
        <td>
          ${art.fileExists 
            ? `<span class="badge-tag success" style="font-size:0.65rem;">VERIFIED</span>` 
            : `<span class="badge-tag danger" style="font-size:0.65rem;" title="File not found in local downloads folder">MISSING</span>`}
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:0.35rem;">
            <button class="btn btn-sm btn-secondary btn-action-preview" data-id="${art.id}" title="Preview content">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
            <button class="btn btn-sm btn-primary btn-action-download" data-id="${art.id}" title="Download file">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button class="btn btn-sm btn-secondary btn-action-delete" data-id="${art.id}" title="Delete artifact" style="color:#ef4444;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Wire Copy Hash Buttons
    tbody.querySelectorAll('.btn-copy-hash').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const hash = btn.dataset.hash;
        if (hash) {
          navigator.clipboard.writeText(hash);
          Toast.info('SHA-256 hash copied to clipboard');
        }
      };
    });

    // Wire Preview Buttons
    tbody.querySelectorAll('.btn-action-preview').forEach(btn => {
      btn.onclick = () => {
        const item = this.artifacts.find(a => a.id === btn.dataset.id);
        if (item) this.openPreview(item);
      };
    });

    // Wire Download Buttons
    tbody.querySelectorAll('.btn-action-download').forEach(btn => {
      btn.onclick = () => {
        const item = this.artifacts.find(a => a.id === btn.dataset.id);
        if (item) this.downloadArtifact(item);
      };
    });

    // Wire Delete Buttons
    tbody.querySelectorAll('.btn-action-delete').forEach(btn => {
      btn.onclick = async () => {
        const item = this.artifacts.find(a => a.id === btn.dataset.id);
        if (!item) return;
        if (!confirm(`Are you sure you want to delete artifact "${item.name}" from disk and database?`)) {
          return;
        }
        try {
          await Api.deleteDownload(item.id);
          this.artifacts = this.artifacts.filter(a => a.id !== item.id);
          this.updateMetrics();
          this.updateCounts();
          this.renderTable();
          Toast.success(`Deleted ${item.name}`);
        } catch (err) {
          Toast.error(err.message || 'Failed to delete artifact');
        }
      };
    });
  },

  downloadArtifact(art) {
    if (!art.fileExists) {
      Toast.warning('File is no longer present on disk at ' + art.relativeFilePath);
      return;
    }
    const fileUrl = `/${art.relativeFilePath}?download=1`;
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = art.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    Toast.success(`Downloading ${art.name} (${art.formattedSize})`);
  },

  async openPreview(art) {
    const modal = document.getElementById('artifactPreviewModal');
    const titleEl = document.getElementById('previewModalTitle');
    const subEl = document.getElementById('previewModalSubtitle');
    const bodyEl = document.getElementById('previewModalBody');
    const btnDownload = document.getElementById('btnPreviewDownload');

    if (!modal || !bodyEl) return;

    titleEl.textContent = art.name;
    subEl.textContent = `${art.workflowName} · ${art.formattedSize} · ${art.relativeFilePath}`;

    if (btnDownload) {
      btnDownload.onclick = () => this.downloadArtifact(art);
    }

    bodyEl.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding:3rem;">
        <div class="discovery-spinner"></div>
      </div>
    `;
    modal.classList.remove('hidden');

    const fileUrl = `/${art.relativeFilePath}`;

    try {
      if (art.type === 'pdf') {
        bodyEl.innerHTML = `
          <div style="height:100%; min-height:550px;">
            <iframe src="${fileUrl}" style="width:100%; height:550px; border:none; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08);" title="${esc(art.name)}"></iframe>
          </div>
        `;
      } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(art.type)) {
        bodyEl.innerHTML = `
          <div style="text-align:center; padding:1rem; background:#f8fafc; border-radius:8px;">
            <img src="${fileUrl}" alt="${esc(art.name)}" style="max-width:100%; max-height:550px; border-radius:6px; object-fit:contain; box-shadow:0 4px 14px rgba(0,0,0,0.08);">
          </div>
        `;
      } else if (art.type === 'csv' || art.type === 'tsv') {
        const textRes = await fetch(fileUrl);
        if (!textRes.ok) throw new Error(`HTTP ${textRes.status}: Unable to load CSV content`);
        const csvText = await textRes.text();
        const rows = csvText.trim().split(/\r?\n/).map(r => {
          // Basic CSV quote-safe splitter
          const cols = [];
          let cur = '';
          let inQuotes = false;
          for (let i = 0; i < r.length; i++) {
            const char = r[i];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === (art.type === 'tsv' ? '\t' : ',') && !inQuotes) {
              cols.push(cur);
              cur = '';
            } else {
              cur += char;
            }
          }
          cols.push(cur);
          return cols;
        });

        if (rows.length === 0) {
          bodyEl.innerHTML = `<p style="color:var(--text-sub); text-align:center; padding:2rem;">The file is empty.</p>`;
          return;
        }

        const headerRow = rows[0];
        const dataRows = rows.slice(1, 100); // Preview up to 100 rows

        bodyEl.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-sub);">
              <span>Showing preview of ${dataRows.length} rows (${rows.length - 1} total)</span>
              <span>Delimiter: ${art.type === 'tsv' ? 'Tab' : 'Comma'}</span>
            </div>
            <div class="table-responsive" style="max-height:500px; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px;">
              <table class="quixotic-table" style="font-size:0.75rem;">
                <thead>
                  <tr>
                    ${headerRow.map(h => `<th style="background:#f8fafc; font-weight:700;">${esc(h)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${dataRows.map(row => `
                    <tr>
                      ${row.map(c => `<td>${esc(c)}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } else if (art.type === 'json') {
        const textRes = await fetch(fileUrl);
        if (!textRes.ok) throw new Error(`HTTP ${textRes.status}: Unable to load JSON content`);
        const jsonText = await textRes.text();
        let formatted = jsonText;
        try {
          formatted = JSON.stringify(JSON.parse(jsonText), null, 2);
        } catch {}

        bodyEl.innerHTML = `
          <div style="position:relative;">
            <button class="btn btn-xs btn-secondary" id="btnCopyJsonContent" style="position:absolute; top:0.75rem; right:0.75rem; z-index:2;">Copy JSON</button>
            <pre style="background:#0f172a; color:#f8fafc; padding:1.25rem; border-radius:8px; font-family:var(--font-mono); font-size:0.75rem; max-height:520px; overflow:auto; margin:0;"><code>${esc(formatted)}</code></pre>
          </div>
        `;
        document.getElementById('btnCopyJsonContent')?.addEventListener('click', () => {
          navigator.clipboard.writeText(formatted);
          Toast.info('JSON content copied to clipboard');
        });
      } else {
        // Plain text or fallback
        const textRes = await fetch(fileUrl);
        if (!textRes.ok) throw new Error(`HTTP ${textRes.status}: Unable to preview file content`);
        const text = await textRes.text();

        bodyEl.innerHTML = `
          <div style="position:relative;">
            <button class="btn btn-xs btn-secondary" id="btnCopyTextContent" style="position:absolute; top:0.75rem; right:0.75rem; z-index:2;">Copy</button>
            <pre style="background:#0f172a; color:#f8fafc; padding:1.25rem; border-radius:8px; font-family:var(--font-mono); font-size:0.75rem; max-height:520px; overflow:auto; margin:0;"><code>${esc(text)}</code></pre>
          </div>
        `;
        document.getElementById('btnCopyTextContent')?.addEventListener('click', () => {
          navigator.clipboard.writeText(text);
          Toast.info('Content copied to clipboard');
        });
      }
    } catch (err) {
      bodyEl.innerHTML = `
        <div style="text-align:center; padding:3rem; color:var(--text-sub);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="display:block; margin:0 auto 0.75rem auto;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p style="font-weight:700; color:var(--text-main); margin-bottom:0.25rem;">Preview unavailable</p>
          <p style="font-size:0.75rem;">${esc(err.message)}</p>
          <button class="btn btn-primary btn-sm" id="btnFallbackDownload" style="margin-top:1rem;">Download Instead</button>
        </div>
      `;
      document.getElementById('btnFallbackDownload')?.addEventListener('click', () => this.downloadArtifact(art));
    }
  }
};
