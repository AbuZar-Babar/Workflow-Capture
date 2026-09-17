/**
 * Workflow Capture — Centralized API Client
 */

export const Api = {
  /**
   * Get CDP and Engine Status
   */
  async getStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Failed to fetch system status');
    return res.json();
  },

  /**
   * Get list of recorded workflows
   */
  async getRecordings() {
    const res = await fetch('/api/recordings');
    if (!res.ok) throw new Error('Failed to fetch recordings');
    return res.json();
  },

  /**
   * Start a workflow recording session
   */
  async startRecording(name) {
    const res = await fetch('/api/record/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start recording');
    return data;
  },

  /**
   * Stop current recording session
   */
  async stopRecording() {
    const res = await fetch('/api/record/stop', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop recording');
    return data;
  },

  /**
   * Start replaying a workflow
   */
  async startReplay({ filename, speed = 1.0, timeoutMs = 5000 }) {
    const res = await fetch('/api/replay/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, speed, timeoutMs })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start replay');
    return data;
  },

  /**
   * Delete a recorded workflow
   */
  async deleteRecording(filename) {
    const res = await fetch(`/api/recordings/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete workflow');
    return data;
  },

  /**
   * Launch Chrome with CDP
   */
  async launchBrowser(portal = 'ecommerce') {
    const res = await fetch('/api/browser/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to launch Chrome');
    return data;
  },

  /**
   * Open test portal in Chrome
   */
  async openPortal(portalKey) {
    const res = await fetch('/api/browser/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: portalKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to open portal');
    return data;
  },

  /**
   * Run automated tests (unit or e2e)
   */
  async runTests(type = 'unit') {
    const res = await fetch('/api/test/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start tests');
    return data;
  }
};
