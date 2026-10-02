/**
 * Workflow Capture — Modernized Files View (Artifacts / Downloads Vault)
 * Clean, fast, SaaS-grade file management interface.
 * Shows: File, Type, Size, Created, Workflow, Actions
 * Features:
 * - Search by file name or workflow
 * - Filter by file category (Documents, Spreadsheets, JSON, Media)
 * - Sort: Newest, Oldest, Size, Name
 * - Fast Pagination (15 items / page)
 * - Preview Modal for PDFs, CSVs, JSON, Images
 * - Direct download and ZIP export
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
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, {
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
  sortOrder: 'newest',
  currentPage: 1,
  pageSize: 15,
  files: [],
  filteredFiles: [],
  router: null,

  async render(container, router) {
    this.router = router;

    container.innerHTML = `
      <div class="files-view-shell" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Page Header -->
        <div class="wf-page-header">
          <div>
            <h1 class="wf-page-title">Files</h1>
            <p class="wf-page-subtitle">Documents, spreadsheets, PDFs, and data produced by workflow runs.</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btnExportAllFiles" title="Download all captured files as a consolidated ZIP package">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Export All ZIP</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnRefreshFiles" title="Reload files vault">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <!-- Filter, Search & Sort Toolbar -->
        <div class="wf-toolbar" style="margin-bottom:1.25rem;">
          <!-- Category Filter Pills -->
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
            <button class="nav-pill-link active filter-btn" data-filter="all" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); border-radius:var(--radius-pill); border:none; cursor:pointer;">
              All Files (<span id="countAll">0</span>)
            </button>
            <button class="nav-pill-link filter-btn" data-filter="document" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); border-radius:var(--radius-pill); border:none; cursor:pointer;">
              PDFs &amp; Docs (<span id="countDocs">0</span>)
            </button>
            <button class="nav-pill-link filter-btn" data-filter="dataset" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); border-radius:var(--radius-pill); border:none; cursor:pointer;">
              Spreadsheets (<span id="countDatasets">0</span>)
            </button>
            <button class="nav-pill-link filter-btn" data-filter="json" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); border-radius:var(--radius-pill); border:none; cursor:pointer;">
              JSON (<span id="countJson">0</span>)
            </button>
            <button class="nav-pill-link filter-btn" data-filter="media" style="padding:0.35rem 0.75rem; font-size:var(--text-xs); border-radius:var(--radius-pill); border:none; cursor:pointer;">
              Media (<span id="countMedia">0</span>)
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; margin-left:auto;">
            <!-- Search Input -->
            <div class="search-input-wrap" style="width:240px;">
              <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="inputSearchFiles" class="search-input" placeholder="Search files…" aria-label="Search files">
            </div>

            <!-- Sort Dropdown -->
            <select id="selectSortFiles" class="form-control" style="font-size:var(--text-xs); height:34px; padding:0 0.5rem; width:130px;">
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="size">Largest Size</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>

        <!-- Files Table Card -->
        <div class="card" style="padding:1.25rem; border-radius:var(--radius-lg);">
          <div class="table-responsive">
            <table class="data-table" style="width:100%; border-collapse:collapse;" aria-label="Files vault">
              <thead>
                <tr style="border-bottom:1px solid var(--border-light); text-align:left;">
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">File</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Type</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Size</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Created</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Workflow</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub); text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="filesTableBody">
                <tr>
                  <td colspan="6" style="text-align:center; padding:3rem 1.5rem; color:var(--text-muted); font-size:var(--text-sm);">
                    Loading files vault…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination Footer -->
          <div id="filesPaginationRow" style="display:flex; justify-content:space-between; align-items:center; padding-top:1rem; margin-top:0.5rem; border-top:1px solid var(--border-subtle); font-size:var(--text-xs); color:var(--text-sub);">
            <span id="filesPaginationInfo">Showing 0 of 0 files</span>
            <div style="display:flex; gap:0.4rem;">
              <button class="btn btn-secondary btn-xs" id="btnPagePrev" disabled>Previous</button>
              <button class="btn btn-secondary btn-xs" id="btnPageNext" disabled>Next</button>
            </div>
          </div>
        </div>

      </div>

      <!-- File Preview Modal -->
      <div id="filePreviewModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="filePreviewModalTitle" style="z-index:9999;">
        <div class="modal-dialog" style="max-width:880px; width:95%; max-height:90vh; display:flex; flex-direction:column; background:var(--bg-surface); border-radius:var(--radius-lg); border:1px solid var(--border-light); padding:1.25rem;">
          <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:0.75rem; margin-bottom:1rem;">
            <div>
              <h3 id="filePreviewModalTitle" style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text-primary);">File Preview</h3>
              <p id="filePreviewModalSubtitle" style="margin:0.2rem 0 0 0; font-size:var(--text-2xs); color:var(--text-sub); font-family:var(--font-mono);"></p>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-primary btn-sm" id="btnFilePreviewDownload">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>Download</span>
              </button>
              <button class="btn-icon" id="btnFilePreviewClose" title="Close">✕</button>
            </div>
          </div>
          <div class="modal-body" id="filePreviewModalBody" style="padding:0; overflow-y:auto; flex:1; min-height:300px; max-height:calc(90vh - 120px);">
          </div>
        </div>
      </div>
    `;

    this.bindEvents(router);
    await this.loadData();
  },

  bindEvents(router) {
    const inputSearch = document.getElementById('inputSearchFiles');
    if (inputSearch) {
      inputSearch.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.currentPage = 1;
        this.filterAndRender();
      };
    }

    const sortSelect = document.getElementById('selectSortFiles');
    if (sortSelect) {
      sortSelect.onchange = (e) => {
        this.sortOrder = e.target.value;
        this.filterAndRender();
      };
    }

    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.onclick = () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.style.background = 'transparent';
          b.style.color = 'var(--text-sub)';
        });
        btn.classList.add('active');
        btn.style.background = 'var(--accent-subtle)';
        btn.style.color = 'var(--accent-primary)';
        this.activeFilter = btn.dataset.filter;
        this.currentPage = 1;
        this.filterAndRender();
      };
    });

    const btnRefresh = document.getElementById('btnRefreshFiles');
    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadData();
    }

    const btnExport = document.getElementById('btnExportAllFiles');
    if (btnExport) {
      btnExport.onclick = () => {
        window.location.href = '/api/downloads/export-all';
        Toast.info('Preparing and downloading ZIP bundle…');
      };
    }

    // Pagination buttons
    const btnPrev = document.getElementById('btnPagePrev');
    const btnNext = document.getElementById('btnPageNext');
    if (btnPrev) {
      btnPrev.onclick = () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderTable();
        }
      };
    }
    if (btnNext) {
      btnNext.onclick = () => {
        const totalPages = Math.ceil(this.filteredFiles.length / this.pageSize);
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.renderTable();
        }
      };
    }

    // Modal Close
    const modal = document.getElementById('filePreviewModal');
    const btnCloseModal = document.getElementById('btnFilePreviewClose');
    if (btnCloseModal && modal) {
      btnCloseModal.onclick = () => modal.classList.add('hidden');
    }
  },

  async loadData() {
    try {
      const [dlRes, wfRes] = await Promise.allSettled([
        Api.getDownloads(),
        Api.getWorkflows().catch(() => ({ workflows: [] }))
      ]);

      const rawDownloads = dlRes.status === 'fulfilled' && dlRes.value?.downloads ? dlRes.value.downloads : [];
      const workflows = wfRes.status === 'fulfilled' && wfRes.value?.workflows ? wfRes.value.workflows : [];

      const wfMap = new Map();
      workflows.forEach(w => {
        if (w.id) wfMap.set(w.id, w.name);
      });

      this.files = rawDownloads.map(d => {
        const fname = d.filename || d.originalFilename || 'file';
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
          downloadedAt: d.downloadedAt || '',
          formattedDate: formatDate(d.downloadedAt),
          fileExists: d.fileExists !== false
        };
      });

      this.updateCounts();
      this.filterAndRender();
    } catch (err) {
      console.error('Failed to load files:', err);
    }
  },

  updateCounts() {
    const setTxt = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    setTxt('countAll', this.files.length);
    setTxt('countDocs', this.files.filter(f => f.category === 'document').length);
    setTxt('countDatasets', this.files.filter(f => f.category === 'dataset').length);
    setTxt('countJson', this.files.filter(f => f.category === 'json').length);
    setTxt('countMedia', this.files.filter(f => f.category === 'media').length);
  },

  filterAndRender() {
    let result = [...this.files];

    // Category filter
    if (this.activeFilter !== 'all') {
      result = result.filter(f => f.category === this.activeFilter);
    }

    // Search query
    if (this.searchQuery) {
      result = result.filter(f =>
        f.name.toLowerCase().includes(this.searchQuery) ||
        f.workflowName.toLowerCase().includes(this.searchQuery) ||
        f.type.toLowerCase().includes(this.searchQuery)
      );
    }

    // Sort
    if (this.sortOrder === 'newest') {
      result.sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt));
    } else if (this.sortOrder === 'oldest') {
      result.sort((a, b) => new Date(a.downloadedAt) - new Date(b.downloadedAt));
    } else if (this.sortOrder === 'size') {
      result.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
    } else if (this.sortOrder === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    this.filteredFiles = result;
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById('filesTableBody');
    if (!tbody) return;

    if (this.filteredFiles.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding:3.5rem 1.5rem; text-align:center;">
            <div class="modern-empty-state" style="border:none; padding:1rem 0;">
              <div class="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              </div>
              <h3 class="empty-state-title">No files found</h3>
              <p class="empty-state-desc">Generated files and documents produced during automation runs will appear here.</p>
            </div>
          </td>
        </tr>
      `;
      this.updatePagination(0, 0);
      return;
    }

    const startIndex = (this.currentPage - 1) * this.pageSize;
    const paginated = this.filteredFiles.slice(startIndex, startIndex + this.pageSize);

    tbody.innerHTML = paginated.map(file => {
      let typeBadgeCls = 'info';
      if (file.type === 'pdf') typeBadgeCls = 'danger';
      else if (file.type === 'csv' || file.type === 'xlsx') typeBadgeCls = 'success';
      else if (file.type === 'json') typeBadgeCls = 'amber';

      return `
        <tr style="border-bottom:1px solid var(--border-subtle); transition:background-color 0.15s ease;">
          <td style="padding:0.85rem 1rem;">
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <div style="width:30px; height:30px; border-radius:var(--radius-sm); background:var(--bg-surface-sunken); border:1px solid var(--border-light); display:flex; align-items:center; justify-content:center; color:var(--accent-primary); flex-shrink:0;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              </div>
              <div style="min-width:0;">
                <strong style="font-size:var(--text-sm); color:var(--text-primary); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:280px;" title="${esc(file.name)}">
                  ${esc(file.name)}
                </strong>
                <span class="mono" style="font-size:var(--text-2xs); color:var(--text-muted);">${esc(file.relativeFilePath)}</span>
              </div>
            </div>
          </td>
          <td style="padding:0.85rem 1rem;">
            <span class="badge-tag ${typeBadgeCls}" style="font-size:var(--text-2xs); text-transform:uppercase;">${esc(file.type)}</span>
          </td>
          <td style="padding:0.85rem 1rem; font-family:var(--font-mono); font-size:var(--text-xs); color:var(--text-secondary);">
            ${file.formattedSize}
          </td>
          <td style="padding:0.85rem 1rem; font-size:var(--text-xs); color:var(--text-sub);">
            ${file.formattedDate}
          </td>
          <td style="padding:0.85rem 1rem;">
            <div style="font-size:var(--text-xs); font-weight:600; color:var(--text-secondary);">${esc(file.workflowName)}</div>
            ${file.runId && file.runId !== '—' ? `<a href="#execution/${encodeURIComponent(file.runId)}" class="mono" style="font-size:var(--text-2xs); color:var(--accent-primary); text-decoration:none;">#${esc(file.runId.slice(0, 8))}</a>` : ''}
          </td>
          <td style="padding:0.85rem 1rem; text-align:right;">
            <div style="display:flex; justify-content:flex-end; gap:0.4rem;">
              <button class="btn btn-secondary btn-xs btn-preview-file" data-id="${esc(file.id)}" title="Preview file content">Preview</button>
              <a href="/api/downloads/${encodeURIComponent(file.id)}/file" class="btn btn-primary btn-xs" download title="Download file">Download</a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind preview buttons
    tbody.querySelectorAll('.btn-preview-file').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const file = this.files.find(f => f.id === id);
        if (file) this.openPreviewModal(file);
      };
    });

    this.updatePagination(startIndex + 1, Math.min(startIndex + this.pageSize, this.filteredFiles.length));
  },

  updatePagination(from, to) {
    const info = document.getElementById('filesPaginationInfo');
    const btnPrev = document.getElementById('btnPagePrev');
    const btnNext = document.getElementById('btnPageNext');
    const total = this.filteredFiles.length;

    if (info) {
      info.textContent = total > 0 ? `Showing ${from}–${to} of ${total} files` : 'Showing 0 of 0 files';
    }
    const totalPages = Math.ceil(total / this.pageSize);
    if (btnPrev) btnPrev.disabled = this.currentPage <= 1;
    if (btnNext) btnNext.disabled = this.currentPage >= totalPages || totalPages === 0;
  },

  openPreviewModal(file) {
    const modal = document.getElementById('filePreviewModal');
    const title = document.getElementById('filePreviewModalTitle');
    const subtitle = document.getElementById('filePreviewModalSubtitle');
    const body = document.getElementById('filePreviewModalBody');
    const btnDownload = document.getElementById('btnFilePreviewDownload');

    if (!modal) return;
    title.textContent = file.name;
    subtitle.textContent = `${file.formattedSize} · ${file.workflowName}`;
    btnDownload.onclick = () => {
      window.location.href = `/api/downloads/${encodeURIComponent(file.id)}/file`;
    };

    body.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; height:320px; background:var(--bg-surface-sunken); border-radius:var(--radius-md); border:1px solid var(--border-light);">
        <iframe src="/api/downloads/${encodeURIComponent(file.id)}/file" style="width:100%; height:100%; border:none; border-radius:var(--radius-md);" title="File Preview"></iframe>
      </div>
    `;

    modal.classList.remove('hidden');
  }
};
