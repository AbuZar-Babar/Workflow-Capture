/**
 * Workflow Capture — Sidebar Component
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Sidebar = {
  buttons: [],
  btnLaunchChrome: null,
  btnStopExecution: null,

  init(onNavigate) {
    this.buttons = document.querySelectorAll('.sidebar-icon-btn[data-route]');
    this.buttons.forEach(btn => {
      btn.onclick = () => {
        const route = btn.getAttribute('data-route');
        if (route && onNavigate) {
          onNavigate(route);
        }
      };
    });

    this.btnLaunchChrome = document.getElementById('btnSidebarLaunchChrome');
    if (this.btnLaunchChrome) {
      this.btnLaunchChrome.onclick = async () => {
        Toast.info('Launching Google Chrome with remote debugging (CDP port 9222)...');
        try {
          const res = await Api.launchBrowser('ecommerce');
          if (res.success) {
            Toast.success('Chrome is running with remote debugging on port 9222!');
          }
        } catch (err) {
          Toast.error(err.message);
        }
      };
    }

    this.btnStopExecution = document.getElementById('btnSidebarStopExecution');
    if (this.btnStopExecution) {
      this.btnStopExecution.onclick = async () => {
        this.btnStopExecution.disabled = true;
        this.btnStopExecution.style.opacity = '0.7';
        Toast.info('Stopping active execution...');
        try {
          const res = await Api.stopExecution();
          Toast.success(res.message || 'Execution stopped successfully');
        } catch (err) {
          Toast.error(err.message || 'Failed to stop execution');
        } finally {
          setTimeout(() => {
            if (this.btnStopExecution) {
              this.btnStopExecution.disabled = false;
              this.btnStopExecution.style.opacity = '1';
            }
          }, 800);
        }
      };
    }
  },

  setExecutionActive(isActive) {
    if (this.btnStopExecution) {
      if (isActive) {
        this.btnStopExecution.style.boxShadow = '0 0 12px rgba(220, 38, 38, 0.7)';
        this.btnStopExecution.title = 'Stop Running Execution (Active)';
      } else {
        this.btnStopExecution.style.boxShadow = 'none';
        this.btnStopExecution.title = 'Stop Active Execution';
      }
    }
  },

  setActive(route) {
    this.buttons.forEach(btn => {
      if (btn.getAttribute('data-route') === route) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
};
