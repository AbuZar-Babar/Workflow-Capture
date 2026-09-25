/**
 * Workflow Capture — Application Entry Point (Main SPA Initializer)
 */

import { SSE } from './sse.js';
import { Router } from './router.js';
import { Header } from './components/header.js';
import { Sidebar } from './components/sidebar.js';
import { Modal } from './components/modal.js';
import { Toast } from './components/toast.js';
import { AuthView } from './views/authView.js';
import { Theme } from './theme.js';

function bootstrap() {
  // 1. Initialize Global Theme, Notifications & Modals
  Theme.init();
  Toast.init();
  Modal.init();
  AuthView.init();

  // 2. Initialize Real-Time SSE Bus
  SSE.init();

  // 3. Initialize Top Header Controller
  Header.init();

  // 4. Initialize Left Sidebar Controller
  Sidebar.init((route) => {
    Router.navigate(route);
  });

  // 5. Initialize Hash Router & Render Default View
  Router.init('appViewContainer');

  // 6. Global SSE state synchronizers
  SSE.on('recording_state', (data) => {
    const isRec = Boolean(data.isRecording);
    Header.setEngineState(isRec ? 'RECORDING' : 'IDLE');
    Header.setGlobalRecordingBanner(isRec, data);
    const curView = Router.views[Router.currentRoute];
    if (curView && typeof curView.setRecordingState === 'function') {
      curView.setRecordingState(isRec, data);
      if (!isRec && typeof curView.loadData === 'function') {
        curView.loadData();
      }
    }
  });

  SSE.on('action_captured', (data) => {
    const actionCountEl = document.getElementById('overviewRecActionCount');
    if (actionCountEl && data.count !== undefined) {
      actionCountEl.textContent = data.count;
    }
    const btnMeta = document.getElementById('overviewRecordButtonMeta');
    const curView = Router.views[Router.currentRoute];
    if (btnMeta && curView && curView.recordStartTime) {
      const sec = Math.max(0, Math.floor((Date.now() - curView.recordStartTime) / 1000));
      const mins = String(Math.floor(sec / 60)).padStart(2, '0');
      const secs = String(sec % 60).padStart(2, '0');
      btnMeta.textContent = `${mins}:${secs} · ${data.count} action${data.count === 1 ? '' : 's'}`;
    }
    Header.updateRecordingBannerActionCount(data.count);
  });

  SSE.on('replay_state', (data) => {
    const isReplaying = Boolean(data.isReplaying);
    Header.setEngineState(isReplaying ? 'REPLAYING' : 'IDLE');
    Sidebar.setExecutionActive(isReplaying);
  });

  SSE.on('run_state', (data) => {
    const isRunning = Boolean(data.isRunning);
    Sidebar.setExecutionActive(isRunning);
    if (isRunning) {
      Header.setEngineState('EXECUTING');
    } else {
      Header.setEngineState('IDLE');
    }
  });
}

window.addEventListener('DOMContentLoaded', bootstrap);
