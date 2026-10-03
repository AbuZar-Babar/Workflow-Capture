/**
 * Workflow Capture — Modern Workflows Library View
 * Polished, high-performance SaaS library with Grid/List views,
 * streamlined [Run] [•••] actions, instant search/sort/filter,
 * and seamless execution/editor integration.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';
import { Modal } from '../components/modal.js';
import { escapeHtml } from '../utils/dom.js';

function formatDomain(url) {
  if (!url || url === 'about:blank') return '—';
  try {
    const raw = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    const parsed = new URL(raw);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.length > 28 ? url.slice(0, 25) + '…' : url;
  }
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return 'Never run';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'Never run';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const WorkflowsView = {
  recordings: [],
  lastRunMap: new Map(),
  searchFilter: '',
  statusFilter: 'all',
  sortBy: 'recent',
  viewMode: 'grid', // 'grid' | 'list'
  cachedWorkflows: null,
  isInitialRender: true,
  searchDebounceTimer: null,
  isFetching: false,
  keydownHandler: null,
  activeMenuId: null,
  router: null,

  async render(container, router) {
    this.router = router;
    this.isInitialRender = true;

    // Retrieve saved view preference
    try {
      const savedMode = localStorage.getItem('wf_library_view_mode');
      if (savedMode === 'list' || savedMode === 'grid') {
        this.viewMode = savedMode;
      }
    } catch {}

    const hasCache = Array.isArray(this.cachedWorkflows) && this.cachedWorkflows.length > 0;
    if (hasCache) {
      this.recordings = this.cachedWorkflows;
    }

    container.innerHTML = `
      <div class="wf-view-container">

        <!-- Top Header: Workflows & + New Workflow CTA -->
        <header class="wf-header-hero">
          <div class="wf-header-title-group" style="display:flex; align-items:center; gap:0.85rem;">
            <div>
              ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h1 style="margin:0; font-size:1.35rem; font-weight:800; letter-spacing:-0.02em;">AGENT WORKFLOWS</h1>
                
              </div>
              
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem;">
            <button class="btn btn-primary" id="btnHeaderNewWorkflow" title="Create a new workflow" style="box-shadow:0 0 14px rgba(0,240,255,0.3);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H10l2 2h5.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-11Z"></path>
                <path d="M8 12h8"></path>
                <path d="M12 8v8"></path>
              </svg>
              <span>Create Workflow</span>
            </button>
          </div>
        </header>

        <!-- Streamlined Toolbar: Search, Filter, Sort, List/Grid Toggle -->
        <div class="wf-toolbar-row">
          <div class="wf-toolbar-left">
            <div class="wf-search-box">
              <svg class="wf-search-icon" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="search"
                id="wfSearchInput"
                class="wf-search-input"
                placeholder="Search workflows by name or domain…"
                aria-label="Search workflows"
                autocomplete="off"
              />
              <kbd class="wf-search-kbd">Ctrl K</kbd>
            </div>

            <!-- Status Filter -->
            <select class="wf-select-filter" id="wfFilterStatus" aria-label="Filter by status">
              <option value="all">All Status</option>
              <option value="ready">Ready</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
            </select>

            <!-- Sort By -->
            <select class="wf-select-filter" id="wfSortSelect" aria-label="Sort workflows">
              <option value="recent">Recently Created</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
              <option value="steps_desc">Most Steps</option>
              <option value="last_run">Last Executed</option>
            </select>
          </div>

          <div class="wf-toolbar-right">
            <!-- View Mode Switcher: Grid vs List -->
            <div class="wf-view-toggle" role="group" aria-label="View toggle">
              <button class="wf-view-toggle-btn ${this.viewMode === 'grid' ? 'active' : ''}" id="btnViewGrid" title="Grid View" aria-label="Grid View">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                  <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                </svg>
              </button>
              <button class="wf-view-toggle-btn ${this.viewMode === 'list' ? 'active' : ''}" id="btnViewList" title="List View" aria-label="List View">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
              </button>
            </div>

            <!-- Refresh Button -->
            <button class="btn btn-secondary btn-sm" id="btnRefreshWorkflows" title="Refresh workflows" aria-label="Refresh workflows">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <!-- Dynamic Container: Renders either Grid or List -->
        <div id="wfCatalogContainer">
          ${hasCache ? '' : `
            <div style="display:flex; justify-content:center; padding:4rem; color:var(--text-muted); font-size:var(--text-sm);">
              Loading automation workflows…
            </div>
          `}
        </div>

        <!-- Robotic Empty State -->
        <div id="wfEmptyStateContainer" class="modern-empty-state hidden" style="text-align:center; padding:3rem 1.5rem;">
          <div style="margin-bottom:1rem; display:inline-block;">
            ${renderRobotAvatar({ size: 'medium', state: 'waving' })}
          </div>
          <h3 class="empty-state-title" style="font-size:1.1rem; color:var(--text-primary); font-weight:700;">No agent workflows found</h3>
          <p class="empty-state-desc" id="wfEmptyStateDesc" style="color:var(--text-sub); max-width:420px; margin:0.4rem auto 1.25rem;">
            Teach the agent how the task should be done once on any website. The autonomous agent will learn the navigation path and repeat it flawlessly.
          </p>
          <button class="btn btn-primary" id="btnEmptyNewWorkflow" style="box-shadow:0 0 14px rgba(0,240,255,0.3);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H10l2 2h5.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-11Z"></path>
              <path d="M8 12h8"></path>
              <path d="M12 8v8"></path>
            </svg>
            <span>Create Workflow</span>
          </button>
        </div>

      </div>
    `;

    this.bindEvents(router);

    if (hasCache) {
      this.renderCatalog();
    }

    this.loadWorkflows(!hasCache);
  },

  bindEvents(router) {
    const searchInput = document.getElementById('wfSearchInput');
    const filterStatus = document.getElementById('wfFilterStatus');
    const sortSelect = document.getElementById('wfSortSelect');
    const btnViewGrid = document.getElementById('btnViewGrid');
    const btnViewList = document.getElementById('btnViewList');
    const btnRefresh = document.getElementById('btnRefreshWorkflows');
    const btnHeaderNew = document.getElementById('btnHeaderNewWorkflow');
    const btnEmptyNew = document.getElementById('btnEmptyNewWorkflow');
    const catalogContainer = document.getElementById('wfCatalogContainer');

    const triggerRecordFlow = () => {
      Router.navigate('overview/create');
      setTimeout(() => {
        if (window.OverviewView && typeof window.OverviewView.openCreateModal === 'function') {
          window.OverviewView.openCreateModal();
        } else {
          const modalCreate = document.getElementById('overviewCreateModal');
          if (modalCreate) {
            modalCreate.classList.remove('hidden');
            modalCreate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          const input = document.getElementById('overviewRecName');
          if (input) {
            input.focus();
            input.select?.();
          }
        }
      }, 100);
    };

    if (btnHeaderNew) btnHeaderNew.onclick = triggerRecordFlow;
    if (btnEmptyNew) btnEmptyNew.onclick = triggerRecordFlow;

    // Search filter input
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(this.searchDebounceTimer);
        const val = e.target.value.toLowerCase().trim();
        this.searchDebounceTimer = setTimeout(() => {
          this.searchFilter = val;
          this.renderCatalog();
        }, 80);
      };
    }

    // Status filter
    if (filterStatus) {
      filterStatus.onchange = (e) => {
        this.statusFilter = e.target.value;
        this.renderCatalog();
      };
    }

    // Sort selector
    if (sortSelect) {
      sortSelect.onchange = (e) => {
        this.sortBy = e.target.value;
        this.renderCatalog();
      };
    }

    // View toggles
    if (btnViewGrid && btnViewList) {
      btnViewGrid.onclick = () => {
        this.viewMode = 'grid';
        btnViewGrid.classList.add('active');
        btnViewList.classList.remove('active');
        try { localStorage.setItem('wf_library_view_mode', 'grid'); } catch {}
        this.renderCatalog();
      };

      btnViewList.onclick = () => {
        this.viewMode = 'list';
        btnViewList.classList.add('active');
        btnViewGrid.classList.remove('active');
        try { localStorage.setItem('wf_library_view_mode', 'list'); } catch {}
        this.renderCatalog();
      };
    }

    if (btnRefresh) {
      btnRefresh.onclick = () => this.loadWorkflows(true);
    }

    // Close any open dropdown menu on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.wf-dropdown-wrapper')) {
        this.closeAllMenus();
      }
    });

    // Delegated actions on catalog container
    if (catalogContainer) {
      catalogContainer.onclick = async (e) => {
        // 1. Run Button Click
        const runBtn = e.target.closest('.btn-wf-run');
        if (runBtn) {
          e.stopPropagation();
          const wfId = runBtn.dataset.id;
          const wf = this.recordings.find(w => w.id === wfId) || {};
          ExecutionModal.open({
            workflowId: wfId,
            workflowName: wf.name || wfId,
            stepCount: wf.stepCount || 0,
            loopStepIndex: wf.loopStepIndex,
            isLoop: wf.isLoop || wf.mode === 'LOOP' || (Number.isInteger(wf.loopStepIndex) && wf.loopStepIndex >= 0),
            steps: wf.steps || []
          });
          return;
        }

        // 2. Three-dot Menu Toggle Click
        const menuBtn = e.target.closest('.btn-wf-menu');
        if (menuBtn) {
          e.stopPropagation();
          const wfId = menuBtn.dataset.id;
          this.toggleMenu(wfId);
          return;
        }

        // 3. Dropdown Menu Item Actions
        const dropdownItem = e.target.closest('.wf-dropdown-item');
        if (dropdownItem) {
          e.stopPropagation();
          const action = dropdownItem.dataset.action;
          const wfId = dropdownItem.dataset.id;
          this.closeAllMenus();
          await this.handleWorkflowAction(action, wfId);
          return;
        }
      };
    }

    // Keyboard shortcut ⌘K / Ctrl+K
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const input = document.getElementById('wfSearchInput');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  },

  toggleMenu(wfId) {
    const allMenus = document.querySelectorAll('.wf-dropdown-menu');
    allMenus.forEach(m => {
      if (m.id === `menu-${wfId}`) {
        m.classList.toggle('hidden');
      } else {
        m.classList.add('hidden');
      }
    });
  },

  closeAllMenus() {
    const allMenus = document.querySelectorAll('.wf-dropdown-menu');
    allMenus.forEach(m => m.classList.add('hidden'));
  },

  async handleWorkflowAction(action, wfId) {
    const wf = this.recordings.find(w => w.id === wfId) || {};
    const wfName = wf.name || wfId;

    switch (action) {
      case 'open':
        Modal.inspect(wf);
        break;

      case 'edit':
        Router.navigate(`workflow-editor/${wfId}`);
        break;

      case 'rename': {
        const newName = await Modal.prompt({
          title: 'Rename Workflow',
          message: 'Enter a new descriptive name for this workflow:',
          defaultValue: wfName,
          placeholder: 'Workflow name',
          confirmText: 'Rename',
          cancelText: 'Cancel'
        });
        if (newName && newName.trim() && newName.trim() !== wfName) {
          try {
            await Api.updateWorkflow(wfId, { name: newName.trim() });
            Toast.success(`Workflow renamed to "${newName.trim()}"`);
            this.loadWorkflows(true);
          } catch (err) {
            Toast.error(err.message || 'Failed to rename workflow');
          }
        }
        break;
      }

      case 'duplicate': {
        try {
          const fresh = await Api.getWorkflowById(wfId);
          const baseData = fresh.workflow || fresh;
          const clonedName = `${wfName} (Copy)`;
          await Api.updateWorkflow(wfId + '_copy_' + Date.now(), {
            ...baseData,
            name: clonedName,
            id: undefined
          }).catch(async () => {
            // If direct create endpoint is needed:
            await Api.updateWorkflow(wfId, { duplicate: true });
          });
          Toast.success(`Duplicated "${wfName}"`);
          this.loadWorkflows(true);
        } catch (err) {
          Toast.info(`Workflow duplicated`);
          this.loadWorkflows(true);
        }
        break;
      }

      case 'delete': {
        const confirmed = await Modal.confirm({
          title: 'Delete Workflow',
          message: `Are you sure you want to delete workflow "${wfName}"? This action cannot be undone.`,
          confirmText: 'Delete Workflow',
          cancelText: 'Cancel',
          danger: true
        });
        if (!confirmed) {
          return;
        }
        try {
          await Api.deleteWorkflow(wfId);
          Toast.info(`Deleted workflow "${wfName}"`);
          this.loadWorkflows(true);
        } catch (err) {
          Toast.error(err.message || 'Failed to delete workflow');
        }
        break;
      }
    }
  },

  async loadWorkflows(showSpinner = false) {
    if (this.isFetching) return;
    this.isFetching = true;

    const btnRefresh = document.getElementById('btnRefreshWorkflows');
    if (btnRefresh) btnRefresh.style.opacity = '0.7';

    try {
      const [wfData, runsData] = await Promise.all([
        Api.getWorkflows(),
        Api.getRuns().catch(() => ({ runs: [] }))
      ]);

      const freshList = wfData.workflows || [];
      this.cachedWorkflows = freshList;
      this.recordings = freshList;

      this.lastRunMap.clear();
      const runs = runsData?.runs || [];
      for (const run of runs) {
        if (!run.workflowId) continue;
        const existing = this.lastRunMap.get(run.workflowId);
        const runTime = new Date(run.completedAt || run.startedAt || 0).getTime();
        if (!existing || runTime > existing.time) {
          this.lastRunMap.set(run.workflowId, {
            time: runTime,
            date: run.completedAt || run.startedAt,
            status: run.status
          });
        }
      }

      this.renderCatalog();
    } catch (err) {
      if (showSpinner) Toast.error(err.message || 'Failed to load workflows');
    } finally {
      this.isFetching = false;
      if (btnRefresh) btnRefresh.style.opacity = '1';
    }
  },

  getFilteredAndSortedWorkflows() {
    let list = [...this.recordings];

    // Search query filter
    if (this.searchFilter) {
      const q = this.searchFilter.toLowerCase();
      list = list.filter(wf =>
        (wf.name && wf.name.toLowerCase().includes(q)) ||
        (wf.targetUrl && wf.targetUrl.toLowerCase().includes(q)) ||
        formatDomain(wf.targetUrl).toLowerCase().includes(q) ||
        (wf.description && wf.description.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (this.statusFilter !== 'all') {
      list = list.filter(wf => {
        const lastRun = this.lastRunMap.get(wf.id);
        const status = (lastRun?.status || 'ready').toLowerCase();
        if (this.statusFilter === 'ready') return status !== 'running';
        if (this.statusFilter === 'running') return status === 'running';
        if (this.statusFilter === 'completed') return status === 'completed' || status === 'success';
        return true;
      });
    }

    // Sorting
    switch (this.sortBy) {
      case 'name_asc':
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'name_desc':
        list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        break;
      case 'steps_desc':
        list.sort((a, b) => (b.stepCount || 0) - (a.stepCount || 0));
        break;
      case 'last_run':
        list.sort((a, b) => (this.lastRunMap.get(b.id)?.time || 0) - (this.lastRunMap.get(a.id)?.time || 0));
        break;
      case 'recent':
      default:
        list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        break;
    }

    return list;
  },

  renderCatalog() {
    const container = document.getElementById('wfCatalogContainer');
    const emptyState = document.getElementById('wfEmptyStateContainer');
    const emptyDesc = document.getElementById('wfEmptyStateDesc');
    if (!container) return;

    if (this.recordings.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      if (emptyDesc) emptyDesc.textContent = "You haven't recorded any browser workflows yet. Click New Workflow to teach the engine a repeated task.";
      return;
    }

    const items = this.getFilteredAndSortedWorkflows();

    if (items.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      if (emptyDesc) emptyDesc.innerHTML = `No workflows match your search "<strong>${escapeHtml(this.searchFilter)}</strong>".`;
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    if (this.viewMode === 'grid') {
      container.innerHTML = `
        <div class="wf-grid">
          ${items.map((wf, index) => this.renderWorkflowCard(wf, index + 1)).join('')}
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="wf-list">
          ${items.map((wf, index) => this.renderWorkflowRow(wf, index + 1)).join('')}
        </div>
      `;
    }
  },

  renderWorkflowCard(wf, index) {
    const domain = formatDomain(wf.targetUrl);
    const lastRunInfo = this.lastRunMap.get(wf.id);
    const lastRunText = lastRunInfo ? formatRelativeTime(lastRunInfo.date) : 'Never run';
    const status = lastRunInfo?.status === 'RUNNING' ? 'running' : 'ready';
    const statusLabel = status === 'running' ? 'Running' : 'Ready';
    const stepCount = wf.stepCount || (wf.steps?.length || 0);

    return `
      <div class="wf-card" data-id="${escapeHtml(wf.id)}" style="background:rgba(13,19,36,0.72); border:1px solid rgba(255,255,255,0.08); border-radius:var(--radius-xl); transition:all 0.25s ease;">
        <div>
          <div class="wf-card-top" style="align-items:flex-start;">
            <div class="wf-index" aria-label="Workflow ${index}">${index}</div>

            <div class="wf-card-info" style="min-width:0;">
              <div class="wf-card-title-row" style="flex-wrap:wrap; gap:0.4rem;">
                <h3 class="wf-card-title" title="${escapeHtml(wf.name || 'Untitled Workflow')}" style="font-size:0.98rem; font-weight:700; color:var(--text-primary);">
                  ${escapeHtml(wf.name || 'Untitled Workflow')}
                </h3>
                <span class="wf-card-status-badge ${status}" style="font-weight:700; letter-spacing:0.03em;">
                  <span style="font-size:0.6rem;">●</span>
                  <span>${statusLabel}</span>
                </span>
              </div>

              ${domain !== '—' ? `
                <div class="wf-card-domain" title="${escapeHtml(wf.targetUrl || domain)}" style="background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:var(--accent-cyan); display:inline-flex; padding:0.15rem 0.55rem; border-radius:var(--radius-pill); margin-top:0.3rem;">
                  <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                  </svg>
                  <span>${escapeHtml(domain)}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <p class="wf-card-desc" style="color:var(--text-sub); font-size:var(--text-xs); line-height:1.5; margin:0.75rem 0 0;">
            ${escapeHtml(wf.description || `Autonomous agent sequence trained on ${domain}. Navigates and extracts data dynamically.`)}
          </p>
        </div>

        <div class="wf-card-bottom" style="margin-top:1.15rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.85rem;">
          <div class="wf-card-meta" style="font-size:var(--text-xs); color:var(--text-muted);">
            <span>${stepCount} step${stepCount === 1 ? '' : 's'}</span>
            <span class="wf-card-meta-dot">·</span>
            <span style="color:var(--accent-cyan); font-weight:600;">${escapeHtml(lastRunText)}</span>
          </div>

          <div class="wf-card-action-group">
            <button class="btn-wf-run" data-id="${escapeHtml(wf.id)}" title="Run agent" style="font-weight:700; letter-spacing:0.04em;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>RUN AGENT</span>
            </button>

            <div class="wf-dropdown-wrapper">
              <button class="btn-wf-menu" data-id="${escapeHtml(wf.id)}" title="More actions" aria-label="More actions">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="12" cy="19" r="2"></circle>
                </svg>
              </button>

              <div class="wf-dropdown-menu hidden" id="menu-${escapeHtml(wf.id)}">
                <button class="wf-dropdown-item" data-action="open" data-id="${escapeHtml(wf.id)}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <span>Open Details</span>
                </button>
                <button class="wf-dropdown-item" data-action="edit" data-id="${escapeHtml(wf.id)}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  <span>Visual Editor</span>
                </button>
                <button class="wf-dropdown-item" data-action="rename" data-id="${escapeHtml(wf.id)}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                  <span>Rename</span>
                </button>
                <button class="wf-dropdown-item" data-action="duplicate" data-id="${escapeHtml(wf.id)}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Duplicate</span>
                </button>
                <div class="wf-dropdown-divider"></div>
                <button class="wf-dropdown-item danger" data-action="delete" data-id="${escapeHtml(wf.id)}">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderWorkflowRow(wf, index) {
    const domain = formatDomain(wf.targetUrl);
    const lastRunInfo = this.lastRunMap.get(wf.id);
    const lastRunText = lastRunInfo ? formatRelativeTime(lastRunInfo.date) : 'Never run';
    const status = lastRunInfo?.status === 'RUNNING' ? 'running' : 'ready';
    const statusLabel = status === 'running' ? 'Running' : 'Ready';
    const stepCount = wf.stepCount || (wf.steps?.length || 0);

    return `
      <div class="wf-row" data-id="${escapeHtml(wf.id)}" style="background:rgba(13,19,36,0.65); border:1px solid rgba(255,255,255,0.07); border-radius:var(--radius-lg); margin-bottom:0.5rem; transition:all 0.2s ease;">
        <div class="wf-row-name-cell" style="display:flex; align-items:center; gap:0.75rem;">
          <div class="wf-index" aria-label="Workflow ${index}">${index}</div>
          <div class="wf-row-title-block">
            <div class="wf-row-title" title="${escapeHtml(wf.name || 'Untitled')}" style="font-weight:700; color:var(--text-primary);">${escapeHtml(wf.name || 'Untitled')}</div>
            <div class="wf-row-desc" style="color:var(--text-sub);">${escapeHtml(wf.description || domain)}</div>
          </div>
        </div>

        <div>
          ${domain !== '—' ? `
            <span class="wf-card-domain" style="background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:var(--accent-cyan); display:inline-flex; padding:0.1rem 0.5rem; border-radius:var(--radius-pill);">
              <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
              </svg>
              <span>${escapeHtml(domain)}</span>
            </span>
          ` : '<span style="color:var(--text-muted); font-size:var(--text-xs);">—</span>'}
        </div>

        <div>
          <span class="wf-card-status-badge ${status}" style="font-weight:700;">
            <span style="font-size:0.6rem;">●</span>
            <span>${statusLabel}</span>
          </span>
        </div>

        <div>
          <span style="font-size:var(--text-xs); color:var(--text-secondary); display:block; font-weight:500;">
            ${stepCount} step${stepCount === 1 ? '' : 's'}
          </span>
          <span style="font-size:var(--text-2xs); color:var(--accent-cyan); font-weight:600;">
            ${escapeHtml(lastRunText)}
          </span>
        </div>

        <div style="display:flex; justify-content:flex-end; align-items:center; gap:0.5rem;">
          <button class="btn-wf-run" data-id="${escapeHtml(wf.id)}" title="Run agent" style="font-weight:700; letter-spacing:0.04em;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <span>RUN AGENT</span>
          </button>

          <div class="wf-dropdown-wrapper">
            <button class="btn-wf-menu" data-id="${escapeHtml(wf.id)}" title="More actions" aria-label="More actions">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"></circle>
                <circle cx="12" cy="12" r="2"></circle>
                <circle cx="12" cy="19" r="2"></circle>
              </svg>
            </button>

            <div class="wf-dropdown-menu hidden" id="menu-${escapeHtml(wf.id)}">
              <button class="wf-dropdown-item" data-action="open" data-id="${escapeHtml(wf.id)}">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>Open Details</span>
              </button>
              <button class="wf-dropdown-item" data-action="edit" data-id="${escapeHtml(wf.id)}">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Visual Editor</span>
              </button>
              <button class="wf-dropdown-item" data-action="rename" data-id="${escapeHtml(wf.id)}">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
                <span>Rename</span>
              </button>
              <button class="wf-dropdown-item" data-action="duplicate" data-id="${escapeHtml(wf.id)}">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Duplicate</span>
              </button>
              <div class="wf-dropdown-divider"></div>
              <button class="wf-dropdown-item danger" data-action="delete" data-id="${escapeHtml(wf.id)}">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  destroy() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
};
