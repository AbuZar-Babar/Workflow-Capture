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
      <div class="settings-shell-wrapper">

        <!-- Header -->
        <div class="settings-page-header">
          <div>
            <h1 class="wf-page-title">Settings</h1>
            <p class="wf-page-subtitle">Manage workspace preferences, automation behavior, and security.</p>
          </div>
          <div class="settings-save-area">
            <span class="settings-save-state" id="settingsSaveState" aria-live="polite">Saved</span>
            <button class="btn btn-primary btn-sm" id="btnSaveSettings">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2-2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save Changes</span>
            </button>
            <button class="btn btn-ghost btn-sm" id="btnResetSettings" title="Restore default settings">Reset</button>
          </div>
        </div>

        <!-- 2-Column Settings Shell -->
        <div class="settings-shell">

          <!-- Left Navigation Menu -->
          <nav class="settings-nav" aria-label="Settings Sections">
            <div class="settings-nav-group">
              <span class="settings-nav-label">Workspace</span>
              <button class="settings-nav-item active" data-section="general"><span>General</span></button>
              <button class="settings-nav-item" data-section="themes"><span>Themes</span></button>
              <button class="settings-nav-item" data-section="appearance"><span>Appearance</span></button>
            </div>
            <div class="settings-nav-group">
              <span class="settings-nav-label">Automation</span>
              <button class="settings-nav-item" data-section="browser"><span>Browser</span></button>
              <button class="settings-nav-item" data-section="workflows"><span>Workflows</span></button>
            </div>
            <div class="settings-nav-group">
              <span class="settings-nav-label">System</span>
              <button class="settings-nav-item" data-section="notifications"><span>Notifications</span></button>
              <button class="settings-nav-item" data-section="performance"><span>Performance</span></button>
            </div>
            <div class="settings-nav-group">
              <span class="settings-nav-label">Security</span>
              <button class="settings-nav-item" data-section="security"><span>Security</span></button>
            </div>
            <label class="settings-mobile-select-label" for="settingsSectionSelect">Section</label>
            <select class="form-control settings-mobile-select" id="settingsSectionSelect" aria-label="Settings section">
              <option value="general">General</option>
              <option value="themes">Themes</option>
              <option value="appearance">Appearance</option>
              <option value="browser">Browser</option>
              <option value="workflows">Workflows</option>
              <option value="notifications">Notifications</option>
              <option value="performance">Performance</option>
              <option value="security">Security</option>
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

            <!-- 2. THEMES (Featured / Custom Themes) -->
            <div class="settings-section-pane hidden" id="pane-themes">
              <div class="settings-panel-header">
                <div style="display:flex; align-items:center; justify-content:space-between; width:100%; flex-wrap:wrap; gap:0.5rem;">
                  <div>
                    <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Theme & Color Palette</h3>
                    <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Select a visual theme inspired by modern workflow dashboards.</p>
                  </div>
                  <span class="badge" id="activeThemeBadge" style="font-size:11px; padding:4px 10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Active</span>
                </div>
              </div>

              <div class="theme-picker-section" style="margin-top: 1rem;">
                <div class="theme-cards-grid" id="themeCardsGrid">
                  <!-- 1. Charcoal Crimson (Featured User Reference Theme) -->
                  <div class="theme-card" data-theme-value="crimson" tabindex="0" role="button" aria-label="Select Charcoal Crimson theme">
                    <div class="theme-card-preview" style="background:#18191d; border: 1px solid rgba(255,255,255,0.1);">
                      <div class="theme-preview-sidebar" style="background:#141518; border-right:1px solid rgba(255,255,255,0.06);">
                        <div style="width:14px; height:3px; background:#f04438; border-radius:1px; margin-bottom:6px;"></div>
                        <div style="width:10px; height:3px; background:rgba(255,255,255,0.2); border-radius:1px; margin-bottom:4px;"></div>
                        <div style="width:10px; height:3px; background:rgba(255,255,255,0.2); border-radius:1px;"></div>
                      </div>
                      <div class="theme-preview-content">
                        <div class="theme-preview-header" style="background:#222329; border-bottom:1px solid rgba(255,255,255,0.06);">
                          <div style="width:24px; height:4px; background:#f4f4f6; border-radius:2px;"></div>
                          <div style="width:12px; height:4px; background:#f04438; border-radius:2px;"></div>
                        </div>
                        <div class="theme-preview-cards">
                          <div style="background:#222329; border:1px solid rgba(255,255,255,0.08); border-radius:4px; padding:5px; margin-bottom:4px;">
                            <div style="width:65%; height:3px; background:#f04438; border-radius:1px; margin-bottom:3px;"></div>
                            <div style="width:40%; height:2px; background:rgba(255,255,255,0.3); border-radius:1px;"></div>
                          </div>
                          <div style="background:#222329; border:1px solid rgba(255,255,255,0.08); border-radius:4px; padding:4px; display:flex; gap:4px;">
                            <div style="width:30%; height:3px; background:#10b981; border-radius:1px;"></div>
                            <div style="width:30%; height:3px; background:#f59e0b; border-radius:1px;"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <div class="theme-card-title-row">
                        <span class="theme-card-title">Charcoal Crimson</span>
                        <span class="badge" style="font-size:10px; color:#f04438; background:rgba(240,68,56,0.12); border:1px solid rgba(240,68,56,0.25);">Featured</span>
                      </div>
                      <p class="theme-card-desc">Deep matte charcoal with vivid crimson accents inspired by high-contrast workflow dashboards.</p>
                    </div>
                    <div class="theme-card-check">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </div>

                  <!-- 2. Mint Sage (Crewix Reference Theme) -->
                  <div class="theme-card" data-theme-value="sage" tabindex="0" role="button" aria-label="Select Mint Sage theme">
                    <div class="theme-card-preview" style="background:#eaf5ea; border: 1px solid #cee5d0;">
                      <div class="theme-preview-sidebar" style="background:#eef7ef; border-right:1px solid #d5ebd7;">
                        <div style="width:14px; height:3px; background:#228249; border-radius:1px; margin-bottom:6px;"></div>
                        <div style="width:10px; height:3px; background:#a3cca8; border-radius:1px; margin-bottom:4px;"></div>
                        <div style="width:10px; height:3px; background:#a3cca8; border-radius:1px;"></div>
                      </div>
                      <div class="theme-preview-content">
                        <div class="theme-preview-header" style="background:#f6fbf6; border-bottom:1px solid #d5ebd7;">
                          <div style="width:24px; height:4px; background:#142217; border-radius:2px;"></div>
                          <div style="width:12px; height:4px; background:#228249; border-radius:2px;"></div>
                        </div>
                        <div class="theme-preview-cards">
                          <div style="background:#f6fbf6; border:1px solid #d6ebd8; border-radius:4px; padding:5px; margin-bottom:4px;">
                            <div style="width:65%; height:3px; background:#228249; border-radius:1px; margin-bottom:3px;"></div>
                            <div style="width:40%; height:2px; background:#a3cca8; border-radius:1px;"></div>
                          </div>
                          <div style="background:#f6fbf6; border:1px solid #d6ebd8; border-radius:4px; padding:4px; display:flex; gap:3px;">
                            <div style="width:20%; height:5px; background:#228249; border-radius:1px;"></div>
                            <div style="width:20%; height:5px; background:#43a047; border-radius:1px;"></div>
                            <div style="width:20%; height:5px; background:#81c784; border-radius:1px;"></div>
                            <div style="width:20%; height:5px; background:#c8e6c9; border-radius:1px;"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <div class="theme-card-title-row">
                        <span class="theme-card-title">Mint Sage</span>
                        <span class="badge" style="font-size:10px; color:#228249; background:rgba(34,130,73,0.12); border:1px solid rgba(34,130,73,0.25);">Crewix</span>
                      </div>
                      <p class="theme-card-desc">Lush organic sage and pale mint surfaces with emerald accents inspired by modern executive apps.</p>
                    </div>
                    <div class="theme-card-check">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </div>

                  <!-- 3. Slate Dark (Classic Dark) -->
                  <div class="theme-card" data-theme-value="dark" tabindex="0" role="button" aria-label="Select Slate Dark theme">
                    <div class="theme-card-preview" style="background:#0f172a; border: 1px solid #334155;">
                      <div class="theme-preview-sidebar" style="background:#0c1322; border-right:1px solid #1e293b;">
                        <div style="width:14px; height:3px; background:#60a5fa; border-radius:1px; margin-bottom:6px;"></div>
                        <div style="width:10px; height:3px; background:rgba(255,255,255,0.2); border-radius:1px; margin-bottom:4px;"></div>
                        <div style="width:10px; height:3px; background:rgba(255,255,255,0.2); border-radius:1px;"></div>
                      </div>
                      <div class="theme-preview-content">
                        <div class="theme-preview-header" style="background:#111827; border-bottom:1px solid #1e293b;">
                          <div style="width:24px; height:4px; background:#f8fafc; border-radius:2px;"></div>
                          <div style="width:12px; height:4px; background:#60a5fa; border-radius:2px;"></div>
                        </div>
                        <div class="theme-preview-cards">
                          <div style="background:#111827; border:1px solid #334155; border-radius:4px; padding:5px; margin-bottom:4px;">
                            <div style="width:65%; height:3px; background:#60a5fa; border-radius:1px; margin-bottom:3px;"></div>
                            <div style="width:40%; height:2px; background:rgba(255,255,255,0.3); border-radius:1px;"></div>
                          </div>
                          <div style="background:#111827; border:1px solid #334155; border-radius:4px; padding:4px; display:flex; gap:4px;">
                            <div style="width:30%; height:3px; background:#4ade80; border-radius:1px;"></div>
                            <div style="width:30%; height:3px; background:#fbbf24; border-radius:1px;"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <div class="theme-card-title-row">
                        <span class="theme-card-title">Slate Dark</span>
                        <span class="badge" style="font-size:10px; color:#60a5fa; background:rgba(96,165,250,0.12); border:1px solid rgba(96,165,250,0.25);">Dark</span>
                      </div>
                      <p class="theme-card-desc">Restrained deep navy & slate background with cool blue primary highlights.</p>
                    </div>
                    <div class="theme-card-check">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </div>

                  <!-- 4. Clean Light -->
                  <div class="theme-card" data-theme-value="light" tabindex="0" role="button" aria-label="Select Clean Light theme">
                    <div class="theme-card-preview" style="background:#f8fafc; border: 1px solid #e2e8f0;">
                      <div class="theme-preview-sidebar" style="background:#f1f5f9; border-right:1px solid #e2e8f0;">
                        <div style="width:14px; height:3px; background:#2563eb; border-radius:1px; margin-bottom:6px;"></div>
                        <div style="width:10px; height:3px; background:#cbd5e1; border-radius:1px; margin-bottom:4px;"></div>
                        <div style="width:10px; height:3px; background:#cbd5e1; border-radius:1px;"></div>
                      </div>
                      <div class="theme-preview-content">
                        <div class="theme-preview-header" style="background:#ffffff; border-bottom:1px solid #e2e8f0;">
                          <div style="width:24px; height:4px; background:#0f172a; border-radius:2px;"></div>
                          <div style="width:12px; height:4px; background:#2563eb; border-radius:2px;"></div>
                        </div>
                        <div class="theme-preview-cards">
                          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:4px; padding:5px; margin-bottom:4px;">
                            <div style="width:65%; height:3px; background:#2563eb; border-radius:1px; margin-bottom:3px;"></div>
                            <div style="width:40%; height:2px; background:#94a3b8; border-radius:1px;"></div>
                          </div>
                          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:4px; padding:4px; display:flex; gap:4px;">
                            <div style="width:30%; height:3px; background:#16a34a; border-radius:1px;"></div>
                            <div style="width:30%; height:3px; background:#d97706; border-radius:1px;"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <div class="theme-card-title-row">
                        <span class="theme-card-title">Clean Light</span>
                        <span class="badge" style="font-size:10px; color:#2563eb; background:rgba(37,99,235,0.12); border:1px solid rgba(37,99,235,0.25);">Light</span>
                      </div>
                      <p class="theme-card-desc">High-clarity white surfaces with soft borders and royal blue accenting.</p>
                    </div>
                    <div class="theme-card-check">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </div>

                </div>
              </div>

              <div class="settings-row" style="margin-top:1.5rem;">
                <div class="settings-row-info">
                  <h4>Quick Theme Selection</h4>
                  <p>Choose an explicit theme or follow your operating system appearance.</p>
                </div>
                <select class="form-control" id="cfgThemeSelectDirect" style="max-width:240px;">
                  <option value="crimson">Charcoal Crimson (Featured)</option>
                  <option value="sage">Mint Sage (Crewix Green)</option>
                  <option value="dark">Slate Dark</option>
                  <option value="light">Clean Light</option>
                  <option value="system">Follow System</option>
                </select>
              </div>
            </div>

            <!-- 3. APPEARANCE -->
            <div class="settings-section-pane hidden" id="pane-appearance">
              <div class="settings-panel-header">
                <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin:0 0 0.25rem 0;">Appearance</h3>
                <p style="font-size:var(--text-xs); color:var(--text-sub); margin:0;">Choose how the application looks and how dense tables should be.</p>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <h4>Theme Mode</h4>
                  <p>Choose the interface theme preset.</p>
                </div>
                <select class="form-control" id="cfgThemeSelect" style="max-width:240px;">
                  <option value="crimson">Charcoal Crimson (Featured)</option>
                  <option value="sage">Mint Sage (Crewix Green)</option>
                  <option value="dark">Slate Dark</option>
                  <option value="light">Clean Light</option>
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
                <button class="btn btn-secondary btn-sm" id="btnPurgeSession" type="button" class="btn btn-secondary btn-sm settings-danger-action">Clear Session Cache</button>
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

    const syncThemeSelectionUI = (themeVal) => {
      let effectiveTheme = themeVal;
      if (themeVal === 'system') {
        const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        effectiveTheme = isSystemDark ? (localStorage.getItem('workflow_capture_dark_preset') || 'crimson') : 'light';
      }
      document.querySelectorAll('.theme-card').forEach(card => {
        const val = card.dataset.themeValue;
        const isActive = val === effectiveTheme ||
          (val === 'crimson' && (effectiveTheme === 'crimson' || effectiveTheme === 'charcoal-crimson')) ||
          (val === 'sage' && (effectiveTheme === 'sage' || effectiveTheme === 'mint'));
        card.classList.toggle('active', Boolean(isActive));
      });
      const badge = document.getElementById('activeThemeBadge');
      if (badge) {
        if (effectiveTheme === 'crimson' || effectiveTheme === 'charcoal-crimson') {
          badge.textContent = 'Charcoal Crimson';
          badge.style.background = 'rgba(240, 68, 56, 0.14)';
          badge.style.color = '#f04438';
          badge.style.border = '1px solid rgba(240, 68, 56, 0.3)';
        } else if (effectiveTheme === 'sage' || effectiveTheme === 'mint') {
          badge.textContent = 'Mint Sage';
          badge.style.background = 'rgba(34, 130, 73, 0.14)';
          badge.style.color = '#228249';
          badge.style.border = '1px solid rgba(34, 130, 73, 0.3)';
        } else if (effectiveTheme === 'dark') {
          badge.textContent = 'Slate Dark';
          badge.style.background = 'rgba(96, 165, 250, 0.14)';
          badge.style.color = '#60a5fa';
          badge.style.border = '1px solid rgba(96, 165, 250, 0.3)';
        } else {
          badge.textContent = 'Clean Light';
          badge.style.background = 'rgba(37, 99, 235, 0.14)';
          badge.style.color = '#2563eb';
          badge.style.border = '1px solid rgba(37, 99, 235, 0.3)';
        }
      }
      const select1 = document.getElementById('cfgThemeSelect');
      if (select1) select1.value = themeVal;
      const select2 = document.getElementById('cfgThemeSelectDirect');
      if (select2) select2.value = themeVal;
    };

    this.syncThemeUI = syncThemeSelectionUI;

    const initialSavedTheme = localStorage.getItem('workflow_capture_theme') || (Theme && Theme.current) || 'crimson';
    syncThemeSelectionUI(initialSavedTheme);

    const onThemeChange = (newTheme) => {
      if (Theme && typeof Theme.setTheme === 'function') {
        Theme.setTheme(newTheme);
      } else {
        document.documentElement.setAttribute('data-theme', newTheme);
        try { localStorage.setItem('workflow_capture_theme', newTheme); } catch (e) {}
      }
      syncThemeSelectionUI(newTheme);
      this.markDirty();
    };

    document.querySelectorAll('.theme-card').forEach(card => {
      card.onclick = () => onThemeChange(card.dataset.themeValue);
      card.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onThemeChange(card.dataset.themeValue);
        }
      };
    });

    const themeSelect = document.getElementById('cfgThemeSelect');
    if (themeSelect) {
      themeSelect.onchange = (e) => onThemeChange(e.target.value);
    }
    const themeSelectDirect = document.getElementById('cfgThemeSelectDirect');
    if (themeSelectDirect) {
      themeSelectDirect.onchange = (e) => onThemeChange(e.target.value);
    }

    window.addEventListener('workflow-capture-theme-change', (e) => {
      if (e.detail && e.detail.theme) {
        syncThemeSelectionUI(e.detail.theme);
      }
    });

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
        maskCredentials: Boolean(document.getElementById('cfgMaskCredentials')?.checked),
        theme: document.getElementById('cfgThemeSelectDirect')?.value || document.getElementById('cfgThemeSelect')?.value || 'crimson'
      };
      try {
        await Api.saveBotConfig(cfg);
        localStorage.setItem('workflow_capture_settings', JSON.stringify(localPrefs));
        this.currentConfig = { ...this.currentConfig, ...cfg, preferences: localPrefs };
        this.markSaved();
        Toast.success('Settings saved successfully');
          this.setSaveState('Saved');
      } catch (err) {
        Toast.error(err.message || 'Failed to save settings');
          this.setSaveState('Unsaved changes');
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

  setSaveState(state) {
    const el = document.getElementById('settingsSaveState');
    if (el) el.textContent = state;
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

      if (localPrefs.theme && typeof this.syncThemeUI === 'function') {
        this.syncThemeUI(localPrefs.theme);
      }

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
