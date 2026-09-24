/**
 * FlowMind Floating Bot Assistant Component
 * Lightweight, zero dependencies, GPU-accelerated.
 * Includes Real-Time Human Disturbance Detection & Visual Alert Display.
 */
(function () {
  if (document.getElementById('flowmindFloatingBot')) return;

  // Ensure CSS stylesheet is loaded
  if (!document.querySelector('link[href*="floating-bot.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/floating-bot.css';
    document.head.appendChild(link);
  }

  const isReportPage = window.location.pathname.includes('report');
  const isDashboardPage = window.location.pathname.includes('index') || window.location.pathname.includes('/app') || window.location.pathname.includes('/dashboard');

  const root = document.createElement('div');
  root.id = 'flowmindFloatingBot';
  root.className = 'flowmind-floating-bot-root';
  root.setAttribute('aria-label', 'FlowMind Bot Assistant');

  root.innerHTML = `
    <!-- Floating Vertical Stepper Glass Card -->
    <div class="flowmind-floating-card" id="flowmindBotCard">
      <div class="flowmind-card-head">
        <div class="flowmind-card-title">
          <span class="flowmind-card-dot"></span>
          <span>FlowMind AI</span>
        </div>
        <button class="flowmind-card-close" id="flowmindBotToggleClose" title="Minimize Bot Assistant" aria-label="Minimize">&minus;</button>
      </div>
      <div class="flowmind-steps-wrap">
        <div class="flowmind-steps-line"></div>

        <!-- Step 1: Teach -->
        <a class="flowmind-step-item flowmind-step-teach" id="flowmindStepTeach" title="Teach: Record workflow demonstration">
          <div class="flowmind-step-icon">
            <svg width="13" height="13" fill="currentColor" style="transform: rotate(-45deg);" viewBox="0 0 24 24"><polygon points="3 3 10.5 21 13.5 13.5 21 10.5 3 3"/></svg>
          </div>
          <span class="flowmind-step-label">Teach</span>
        </a>

        <!-- Step 2: Learn -->
        <a class="flowmind-step-item flowmind-step-learn" id="flowmindStepLearn" title="Learn: Self-healing selector inference">
          <div class="flowmind-step-icon">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15M8 9a4 4 0 018 0M7 15a4 4 0 0010 0"/></svg>
          </div>
          <span class="flowmind-step-label">Learn</span>
        </a>

        <!-- Step 3: Remember -->
        <a class="flowmind-step-item flowmind-step-remember" id="flowmindStepRemember" title="Remember: Persistent workflows & secrets">
          <div class="flowmind-step-icon">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          </div>
          <span class="flowmind-step-label">Remember</span>
        </a>

        <!-- Step 4: Run -->
        <a class="flowmind-step-item flowmind-step-run" id="flowmindStepRun" title="Run: Autonomous resilient replay">
          <div class="flowmind-step-icon">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="6 4 19 12 6 20 6 4"/></svg>
          </div>
          <span class="flowmind-step-label">Run</span>
        </a>
      </div>
    </div>

    <!-- Human Disturbance Alert Speech Bubble -->
    <div class="flowmind-speech-bubble" id="flowmindSpeechBubble" role="alert" aria-live="assertive">
      <div class="flowmind-bubble-head">
        <div class="flowmind-bubble-badge">
          <span class="flowmind-bubble-pulse-dot"></span>
          <span class="flowmind-bubble-badge-txt">Human Disturbance</span>
        </div>
        <button class="flowmind-bubble-close" id="flowmindBubbleClose" title="Dismiss Alert" aria-label="Close">&times;</button>
      </div>
      <div class="flowmind-bubble-body">
        <p class="flowmind-bubble-msg" id="flowmindBubbleMsg">
          Manual input intercepted on <strong id="flowmindBubbleStep">Step #1</strong>! Automated flow was disturbed.
        </p>
        <div class="flowmind-bubble-meta">
          <span class="flowmind-bubble-tag" id="flowmindBubbleTag">Input Disturbance</span>
          <span class="flowmind-bubble-time" id="flowmindBubbleTime">Just now</span>
        </div>
      </div>
      <div class="flowmind-bubble-actions">
        <button class="flowmind-btn-stop-flow" id="flowmindBtnStopReplay" title="Halt replay safely">
          <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          <span>Stop Replay</span>
        </button>
        <button class="flowmind-btn-ack" id="flowmindBtnAck">
          <span>Acknowledge</span>
        </button>
      </div>
      <div class="flowmind-bubble-tail"></div>
    </div>

    <!-- Friendly Hovering Robot Mascot Button -->
    <button class="flowmind-floating-mascot-btn" id="flowmindBotMascotBtn" title="Toggle FlowMind Bot Assistant" aria-label="Toggle Bot Assistant">
      <div class="flowmind-mascot-glow"></div>
      <div class="flowmind-orbital-ring"></div>
      <div class="flowmind-mascot-svg-wrap">
        <svg viewBox="0 0 320 360" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="fbmBodyGrad" x1="60" y1="40" x2="260" y2="340" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="65%" stop-color="#edf2fe"/>
              <stop offset="100%" stop-color="#d9e3f8"/>
            </linearGradient>
            <linearGradient id="fbmVisorGrad" x1="100" y1="90" x2="220" y2="180" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#0a1226"/>
              <stop offset="100%" stop-color="#1e293b"/>
            </linearGradient>
            <linearGradient id="fbmEarGlow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#60a5fa"/>
              <stop offset="100%" stop-color="#2563eb"/>
            </linearGradient>
            <linearGradient id="fbmNeonLight" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
          <ellipse cx="160" cy="335" rx="55" ry="10" fill="#818cf8" opacity="0.35"/>
          <rect x="238" y="112" width="20" height="38" rx="8" fill="url(#fbmBodyGrad)" stroke="#c7d2fe" stroke-width="1.5"/>
          <circle cx="248" cy="131" r="5" fill="url(#fbmEarGlow)"/>
          <rect x="62" y="112" width="20" height="38" rx="8" fill="url(#fbmBodyGrad)" stroke="#c7d2fe" stroke-width="1.5"/>
          <circle cx="72" cy="131" r="5" fill="url(#fbmEarGlow)"/>
          <rect x="74" y="60" width="172" height="142" rx="71" fill="url(#fbmBodyGrad)" stroke="#ffffff" stroke-width="2.5"/>
          <rect x="92" y="86" width="136" height="88" rx="44" fill="url(#fbmVisorGrad)"/>
          <path id="fbmEyeLeft" d="M112 128 C116 118 132 118 136 128" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" fill="none"/>
          <path id="fbmEyeRight" d="M184 128 C188 118 204 118 208 128" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" fill="none"/>
          <path d="M116 200 C116 200 102 216 102 260 C102 295 125 305 160 305 C195 305 218 295 218 260 C218 216 204 200 204 200 Z" fill="url(#fbmBodyGrad)" stroke="#ffffff" stroke-width="2"/>
          <circle cx="160" cy="245" r="13" fill="#ffffff" stroke="#c7d2fe" stroke-width="2"/>
          <circle cx="160" cy="245" r="9" fill="url(#fbmNeonLight)"/>
          <path d="M102 225 C92 235 84 250 86 264 C87 272 94 274 98 268 C104 260 108 244 112 234" fill="url(#fbmBodyGrad)" stroke="#ffffff" stroke-width="2"/>
          <path d="M216 220 C228 215 238 205 244 195 C247 189 252 192 250 199 C246 211 234 235 220 238" fill="url(#fbmBodyGrad)" stroke="#ffffff" stroke-width="2"/>
        </svg>
      </div>
    </button>
  `;

  document.body.appendChild(root);

  // Toggle Collapse State
  const mascotBtn = document.getElementById('flowmindBotMascotBtn');
  const closeBtn = document.getElementById('flowmindBotToggleClose');

  const toggle = (force) => {
    const isCollapsed = typeof force === 'boolean' ? force : !root.classList.contains('is-collapsed');
    root.classList.toggle('is-collapsed', isCollapsed);
    try {
      sessionStorage.setItem('flowmind_bot_collapsed', isCollapsed ? '1' : '0');
    } catch {}
  };

  if (mascotBtn) {
    mascotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // If in alert state, clicking mascot acknowledges/toggles alert
      if (root.classList.contains('is-alert-state')) {
        clearDisturbanceAlert();
      } else {
        toggle();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(true);
    });
  }

  // Restore preferred state from session if user minimized it
  try {
    if (sessionStorage.getItem('flowmind_bot_collapsed') === '1') {
      root.classList.add('is-collapsed');
    }
  } catch {}

  // Smart Context-Aware Click Destinations
  const stepTeach = document.getElementById('flowmindStepTeach');
  const stepLearn = document.getElementById('flowmindStepLearn');
  const stepRemember = document.getElementById('flowmindStepRemember');
  const stepRun = document.getElementById('flowmindStepRun');

  const scrollToEl = (selector) => {
    const target = document.querySelector(selector);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (isReportPage) {
    if (stepTeach) stepTeach.onclick = () => scrollToEl('#feat-recorder');
    if (stepLearn) stepLearn.onclick = () => scrollToEl('#feat-resolver');
    if (stepRemember) stepRemember.onclick = () => scrollToEl('#feat-discovery');
    if (stepRun) stepRun.onclick = () => scrollToEl('#feat-loop');
  } else if (isDashboardPage) {
    if (stepTeach) stepTeach.onclick = () => { if (window.Router) window.Router.navigate('overview'); else window.location.hash = '#overview'; };
    if (stepLearn) stepLearn.onclick = () => { if (window.Router) window.Router.navigate('workflows'); else window.location.hash = '#workflows'; };
    if (stepRemember) stepRemember.onclick = () => { if (window.Router) window.Router.navigate('workflows'); else window.location.hash = '#workflows'; };
    if (stepRun) stepRun.onclick = () => { if (window.Router) window.Router.navigate('results'); else window.location.hash = '#results'; };
  } else {
    if (stepTeach) stepTeach.href = '/app#overview';
    if (stepLearn) stepLearn.href = '/report.html#feat-resolver';
    if (stepRemember) stepRemember.href = '/app#workflows';
    if (stepRun) stepRun.href = '/app#results';
  }

  // -------------------------------------------------------------
  // Human Disturbance Alert Controller
  // -------------------------------------------------------------
  const bubbleClose = document.getElementById('flowmindBubbleClose');
  const bubbleMsg = document.getElementById('flowmindBubbleMsg');
  const bubbleStep = document.getElementById('flowmindBubbleStep');
  const bubbleTag = document.getElementById('flowmindBubbleTag');
  const bubbleTime = document.getElementById('flowmindBubbleTime');
  const btnStopReplay = document.getElementById('flowmindBtnStopReplay');
  const btnAck = document.getElementById('flowmindBtnAck');

  let alertDismissTimeout = null;

  const showDisturbanceAlert = (data) => {
    if (!data) return;
    root.classList.add('is-alert-state');

    const stepIdx = data.stepIndex || (data.action ? data.action.index + 1 : '?');
    if (bubbleStep) bubbleStep.textContent = `Step #${stepIdx}`;

    if (bubbleMsg) {
      const type = data.detail?.type || data.event?.type || 'input';
      const keyInfo = data.detail?.key ? ` (key '${data.detail.key}')` : '';
      bubbleMsg.innerHTML = `Manual human <strong>${type}${keyInfo}</strong> detected on <strong class="flowmind-highlight-step">Step #${stepIdx}</strong>. Automated workflow execution was disturbed!`;
    }

    if (bubbleTag) {
      const type = (data.detail?.type || data.event?.type || 'human input').toUpperCase();
      bubbleTag.textContent = `${type} INTERRUPT`;
    }

    if (bubbleTime) {
      bubbleTime.textContent = new Date().toLocaleTimeString();
    }

    if (stepRun) {
      stepRun.classList.add('is-disturbed');
    }

    if (alertDismissTimeout) clearTimeout(alertDismissTimeout);
    // Auto-settle after 35 seconds if unacknowledged
    alertDismissTimeout = setTimeout(() => {
      clearDisturbanceAlert();
    }, 35000);
  };

  const clearDisturbanceAlert = () => {
    root.classList.remove('is-alert-state');
    if (stepRun) {
      stepRun.classList.remove('is-disturbed');
    }
    if (alertDismissTimeout) {
      clearTimeout(alertDismissTimeout);
      alertDismissTimeout = null;
    }
  };

  if (bubbleClose) {
    bubbleClose.addEventListener('click', (e) => {
      e.stopPropagation();
      clearDisturbanceAlert();
    });
  }

  if (btnAck) {
    btnAck.addEventListener('click', (e) => {
      e.stopPropagation();
      clearDisturbanceAlert();
    });
  }

  if (btnStopReplay) {
    btnStopReplay.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnStopReplay.disabled = true;
      btnStopReplay.innerHTML = '<span>Stopping...</span>';
      try {
        await fetch('/api/replay/stop', { method: 'POST' });
        if (bubbleMsg) {
          bubbleMsg.innerHTML = 'Automated replay <strong>stopped</strong>. You have manual control of the page.';
        }
      } catch (err) {
        if (bubbleMsg) {
          bubbleMsg.textContent = 'Could not stop replay: ' + err.message;
        }
      } finally {
        setTimeout(() => {
          clearDisturbanceAlert();
          btnStopReplay.disabled = false;
          btnStopReplay.innerHTML = `
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            <span>Stop Replay</span>
          `;
        }, 2200);
      }
    });
  }

  // -------------------------------------------------------------
  // SSE Integration for Real-Time Disturbance Alerts (Zero Redundant Sockets)
  // -------------------------------------------------------------
  const setupSSEListener = () => {
    const bindSSE = () => {
      if (window.SSE && typeof window.SSE.on === 'function') {
        window.SSE.on('human_intervention', (data) => {
          showDisturbanceAlert(data);
        });
        window.SSE.on('replay_state', (data) => {
          if (data && data.isReplaying === false) {
            setTimeout(clearDisturbanceAlert, 5000);
          }
        });
        return true;
      }
      return false;
    };

    if (!bindSSE()) {
      // Check again after DOM ready once main.js exports window.SSE
      window.addEventListener('DOMContentLoaded', () => {
        if (!bindSSE()) {
          setTimeout(bindSSE, 1000);
        }
      });
    }
  };

  setupSSEListener();

  // Expose global controller for testing or manual interactions
  window.FlowMindBot = {
    showAlert: showDisturbanceAlert,
    clearAlert: clearDisturbanceAlert,
    toggle
  };
})();
