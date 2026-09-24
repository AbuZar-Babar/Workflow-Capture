/**
 * Workflow Capture — Server-Sent Events (SSE) Bus
 */

class SSEManager {
  constructor() {
    this.listeners = new Map();
    this.eventSource = null;
    this.logHistory = [];
  }

  init() {
    if (this.eventSource) return;

    this.eventSource = new EventSource('/api/events');

    const eventNames = ['log', 'action_captured', 'recording_state', 'replay_progress', 'replay_state', 'run_state', 'test_state', 'human_intervention'];

    eventNames.forEach(evt => {
      this.eventSource.addEventListener(evt, (e) => {
        try {
          const data = JSON.parse(e.data);
          if (evt === 'log') {
            this.logHistory.push(data);
            if (this.logHistory.length > 500) this.logHistory.shift();
          }
          this.emit(evt, data);
        } catch (err) {
          console.error(`Error parsing SSE event "${evt}":`, err);
        }
      });
    });

    this.eventSource.onerror = (err) => {
      this.emit('connection_error', err);
    };
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, payload) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`Error in listener for "${event}":`, err);
        }
      }
    }
  }

  getLogs() {
    return this.logHistory;
  }

  clearLogs() {
    this.logHistory = [];
  }
}

export const SSE = new SSEManager();
if (typeof window !== 'undefined') {
  window.SSE = SSE;
}
