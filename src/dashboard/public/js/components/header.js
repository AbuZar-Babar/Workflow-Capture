/**
 * Workflow Capture — Header Component
 * Manages topbar presentation, real-time browser status, and global recording banner.
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Header = {
  elCdpDot: null,
  elCdpText: null,
  elSystemStateText: null,
  elBtnRefreshStatus: null,
  elGlobalRecordingBanner: null,
  elGlobalRecName: null,
  elGlobalRecMeta: null,
  elBtnGlobalStopRec: null,
  recordingBannerTimer: null,
  recordingStartTime: null,
  lastActionCount: 0,
  refreshTimer: null,

  init() {
    this.elCdpDot = document.getElementById('cdpDot');
    this.elCdpText = document.getElementById('cdpText');
    this.elSystemStateText = document.getElementById('systemStateText');
    this.elBtnRefreshStatus = document.getElementById('btnRefreshStatus');
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

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.refreshStatus();
    this.refreshTimer = setInterval(() => {
      if (!document.hidden) this.refreshStatus();
    }, 8000);
  },

  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.recordingBannerTimer) {
      clearInterval(this.recordingBannerTimer);
      this.recordingBannerTimer = null;
    }
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
    if (!this.elCdpDot) this.elCdpDot = document.getElementById('cdpDot');
    if (!this.elCdpText) this.elCdpText = document.getElementById('cdpText');
    if (!this.elSystemStateText) this.elSystemStateText = document.getElementById('systemStateText');

    try {
      const data = await Api.getStatus();

      // State-driven Status Pill with User-Friendly Terminology
      if (data.recorder && data.recorder.isRecording) {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot recording';
        if (this.elCdpText) this.elCdpText.textContent = 'Recording Active';
      } else if (data.replay && data.replay.isReplaying) {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot running';
        if (this.elCdpText) this.elCdpText.textContent = 'Running';
      } else if (data.runs && data.runs.hasActive) {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot running';
        if (this.elCdpText) this.elCdpText.textContent = 'Running';
      } else if (data.cdp && data.cdp.online) {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot online';
        if (this.elCdpText) this.elCdpText.textContent = 'Browser Ready';
      } else {
        if (this.elCdpDot) this.elCdpDot.className = 'status-dot offline';
        if (this.elCdpText) this.elCdpText.textContent = 'Browser Not Connected';
      }

      // Engine & Recorder State
      if (data.recorder && data.recorder.isRecording) {
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'RECORDING';
          this.elSystemStateText.style.color = 'var(--color-danger)';
        }
        this.setGlobalRecordingBanner(true, {
          name: data.recorder.name,
          startedAt: data.recorder.startedAt,
          actionCount: data.recorder.actionCount
        });
      } else if (data.replay && data.replay.isReplaying) {
        this.setGlobalRecordingBanner(false);
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'RUNNING';
          this.elSystemStateText.style.color = 'var(--accent-primary)';
        }
      } else {
        this.setGlobalRecordingBanner(false);
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'IDLE';
          this.elSystemStateText.style.color = 'var(--text-sub)';
        }
      }

      return data;
    } catch (err) {
      if (this.elCdpDot) this.elCdpDot.className = 'status-dot offline';
      if (this.elCdpText) this.elCdpText.textContent = 'Browser Not Connected';
    }
  },

  setEngineState(state) {
    if (!this.elSystemStateText) this.elSystemStateText = document.getElementById('systemStateText');
    if (this.elSystemStateText) {
      this.elSystemStateText.textContent = state;
      if (state === 'RECORDING') this.elSystemStateText.style.color = 'var(--color-danger)';
      else if (state === 'REPLAYING' || state === 'EXECUTING' || state === 'RUNNING') this.elSystemStateText.style.color = 'var(--accent-primary)';
      else this.elSystemStateText.style.color = 'var(--text-sub)';
    }

    if (!this.elCdpDot) this.elCdpDot = document.getElementById('cdpDot');
    if (!this.elCdpText) this.elCdpText = document.getElementById('cdpText');
    if (state === 'RECORDING') {
      if (this.elCdpDot) this.elCdpDot.className = 'status-dot recording';
      if (this.elCdpText) this.elCdpText.textContent = 'Recording Active';
    } else if (state === 'REPLAYING' || state === 'EXECUTING' || state === 'RUNNING') {
      if (this.elCdpDot) this.elCdpDot.className = 'status-dot running';
      if (this.elCdpText) this.elCdpText.textContent = 'Running';
    } else if (state === 'IDLE') {
      this.refreshStatus();
    }
  }
};
