/**
 * Workflow Capture — Sidebar Component
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Sidebar = {
  buttons: [],
  btnStopExecution: null,
  isExecutionActive: false,

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

    this.btnStopExecution = document.getElementById('btnSidebarStopExecution');
    if (this.btnStopExecution) {
      this.btnStopExecution.onclick = async () => {
        this.btnStopExecution.disabled = true;
        this.btnStopExecution.classList.add('is-pending');
        Toast.info('Stopping active execution...');
        try {
          const res = await Api.stopExecution();
          Toast.success(res.message || 'Execution stopped successfully');
        } catch (err) {
          Toast.error(err.message || 'Failed to stop execution');
        } finally {
          setTimeout(() => {
            if (this.btnStopExecution) {
              this.btnStopExecution.classList.remove('is-pending');
              this.setExecutionActive(this.isExecutionActive);
            }
          }, 800);
        }
      };
      this.setExecutionActive(false);
    }
  },

  setExecutionActive(isActive) {
    this.isExecutionActive = Boolean(isActive);
    if (this.btnStopExecution) {
      if (this.isExecutionActive) {
        this.btnStopExecution.title = 'Stop Running Execution (Active)';
      } else {
        this.btnStopExecution.disabled = true;
        this.btnStopExecution.classList.remove('is-active');
        this.btnStopExecution.title = 'Stop Active Execution';
      }
      this.btnStopExecution.disabled = !this.isExecutionActive;
      this.btnStopExecution.classList.toggle('is-active', this.isExecutionActive);
      this.btnStopExecution.setAttribute('aria-label', this.isExecutionActive ? 'Stop running execution' : 'Stop active execution');
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
