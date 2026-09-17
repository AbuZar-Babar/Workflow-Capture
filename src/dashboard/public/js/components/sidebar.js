/**
 * Workflow Capture — Sidebar Component
 */

import { Api } from '../api.js';
import { Toast } from './toast.js';

export const Sidebar = {
  buttons: [],
  btnLaunchChrome: null,

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
