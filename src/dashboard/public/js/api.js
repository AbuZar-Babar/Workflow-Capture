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

  async executeWorkflow(workflowId, loopStepIndex = null) {
    const bodyPayload = loopStepIndex !== null ? { isLoop: true, loopStepIndex } : { isLoop: false };
    const res = await Auth.authenticatedFetch(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to execute workflow');
    return data;
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

  async getRunStatus(runId) {
    const res = await Auth.authenticatedFetch(`/api/runs/${runId}`);
    if (!res.ok) throw new Error('Failed to fetch run status');
    return res.json();
  }
};

export const API = Api;
