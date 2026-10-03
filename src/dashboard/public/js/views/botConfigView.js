/**
 * Workflow Capture — Modernized Settings View
 * Comprehensive multi-section configuration:
 * 1. General
 * 2. Appearance
 * 3. Browser
 * 4. Workflows (Bot profile & anti-detection)
 * 5. Notifications
 * 6. Performance
 * 7. Security
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Theme } from '../theme.js';
import { renderRobotAvatar } from '../components/robotAvatar.js';
import { Modal } from '../components/modal.js';

export const BotConfigView = {
  currentConfig: null,
  presets: {},
  activeSection: 'general',

  async render(container) {
    container.innerHTML = `
      <div class="settings-shell-wrapper" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Header -->
        <div class="wf-page-header">
          <div style="display:flex; align-items:center; gap:0.85rem;">
            <div>
              ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h1 class="wf-page-title" style="margin:0; font-size:1.35rem; font-weight:800; letter-spacing:-0.02em;">AGENT SETTINGS</h1>
                <span class="badge-tag info" style="font-size:0.68rem; font-weight:700;">ENGINE CONFIG</span>
              </div>
              <p class="wf-page-subtitle" style="margin:0.2rem 0 0;">Agent worker tuning, browser CDP connection parameters, anti-detection, and vault security.</p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <button class="btn btn-secondary btn-sm" id="btnResetSettings" title="Restore default settings">
              <span>Reset Defaults</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnSaveSettings">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save Changes</span>
            </button>
          </div>
        </div>

        <!-- 2-Column Settings Shell -->
        <div class="settings-shell">

          <!-- Left Navigation Menu -->
          <nav class="settings-nav" aria-label="Settings Sections">
            <button class="settings-nav-item active" data-section="general">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <span>General</span>
            </button>
            <button class="settings-nav-item" data-section="appearance">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
              <span>Appearance</span>
            </button>
            <button class="settings-nav-item" data-section="browser">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>
              <span>Browser</span>
            </button>
            <button class="settings-nav-item" data-section="workflows">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
              <span>Workflows</span>
            </button>
            <button class="settings-nav-item" data-section="notifications">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <span>Notifications</span>
            </button>
            <button class="settings-nav-item" data-section="performance">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <span>Performance</span>
            </button>
            <button class="settings-nav-item" data-section="security">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>Security</span>
            </button>
          </nav>

          <!-- Right Content Panels -->
          <div class="settings-panel">

            <!-- 1. GENERAL -->
            <div class="settings-section-pane" id="pane-general">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">General Preferences</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Configure workspace naming and automation storage targets.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Workspace Name</h4>
                  <p>Display name for this automation client instance.</p>
                </div>
                <input type="text" class="form-control" id="cfgWorkspaceName" style="max-width:240px;" value="Default Workspace">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Downloads Directory</h4>
                  <p>Root folder where workflow files and spreadsheets are saved.</p>
                </div>
                <input type="text" class="form-control mono" id="cfgDownloadsPath" style="max-width:240px; font-size:var(--text-xs);" value="downloads/">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Auto-Save Recorded Steps</h4>
                  <p>Automatically commit workflow steps to disk upon recorder stop.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgAutoSave" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 2. APPEARANCE -->
            <div class="settings-section-pane hidden" id="pane-appearance">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Appearance &amp; Theme</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Customize light/dark mode and surface contrast.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Theme Mode</h4>
                  <p>Select your interface appearance theme.</p>
                </div>
                <select class="form-control" id="cfgThemeSelect" style="max-width:200px;">
                  <option value="light">Light Mode</option>
                  <option value="dark">Dark Mode</option>
                  <option value="system">System Default</option>
                </select>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Compact Table Density</h4>
                  <p>Use compact padding for high-density workflow tables and lists.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgCompactDensity">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 3. BROWSER -->
            <div class="settings-section-pane hidden" id="pane-browser">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Browser Automation Engine</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Chrome DevTools Protocol (CDP) connection parameters.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Remote Debugging Port</h4>
                  <p>Local CDP port for browser control and event interception.</p>
                </div>
                <input type="number" class="form-control mono" id="cfgCdpPort" style="max-width:140px;" value="9222">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Headless Mode</h4>
                  <p>Run workflow replays silently in the background without UI window.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgHeadless">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Isolated Automation Profile</h4>
                  <p>Keep session cookies and storage distinct from personal browsing.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgIsolatedProfile" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 4. WORKFLOWS (Bot Profile & Stealth) -->
            <div class="settings-section-pane hidden" id="pane-workflows">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Workflow Execution &amp; Bot Profile</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Tune humanized delays, Bezier mouse paths, and loop detection.</p>
              </div>

              <!-- Preset Selector -->
              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Stealth Preset</h4>
                  <p>Choose preconfigured anti-bot evasion profiles.</p>
                </div>
                <select class="form-control" id="cfgStealthPreset" style="max-width:220px;">
                  <option value="balanced">Balanced (Recommended)</option>
                  <option value="ultra_stealth">Ultra Stealth (High Evasion)</option>
                  <option value="fast">Fast Track (Dev &amp; Tests)</option>
                  <option value="erp">ERP / Slow Portals (Patient)</option>
                </select>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Humanized Mouse Curves</h4>
                  <p>Emulate natural Bezier curves with micro-wobbles between targets.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgMouseEnabled" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Action Delay Range</h4>
                  <p>Randomized hesitation between clicks and field inputs.</p>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <input type="number" class="form-control mono" id="cfgMinActionDelay" style="width:90px;" value="200">
                  <span style="font-size:var(--text-xs); color:var(--text-sub);">to</span>
                  <input type="number" class="form-control mono" id="cfgMaxActionDelay" style="width:90px;" value="650">
                  <span style="font-size:var(--text-xs); color:var(--text-sub);">ms</span>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Loop Pattern Detection</h4>
                  <p>Automatically discover repeated rows, grids, and collections during recording.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgLoopDetection" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 5. NOTIFICATIONS -->
            <div class="settings-section-pane hidden" id="pane-notifications">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Notifications &amp; Alerts</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Execution toasts, completion audio, and error alerts.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Execution Completion Alerts</h4>
                  <p>Show in-app toast notification when a workflow finishes.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgNotifyCompleted" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Error &amp; Intervention Alerts</h4>
                  <p>Immediately notify if a selector fails or human intervention is needed.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgNotifyErrors" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 6. PERFORMANCE -->
            <div class="settings-section-pane hidden" id="pane-performance">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Performance &amp; Resources</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Optimize client responsiveness and log buffer limits.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Live Log Stream Buffer</h4>
                  <p>Maximum number of console log messages held in memory.</p>
                </div>
                <select class="form-control" id="cfgLogBufferSize" style="max-width:180px;">
                  <option value="500">500 entries</option>
                  <option value="1000" selected>1,000 entries</option>
                  <option value="5000">5,000 entries</option>
                </select>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Virtualization &amp; Pagination</h4>
                  <p>Paginate large record runs for instant 60 FPS scrolling.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgVirtualization" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- 7. SECURITY -->
            <div class="settings-section-pane hidden" id="pane-security">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Security &amp; Credentials</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Credential masking, secret placeholder handling, and data purging.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Mask Credentials in Live Terminal</h4>
                  <p>Sanitize password values from stdout and SSE stream broadcasts.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgMaskCredentials" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Purge Local Session Cache</h4>
                  <p>Clear temporary run tokens and cached execution state.</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="btnPurgeSession" type="button">Purge Cache</button>
              </div>
            </div>

          </div>

        </div>

      </div>
    `;

    this.bindEvents();
    await this.loadConfig();
  },

  bindEvents() {
    // Navigation item clicks
    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
      item.onclick = () => {
        navItems.forEach(b => b.classList.remove('active'));
        item.classList.add('active');
        const section = item.dataset.section;
        this.activeSection = section;

        document.querySelectorAll('.settings-section-pane').forEach(pane => {
          pane.classList.add('hidden');
        });
        const activePane = document.getElementById(`pane-${section}`);
        if (activePane) activePane.classList.remove('hidden');
      };
    });

    // Theme selector
    const themeSelect = document.getElementById('cfgThemeSelect');
    if (themeSelect) {
      themeSelect.value = localStorage.getItem('workflow_capture_theme') || 'light';
      themeSelect.onchange = (e) => {
        Theme.setTheme(e.target.value);
        Toast.info(`Theme changed to ${e.target.value}`);
      };
    }

    // Save Settings button
    const btnSave = document.getElementById('btnSaveSettings');
    if (btnSave) {
      btnSave.onclick = async () => {
        btnSave.disabled = true;
        Toast.info('Saving settings…');

        const cfg = {
          preset: document.getElementById('cfgStealthPreset')?.value || 'balanced',
          timing: {
            minActionDelayMs: Number(document.getElementById('cfgMinActionDelay')?.value) || 200,
            maxActionDelayMs: Number(document.getElementById('cfgMaxActionDelay')?.value) || 650,
            clickJitterMs: 120,
            preActionDelayMs: 100
          },
          mouse: {
            enabled: Boolean(document.getElementById('cfgMouseEnabled')?.checked),
            speed: 'medium',
            wobble: 2,
            overshoot: true
          },
          typing: {
            minTypingDelayMs: 40,
            maxTypingDelayMs: 120,
            punctuationPauseMs: 250
          }
        };

        try {
          await Api.saveBotConfig(cfg);
          Toast.success('Settings saved successfully');
        } catch (err) {
          Toast.error(err.message || 'Failed to save settings');
        } finally {
          btnSave.disabled = false;
        }
      };
    }

    // Reset Defaults
    const btnReset = document.getElementById('btnResetSettings');
    if (btnReset) {
      btnReset.onclick = async () => {
        const confirmed = await Modal.confirm({
          title: 'Reset Settings',
          message: 'Are you sure you want to reset all settings to defaults? This will restore original configurations.',
          confirmText: 'Reset to Defaults',
          cancelText: 'Cancel',
          danger: true
        });
        if (!confirmed) return;
        try {
          await Api.resetBotConfig();
          Toast.success('Settings restored to defaults');
          await this.loadConfig();
        } catch (err) {
          Toast.error(err.message || 'Failed to reset settings');
        }
      };
    }

    // Purge Cache
    const btnPurge = document.getElementById('btnPurgeSession');
    if (btnPurge) {
      btnPurge.onclick = () => {
        sessionStorage.clear();
        Toast.success('Session cache cleared successfully');
      };
    }
  },

  async loadConfig() {
    try {
      const res = await Api.getBotConfig();
      if (res && res.success) {
        this.currentConfig = res.config;
        if (this.currentConfig) {
          const presetEl = document.getElementById('cfgStealthPreset');
          if (presetEl && this.currentConfig.preset) presetEl.value = this.currentConfig.preset;

          if (this.currentConfig.timing) {
            const minEl = document.getElementById('cfgMinActionDelay');
            const maxEl = document.getElementById('cfgMaxActionDelay');
            if (minEl && this.currentConfig.timing.minActionDelayMs != null) minEl.value = this.currentConfig.timing.minActionDelayMs;
            if (maxEl && this.currentConfig.timing.maxActionDelayMs != null) maxEl.value = this.currentConfig.timing.maxActionDelayMs;
          }

          if (this.currentConfig.mouse) {
            const mouseEl = document.getElementById('cfgMouseEnabled');
            if (mouseEl && this.currentConfig.mouse.enabled != null) mouseEl.checked = Boolean(this.currentConfig.mouse.enabled);
          }
        }
      }
    } catch (err) {
      console.warn('Could not load bot settings:', err);
    }
  }
};
