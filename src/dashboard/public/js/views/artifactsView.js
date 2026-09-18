/**
 * Workflow Capture — Extracted Artifacts & Scraped Data Vault
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const ArtifactsView = {
  activeFilter: 'all',
  searchQuery: '',

  mockArtifacts: [
    {
      id: 'art_001',
      name: 'monthly_invoice_sep_2026.pdf',
      type: 'pdf',
      category: 'document',
      size: '342 KB',
      workflow: 'Stratos CRM Invoicing',
      runId: 'run_1789640123559',
      extractedAt: '2026-09-18 10:45 AM',
      itemsCount: 1,
      status: 'VERIFIED'
    },
    {
      id: 'art_002',
      name: 'ecommerce_products_catalog.csv',
      type: 'csv',
      category: 'dataset',
      size: '1.24 MB',
      workflow: 'NovaGear Catalog Scraper',
      runId: 'run_1789640849201',
      extractedAt: '2026-09-18 09:12 AM',
      itemsCount: 450,
      status: 'PARSED'
    },
    {
      id: 'art_003',
      name: 'b2b_leads_pipeline_manifest.json',
      type: 'json',
      category: 'dataset',
      size: '88 KB',
      workflow: 'Stratos CRM Lead Extractor',
      runId: 'run_1789639912004',
      extractedAt: '2026-09-17 08:30 PM',
      itemsCount: 82,
      status: 'PARSED'
    },
    {
      id: 'art_004',
      name: 'alexandria_library_catalog.xlsx',
      type: 'xlsx',
      category: 'dataset',
      size: '760 KB',
      workflow: 'Alexandria Digital Catalog',
      runId: 'run_1789635541092',
      extractedAt: '2026-09-17 04:15 PM',
      itemsCount: 310,
      status: 'VERIFIED'
    },
    {
      id: 'art_005',
      name: 'checkout_confirmation_receipt.pdf',
      type: 'pdf',
      category: 'document',
      size: '185 KB',
      workflow: 'NovaGear Automated Checkout',
      runId: 'run_1789631102948',
      extractedAt: '2026-09-16 02:20 PM',
      itemsCount: 1,
      status: 'VERIFIED'
    },
    {
      id: 'art_006',
      name: 'error_checkpoint_snapshot.png',
      type: 'png',
      category: 'media',
      size: '410 KB',
      workflow: 'Portal Login Diagnostics',
      runId: 'run_1789628874100',
      extractedAt: '2026-09-16 11:05 AM',
      itemsCount: 1,
      status: 'EXTRACTED'
    }
  ],

  async render(container, router) {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:1.25rem;">
        
        <!-- Header Controls Row -->
        <div class="workflows-header-controls" style="background:#ffffff; padding:1.25rem 1.5rem; border-radius:var(--radius-xl); border:1px solid rgba(0,0,0,0.06); box-shadow:var(--shadow-card); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <div style="display:flex; align-items:center; gap:0.65rem;">
              <span style="font-size:1.4rem;">📦</span>
              <h2 style="font-size:1.25rem; font-weight:800; color:var(--text-main); letter-spacing:-0.02em;">Scraped Data & Artifacts Vault</h2>
            </div>
            <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.2rem;">Collected documents, spreadsheets, PDFs, and extraction manifests from automated loop runs</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem;">
            <button class="btn btn-secondary btn-sm" id="btnExportAllArtifacts">
              <span>📥 Export All ZIP</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnRefreshArtifacts">
              <span>🔄 Refresh Vault</span>
            </button>
          </div>
        </div>

        <!-- Metrics Overview Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem;">
          
          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Total Artifacts</span>
              <span style="font-size:1.2rem;">📁</span>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalArtifacts">6 Files</p>
            <small style="font-size:0.68rem; color:var(--brand-forest); font-weight:600;">Auto-collected via CDP</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Scraped Volume</span>
              <span style="font-size:1.2rem;">💾</span>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalSize">3.03 MB</p>
            <small style="font-size:0.68rem; color:var(--text-sub);">Disk persistence ready</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Scraped Records</span>
              <span style="font-size:1.2rem;">📊</span>
            </div>
            <p style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.35rem;" id="statTotalRecords">844 Items</p>
            <small style="font-size:0.68rem; color:var(--brand-forest); font-weight:600;">Across 4 active portals</small>
          </div>

          <div class="card" style="padding:1rem 1.25rem; background:#ffffff; border-radius:var(--radius-lg); border:1px solid rgba(0,0,0,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.72rem; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Storage Target</span>
              <span style="font-size:1.2rem;">📂</span>
            </div>
            <p style="font-size:0.85rem; font-weight:800; color:var(--text-main); font-family:var(--font-mono); margin-top:0.35rem; word-break:break-all;">recordings/runs/</p>
            <small style="font-size:0.68rem; color:var(--text-sub);">Local runtime sandbox</small>
          </div>

        </div>

        <!-- Filter & Search Toolbar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          
          <div style="display:flex; gap:0.35rem; background:#ffffff; padding:0.3rem; border-radius:var(--radius-pill); border:1px solid rgba(0,0,0,0.06);">
            <button class="nav-pill-link active filter-btn" data-filter="all">All Formats</button>
            <button class="nav-pill-link filter-btn" data-filter="document">📄 PDFs & Docs</button>
            <button class="nav-pill-link filter-btn" data-filter="dataset">📊 CSV & Excel</button>
            <button class="nav-pill-link filter-btn" data-filter="media">🖼️ Screenshots</button>
          </div>

          <div class="search-input-wrap" style="max-width:320px; width:100%;">
            <span class="search-icon-pos">🔍</span>
            <input type="text" id="inputSearchArtifacts" class="form-control" placeholder="Search extracted files, workflows...">
          </div>

        </div>

        <!-- Artifacts Table Card -->
        <div class="card" style="background:#ffffff; border-radius:var(--radius-xl); border:1px solid rgba(0,0,0,0.06); padding:1.25rem; box-shadow:var(--shadow-card);">
          <div class="table-responsive">
            <table class="quixotic-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Origin Workflow</th>
                  <th>Format</th>
                  <th>Size / Items</th>
                  <th>Extraction Time</th>
                  <th>Status</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="artifactsTableBody">
                <!-- Injected dynamically -->
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;

    this.bindEvents(router);
    this.renderTable();
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
      btnRefresh.onclick = () => {
        Toast.info('Refreshing artifacts vault from recordings/runs/ ...');
        setTimeout(() => {
          Toast.success('Vault is up-to-date!');
          this.renderTable();
        }, 350);
      };
    }

    const btnExport = document.getElementById('btnExportAllArtifacts');
    if (btnExport) {
      btnExport.onclick = () => {
        Toast.info('Preparing consolidated ZIP package of all scraped materials...');
        setTimeout(() => {
          Toast.success('Consolidated archive generated! Ready for download.');
        }, 600);
      };
    }
  },

  renderTable() {
    const tbody = document.getElementById('artifactsTableBody');
    if (!tbody) return;

    let filtered = this.mockArtifacts.filter(art => {
      const matchesFilter = this.activeFilter === 'all' || art.category === this.activeFilter;
      const matchesSearch = !this.searchQuery || 
        art.name.toLowerCase().includes(this.searchQuery) ||
        art.workflow.toLowerCase().includes(this.searchQuery) ||
        art.type.toLowerCase().includes(this.searchQuery);
      return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:2rem; color:var(--text-sub);">
            <span style="font-size:1.8rem; display:block; margin-bottom:0.5rem;">📂</span>
            No artifacts found matching your filter or search query.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach(art => {
      const tr = document.createElement('tr');
      
      let typeBadgeClass = 'info';
      let icon = '📄';
      if (art.type === 'pdf') { typeBadgeClass = 'danger'; icon = '📕'; }
      else if (art.type === 'csv' || art.type === 'xlsx') { typeBadgeClass = 'success'; icon = '📊'; }
      else if (art.type === 'json') { typeBadgeClass = 'amber'; icon = '📝'; }
      else if (art.type === 'png' || art.type === 'jpg') { typeBadgeClass = 'info'; icon = '🖼️'; }

      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="font-size:1.1rem;">${icon}</span>
            <div>
              <strong style="font-size:0.8rem; color:var(--text-main); display:block;">${art.name}</strong>
              <small style="font-size:0.68rem; color:var(--text-sub); font-family:var(--font-mono);">${art.runId}</small>
            </div>
          </div>
        </td>
        <td>
          <span style="font-size:0.75rem; font-weight:600; color:var(--text-main);">${art.workflow}</span>
        </td>
        <td>
          <span class="badge-tag ${typeBadgeClass}">${art.type.toUpperCase()}</span>
        </td>
        <td>
          <span style="font-size:0.75rem; font-family:var(--font-mono);">${art.size}</span>
          ${art.itemsCount > 1 ? `<small style="display:block; font-size:0.65rem; color:var(--brand-forest); font-weight:700;">${art.itemsCount} records</small>` : ''}
        </td>
        <td>
          <span style="font-size:0.72rem; color:var(--text-sub);">${art.extractedAt}</span>
        </td>
        <td>
          <span class="badge-tag success">${art.status}</span>
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:0.35rem;">
            <button class="btn btn-sm btn-secondary btn-action-preview" data-id="${art.id}" title="Preview content">
              <span>👁️</span>
            </button>
            <button class="btn btn-sm btn-primary btn-action-download" data-id="${art.id}" title="Download file">
              <span>📥 Download</span>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-action-preview').forEach(btn => {
      btn.onclick = () => {
        const item = this.mockArtifacts.find(a => a.id === btn.dataset.id);
        if (item) {
          Toast.info(`Opening preview for ${item.name}...`);
        }
      };
    });

    tbody.querySelectorAll('.btn-action-download').forEach(btn => {
      btn.onclick = () => {
        const item = this.mockArtifacts.find(a => a.id === btn.dataset.id);
        if (item) {
          Toast.success(`Downloading ${item.name} (${item.size})`);
        }
      };
    });
  }
};
