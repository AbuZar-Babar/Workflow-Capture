/**
 * Workflow Capture — Header Component
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Header = {
  elCdpDot: null,
  elCdpText: null,
  elSystemStateText: null,
  elBtnRefreshStatus: null,
  elBtnLaunchChrome: null,
  elSelectTestPortal: null,
  elBtnOpenSelectedPortal: null,
  elGlobalRecordingBanner: null,
  elGlobalRecName: null,
  elGlobalRecMeta: null,
  elBtnGlobalStopRec: null,
  recordingBannerTimer: null,
  recordingStartTime: null,
  lastActionCount: 0,

  init() {
    this.elCdpDot = document.getElementById('cdpDot');
    this.elCdpText = document.getElementById('cdpText');
    this.elSystemStateText = document.getElementById('systemStateText');
    this.elBtnRefreshStatus = document.getElementById('btnRefreshStatus');
    this.elBtnLaunchChrome = document.getElementById('btnLaunchChrome');
    this.elSelectTestPortal = document.getElementById('selectTestPortal');
    this.elBtnOpenSelectedPortal = document.getElementById('btnOpenSelectedPortal');
    this.elGlobalRecordingBanner = document.getElementById('globalRecordingBanner');
    this.elGlobalRecName = document.getElementById('globalRecName');
    this.elGlobalRecMeta = document.getElementById('globalRecMeta');
    this.elBtnGlobalStopRec = document.getElementById('btnGlobalStopRec');

    if (this.elBtnGlobalStopRec) {
      this.elBtnGlobalStopRec.onclick = async () => {
        this.elBtnGlobalStopRec.disabled = true;
        this.elBtnGlobalStopRec.textContent = 'Saving…';
        Toast.info('Stopping and saving recording…');
        try {
          const res = await Api.stopRecording();
          Toast.success(`Recording saved: ${res.summary?.actionCount || 0} steps captured`);
          this.setGlobalRecordingBanner(false);
          const overviewBtnStop = document.getElementById('btnOverviewStopRecHero');
          if (overviewBtnStop) {
            overviewBtnStop.click();
          }
        } catch (err) {
          Toast.error(err.message || 'Failed to stop recording');
        } finally {
          if (this.elBtnGlobalStopRec) {
            this.elBtnGlobalStopRec.disabled = false;
            this.elBtnGlobalStopRec.innerHTML = '<span>■</span> <span>Stop &amp; Save</span>';
          }
        }
      };
    }

    if (this.elBtnRefreshStatus) {
      this.elBtnRefreshStatus.onclick = () => this.refreshStatus();
    }

    if (this.elBtnLaunchChrome) {
      this.elBtnLaunchChrome.onclick = async () => {
        const portal = this.elSelectTestPortal ? this.elSelectTestPortal.value : 'ecommerce';
        Toast.info('Launching Google Chrome with CDP enabled...');
        try {
          const res = await Api.launchBrowser(portal);
          if (res.success) {
            Toast.success('Google Chrome launched with test portal!');
            this.refreshStatus();
          }
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    if (this.elBtnOpenSelectedPortal) {
      this.elBtnOpenSelectedPortal.onclick = async () => {
        const portal = this.elSelectTestPortal ? this.elSelectTestPortal.value : 'ecommerce';
        Toast.info(`Opening ${portal} in Chrome...`);
        try {
          const res = await Api.openPortal(portal);
          if (res.success) {
            Toast.success(`Loaded portal in Chrome!`);
            this.refreshStatus();
          }
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    this.refreshStatus();
    setInterval(() => {
      if (!document.hidden) this.refreshStatus();
    }, 8000);
  },

  setGlobalRecordingBanner(isRecording, meta = {}) {
    if (!this.elGlobalRecordingBanner) {
      this.elGlobalRecordingBanner = document.getElementById('globalRecordingBanner');
      this.elGlobalRecName = document.getElementById('globalRecName');
      this.elGlobalRecMeta = document.getElementById('globalRecMeta');
    }
    if (!this.elGlobalRecordingBanner) return;

    if (isRecording) {
      this.elGlobalRecordingBanner.classList.remove('hidden');
      if (this.elGlobalRecName) {
        this.elGlobalRecName.textContent = meta.name || 'Workflow Recording';
      }
      if (meta.actionCount !== undefined) {
        this.lastActionCount = Number(meta.actionCount);
      }
      this.recordingStartTime = meta.startedAt ? new Date(meta.startedAt).getTime() : (this.recordingStartTime || Date.now());
      const updateMeta = () => {
        if (!this.elGlobalRecMeta || !this.recordingStartTime) return;
        const sec = Math.max(0, Math.floor((Date.now() - this.recordingStartTime) / 1000));
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');
        this.elGlobalRecMeta.textContent = `${mins}:${secs} · ${this.lastActionCount} action${this.lastActionCount === 1 ? '' : 's'}`;
      };
      updateMeta();
      if (!this.recordingBannerTimer) {
        this.recordingBannerTimer = setInterval(updateMeta, 1000);
      }
    } else {
      this.elGlobalRecordingBanner.classList.add('hidden');
      if (this.recordingBannerTimer) {
        clearInterval(this.recordingBannerTimer);
        this.recordingBannerTimer = null;
      }
      this.recordingStartTime = null;
      this.lastActionCount = 0;
    }
  },

  updateRecordingBannerActionCount(count) {
    this.lastActionCount = Number(count) || 0;
    if (!this.elGlobalRecMeta || !this.recordingStartTime) return;
    const sec = Math.max(0, Math.floor((Date.now() - this.recordingStartTime) / 1000));
    const mins = String(Math.floor(sec / 60)).padStart(2, '0');
    const secs = String(sec % 60).padStart(2, '0');
    this.elGlobalRecMeta.textContent = `${mins}:${secs} · ${this.lastActionCount} action${this.lastActionCount === 1 ? '' : 's'}`;
  },

  async refreshStatus() {
    try {
      const data = await Api.getStatus();

      // CDP Pill
      if (data.cdp && data.cdp.online) {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot online';
        const tabCount = data.cdp.tabs ? data.cdp.tabs.length : 0;
        if (this.elCdpText) this.elCdpText.textContent = `CDP Online (${tabCount} tab${tabCount === 1 ? '' : 's'})`;
      } else {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot offline';
        if (this.elCdpText) this.elCdpText.textContent = 'CDP Standby (Port 9222)';
      }

      // Engine & Recorder State
      if (data.recorder && data.recorder.isRecording) {
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'RECORDING';
          this.elSystemStateText.style.color = '#ef4444';
        }
        this.setGlobalRecordingBanner(true, {
          name: data.recorder.name,
          startedAt: data.recorder.startedAt,
          actionCount: data.recorder.actionCount
        });
      } else if (data.replay && data.replay.isReplaying) {
        this.setGlobalRecordingBanner(false);
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'REPLAYING';
          this.elSystemStateText.style.color = '#0284c7';
        }
      } else {
        this.setGlobalRecordingBanner(false);
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'IDLE';
          this.elSystemStateText.style.color = 'var(--brand-forest)';
        }
      }

      return data;
    } catch (err) {
      if (this.elCdpDot) this.elCdpDot.className = 'status-dot offline';
      if (this.elCdpText) this.elCdpText.textContent = 'Server Offline';
    }
  },

  setEngineState(state) {
    if (!this.elSystemStateText) return;
    this.elSystemStateText.textContent = state;
    if (state === 'RECORDING') this.elSystemStateText.style.color = '#ef4444';
    else if (state === 'REPLAYING') this.elSystemStateText.style.color = '#0284c7';
    else this.elSystemStateText.style.color = 'var(--brand-forest)';
  }
};
