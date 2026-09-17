/**
 * Workflow Capture — Client-Side Hash Router
 */

import { OverviewView } from './views/overviewView.js';
import { WorkflowsView } from './views/workflowsView.js';
import { ConsoleView } from './views/consoleView.js';
import { PortalsView } from './views/portalsView.js';
import { TestsView } from './views/testsView.js';
import { SecretsView } from './views/secretsView.js';
import { WorkflowEditorView } from './views/workflowEditorView.js';
import { Auth } from './auth.js';
import { Sidebar } from './components/sidebar.js';

export const Router = {
  container: null,
  currentRoute: null,
  navPills: [],

  views: {
    overview: OverviewView,
    workflows: WorkflowsView,
    console: ConsoleView,
    portals: PortalsView,
    tests: TestsView,
    secrets: SecretsView,
    'workflow-editor': WorkflowEditorView
  },

  init(containerId = 'appViewContainer') {
    this.container = document.getElementById(containerId);
    this.navPills = document.querySelectorAll('.nav-pill-link');

    // Handle Top Nav Pill click
    this.navPills.forEach(pill => {
      pill.onclick = () => {
        const route = pill.getAttribute('data-tab');
        if (route) this.navigate(route);
      };
    });

    // Handle window hash change
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '') || 'overview';
      this.renderRoute(hash);
    });

    // Initial route
    const initialHash = window.location.hash.replace('#', '') || 'overview';
    this.renderRoute(initialHash);
  },

  navigate(route) {
    if (window.location.hash === `#${route}`) {
      this.renderRoute(route);
    } else {
      window.location.hash = `#${route}`;
    }
  },

  async renderRoute(routeParam) {

    // Split route to handle arguments (e.g., workflow-editor/123)
    const routeParts = routeParam.split('/');
    let route = routeParts[0];
    const routeArg = routeParts[1];

    // Normalize aliases
    if (route === 'dashboard') route = 'overview';
    if (!this.views[route]) route = 'overview';

    this.currentRoute = route;

    // Update Top Nav Pills Active State
    this.navPills.forEach(pill => {
      if (pill.getAttribute('data-tab') === route || (route === 'overview' && pill.getAttribute('data-tab') === 'dashboard')) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // Update Sidebar Active State
    Sidebar.setActive(route);

    // Render View
    if (this.container && this.views[route]) {
      this.container.innerHTML = '';
      await this.views[route].render(this.container, this, routeArg);
    }
  }
};
