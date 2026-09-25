/**
 * Workflow Capture — Bot Profile & Stealth Configuration View
 * 
 * Interactive control room for tuning humanized mouse trajectories,
 * stochastic keystroke dynamics, click jitter, and anti-captcha evasion.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const BotConfigView = {
  currentConfig: null,
  presets: {},
  canvasAnimId: null,

  async render(container) {
    container.innerHTML = `
      <section class="card" style="min-height:75vh; padding:1.5rem;">
        
        <!-- Header -->
        <div class="card-header-row" style="margin-bottom:1.5rem; align-items:flex-start;">
          <div class="card-title-wrap">
            <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.25rem;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-forest);"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8.01" y2="16"></line><line x1="16" y1="16" x2="16.01" y2="16"></line></svg>
              <h2 style="font-size:1.25rem; font-weight:800; color:var(--text-main); margin:0;">Bot Profile & Anti-Captcha Stealth</h2>
            </div>
            <p style="color:var(--text-sub); font-size:0.8rem;">
              Fine-tune click timing, human Bezier mouse curves, typing cadence, and browser fingerprint masking to bypass bot detection.
            </p>
          </div>

          <div style="display:flex; gap:0.6rem; align-items:center;">
            <button class="btn btn-secondary btn-sm" id="btnResetBotDefaults" title="Restore standard default parameters">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
              <span>Reset Defaults</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btnSaveBotConfig" style="padding:0.45rem 1.15rem; font-weight:800;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save Configuration</span>
            </button>
          </div>
        </div>

        <!-- Preset Selection Ribbon -->
        <div style="margin-bottom:1.5rem;">
          <label style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-sub); display:block; margin-bottom:0.6rem;">
            Stealth Behavior Preset
          </label>
          <div class="bot-preset-grid">
            <div class="bot-preset-card active" data-preset="ultra_stealth">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                <strong style="font-size:0.88rem; color:var(--text-main); display:inline-flex; align-items:center; gap:0.35rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                  Ultra Stealth
                </strong>
                <span class="badge-tag success" style="font-size:0.65rem;">Max Evasion</span>
              </div>
              <p style="font-size:0.72rem; color:var(--text-sub); margin:0; line-height:1.35;">
                Complex Bezier curves, randomized micro-wobbles, realistic typing pauses & complete navigator spoofing.
              </p>
            </div>

            <div class="bot-preset-card" data-preset="balanced">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                <strong style="font-size:0.88rem; color:var(--text-main); display:inline-flex; align-items:center; gap:0.35rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line></svg>
                  Balanced
                </strong>
                <span class="badge-tag info" style="font-size:0.65rem;">Recommended</span>
              </div>
              <p style="font-size:0.72rem; color:var(--text-sub); margin:0; line-height:1.35;">
                Natural human timing with smooth mouse curves and optimal execution throughput.
              </p>
            </div>

            <div class="bot-preset-card" data-preset="fast">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                <strong style="font-size:0.88rem; color:var(--text-main); display:inline-flex; align-items:center; gap:0.35rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  Fast Track
                </strong>
                <span class="badge-tag amber" style="font-size:0.65rem;">Dev & Tests</span>
              </div>
              <p style="font-size:0.72rem; color:var(--text-sub); margin:0; line-height:1.35;">
                Instant click dispatch and minimal typing delays for swift local automation & regression tests.
              </p>
            </div>

            <div class="bot-preset-card" data-preset="erp">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                <strong style="font-size:0.88rem; color:var(--text-main); display:inline-flex; align-items:center; gap:0.35rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
                  ERP / CityMart
                </strong>
                <span class="badge-tag purple" style="font-size:0.65rem;">Slow & Patient</span>
              </div>
              <p style="font-size:0.72rem; color:var(--text-sub); margin:0; line-height:1.35;">
                Generous delays (2s - 4.5s) & patient polling (15s) for heavy data grids, loading spinners & ExtJS portals.
              </p>
            </div>
          </div>
        </div>

        <!-- 4-Section Configuration Grid -->
        <div class="bot-config-grid">
          
          <!-- Card 1: Click & Action Timing -->
          <article class="card" style="padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:0.75rem;">
              <div class="card-title-wrap">
                <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:inline-flex; align-items:center; gap:0.4rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  Action & Step Pacing Delays
                </h3>
                <p style="font-size:0.72rem; color:var(--text-sub);">Sets how long the bot waits between actions and page loads</p>
              </div>
            </div>

            <!-- Quick Step Delay Buttons -->
            <div style="margin-bottom:1rem;">
              <label style="font-size:0.72rem; font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.35rem;">Quick Step Delay Presets</label>
              <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:0.4rem;">
                <button type="button" class="btn btn-xs btn-secondary btn-delay-preset" data-min="100" data-max="300" data-pre="50" style="justify-content:flex-start; padding:0.35rem 0.5rem; font-size:0.7rem; font-weight:600;">
                  ⚡ Fast (200ms)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-delay-preset" data-min="250" data-max="650" data-pre="100" style="justify-content:flex-start; padding:0.35rem 0.5rem; font-size:0.7rem; font-weight:600;">
                  ⚖️ Normal (500ms)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-delay-preset" data-min="2000" data-max="4500" data-pre="800" style="justify-content:flex-start; padding:0.35rem 0.5rem; font-size:0.7rem; font-weight:600;">
                  🏢 ERP / CityMart (3.5s)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-delay-preset" data-min="5000" data-max="8000" data-pre="1500" style="justify-content:flex-start; padding:0.35rem 0.5rem; font-size:0.7rem; font-weight:600;">
                  ⏳ Deep Wait (6.5s)
                </button>
              </div>
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgMinActionDelay">Min Action Delay</label>
                <span class="slider-val" id="valMinActionDelay">250 ms</span>
              </div>
              <input type="range" id="cfgMinActionDelay" min="20" max="10000" step="50" value="250" class="bot-slider">
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgMaxActionDelay">Max Action Delay</label>
                <span class="slider-val" id="valMaxActionDelay">650 ms</span>
              </div>
              <input type="range" id="cfgMaxActionDelay" min="50" max="20000" step="100" value="650" class="bot-slider">
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgClickJitter">Click Timing Jitter (+/-)</label>
                <span class="slider-val" id="valClickJitter">120 ms</span>
              </div>
              <input type="range" id="cfgClickJitter" min="0" max="1000" step="20" value="120" class="bot-slider">
            </div>

            <div class="form-group">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgPreActionDelay">Pre-Interaction Hesitation</label>
                <span class="slider-val" id="valPreActionDelay">100 ms</span>
              </div>
              <input type="range" id="cfgPreActionDelay" min="0" max="5000" step="50" value="100" class="bot-slider">
            </div>
          </article>

          <!-- Card 2: Mouse Trajectory Dynamics + Live Canvas Simulator -->
          <article class="card" style="padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:0.85rem;">
              <div class="card-title-wrap">
                <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:inline-flex; align-items:center; gap:0.4rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="7"></rect><line x1="12" y1="6" x2="12" y2="10"></line></svg>
                  Mouse Movement & Bezier Curves
                </h3>
                <p style="font-size:0.72rem; color:var(--text-sub);">Humanized curved paths with acceleration & micro-wobble</p>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="cfgMouseEnabled" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; margin-bottom:0.85rem;">
              <div class="form-group">
                <label for="cfgMouseSpeed" style="font-size:0.72rem; font-weight:700;">Speed Profile</label>
                <select id="cfgMouseSpeed" class="form-control form-control-sm">
                  <option value="human">Realistic Human</option>
                  <option value="medium" selected>Smooth Medium</option>
                  <option value="slow">Slow & Deliberate</option>
                  <option value="fast">Swift Glide</option>
                </select>
              </div>

              <div class="form-group">
                <div style="display:flex; justify-content:space-between; font-size:0.72rem; font-weight:700; margin-bottom:0.25rem;">
                  <label for="cfgMouseWobble">Hand Wobble</label>
                  <span id="valMouseWobble">2 px</span>
                </div>
                <input type="range" id="cfgMouseWobble" min="0" max="8" step="1" value="2" class="bot-slider">
              </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.85rem;">
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-body);">Target Overshoot & Correction</label>
              <label class="toggle-switch">
                <input type="checkbox" id="cfgMouseOvershoot" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <!-- Live Mouse Trajectory Preview Canvas -->
            <div style="background:var(--input-bg); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:0.65rem; position:relative;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                <span style="font-size:0.68rem; font-weight:800; color:var(--brand-forest); text-transform:uppercase;">Live Trajectory Simulator</span>
                <button class="btn btn-xs btn-primary" id="btnTestMousePath" style="display:inline-flex; align-items:center; gap:0.3rem;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <span>Draw Path</span>
                </button>
              </div>
              <canvas id="mouseTrajectoryCanvas" width="300" height="100" style="width:100%; height:95px; background:var(--card-bg-solid); border-radius:6px; border:1px solid var(--border-light); display:block;"></canvas>
            </div>
          </article>

          <!-- Card 3: Keystroke Dynamics & Typing Cadence -->
          <article class="card" style="padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:1rem;">
              <div class="card-title-wrap">
                <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:inline-flex; align-items:center; gap:0.4rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="6" y1="8" x2="6" y2="8"></line><line x1="10" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="14" y2="8"></line><line x1="18" y1="8" x2="18" y2="8"></line><line x1="6" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="18" y2="12"></line><line x1="10" y1="16" x2="14" y2="16"></line></svg>
                  Keystroke Cadence & Rhythm
                </h3>
                <p style="font-size:0.72rem; color:var(--text-sub);">Stochastic character typing speed and punctuation pauses</p>
              </div>
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgMinTypingDelay">Min Typing Delay</label>
                <span class="slider-val" id="valMinTypingDelay">40 ms/key</span>
              </div>
              <input type="range" id="cfgMinTypingDelay" min="5" max="250" step="5" value="40" class="bot-slider">
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgMaxTypingDelay">Max Typing Delay</label>
                <span class="slider-val" id="valMaxTypingDelay">120 ms/key</span>
              </div>
              <input type="range" id="cfgMaxTypingDelay" min="20" max="500" step="10" value="120" class="bot-slider">
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgPunctuationPause">Punctuation / Space Pause</label>
                <span class="slider-val" id="valPunctuationPause">180 ms</span>
              </div>
              <input type="range" id="cfgPunctuationPause" min="0" max="800" step="20" value="180" class="bot-slider">
            </div>

            <!-- Interactive Typing Tester -->
            <div style="background:var(--input-bg); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:0.65rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                <span style="font-size:0.68rem; font-weight:800; color:var(--text-sub); text-transform:uppercase;">Typing Rhythm Tester</span>
                <button class="btn btn-xs btn-dark" id="btnTestTypingCadence">Type Test</button>
              </div>
              <input type="text" id="typingTestDisplay" class="form-control form-control-sm" placeholder="Simulated bot typing output..." readonly style="font-family:var(--font-mono); font-size:0.75rem;">
            </div>
          </article>

          <!-- Card 4: Anti-Detection & Captcha Evasion -->
          <article class="card" style="padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:1rem;">
              <div class="card-title-wrap">
                <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:inline-flex; align-items:center; gap:0.4rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                  Anti-Captcha & Fingerprint Masking
                </h3>
                <p style="font-size:0.72rem; color:var(--text-sub);">Eliminates automated browser fingerprints and heuristics</p>
              </div>
              <span class="badge-tag success" id="stealthScoreBadge">99.2% Clean</span>
            </div>

            <div style="display:flex; flex-direction:column; gap:0.85rem;">
              
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:var(--input-bg); border-radius:var(--radius-md); border:1px solid var(--border-light);">
                <div>
                  <strong style="font-size:0.75rem; color:var(--text-main); display:block;">Mask <code>navigator.webdriver</code></strong>
                  <small style="font-size:0.65rem; color:var(--text-sub);">Deletes automation flag checked by Cloudflare & reCAPTCHA</small>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgMaskWebdriver" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:var(--input-bg); border-radius:var(--radius-md); border:1px solid var(--border-light);">
                <div>
                  <strong style="font-size:0.75rem; color:var(--text-main); display:block;">Emulate Chrome Runtime</strong>
                  <small style="font-size:0.65rem; color:var(--text-sub);">Fakes <code>window.chrome.runtime</code> and standard browser APIs</small>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgEmulateChromeRuntime" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:var(--input-bg); border-radius:var(--radius-md); border:1px solid var(--border-light);">
                <div>
                  <strong style="font-size:0.75rem; color:var(--text-main); display:block;">Emulate Browser Plugins</strong>
                  <small style="font-size:0.65rem; color:var(--text-sub);">Populates mock PDF and Widevine plugins array</small>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgEmulatePlugins" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:var(--input-bg); border-radius:var(--radius-md); border:1px solid var(--border-light);">
                <div>
                  <strong style="font-size:0.75rem; color:var(--text-main); display:block;">Randomized Viewport Pre-Scroll</strong>
                  <small style="font-size:0.65rem; color:var(--text-sub);">Simulates reading gestures before interacting with elements</small>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="cfgRandomizeScroll">
                  <span class="toggle-slider"></span>
                </label>
              </div>

            </div>
          </article>

          <!-- Card 5: Dynamic Resolution & Condition Polling Engine -->
          <article class="card" style="padding:1.25rem;">
            <div class="card-header-row" style="margin-bottom:1rem;">
              <div class="card-title-wrap">
                <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:inline-flex; align-items:center; gap:0.4rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline><path d="M16 16l4 4"></path></svg>
                  DOM Resolution & Condition Polling
                </h3>
                <p style="font-size:0.72rem; color:var(--text-sub);">Configure in-page polling interval and maximum dynamic wait timeout</p>
              </div>
            </div>

            <!-- Quick Preset Buttons -->
            <div style="margin-bottom:1.15rem;">
              <label style="font-size:0.72rem; font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.4rem;">Preferred Wait Presets</label>
              <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.45rem;">
                <button type="button" class="btn btn-xs btn-secondary btn-resolution-preset" data-timeout="3000" data-poll="50" style="justify-content:flex-start; text-align:left; padding:0.4rem 0.55rem; font-weight:600;">
                  ⚡ Fast (3s / 50ms)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-resolution-preset" data-timeout="5000" data-poll="100" style="justify-content:flex-start; text-align:left; padding:0.4rem 0.55rem; font-weight:600;">
                  ⚖️ Default (5s / 100ms)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-resolution-preset" data-timeout="15000" data-poll="150" style="justify-content:flex-start; text-align:left; padding:0.4rem 0.55rem; font-weight:600;">
                  🏢 ERP / CityMart (15s / 150ms)
                </button>
                <button type="button" class="btn btn-xs btn-secondary btn-resolution-preset" data-timeout="30000" data-poll="250" style="justify-content:flex-start; text-align:left; padding:0.4rem 0.55rem; font-weight:600;">
                  ⏳ Deep Wait (30s / 250ms)
                </button>
              </div>
            </div>

            <div class="form-group" style="margin-bottom:1rem;">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgResolutionTimeout">Max Resolution Timeout</label>
                <span class="slider-val" id="valResolutionTimeout">5000 ms</span>
              </div>
              <input type="range" id="cfgResolutionTimeout" min="1000" max="60000" step="1000" value="5000" class="bot-slider">
              <small style="font-size:0.65rem; color:var(--text-sub); display:block; margin-top:0.2rem;">Max time to wait for dynamic modals, ExtJS grids, or async DOM insertions.</small>
            </div>

            <div class="form-group">
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">
                <label for="cfgPollInterval">Condition Polling Interval</label>
                <span class="slider-val" id="valPollInterval">100 ms</span>
              </div>
              <input type="range" id="cfgPollInterval" min="20" max="1000" step="10" value="100" class="bot-slider">
              <small style="font-size:0.65rem; color:var(--text-sub); display:block; margin-top:0.2rem;">Active in-page query frequency to evaluate candidates and fingerprint scores.</small>
            </div>
          </article>

        </div>

      </section>
    `;

    this.bindEvents();
    await this.loadConfig();
    this.initCanvas();
  },

  async loadConfig() {
    try {
      const res = await Api.getBotConfig();
      if (res.success) {
        this.currentConfig = res.config;
        this.presets = res.presets || {};
        this.populateForm(this.currentConfig);
      }
    } catch (err) {
      Toast.error(`Failed to load bot config: ${err.message}`);
    }
  },

  populateForm(cfg) {
    if (!cfg) return;

    // Presets Ribbon
    document.querySelectorAll('.bot-preset-card').forEach(card => {
      if (card.getAttribute('data-preset') === cfg.preset) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Timing
    if (cfg.timing) {
      this.setVal('cfgMinActionDelay', cfg.timing.minActionDelayMs, 'valMinActionDelay', ' ms');
      this.setVal('cfgMaxActionDelay', cfg.timing.maxActionDelayMs, 'valMaxActionDelay', ' ms');
      this.setVal('cfgClickJitter', cfg.timing.clickJitterMs, 'valClickJitter', ' ms');
      this.setVal('cfgPreActionDelay', cfg.timing.preActionDelayMs, 'valPreActionDelay', ' ms');
    }

    // Mouse
    if (cfg.mouse) {
      const elEnable = document.getElementById('cfgMouseEnabled');
      if (elEnable) elEnable.checked = cfg.mouse.enabled !== false;
      const elSpeed = document.getElementById('cfgMouseSpeed');
      if (elSpeed) elSpeed.value = cfg.mouse.speed || 'medium';
      this.setVal('cfgMouseWobble', cfg.mouse.wobble ?? 2, 'valMouseWobble', ' px');
      const elOvershoot = document.getElementById('cfgMouseOvershoot');
      if (elOvershoot) elOvershoot.checked = cfg.mouse.overshoot !== false;
    }

    // Typing
    if (cfg.typing) {
      this.setVal('cfgMinTypingDelay', cfg.typing.minTypingDelayMs, 'valMinTypingDelay', ' ms/key');
      this.setVal('cfgMaxTypingDelay', cfg.typing.maxTypingDelayMs, 'valMaxTypingDelay', ' ms/key');
      this.setVal('cfgPunctuationPause', cfg.typing.punctuationPauseMs, 'valPunctuationPause', ' ms');
    }

    // Resolution & Condition Polling
    if (cfg.resolution) {
      this.setVal('cfgResolutionTimeout', cfg.resolution.timeoutMs || 5000, 'valResolutionTimeout', ' ms');
      this.setVal('cfgPollInterval', cfg.resolution.pollIntervalMs || 100, 'valPollInterval', ' ms');
    }

    // Stealth
    if (cfg.stealth) {
      const elMask = document.getElementById('cfgMaskWebdriver');
      if (elMask) elMask.checked = cfg.stealth.maskWebdriver !== false;
      const elRuntime = document.getElementById('cfgEmulateChromeRuntime');
      if (elRuntime) elRuntime.checked = cfg.stealth.emulateChromeRuntime !== false;
      const elPlugins = document.getElementById('cfgEmulatePlugins');
      if (elPlugins) elPlugins.checked = cfg.stealth.emulatePlugins !== false;
      const elScroll = document.getElementById('cfgRandomizeScroll');
      if (elScroll) elScroll.checked = !!cfg.stealth.randomizeScroll;
    }

    this.updateStealthScore();
  },

  setVal(inputId, val, labelId, suffix = '') {
    const el = document.getElementById(inputId);
    if (el) el.value = val;
    const label = document.getElementById(labelId);
    if (label) label.textContent = `${val}${suffix}`;
  },

  getFormData() {
    return {
      preset: document.querySelector('.bot-preset-card.active')?.getAttribute('data-preset') || 'custom',
      timing: {
        minActionDelayMs: parseInt(document.getElementById('cfgMinActionDelay')?.value || '250', 10),
        maxActionDelayMs: parseInt(document.getElementById('cfgMaxActionDelay')?.value || '650', 10),
        clickJitterMs: parseInt(document.getElementById('cfgClickJitter')?.value || '120', 10),
        preActionDelayMs: parseInt(document.getElementById('cfgPreActionDelay')?.value || '100', 10)
      },
      mouse: {
        enabled: !!document.getElementById('cfgMouseEnabled')?.checked,
        speed: document.getElementById('cfgMouseSpeed')?.value || 'medium',
        wobble: parseInt(document.getElementById('cfgMouseWobble')?.value || '2', 10),
        overshoot: !!document.getElementById('cfgMouseOvershoot')?.checked,
        hoverBeforeClickMs: 140,
        steps: 24
      },
      typing: {
        minTypingDelayMs: parseInt(document.getElementById('cfgMinTypingDelay')?.value || '40', 10),
        maxTypingDelayMs: parseInt(document.getElementById('cfgMaxTypingDelay')?.value || '120', 10),
        punctuationPauseMs: parseInt(document.getElementById('cfgPunctuationPause')?.value || '180', 10),
        variance: 'uniform'
      },
      resolution: {
        timeoutMs: parseInt(document.getElementById('cfgResolutionTimeout')?.value || '5000', 10),
        pollIntervalMs: parseInt(document.getElementById('cfgPollInterval')?.value || '100', 10)
      },
      stealth: {
        maskWebdriver: !!document.getElementById('cfgMaskWebdriver')?.checked,
        emulateChromeRuntime: !!document.getElementById('cfgEmulateChromeRuntime')?.checked,
        emulatePlugins: !!document.getElementById('cfgEmulatePlugins')?.checked,
        randomizeScroll: !!document.getElementById('cfgRandomizeScroll')?.checked,
        spoofUserAgent: false
      }
    };
  },

  bindEvents() {
    // Slider value sync
    const setupSlider = (id, labelId, suffix) => {
      const el = document.getElementById(id);
      const label = document.getElementById(labelId);
      if (el && label) {
        el.oninput = () => {
          label.textContent = `${el.value}${suffix}`;
          this.markCustomPreset();
          this.updateStealthScore();
        };
      }
    };

    setupSlider('cfgMinActionDelay', 'valMinActionDelay', ' ms');
    setupSlider('cfgMaxActionDelay', 'valMaxActionDelay', ' ms');
    setupSlider('cfgClickJitter', 'valClickJitter', ' ms');
    setupSlider('cfgPreActionDelay', 'valPreActionDelay', ' ms');
    setupSlider('cfgMouseWobble', 'valMouseWobble', ' px');
    setupSlider('cfgMinTypingDelay', 'valMinTypingDelay', ' ms/key');
    setupSlider('cfgMaxTypingDelay', 'valMaxTypingDelay', ' ms/key');
    setupSlider('cfgPunctuationPause', 'valPunctuationPause', ' ms');
    setupSlider('cfgResolutionTimeout', 'valResolutionTimeout', ' ms');
    setupSlider('cfgPollInterval', 'valPollInterval', ' ms');

    // Quick Step Delay Preset Buttons
    document.querySelectorAll('.btn-delay-preset').forEach(btn => {
      btn.onclick = () => {
        const min = btn.getAttribute('data-min');
        const max = btn.getAttribute('data-max');
        const pre = btn.getAttribute('data-pre');
        if (min) this.setVal('cfgMinActionDelay', min, 'valMinActionDelay', ' ms');
        if (max) this.setVal('cfgMaxActionDelay', max, 'valMaxActionDelay', ' ms');
        if (pre) this.setVal('cfgPreActionDelay', pre, 'valPreActionDelay', ' ms');
        this.markCustomPreset();
        Toast.info(`Set step delay to ${min}ms - ${max}ms`);
      };
    });

    // Quick Resolution Preset Buttons
    document.querySelectorAll('.btn-resolution-preset').forEach(btn => {
      btn.onclick = () => {
        const timeout = btn.getAttribute('data-timeout');
        const poll = btn.getAttribute('data-poll');
        if (timeout) this.setVal('cfgResolutionTimeout', timeout, 'valResolutionTimeout', ' ms');
        if (poll) this.setVal('cfgPollInterval', poll, 'valPollInterval', ' ms');
        this.markCustomPreset();
        Toast.info(`Set resolution timeout to ${timeout}ms & polling to ${poll}ms`);
      };
    });

    // Preset cards
    document.querySelectorAll('.bot-preset-card').forEach(card => {
      card.onclick = () => {
        document.querySelectorAll('.bot-preset-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const presetKey = card.getAttribute('data-preset');
        if (this.presets[presetKey]) {
          this.populateForm({ preset: presetKey, ...this.presets[presetKey] });
          Toast.info(`Applied "${this.presets[presetKey].name}" preset.`);
          this.animateMousePath();
        }
      };
    });

    // Save
    const btnSave = document.getElementById('btnSaveBotConfig');
    if (btnSave) {
      btnSave.onclick = async () => {
        btnSave.disabled = true;
        btnSave.textContent = 'Saving...';
        try {
          const data = this.getFormData();
          const res = await Api.updateBotConfig(data);
          if (res.success) {
            this.currentConfig = res.config;
            Toast.success('Bot stealth configuration saved successfully!');
          }
        } catch (err) {
          Toast.error(err.message);
        } finally {
          btnSave.disabled = false;
          btnSave.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span>Save Configuration</span>';
        }
      };
    }

    // Reset Defaults
    const btnReset = document.getElementById('btnResetBotDefaults');
    if (btnReset) {
      btnReset.onclick = async () => {
        if (!confirm('Reset bot configuration parameters to Balanced default?')) return;
        try {
          const res = await Api.resetBotConfig('balanced');
          if (res.success) {
            this.currentConfig = res.config;
            this.populateForm(res.config);
            Toast.success('Restored default bot configuration!');
            this.animateMousePath();
          }
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    // Test Mouse Path
    const btnTestMouse = document.getElementById('btnTestMousePath');
    if (btnTestMouse) {
      btnTestMouse.onclick = () => this.animateMousePath();
    }

    // Test Typing
    const btnTestTyping = document.getElementById('btnTestTypingCadence');
    if (btnTestTyping) {
      btnTestTyping.onclick = () => this.runTypingSimulator();
    }
  },

  markCustomPreset() {
    document.querySelectorAll('.bot-preset-card').forEach(c => c.classList.remove('active'));
  },

  updateStealthScore() {
    let score = 95.0;
    const isMaskWebdriver = document.getElementById('cfgMaskWebdriver')?.checked;
    const isRuntime = document.getElementById('cfgEmulateChromeRuntime')?.checked;
    const isPlugins = document.getElementById('cfgEmulatePlugins')?.checked;
    const isMouse = document.getElementById('cfgMouseEnabled')?.checked;
    const minDelay = parseInt(document.getElementById('cfgMinActionDelay')?.value || '250', 10);

    if (!isMaskWebdriver) score -= 35;
    if (!isRuntime) score -= 15;
    if (!isPlugins) score -= 15;
    if (!isMouse) score -= 20;
    if (minDelay < 100) score -= 10;

    score = Math.max(10, Math.min(99.8, score));
    const badge = document.getElementById('stealthScoreBadge');
    if (badge) {
      badge.textContent = `${score.toFixed(1)}% Undetected`;
      if (score >= 85) badge.className = 'badge-tag success';
      else if (score >= 60) badge.className = 'badge-tag amber';
      else badge.className = 'badge-tag danger';
    }
  },

  initCanvas() {
    const canvas = document.getElementById('mouseTrajectoryCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.animateMousePath();
  },

  animateMousePath() {
    const canvas = document.getElementById('mouseTrajectoryCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid dots
    ctx.fillStyle = 'rgba(12, 92, 63, 0.08)';
    for (let x = 10; x < canvas.width; x += 15) {
      for (let y = 10; y < canvas.height; y += 15) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    const wobble = parseInt(document.getElementById('cfgMouseWobble')?.value || '2', 10);
    const overshoot = !!document.getElementById('cfgMouseOvershoot')?.checked;
    const mouseEnabled = !!document.getElementById('cfgMouseEnabled')?.checked;

    const startX = 25, startY = 70;
    const endX = 270, endY = 25;

    // Draw Start & End Targets
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(startX, startY, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4f46e5';
    ctx.beginPath();
    ctx.arc(endX, endY, 6, 0, Math.PI * 2);
    ctx.fill();

    if (!mouseEnabled) {
      // Direct mechanical jump line
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Bezier control points
    const cp1x = startX + (endX - startX) * 0.3 + (Math.random() * 40 - 20);
    const cp1y = startY - 45 + (Math.random() * 20 - 10);
    let cp2x = startX + (endX - startX) * 0.75 + (Math.random() * 30 - 15);
    let cp2y = endY + 25 + (Math.random() * 20 - 10);

    if (overshoot) {
      cp2x += 8;
      cp2y -= 6;
    }

    // Generate path points with wobble
    const points = [];
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      let x = uuu * startX + 3 * uu * t * cp1x + 3 * u * tt * cp2x + ttt * endX;
      let y = uuu * startY + 3 * uu * t * cp1y + 3 * u * tt * cp2y + ttt * endY;

      if (wobble > 0 && i > 2 && i < steps - 2) {
        x += (Math.random() * wobble * 2 - wobble);
        y += (Math.random() * wobble * 2 - wobble);
      }
      points.push({ x, y });
    }

    // Draw animated trajectory
    let currentIdx = 0;
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';

    const drawStep = () => {
      if (currentIdx >= points.length - 1) return;
      ctx.beginPath();
      ctx.moveTo(points[currentIdx].x, points[currentIdx].y);
      ctx.lineTo(points[currentIdx + 1].x, points[currentIdx + 1].y);
      ctx.stroke();
      currentIdx++;
      setTimeout(drawStep, 16);
    };

    drawStep();
  },

  async runTypingSimulator() {
    const input = document.getElementById('typingTestDisplay');
    if (!input) return;

    const sampleText = 'Human typing with anti-captcha cadence...';
    input.value = '';

    const minDelay = parseInt(document.getElementById('cfgMinTypingDelay')?.value || '40', 10);
    const maxDelay = parseInt(document.getElementById('cfgMaxTypingDelay')?.value || '120', 10);
    const pause = parseInt(document.getElementById('cfgPunctuationPause')?.value || '180', 10);

    for (let i = 0; i < sampleText.length; i++) {
      const char = sampleText[i];
      input.value += char;

      let delay = Math.round(Math.random() * (maxDelay - minDelay) + minDelay);
      if (/[.,!?;:\s]/.test(char)) {
        delay += pause;
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
};
