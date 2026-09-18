/**
 * Workflow Capture — Live Console View (Streaming Execution Terminal)
 */

import { SSE } from '../sse.js';
import { Toast } from '../components/toast.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const ConsoleView = {
  activeFilter: 'ALL',
  searchQuery: '',
  autoScroll: true,
  logs: [],
  containerEl: null,

  async render(container) {
    this.logs = SSE.getLogs();

    container.innerHTML = `
      <section class="card console-full-view">
        
        <!-- Header Toolbar -->
        <div class="card-header-row" style="margin-bottom:0.25rem;">
          <div class="card-title-wrap">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main);">Live Execution Terminal</h2>
              <span class="badge-tag info" id="consoleLiveBadge" style="display:inline-flex; align-items:center; gap:0.35rem;">
                <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>
                <span>STREAM CONNECTED</span>
              </span>
            </div>
            <p>Real-time Chrome DevTools Protocol & Workflow Automation logs</p>
          </div>

          <!-- Controls: Level Filters, Search, Export, Clear -->
          <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
            <div class="console-filter-pill-group">
              <button class="console-filter-btn active" data-filter="ALL">ALL</button>
              <button class="console-filter-btn" data-filter="INFO">INFO</button>
              <button class="console-filter-btn" data-filter="ACTION">ACTION</button>
              <button class="console-filter-btn" data-filter="SUCCESS">SUCCESS</button>
              <button class="console-filter-btn" data-filter="WARN">WARN</button>
              <button class="console-filter-btn" data-filter="ERROR">ERROR</button>
            </div>

            <input type="text" id="consoleSearchInput" class="form-control" style="width:180px; padding:0.35rem 0.65rem; font-size:0.75rem;" placeholder="Filter log text...">

            <label style="font-size:0.75rem; color:var(--text-sub); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
              <input type="checkbox" id="chkConsoleAutoScroll" checked> Auto-scroll
            </label>

            <button class="btn btn-secondary btn-sm" id="btnExportLogs" title="Export current log buffer to .txt">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Export</span>
            </button>
            <button class="btn btn-ghost btn-sm" id="btnClearConsole">
              <span>Clear</span>
            </button>
          </div>
        </div>

        <!-- Terminal Output Window -->
        <div class="console-terminal-wrapper" id="consoleLogOutput">
          <!-- Log entries will be populated here -->
        </div>

      </section>
    `;

    this.containerEl = document.getElementById('consoleLogOutput');
    this.bindEvents();
    this.renderLogs();
  },

  bindEvents() {
    // Filter buttons
    document.querySelectorAll('.console-filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter');
        this.renderLogs();
      };
    });

    // Search input
    const search = document.getElementById('consoleSearchInput');
    if (search) {
      search.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderLogs();
      };
    }

    // Auto-scroll checkbox
    const chk = document.getElementById('chkConsoleAutoScroll');
    if (chk) {
      chk.onchange = (e) => {
        this.autoScroll = e.target.checked;
      };
    }

    // Clear logs
    const btnClear = document.getElementById('btnClearConsole');
    if (btnClear) {
      btnClear.onclick = () => {
        SSE.clearLogs();
        this.logs = [];
        this.renderLogs();
        Toast.info('Console log buffer cleared');
      };
    }

    // Export logs
    const btnExport = document.getElementById('btnExportLogs');
    if (btnExport) {
      btnExport.onclick = () => {
        const text = SSE.getLogs().map(l => `[${l.time}] [${l.level}] ${l.text}`).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-capture-logs-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        Toast.success('Logs exported to text file');
      };
    }

    // SSE Log listener
    SSE.on('log', (log) => {
      this.logs = SSE.getLogs();
      if (this.containerEl && this.matchesFilter(log)) {
        this.appendLogEntry(log);
      }
    });
  },

  matchesFilter(log) {
    const level = (log.level || 'INFO').toUpperCase();
    if (this.activeFilter !== 'ALL' && level !== this.activeFilter) return false;
    if (this.searchQuery && !String(log.text).toLowerCase().includes(this.searchQuery)) return false;
    return true;
  },

  renderLogs() {
    if (!this.containerEl) return;
    this.containerEl.innerHTML = '';

    const filtered = this.logs.filter(l => this.matchesFilter(l));
    if (filtered.length === 0) {
      this.containerEl.innerHTML = `<div style="color:#64748b; font-style:italic; padding:1rem;">No log events found matching current criteria.</div>`;
      return;
    }

    filtered.forEach(log => this.appendLogEntry(log, false));

    if (this.autoScroll) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  },

  appendLogEntry(log, scroll = true) {
    if (!this.containerEl) return;

    const entry = document.createElement('div');
    const levelClass = (log.level || 'INFO').toLowerCase();
    entry.className = 'log-entry';

    entry.innerHTML = `
      <span class="log-time">${log.time || new Date().toLocaleTimeString()}</span>
      <span class="log-badge ${levelClass}">${log.level || 'INFO'}</span>
      <span class="log-message">${escapeHtml(log.text)}</span>
    `;

    this.containerEl.appendChild(entry);

    if (scroll && this.autoScroll) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  }
};
