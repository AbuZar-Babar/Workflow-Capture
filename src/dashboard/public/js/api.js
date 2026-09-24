/**
 * Workflow Capture — Centralized API Client
 */

import { Auth } from './auth.js';

export const Api = {
  /**
   * Get CDP and Engine Status
   */
  async getStatus() {
    const res = await Auth.authenticatedFetch('/api/status');
    if (!res.ok) throw new Error('Failed to fetch system status');
    return res.json();
  },

  /**
   * Get list of recorded workflows
   */
  async getRecordings() {
    const res = await Auth.authenticatedFetch('/api/recordings');
    if (!res.ok) throw new Error('Failed to fetch recordings');
    return res.json();
  },

  /**
   * Start a workflow recording session
   */
  async startRecording(name) {
    const res = await Auth.authenticatedFetch('/api/record/start', {
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
    const res = await Auth.authenticatedFetch('/api/record/stop', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop recording');
    return data;
  },

  /**
   * Start replaying a workflow
   */
  async startReplay({ filename, speed = 1.0, timeoutMs = 5000 }) {
    const res = await Auth.authenticatedFetch('/api/replay/start', {
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
    const res = await Auth.authenticatedFetch(`/api/recordings/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete workflow');
    return data;
  },

  /**
   * Launch Chrome with CDP
   */
  async launchBrowser(portal = 'ecommerce') {
    const res = await Auth.authenticatedFetch('/api/browser/launch', {
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
    const res = await Auth.authenticatedFetch('/api/browser/open', {
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
    const res = await Auth.authenticatedFetch('/api/test/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start tests');
    return data;
  },

  // -------------------------------------------------------------
  // Auth APIs
  // -------------------------------------------------------------
  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  async dummyLogin() {
    const res = await fetch('/api/auth/dummy-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Dummy login failed');
    return data;
  },

  async signup(username, email, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    return data;
  },

  async logout() {
    const res = await Auth.authenticatedFetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Logout failed');
    return data;
  },

  // -------------------------------------------------------------
  // Secrets Vault APIs
  // -------------------------------------------------------------
  async getSecrets() {
    const res = await Auth.authenticatedFetch('/api/secrets');
    if (!res.ok) throw new Error('Failed to fetch secrets');
    return res.json();
  },

  async createSecret(name, domain, value) {
    const res = await Auth.authenticatedFetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, domain, value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create secret');
    return data;
  },

  async deleteSecret(id) {
    const res = await Auth.authenticatedFetch(`/api/secrets/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete secret');
    return data;
  },

  // -------------------------------------------------------------
  // Workflow & Runs APIs
  // -------------------------------------------------------------
  async getWorkflows() {
    const res = await Auth.authenticatedFetch('/api/workflows');
    if (!res.ok) throw new Error('Failed to fetch workflows');
    return res.json();
  },

  async getWorkflowById(workflowId) {
    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}`);
    if (!res.ok) throw new Error('Failed to fetch workflow');
    return res.json();
  },

  async updateWorkflow(workflowId, updates) {
    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update workflow');
    return data;
  },

  async discoverWorkflow(workflowId, loopStepIndex = null) {
    const res = await Auth.authenticatedFetch(`/api/workflows/${encodeURIComponent(workflowId)}/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loopStepIndex === null ? {} : { loopStepIndex })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.discovery?.reason || 'Item discovery failed');
    return data;
  },

  async executeWorkflow(workflowId, loopStepIndexOrOptions = null) {
    const bodyPayload = {};
    if (typeof loopStepIndexOrOptions === 'object' && loopStepIndexOrOptions !== null) {
      if (loopStepIndexOrOptions.mode) {
        bodyPayload.mode = loopStepIndexOrOptions.mode;
      }
      if (loopStepIndexOrOptions.isLoop !== undefined) {
        bodyPayload.isLoop = Boolean(loopStepIndexOrOptions.isLoop);
      }
      if (loopStepIndexOrOptions.loopStepIndex !== null && loopStepIndexOrOptions.loopStepIndex !== undefined) {
        bodyPayload.loopStepIndex = loopStepIndexOrOptions.loopStepIndex;
        if (loopStepIndexOrOptions.isLoop === undefined) {
          bodyPayload.isLoop = true;
          bodyPayload.mode = 'loop';
        }
      }
      if (loopStepIndexOrOptions.forceRedownload) {
        bodyPayload.forceRedownload = true;
      }
      if (loopStepIndexOrOptions.rowFilter) {
        bodyPayload.rowFilter = loopStepIndexOrOptions.rowFilter;
      }
    } else if (typeof loopStepIndexOrOptions === 'string') {
      bodyPayload.mode = loopStepIndexOrOptions;
      bodyPayload.isLoop = loopStepIndexOrOptions === 'loop' || loopStepIndexOrOptions === 'batch';
    } else if (Number.isInteger(loopStepIndexOrOptions) && loopStepIndexOrOptions >= 0) {
      bodyPayload.mode = 'loop';
      bodyPayload.isLoop = true;
      bodyPayload.loopStepIndex = loopStepIndexOrOptions;
    } else {
      // Default: single macro execution
      bodyPayload.mode = 'single';
      bodyPayload.isLoop = false;
    }

    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to execute workflow');
    return data;
  },

  async getDownloads() {
    const res = await Auth.authenticatedFetch('/api/downloads');
    if (!res.ok) throw new Error('Failed to fetch downloads');
    return res.json();
  },

  async getWorkflowDownloads(workflowId) {
    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}/downloads`);
    if (!res.ok) throw new Error('Failed to fetch workflow downloads');
    return res.json();
  },

  async deleteDownload(downloadId) {
    const res = await Auth.authenticatedFetch(`/api/downloads/${encodeURIComponent(downloadId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete download artifact');
    return data;
  },

  async exportDownloads() {
    const res = await Auth.authenticatedFetch('/api/downloads/export');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to export downloads archive');
    }
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'workflow-artifacts.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
    return { success: true };
  },

  async deleteWorkflow(workflowId) {
    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete workflow');
    return data;
  },

  async getRuns() {
    const res = await Auth.authenticatedFetch('/api/runs');
    if (!res.ok) throw new Error('Failed to fetch runs');
    return res.json();
  },

  async getActiveRuns() {
    const res = await Auth.authenticatedFetch('/api/runs/active');
    if (!res.ok) throw new Error('Failed to fetch active runs');
    return res.json();
  },

  async getRunStatus(runId) {
    const res = await Auth.authenticatedFetch(`/api/runs/${runId}`);
    if (!res.ok) throw new Error('Failed to fetch run status');
    return res.json();
  },

  /**
   * Stop a specific active workflow run
   */
  async stopRun(runId) {
    const res = await Auth.authenticatedFetch(`/api/runs/${runId}/stop`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop run');
    return data;
  },

  /**
   * Stop all active workflow runs
   */
  async stopAllRuns() {
    const res = await Auth.authenticatedFetch('/api/runs/stop', {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop running executions');
    return data;
  },

  /**
   * Stop raw replay playback
   */
  async stopReplay() {
    const res = await Auth.authenticatedFetch('/api/replay/stop', {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop replay');
    return data;
  },

  /**
   * Universal Stop Execution (stops workflow runs, active replays, and active recordings)
   */
  async stopExecution() {
    let recorderStopped = false;
    try {
      const status = await this.getStatus().catch(() => null);
      if (status && status.recorder && status.recorder.isRecording) {
        await this.stopRecording().catch(() => {});
        recorderStopped = true;
      }
    } catch {}

    try {
      const res = await Auth.authenticatedFetch('/api/runs/stop', {
        method: 'POST'
      });
      const data = await res.json();
      if (recorderStopped) {
        data.message = (data.message ? data.message + ' and ' : '') + 'Recording saved successfully';
      }
      return data;
    } catch {
      const replayRes = await this.stopReplay();
      if (recorderStopped) {
        replayRes.message = 'Recording stopped and saved successfully';
      }
      return replayRes;
    }
  },

  // -------------------------------------------------------------
  // Bot Configuration & Anti-Captcha Stealth APIs
  // -------------------------------------------------------------
  async getBotConfig() {
    const res = await Auth.authenticatedFetch('/api/bot-config');
    if (!res.ok) throw new Error('Failed to fetch bot configuration');
    return res.json();
  },

  async updateBotConfig(config) {
    const res = await Auth.authenticatedFetch('/api/bot-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update bot configuration');
    return data;
  },

  async resetBotConfig(preset = 'balanced') {
    const res = await Auth.authenticatedFetch('/api/bot-config/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reset bot configuration');
    return data;
  },

  async getBotPresets() {
    const res = await Auth.authenticatedFetch('/api/bot-config/presets');
    if (!res.ok) throw new Error('Failed to fetch bot presets');
    return res.json();
  }
};

export const API = Api;
