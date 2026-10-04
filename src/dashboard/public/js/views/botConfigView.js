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
          <div>
            <h1 class="wf-page-title" style="margin:0;">Settings</h1>
            <p class="wf-page-subtitle" style="margin:0.25rem 0 0;">Manage application preferences and automation behavior.</p>
          </div>
          <div class="settings-header-actions">
            <span class="settings-save-state" id="settingsSaveState" aria-live="polite">✓ Saved</span>
            <button class="btn btn-primary btn-sm" id="btnSaveSettings" disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0-0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save changes</span>
            </button>
            <button class="btn btn-ghost btn-sm" id="btnResetSettings" title="Restore default settings">Reset</button>
          </div>        </div>

        <!-- 2-Column Settings Shell -->
        <div class="settings-shell">

          <!-- Left Navigation Menu -->
          <nav class="settings-nav" aria-label="Settings Sections">
            <div class="settings-nav-group">
              <div class="settings-nav-label">General</div>
              <button class="settings-nav-item active" data-section="general"><span>General</span></button>
              <button class="settings-nav-item" data-section="appearance"><span>Appearance</span></button>
            </div>
            <div class="settings-nav-group">
              <div class="settings-nav-label">Automation</div>
              <button class="settings-nav-item" data-section="browser"><span>Browser</span></button>
              <button class="settings-nav-item" data-section="workflows"><span>Workflows</span></button>
            </div>
            <div class="settings-nav-group">
              <div class="settings-nav-label">System</div>
              <button class="settings-nav-item" data-section="notifications"><span>Notifications</span></button>
              <button class="settings-nav-item" data-section="performance"><span>Performance</span></button>
            </div>
            <div class="settings-nav-group">
              <div class="settings-nav-label">Security</div>
              <button class="settings-nav-item" data-section="security"><span>Security</span></button>
            </div>
            <label class="settings-mobile-select-label" for="settingsSectionSelect">Section</label>
            <select class="form-control settings-mobile-select" id="settingsSectionSelect" aria-label="Settings section">
              <option value="general">General</option><option value="appearance">Appearance</option><option value="browser">Browser</option><option value="workflows">Workflows</option><option value="notifications">Notifications</option><option value="performance">Performance</option><option value="security">Security</option>
            </select>
          </nav>

          <!-- Right Content Panels -->
          <div class="settings-panel">

            <!-- 1. GENERAL -->
            <div class="settings-section-pane" id="pane-general">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">General</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Workspace and automation defaults.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Workspace Name</h4>
                  <p>Name shown for this workspace.</p>
                </div>
                <input type="text" class="form-control" id="cfgWorkspaceName" style="max-width:240px;" value="Default Workspace">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Downloads Directory</h4>
                  <p>Default location for workflow files and generated output.</p>
                </div>
                <input type="text" class="form-control mono" id="cfgDownloadsPath" style="max-width:240px; font-size:var(--text-xs);" value="downloads/">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Auto-Save Recorded Steps</h4>
                  <p>Save recorded workflow steps automatically when recording stops.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Appearance</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Choose how the application looks and how dense tables should be.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Theme Mode</h4>
                  <p>Choose the interface theme.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Browser</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Configure the browser connection and execution mode.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Remote Debugging Port</h4>
                  <p>Port used to connect to the local browser.</p>
                </div>
                <input type="number" class="form-control mono" id="cfgCdpPort" style="max-width:140px;" value="9222">
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Headless Mode</h4>
                  <p>Run workflows without showing the browser window.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgHeadless">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Isolated Automation Profile</h4>
                  <p>Keep automation sessions separate from personal browsing.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Workflow execution</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Configure execution timing, cursor behavior, and loop discovery.</p>
              </div>

              <!-- Preset Selector -->
              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Execution profile</h4>
                  <p>Choose a preset for common execution scenarios.</p>
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
                  <h4>Natural mouse movement</h4>
                  <p>Use natural cursor movement between interaction targets.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgMouseEnabled" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Action Delay Range</h4>
                  <p>Add a small randomized delay between interactions.</p>
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
                  <p>Detect repeated rows, grids, and collections while recording.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Notifications</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Choose which workflow events should notify you.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Execution Completion Alerts</h4>
                  <p>Show a notification when a workflow finishes.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgNotifyCompleted" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Error &amp; Intervention Alerts</h4>
                  <p>Notify when an interaction fails or manual intervention is required.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Performance</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Configure logging and large-run performance.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Live Log Stream Buffer</h4>
                  <p>Maximum live log entries kept in memory.</p>
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
                  <p>Keep large result sets responsive with pagination.</p>
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
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Security</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Protect sensitive values and clear temporary session data.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Mask Credentials in Live Terminal</h4>
                  <p>Hide password values from live logs and terminal output.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgMaskCredentials" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Purge Local Session Cache</h4>
                  <p>Remove temporary session tokens and cached execution state.</p>
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
    const navItems = document.querySelectorAll('.settings-nav-item');
    const mobileSelect = document.getElementById('settingsSectionSelect');

    const showSection = (section) => {
      navItems.forEach(item => item.classList.toggle('active', item.dataset.section === section));
      if (mobileSelect) mobileSelect.value = section;
      this.activeSection = section;
      document.querySelectorAll('.settings-section-pane').forEach(pane => pane.classList.add('hidden'));
      const activePane = document.getElementById(`pane-${section}`);
      if (activePane) {
        activePane.classList.remove('hidden');
        activePane.classList.remove('settings-pane-enter');
        void activePane.offsetWidth;
        activePane.classList.add('settings-pane-enter');
      }
    };

    navItems.forEach(item => { item.onclick = () => showSection(item.dataset.section); });
    if (mobileSelect) mobileSelect.onchange = (e) => showSection(e.target.value);

    const themeSelect = document.getElementById('cfgThemeSelect');
    if (themeSelect) {
      themeSelect.value = localStorage.getItem('workflow_capture_theme') || 'light';
      themeSelect.onchange = (e) => { Theme.setTheme(e.target.value); this.markDirty(); };
    }

    const trackIds = ['cfgWorkspaceName','cfgDownloadsPath','cfgAutoSave','cfgCompactDensity','cfgCdpPort','cfgHeadless','cfgIsolatedProfile','cfgStealthPreset','cfgMouseEnabled','cfgMinActionDelay','cfgMaxActionDelay','cfgLoopDetection','cfgNotifyCompleted','cfgNotifyErrors','cfgLogBufferSize','cfgVirtualization','cfgMaskCredentials'];
    trackIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('input', () => this.markDirty()); el.addEventListener('change', () => this.markDirty()); }
    });

    const btnSave = document.getElementById('btnSaveSettings');
    if (btnSave) btnSave.onclick = async () => {
      btnSave.disabled = true;
      Toast.info('Saving settings…');
      const cfg = {
        preset: document.getElementById('cfgStealthPreset')?.value || 'balanced',
        timing: {
          minActionDelayMs: Number(document.getElementById('cfgMinActionDelay')?.value) || 200,
          maxActionDelayMs: Number(document.getElementById('cfgMaxActionDelay')?.value) || 650,
          clickJitterMs: 120, preActionDelayMs: 100
        },
        mouse: {
          enabled: Boolean(document.getElementById('cfgMouseEnabled')?.checked),
          speed: 'medium', wobble: 2, overshoot: true
        },
        typing: { minTypingDelayMs: 40, maxTypingDelayMs: 120, punctuationPauseMs: 250 }
      };
      const localPrefs = {
        workspaceName: document.getElementById('cfgWorkspaceName')?.value || 'Default Workspace',
        downloadsPath: document.getElementById('cfgDownloadsPath')?.value || 'downloads/',
        autoSave: Boolean(document.getElementById('cfgAutoSave')?.checked),
        compactDensity: Boolean(document.getElementById('cfgCompactDensity')?.checked),
        cdpPort: Number(document.getElementById('cfgCdpPort')?.value) || 9222,
        headless: Boolean(document.getElementById('cfgHeadless')?.checked),
        isolatedProfile: Boolean(document.getElementById('cfgIsolatedProfile')?.checked),
        loopDetection: Boolean(document.getElementById('cfgLoopDetection')?.checked),
        notifyCompleted: Boolean(document.getElementById('cfgNotifyCompleted')?.checked),
        notifyErrors: Boolean(document.getElementById('cfgNotifyErrors')?.checked),
        logBufferSize: Number(document.getElementById('cfgLogBufferSize')?.value) || 1000,
        virtualization: Boolean(document.getElementById('cfgVirtualization')?.checked),
        maskCredentials: Boolean(document.getElementById('cfgMaskCredentials')?.checked)
      };
      try {
        await Api.saveBotConfig(cfg);
        localStorage.setItem('workflow_capture_settings', JSON.stringify(localPrefs));
        this.currentConfig = { ...this.currentConfig, ...cfg, preferences: localPrefs };
        this.markSaved();
        Toast.success('Settings saved successfully');
      } catch (err) {
        Toast.error(err.message || 'Failed to save settings');
        this.markDirty();
      }
    };

    const btnReset = document.getElementById('btnResetSettings');
    if (btnReset) btnReset.onclick = async () => {
      const confirmed = await Modal.confirm({ title: 'Reset settings', message: 'Reset all application settings to their defaults? This will discard your current changes.', confirmText: 'Reset settings', cancelText: 'Cancel', danger: true });
      if (!confirmed) return;
      try {
        await Api.resetBotConfig();
        localStorage.removeItem('workflow_capture_settings');
        localStorage.removeItem('workflow_capture_theme');
        Theme.setTheme('light');
        Toast.success('Settings restored to defaults');
        await this.loadConfig();
      } catch (err) { Toast.error(err.message || 'Failed to reset settings'); }
    };

    const btnPurge = document.getElementById('btnPurgeSession');
    if (btnPurge) btnPurge.onclick = async () => {
      const confirmed = await Modal.confirm({ title: 'Clear session cache', message: 'Clear temporary session tokens and cached execution state? Saved workflows and downloaded files will not be deleted.', confirmText: 'Clear cache', cancelText: 'Cancel', danger: true });
      if (!confirmed) return;
      sessionStorage.clear();
      Toast.success('Session cache cleared successfully');
    };

    showSection(this.activeSection);
  },

  markDirty() {
    const state = document.getElementById('settingsSaveState');
    const button = document.getElementById('btnSaveSettings');
    if (state) { state.textContent = 'Unsaved changes'; state.classList.add('is-dirty'); }
    if (button) button.disabled = false;
  },

  markSaved() {
    const state = document.getElementById('settingsSaveState');
    const button = document.getElementById('btnSaveSettings');
    if (state) { state.textContent = '✓ Saved'; state.classList.remove('is-dirty'); }
    if (button) button.disabled = true;
  },

  async loadConfig() {
    try {
      const localPrefs = JSON.parse(localStorage.getItem('workflow_capture_settings') || '{}');
      const setValue = (id, value) => { const el = document.getElementById(id); if (el && value !== undefined) el.value = value; };
      const setChecked = (id, value) => { const el = document.getElementById(id); if (el && value !== undefined) el.checked = Boolean(value); };

      setValue('cfgWorkspaceName', localPrefs.workspaceName ?? 'Default Workspace');
      setValue('cfgDownloadsPath', localPrefs.downloadsPath ?? 'downloads/');
      setChecked('cfgAutoSave', localPrefs.autoSave ?? true);
      setChecked('cfgCompactDensity', localPrefs.compactDensity ?? false);
      setValue('cfgCdpPort', localPrefs.cdpPort ?? 9222);
      setChecked('cfgHeadless', localPrefs.headless ?? false);
      setChecked('cfgIsolatedProfile', localPrefs.isolatedProfile ?? true);
      setChecked('cfgLoopDetection', localPrefs.loopDetection ?? true);
      setChecked('cfgNotifyCompleted', localPrefs.notifyCompleted ?? true);
      setChecked('cfgNotifyErrors', localPrefs.notifyErrors ?? true);
      setValue('cfgLogBufferSize', localPrefs.logBufferSize ?? 1000);
      setChecked('cfgVirtualization', localPrefs.virtualization ?? true);
      setChecked('cfgMaskCredentials', localPrefs.maskCredentials ?? true);

      const res = await Api.getBotConfig();
      if (res && res.success) {
        this.currentConfig = res.config;
        if (this.currentConfig) {
          setValue('cfgStealthPreset', this.currentConfig.preset || 'balanced');
          if (this.currentConfig.timing) {
            setValue('cfgMinActionDelay', this.currentConfig.timing.minActionDelayMs);
            setValue('cfgMaxActionDelay', this.currentConfig.timing.maxActionDelayMs);
          }
          if (this.currentConfig.mouse) setChecked('cfgMouseEnabled', this.currentConfig.mouse.enabled);
        }
      }
      this.markSaved();
    } catch (err) {
      console.warn('Could not load bot settings:', err);
      this.markSaved();
    }
  }
};
