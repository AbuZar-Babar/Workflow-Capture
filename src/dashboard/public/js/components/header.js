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

  init() {
    this.elCdpDot = document.getElementById('cdpDot');
    this.elCdpText = document.getElementById('cdpText');
    this.elSystemStateText = document.getElementById('systemStateText');
    this.elBtnRefreshStatus = document.getElementById('btnRefreshStatus');
    this.elBtnLaunchChrome = document.getElementById('btnLaunchChrome');
    this.elSelectTestPortal = document.getElementById('selectTestPortal');
    this.elBtnOpenSelectedPortal = document.getElementById('btnOpenSelectedPortal');

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
    setInterval(() => this.refreshStatus(), 4000);
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

      // Engine State
      if (data.recorder && data.recorder.isRecording) {
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'RECORDING';
          this.elSystemStateText.style.color = '#ef4444';
        }
      } else if (data.replay && data.replay.isReplaying) {
        if (this.elSystemStateText) {
          this.elSystemStateText.textContent = 'REPLAYING';
          this.elSystemStateText.style.color = '#0284c7';
        }
      } else {
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
