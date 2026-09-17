/**
 * Workflow Capture — Diagnostics & Test Runner View
 */

import { Api } from '../api.js';
import { SSE } from '../sse.js';
import { Toast } from '../components/toast.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const TestsView = {
  outputEl: null,
  btnUnit: null,
  btnE2e: null,

  async render(container) {
    container.innerHTML = `
      <section class="card" style="min-height:70vh;">
        
        <!-- Header -->
        <div class="card-header-row" style="margin-bottom:1.25rem;">
          <div class="card-title-wrap">
            <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main);">Verification & Automated Test Suite</h2>
            <p>Run end-to-end regression suites and selector resolver heuristic unit tests</p>
          </div>

          <div style="display:flex; gap:0.65rem;">
            <button class="btn btn-primary btn-sm" id="btnSuiteRunUnit">
              <span>🧪 Run Unit Tests</span>
            </button>
            <button class="btn btn-dark btn-sm" id="btnSuiteRunE2E">
              <span>⚡ Run E2E Smoke Test</span>
            </button>
          </div>
        </div>

        <!-- 2-Column Diagnostics Layout -->
        <div class="content-grid" style="align-items:start;">
          
          <!-- Test Suites Summary Card -->
          <div class="col-span-5" style="display:flex; flex-direction:column; gap:1rem;">
            
            <article class="card" style="background:#f9fafb; border:1px solid rgba(0,0,0,0.06);">
              <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); margin-bottom:0.5rem;">
                Selector Resolver Heuristic Suite
              </h3>
              <p style="font-size:0.75rem; color:var(--text-sub); margin-bottom:0.75rem;">
                Tests dynamic ID rejection (regex patterns), transient Tailwind/state class filtering, tag name enforcement, and fuzzy text similarity matching.
              </p>
              <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.72rem; color:var(--text-sub);">
                <span>Target: <code>test/selector-resolver.test.js</code></span>
                <span class="badge-tag success">5 Tests</span>
              </div>
            </article>

            <article class="card" style="background:#f9fafb; border:1px solid rgba(0,0,0,0.06);">
              <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); margin-bottom:0.5rem;">
                E2E Smoke & Playback Suite
              </h3>
              <p style="font-size:0.75rem; color:var(--text-sub); margin-bottom:0.75rem;">
                Launches browser instance via Puppeteer Core CDP, performs clicks, text typing, select changes, and verifies action persistence.
              </p>
              <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.72rem; color:var(--text-sub);">
                <span>Target: <code>test/e2e-smoke.js</code></span>
                <span class="badge-tag amber">CDP Integration</span>
              </div>
            </article>

          </div>

          <!-- Live Test Execution Output Window -->
          <div class="col-span-7">
            <div class="card" style="padding:1rem;">
              <div class="card-header-row" style="margin-bottom:0.65rem;">
                <h4 style="font-size:0.8rem; font-weight:800; color:var(--text-main);">Test Execution Telemetry</h4>
                <button class="btn btn-ghost btn-sm" id="btnClearTestOutput">Clear Output</button>
              </div>

              <div class="test-output-panel" id="testOutputWindow">
                <div style="color:#64748b; font-style:italic;">Click "Run Unit Tests" or "Run E2E Smoke Test" to stream execution results.</div>
              </div>
            </div>
          </div>

        </div>

      </section>
    `;

    this.outputEl = document.getElementById('testOutputWindow');
    this.btnUnit = document.getElementById('btnSuiteRunUnit');
    this.btnE2e = document.getElementById('btnSuiteRunE2E');

    this.bindEvents();
  },

  bindEvents() {
    if (this.btnUnit) {
      this.btnUnit.onclick = async () => {
        Toast.info('Executing Selector Resolver unit tests...');
        this.appendOutput('--- Launching Selector Resolver Unit Tests ---');
        try {
          await Api.runTests('unit');
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    if (this.btnE2e) {
      this.btnE2e.onclick = async () => {
        Toast.info('Executing E2E Smoke Test suite...');
        this.appendOutput('--- Launching E2E Smoke Tests ---');
        try {
          await Api.runTests('e2e');
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    const btnClear = document.getElementById('btnClearTestOutput');
    if (btnClear && this.outputEl) {
      btnClear.onclick = () => {
        this.outputEl.innerHTML = '<div style="color:#64748b; font-style:italic;">Output cleared.</div>';
      };
    }

    // SSE test status updates
    SSE.on('test_state', (data) => {
      if (data.isRunning) {
        if (this.btnUnit) this.btnUnit.disabled = true;
        if (this.btnE2e) this.btnE2e.disabled = true;
      } else {
        if (this.btnUnit) this.btnUnit.disabled = false;
        if (this.btnE2e) this.btnE2e.disabled = false;
        if (data.success) {
          this.appendOutput(`\n[SUCCESS] ${data.type.toUpperCase()} test suite finished with exit code 0.`);
          Toast.success(`${data.type.toUpperCase()} Tests Passed!`);
        } else {
          this.appendOutput(`\n[FAILURE] ${data.type.toUpperCase()} test suite failed with exit code ${data.exitCode}.`);
          Toast.error(`${data.type.toUpperCase()} Tests Failed!`);
        }
      }
    });

    SSE.on('log', (log) => {
      if (this.outputEl && (log.level === 'ERROR' || log.level === 'SUCCESS' || log.text.includes('Test') || log.text.includes('Passed'))) {
        this.appendOutput(`[${log.level}] ${log.text}`);
      }
    });
  },

  appendOutput(text) {
    if (!this.outputEl) return;
    const line = document.createElement('div');
    line.style.lineHeight = '1.45';
    line.style.marginTop = '0.2rem';
    line.textContent = text;
    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }
};
