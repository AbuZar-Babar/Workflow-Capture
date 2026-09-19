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

function bootstrap() {
  // 1. Initialize Global Notifications & Modals
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
    Header.setEngineState(data.isRecording ? 'RECORDING' : 'IDLE');
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
