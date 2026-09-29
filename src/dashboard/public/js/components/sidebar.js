/**
 * Workflow Capture — Sidebar Component
 * Manages primary navigation, active state mapping, collapse state, and execution control.
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Sidebar = {
  sidebarEl: null,
  buttons: [],
  btnStopExecution: null,
  btnCollapse: null,
  isExecutionActive: false,
  isCollapsed: false,

  init(onNavigate) {
    this.sidebarEl = document.getElementById('appSidebar') || document.querySelector('.app-sidebar') || document.querySelector('.floating-sidebar');
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

    // Sidebar Collapse / Expand toggle
    this.btnCollapse = document.getElementById('btnSidebarCollapse');
    if (this.btnCollapse && this.sidebarEl) {
      const savedCollapsed = localStorage.getItem('workflow_capture_sidebar_collapsed');
      if (savedCollapsed === '1') {
        this.setCollapsed(true, false);
      }

      this.btnCollapse.onclick = () => {
        this.setCollapsed(!this.isCollapsed, true);
      };
    }
  },

  setCollapsed(collapsed, save = true) {
    this.isCollapsed = Boolean(collapsed);
    if (!this.sidebarEl) {
      this.sidebarEl = document.getElementById('appSidebar') || document.querySelector('.app-sidebar') || document.querySelector('.floating-sidebar');
    }
    if (this.sidebarEl) {
      this.sidebarEl.classList.toggle('is-collapsed', this.isCollapsed);
      this.sidebarEl.setAttribute('aria-expanded', String(!this.isCollapsed));
    }
    if (this.btnCollapse) {
      const label = this.isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
      this.btnCollapse.title = label;
      this.btnCollapse.setAttribute('aria-label', label);
      this.btnCollapse.setAttribute('data-tooltip', label);
      const labelSpan = this.btnCollapse.querySelector('.sidebar-nav-label');
      if (labelSpan) labelSpan.textContent = this.isCollapsed ? 'Expand' : 'Collapse';
    }
    if (save) {
      try {
        localStorage.setItem('workflow_capture_sidebar_collapsed', this.isCollapsed ? '1' : '0');
      } catch (e) {
        // Storage might be restricted
      }
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
    // Map view aliases to primary product IA sections:
    // Dashboard, Workflows, Activity, Files, Settings
    let target = route;
    if (route === 'dashboard') target = 'overview';
    if (route === 'workflow-editor') target = 'workflows';
    if (route === 'execution' || route === 'results') target = 'console';

    this.buttons.forEach(btn => {
      const btnRoute = btn.getAttribute('data-route');
      if (btnRoute === target) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });
  }
};
