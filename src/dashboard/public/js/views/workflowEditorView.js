import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';

export const WorkflowEditorView = {
  editor: null,
  workflowId: null,
  workflow: null,

  async render(container, router, workflowId) {
    this.workflowId = workflowId;
    container.innerHTML = `
      <div class="workflow-editor-layout">
        <div class="workflow-editor-header">
          <div style="display: flex; gap: 1rem; align-items: center;">
            <button class="btn btn-secondary btn-sm" id="btnBack">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              <span>Back to Workflows</span>
            </button>
            <h2 id="wfTitle" style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-main);">Loading Workflow...</h2>
          </div>
          <div style="display: flex; gap: 0.75rem; align-items: center;">
            <div style="display: flex; align-items: center; gap: 0.35rem; background: rgba(0,0,0,0.04); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.2rem 0.6rem;">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
              <label for="wfTargetUrlInput" style="font-size: 0.72rem; font-weight: 700; color: var(--text-sub); white-space: nowrap; margin: 0;">Target URL:</label>
              <input type="text" id="wfTargetUrlInput" placeholder="https://example.com" style="border: none; background: transparent; font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-main); width: 220px; outline: none;" />
            </div>
            <span id="wfStepCounter" class="badge-tag success">0 Steps</span>
            <button class="btn btn-primary btn-sm" id="btnSaveFlow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save Workflow</span>
            </button>
            <button class="btn btn-secondary btn-sm" id="btnExecuteFlowEditor" style="background:var(--brand-forest); color:#ffffff; border-color:var(--brand-forest); display:inline-flex; align-items:center; gap:0.35rem;">
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span>Execute Flow</span>
            </button>
          </div>
        </div>
        <div class="workflow-editor-canvas" id="drawflow">
          <div class="drawflow-canvas-controls">
            <button type="button" id="btnZoomIn" title="Zoom In">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button type="button" id="btnZoomOut" title="Zoom Out">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button type="button" id="btnZoomReset" title="Reset View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnBack').addEventListener('click', () => {
      this.hideConnectionMenu();
      Router.navigate('workflows');
    });

    document.getElementById('btnSaveFlow').addEventListener('click', () => {
      this.saveWorkflow();
    });

    document.getElementById('btnExecuteFlowEditor')?.addEventListener('click', () => {
      const steps = this.workflow?.steps || (this.workflow?.recordingData && this.workflow.recordingData.actions) || [];
      ExecutionModal.open({
        workflowId: this.workflowId,
        workflowName: this.workflow?.name || 'Workflow',
        stepCount: steps.length,
        loopStepIndex: this.workflow?.loopStepIndex,
        isLoop: this.workflow?.isLoop || this.workflow?.mode === 'LOOP'
      });
    });

    try {
      const data = await Api.getWorkflowById(this.workflowId);
      this.workflow = data.workflow || data;
      const wfName = this.workflow.name || 'Workflow';
      document.getElementById('wfTitle').textContent = `Visual Editor: ${wfName}`;
      
      const steps = this.workflow.steps || (this.workflow.recordingData && this.workflow.recordingData.actions) || [];
      const badge = document.getElementById('wfStepCounter');
      if (badge) badge.textContent = `${steps.length} Steps`;

      const targetUrlInput = document.getElementById('wfTargetUrlInput');
      if (targetUrlInput) {
        targetUrlInput.value = this.workflow.targetUrl ||
          (this.workflow.recordingData && this.workflow.recordingData.metadata && this.workflow.recordingData.metadata.startUrl) ||
          '';
      }

      this.initDrawflow();
    } catch (err) {
      console.error(err);
      Toast.error('Failed to load workflow: ' + err.message);
    }
  },

  initDrawflow() {
    const container = document.getElementById('drawflow');
    if (!container) return;
    
    // Ensure parent-drawflow is the primary class so Drawflow's internal switch statement matches
    container.className = 'parent-drawflow workflow-editor-canvas';

    this.editor = new Drawflow(container);
    this.editor.start();
    this.editor.clearModuleSelected();

    // Universal Pan / Drag handler across the entire canvas viewport
    container.addEventListener('mousedown', (e) => {
      // Ignore clicks on nodes, form inputs, canvas control buttons, connections, or quick menus
      if (
        e.target.closest('.drawflow-node') || 
        e.target.closest('.drawflow-canvas-controls') || 
        e.target.closest('button') || 
        e.target.closest('input') || 
        e.target.closest('select') ||
        e.target.closest('.connection') ||
        e.target.closest('.main-path') ||
        e.target.closest('.point') ||
        e.target.closest('.df-conn-menu') ||
        e.target.closest('.drawflow-delete')
      ) {
        return;
      }
      this.hideConnectionMenu();
      this.editor.editor_selected = true;
      this.editor.pos_x = e.clientX;
      this.editor.pos_y = e.clientY;
    }, true);

    container.addEventListener('touchstart', (e) => {
      if (
        e.touches && 
        e.touches.length === 1 && 
        !e.target.closest('.drawflow-node') && 
        !e.target.closest('.drawflow-canvas-controls') && 
        !e.target.closest('button') &&
        !e.target.closest('.connection') &&
        !e.target.closest('.main-path') &&
        !e.target.closest('.point') &&
        !e.target.closest('.df-conn-menu')
      ) {
        this.hideConnectionMenu();
        this.editor.editor_selected = true;
        this.editor.pos_x = e.touches[0].clientX;
        this.editor.pos_y = e.touches[0].clientY;
      }
    }, { capture: true, passive: true });

    // Wire Zoom & Reset controls
    document.getElementById('btnZoomIn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editor.zoom_in();
    });
    document.getElementById('btnZoomOut')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editor.zoom_out();
    });
    document.getElementById('btnZoomReset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editor.zoom_reset();
    });

    this.initDeleteModal();
    this.initConnectionInteractions(container);

    // Hook Drawflow connection/removal events to automatically refresh visual step numbering
    this.editor.on('connectionCreated', () => {
      this.refreshStepNumbers();
    });
    this.editor.on('connectionRemoved', () => {
      this.refreshStepNumbers();
    });
    this.editor.on('nodeRemoved', () => {
      this.refreshStepNumbers();
    });

    this.renderWorkflowSteps();
  },

  selectedConnectionInfo: null,
  keyDeleteHandler: null,

  initConnectionInteractions(container) {
    this.selectedConnectionInfo = null;

    // Listen for canvas click to select connection or handle delete buttons
    container.addEventListener('click', (e) => {
      // 1. If clicked on native Drawflow delete button
      if (e.target.closest('.drawflow-delete')) {
        e.stopPropagation();
        this.hideConnectionMenu();
        if (this.selectedConnectionInfo) {
          this.deleteSingleConnection(this.selectedConnectionInfo);
        } else if (this.editor.connection_selected) {
          this.editor.removeConnection();
          this.refreshStepNumbers();
          Toast.info('Link deleted.');
        }
        return;
      }

      // 2. If clicked on our floating menu delete button
      if (e.target.closest('.df-btn-del-conn')) {
        e.stopPropagation();
        if (this.selectedConnectionInfo) {
          this.deleteSingleConnection(this.selectedConnectionInfo);
        }
        return;
      }

      // 3. If clicked on a connection line (.main-path or .connection)
      const connPath = e.target.closest('.main-path');
      const connSvg = e.target.closest('.connection');
      if (connPath || connSvg) {
        e.stopPropagation();
        const svg = connSvg || (connPath ? connPath.closest('svg.connection') : null);
        const connInfo = this.parseConnectionSvg(svg);
        if (connInfo) {
          this.selectedConnectionInfo = connInfo;
          this.showConnectionMenu(connInfo, e.clientX, e.clientY);
        }
        return;
      }

      // 4. Clicked elsewhere: hide menu and unselect connection
      if (!e.target.closest('.df-conn-menu')) {
        this.hideConnectionMenu();
        this.selectedConnectionInfo = null;
      }
    });

    // Drawflow event hooks
    this.editor.on('connectionSelected', (info) => {
      this.selectedConnectionInfo = {
        id_output: String(info.output_id),
        id_input: String(info.input_id),
        output_class: info.output_class,
        input_class: info.input_class
      };
    });

    // Delete or Backspace key deletes selected connection
    if (this.keyDeleteHandler) {
      window.removeEventListener('keydown', this.keyDeleteHandler);
    }
    this.keyDeleteHandler = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedConnectionInfo) {
          e.preventDefault();
          this.deleteSingleConnection(this.selectedConnectionInfo);
        }
      }
    };
    window.addEventListener('keydown', this.keyDeleteHandler);
  },

  parseConnectionSvg(svgEl) {
    if (!svgEl) return null;
    const classList = Array.from(svgEl.classList || []);
    let id_output = null;
    let id_input = null;
    let output_class = 'output_1';
    let input_class = 'input_1';

    for (const cls of classList) {
      const mOut = cls.match(/^node_out_node-(\d+)$/);
      if (mOut) id_output = mOut[1];

      const mIn = cls.match(/^node_in_node-(\d+)$/);
      if (mIn) id_input = mIn[1];

      if (/^output_\d+$/.test(cls)) output_class = cls;
      if (/^input_\d+$/.test(cls)) input_class = cls;
    }

    if (id_output && id_input) {
      return { id_output, id_input, output_class, input_class, svgEl };
    }
    return null;
  },

  showConnectionMenu(connInfo, clientX, clientY) {
    this.hideConnectionMenu();
    if (!connInfo) return;

    const sourceNodeEl = document.getElementById(`node-${connInfo.id_output}`);
    const targetNodeEl = document.getElementById(`node-${connInfo.id_input}`);
    const sourceNum = sourceNodeEl?.querySelector('.df-step-number')?.textContent || `#${connInfo.id_output}`;
    const targetNum = targetNodeEl?.querySelector('.df-step-number')?.textContent || `#${connInfo.id_input}`;

    const menu = document.createElement('div');
    menu.className = 'df-conn-menu';
    menu.id = 'dfActiveConnMenu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.innerHTML = `
      <div class="df-conn-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        <span>Link: <strong>${this.escapeHtml(sourceNum)}</strong> ➔ <strong>${this.escapeHtml(targetNum)}</strong></span>
      </div>
      <button type="button" class="df-btn-del-conn" title="Delete this connection">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete Link
      </button>
    `;

    const btn = menu.querySelector('.df-btn-del-conn');
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.deleteSingleConnection(connInfo);
      };
    }

    document.body.appendChild(menu);
  },

  hideConnectionMenu() {
    const existing = document.getElementById('dfActiveConnMenu');
    if (existing) existing.remove();
  },

  deleteSingleConnection(connInfo) {
    if (!connInfo || !this.editor) return;
    try {
      this.editor.removeSingleConnection(
        connInfo.id_output,
        connInfo.id_input,
        connInfo.output_class,
        connInfo.input_class
      );
      this.selectedConnectionInfo = null;
      this.hideConnectionMenu();
      this.refreshStepNumbers();
      Toast.info('Link deleted. You can manually drag between ports to connect steps.');
    } catch (err) {
      console.warn('Could not remove connection via removeSingleConnection:', err);
      try {
        this.editor.removeConnection();
        this.selectedConnectionInfo = null;
        this.hideConnectionMenu();
        this.refreshStepNumbers();
        Toast.info('Link deleted.');
      } catch (e2) {
        Toast.error('Failed to remove link');
      }
    }
  },

  pendingDeleteNodeId: null,

  initDeleteModal() {
    const modal = document.getElementById('deleteNodeModal');
    const btnClose = document.getElementById('btnCloseDeleteModal');
    const btnCancel = document.getElementById('btnCancelDeleteStep');
    const btnConfirm = document.getElementById('btnConfirmDeleteStep');

    if (btnClose) btnClose.onclick = () => this.hideDeleteModal();
    if (btnCancel) btnCancel.onclick = () => this.hideDeleteModal();
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) this.hideDeleteModal();
      };
    }
    if (btnConfirm) {
      btnConfirm.onclick = () => this.executeDeleteNode();
    }
  },

  promptDeleteNode(nodeId, stepName) {
    this.pendingDeleteNodeId = nodeId;
    const targetLabel = document.getElementById('deleteStepTargetName');
    if (targetLabel) {
      targetLabel.textContent = `"${stepName || 'this step'}"`;
    }
    const modal = document.getElementById('deleteNodeModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  },

  hideDeleteModal() {
    this.pendingDeleteNodeId = null;
    const modal = document.getElementById('deleteNodeModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  },

  executeDeleteNode() {
    const nodeId = this.pendingDeleteNodeId;
    if (!nodeId || !this.editor) {
      this.hideDeleteModal();
      return;
    }

    try {
      const nodeData = this.editor.drawflow.drawflow.Home.data[nodeId];
      if (!nodeData) {
        this.hideDeleteModal();
        return;
      }

      // Remove the node from Drawflow canvas (this automatically removes attached connections)
      this.editor.removeNodeId(`node-${nodeId}`);

      // We intentionally do NOT auto-reconnect surrounding nodes per user preference,
      // leaving the gap open so the user can manually wire links as desired.

      this.hideConnectionMenu();
      this.selectedConnectionInfo = null;

      // Refresh numbering on remaining step cards
      this.refreshStepNumbers();

      Toast.success('Step deleted. Connect remaining steps by dragging from an output port to an input port.');
    } catch (err) {
      Toast.error('Failed to delete step: ' + err.message);
    } finally {
      this.hideDeleteModal();
    }
  },

  refreshStepNumbers() {
    try {
      if (!this.editor) return;
      const exported = this.editor.export();
      const data = exported?.drawflow?.Home?.data || {};
      const nodes = Object.values(data);
      if (nodes.length === 0) return;

      // Find start node (node with no input connections)
      let startNodeId = null;
      for (const node of nodes) {
        const inputConn = node.inputs?.input_1?.connections;
        if (!inputConn || inputConn.length === 0) {
          startNodeId = node.id;
          break;
        }
      }
      if (!startNodeId) {
        const sorted = [...nodes].sort((a, b) => (a.pos_x || 0) - (b.pos_x || 0));
        startNodeId = sorted[0].id;
      }

      let currentId = startNodeId;
      let stepIndex = 0;
      const visited = new Set();

      while (currentId && !visited.has(String(currentId))) {
        visited.add(String(currentId));
        const nodeEl = document.getElementById(`node-${currentId}`);
        if (nodeEl) {
          const stepNumberEl = nodeEl.querySelector('.df-step-number');
          if (stepNumberEl) {
            stepNumberEl.textContent = `#${stepIndex + 1}`;
          }
        }
        const nodeData = data[currentId];
        stepIndex++;
        if (nodeData?.outputs?.output_1?.connections?.length > 0) {
          currentId = nodeData.outputs.output_1.connections[0].node;
        } else {
          currentId = null;
        }
      }

      // Any remaining disconnected nodes
      const unvisited = nodes.filter(n => !visited.has(String(n.id))).sort((a, b) => (a.pos_x || 0) - (b.pos_x || 0));
      for (const node of unvisited) {
        const nodeEl = document.getElementById(`node-${node.id}`);
        if (nodeEl) {
          const stepNumberEl = nodeEl.querySelector('.df-step-number');
          if (stepNumberEl) {
            stepNumberEl.textContent = `#${stepIndex + 1}`;
          }
        }
        stepIndex++;
      }
    } catch (err) {
      console.warn('refreshStepNumbers warning:', err);
    }
  },

  renderWorkflowSteps() {
    const steps = this.workflow.steps || (this.workflow.recordingData && this.workflow.recordingData.actions) || [];
    if (!steps || steps.length === 0) {
      Toast.info('This workflow has no recorded steps yet.');
      return;
    }
    
    let previousNodeId = null;
    let pos_x = 80;
    let pos_y = 100;

    steps.forEach((step, index) => {
      const actionType = (step.action || step.type || 'CLICK').toUpperCase();
      const friendlyName = this.getFriendlyStepName(step, index);
      const actionDesc = this.describeAction(step, friendlyName);

      // Resolve best target selector representation
      let targetSelector = '';
      const candidates = (step.target && Array.isArray(step.target.candidates)) ? step.target.candidates : [];
      
      if (typeof step.target === 'string') {
        targetSelector = step.target;
      } else if (candidates.length > 0) {
        targetSelector = candidates[0].value || '';
      } else if (step.target && step.target.fingerprint) {
        const fp = step.target.fingerprint;
        if (fp.id) targetSelector = `#${fp.id}`;
        else if (fp.attributes && fp.attributes.name) targetSelector = `[name="${fp.attributes.name}"]`;
        else if (fp.tagName) targetSelector = fp.tagName.toLowerCase();
      }

      const stepValue = step.value || (step.meta && step.meta.value) || '';
      const selectedOptionText = (step.meta && step.meta.text) || '';

      const actionClass = actionType.toLowerCase();
      let actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
      if (actionType === 'CLICK') actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`;
      else if (actionType === 'TYPE') actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="6" y1="8" x2="6" y2="8"></line><line x1="10" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="14" y2="8"></line><line x1="18" y1="8" x2="18" y2="8"></line><line x1="6" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="18" y2="12"></line><line x1="10" y1="16" x2="14" y2="16"></line></svg>`;
      else if (actionType === 'NAVIGATE') actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
      else if (actionType === 'SELECT') actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;
      else if (actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY' || actionType === 'ENTER') actionIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;

      // Parse list / dropdown options from fingerprint or meta
      const availableOptions = this.extractAvailableOptions(step);
      const isListOrSelect = actionType === 'SELECT' || availableOptions.length > 0 || /select|dropdown|list|option|:nth-child/i.test(targetSelector);

      // Determine step role (SETUP vs LOOP)
      let isLoopStep = false;
      if (step.role) {
        isLoopStep = step.role === 'LOOP';
      } else if (Number.isInteger(this.workflow.loopStepIndex) && this.workflow.loopStepIndex >= 0) {
        isLoopStep = index >= this.workflow.loopStepIndex;
      } else {
        isLoopStep = false;
      }

      // Step Node HTML setup
      let html = `
        <div class="df-node-header">
          <div class="df-action-badge ${actionClass}">
            <span style="display:inline-flex; align-items:center;">${actionIcon}</span>
            <span>${this.escapeHtml(actionType)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.35rem;">
            <span class="df-role-badge ${isLoopStep ? 'role-loop' : 'role-setup'}" id="badge-role-${index}">
              ${isLoopStep ? '🔁 LOOP' : '⚙️ ONCE'}
            </span>
            ${isListOrSelect ? `<span class="df-badge-pill options" title="Contains selectable options" style="display:inline-flex; align-items:center; gap:0.25rem;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg> Choices</span>` : ''}
            <span class="df-step-number">#${index + 1}</span>
            <button type="button" class="df-btn-delete-node" title="Delete this step">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Human-Friendly Hero Header -->
        <div class="df-node-hero">
          <span class="df-node-title" id="node-title-${index}">${this.escapeHtml(friendlyName)}</span>
          <span class="df-node-desc" id="node-desc-${index}">${this.escapeHtml(actionDesc)}</span>
        </div>

        <div class="df-node-body">
          <!-- Editable Friendly Name -->
          <div class="df-input-group">
            <label style="display:flex; justify-content:space-between; align-items:center;">
              <span>Element / Step Name</span>
              <span style="font-size:0.62rem; color:var(--text-sub); font-weight:normal;">User-Friendly</span>
            </label>
            <input type="text" class="df-name-input" value="${this.escapeHtml(friendlyName)}" placeholder="e.g. Invoice Button" spellcheck="false" />
          </div>

          <!-- Execution Role -->
          <div class="df-input-group" style="background:${isLoopStep ? '#fef3c7' : '#f8fafc'}; padding:0.45rem 0.55rem; border-radius:6px; border:1px solid ${isLoopStep ? '#fcd34d' : '#e2e8f0'};">
            <label style="color:${isLoopStep ? '#92400e' : '#475569'}; font-weight:700; font-size:0.7rem; display:flex; justify-content:space-between; align-items:center;">
              <span>Execution Role</span>
              <span class="df-role-helper" style="font-size:0.65rem; color:${isLoopStep ? '#b45309' : '#64748b'};">${isLoopStep ? 'Repeats for all items' : 'Runs once (navigation / form)'}</span>
            </label>
            <select class="df-role-select" style="font-size:0.75rem; font-weight:600; background:#fff; border-color:${isLoopStep ? '#f59e0b' : '#cbd5e1'};">
              <option value="SETUP" ${!isLoopStep ? 'selected' : ''}>⚙️ SETUP — Run once (Tabs, Login, Search)</option>
              <option value="LOOP" ${isLoopStep ? 'selected' : ''}>🔁 LOOP TARGET — Iterate across table rows/items</option>
            </select>
          </div>
      `;

      // List / Dropdown Options Selector
      if (isListOrSelect && availableOptions.length > 0) {
        html += `
          <div class="df-input-group" style="background:#f0fdf4; padding:0.6rem; border-radius:8px; border:1px solid #bbf7d0;">
            <label style="color:#166534; display:flex; justify-content:space-between; align-items:center;">
              <span>Available Options / Items</span>
              <span style="font-size:0.65rem; color:#15803d;">${availableOptions.length} Items</span>
            </label>
            <select class="df-option-select" style="background:#ffffff; border-color:#86efac; font-weight:600;">
              ${availableOptions.map((opt, optIdx) => {
                const isSelected = (stepValue && (opt.value === stepValue || opt.label === stepValue)) ||
                                   (selectedOptionText && opt.label.includes(selectedOptionText)) ||
                                   (optIdx === 0 && !stepValue && !selectedOptionText);
                return `
                  <option value="${this.escapeHtml(opt.value)}" data-label="${this.escapeHtml(opt.label)}" ${isSelected ? 'selected' : ''}>
                    ${optIdx + 1}. ${this.escapeHtml(opt.label)}
                  </option>
                `;
              }).join('')}
              <option value="__dynamic_loop__" ${step.isLoop || stepValue === '{{loop:index}}' ? 'selected' : ''}>
                [Dynamic Loop] Iterate: Item #1 on Run 1, Item #2 on Run 2...
              </option>
            </select>
            <small style="font-size:0.65rem; color:#15803d; margin-top:2px;">Pick an option to select or choose dynamic iteration loop.</small>
          </div>
        `;
      } else if (isListOrSelect) {
        // Fallback option helper for list/table items
        html += `
          <div class="df-input-group" style="background:#f8fafc; padding:0.5rem; border-radius:8px; border:1px solid #e2e8f0;">
            <label style="color:#475569;">Iteration / Option Mode</label>
            <select class="df-option-select" style="font-size:0.75rem;">
              <option value="fixed" ${!step.isLoop ? 'selected' : ''}>Fixed Item Target</option>
              <option value="__dynamic_loop__" ${step.isLoop ? 'selected' : ''}>[Dynamic Loop] Select Item #1 on Run 1, #2 on Run 2...</option>
            </select>
          </div>
        `;
      }

      if (actionType === 'TYPE' || actionType === 'NAVIGATE' || actionType === 'SELECT' || actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY' || stepValue || step.key) {
        const valLabel = (actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY') ? 'Key to Press (e.g. Enter, Tab, Escape)' : 'Value / Text to Type';
        const displayVal = step.key || stepValue || selectedOptionText || (actionType === 'KEY_PRESS' ? 'Enter' : '');
        html += `
          <div class="df-input-group">
            <label>${valLabel}</label>
            <input type="text" class="df-value-input" value="${this.escapeHtml(displayVal)}" placeholder="Enter value or key..." spellcheck="false" />
          </div>
        `;
      }

      // Checkbox Desired State Selector
      const isCheckboxStep = Boolean(
        step.isCheckbox === true ||
        step.desiredState !== undefined ||
        step.checked !== undefined ||
        step.target?.isCheckbox === true ||
        step.target?.fingerprint?.isCheckbox === true ||
        step.target?.fingerprint?.type === 'checkbox' ||
        step.target?.fingerprint?.role === 'checkbox' ||
        step.target?.fingerprint?.tagName === 'mat-pseudo-checkbox' ||
        friendlyName.toLowerCase().includes('checkbox') ||
        (step.name && step.name.toLowerCase().includes('checkbox')) ||
        (step.elementName && step.elementName.toLowerCase().includes('checkbox'))
      );
      const desiredCheckboxState = step.desiredState !== undefined
        ? step.desiredState
        : (step.checked !== undefined ? step.checked : (step.target?.fingerprint?.checked ?? true));

      if (isCheckboxStep) {
        html += `
          <div class="df-input-group df-checkbox-group" style="background:#eff6ff; padding:0.6rem; border-radius:8px; border:1px solid #bfdbfe;">
            <label style="color:#1d4ed8; font-weight:700; font-size:0.75rem; display:flex; justify-content:space-between; align-items:center;">
              <span>☑️ Checkbox Target State</span>
              <span style="font-size:0.65rem; color:#2563eb; background:#dbeafe; padding:1px 6px; border-radius:4px;">Idempotent</span>
            </label>
            <select class="df-checkbox-select" style="font-size:0.75rem; font-weight:600; background:#fff; border-color:#93c5fd; color:#1e3a8a; width:100%; border-radius:6px; padding:0.35rem 0.5rem; margin-top:4px;">
              <option value="true" ${desiredCheckboxState !== false ? 'selected' : ''}>Ensure CHECKED (Select / ON)</option>
              <option value="false" ${desiredCheckboxState === false ? 'selected' : ''}>Ensure UNCHECKED (Deselect / OFF)</option>
            </select>
            <small style="font-size:0.65rem; color:#3b82f6; display:block; margin-top:3px;">Preserves state on repeat runs; never toggles mistakenly.</small>
          </div>
        `;
      }

      // Collapsible Advanced Technical Selector
      html += `
          <details class="df-advanced-details">
            <summary class="df-advanced-summary">
              <span>⚙️ Technical Selector (CSS / XPath)</span>
              <svg class="df-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </summary>
            <div class="df-advanced-body">
              <input type="text" class="df-target-input" value="${this.escapeHtml(targetSelector)}" placeholder="#element-id or .class" spellcheck="false" />
              <span style="font-size:0.65rem; color:var(--text-sub); display:block; margin-top:3px;">Browser DOM locator path</span>
            </div>
          </details>

          <!-- Card Footer with Delete Option -->
          <div class="df-node-footer">
            <button type="button" class="df-btn-delete-text" title="Delete this step from workflow">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Delete Step</span>
            </button>
          </div>
        </div>
      `;

      const nodeId = this.editor.addNode(
        'step', 
        1, 
        1, 
        pos_x, 
        pos_y, 
        'step-node', 
        { action: actionType, originalStep: step }, 
        html
      );

      if (previousNodeId) {
        this.editor.addConnection(previousNodeId, nodeId, "output_1", "input_1");
      }

      // Wire interactive events for name input, option dropdown, and role
      setTimeout(() => {
        const nodeEl = document.getElementById(`node-${nodeId}`);
        if (nodeEl) {
          const nameInput = nodeEl.querySelector('.df-name-input');
          const valueInput = nodeEl.querySelector('.df-value-input');
          const titleEl = document.getElementById(`node-title-${index}`);
          const descEl = document.getElementById(`node-desc-${index}`);
          const targetInput = nodeEl.querySelector('.df-target-input');
          const optionSelect = nodeEl.querySelector('.df-option-select');

          if (nameInput) {
            nameInput.addEventListener('input', (e) => {
              const newName = e.target.value.trim() || `Step #${index + 1}`;
              if (titleEl) titleEl.textContent = newName;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: actionType,
                value: valueInput?.value || stepValue,
                key: step.key
              }, newName);
            });
          }

          if (valueInput) {
            valueInput.addEventListener('input', (e) => {
              const currentName = nameInput ? nameInput.value.trim() : friendlyName;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: actionType,
                value: e.target.value,
                key: step.key
              }, currentName);
            });
          }

          if (optionSelect && valueInput) {
            optionSelect.onchange = (e) => {
              const val = e.target.value;
              if (val === '__dynamic_loop__') {
                valueInput.value = '{{loop:index}}';
                Toast.info(`Step #${index + 1} set to dynamic iteration mode`);
              } else {
                const selectedOpt = e.target.options[e.target.selectedIndex];
                const label = selectedOpt ? selectedOpt.getAttribute('data-label') : val;
                valueInput.value = val || label || '';
                Toast.success(`Selected option: ${label || val}`);
              }
              const currentName = nameInput ? nameInput.value.trim() : friendlyName;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: actionType,
                value: valueInput.value,
                key: step.key
              }, currentName);
            };
          }

          const checkboxSelect = nodeEl.querySelector('.df-checkbox-select');
          if (checkboxSelect) {
            checkboxSelect.onchange = (e) => {
              const shouldBeChecked = e.target.value === 'true';
              const currentName = nameInput ? nameInput.value.trim() : friendlyName;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: actionType,
                isCheckbox: true,
                desiredState: shouldBeChecked,
                checked: shouldBeChecked
              }, currentName);
              Toast.info(`Step #${index + 1} set to ensure ${shouldBeChecked ? 'CHECKED' : 'UNCHECKED'}`);
            };
          }

          const roleSelect = nodeEl.querySelector('.df-role-select');
          if (roleSelect) {
            roleSelect.onchange = (e) => {
              const newRole = e.target.value;
              const roleBadge = document.getElementById(`badge-role-${index}`);
              const roleHelper = nodeEl.querySelector('.df-role-helper');
              const roleGroup = roleSelect.closest('.df-input-group');
              if (newRole === 'LOOP') {
                if (roleBadge) {
                  roleBadge.className = 'df-role-badge role-loop';
                  roleBadge.textContent = '🔁 LOOP';
                }
                if (roleHelper) {
                  roleHelper.textContent = 'Repeats for all items';
                  roleHelper.style.color = '#b45309';
                }
                if (roleGroup) {
                  roleGroup.style.background = '#fef3c7';
                  roleGroup.style.borderColor = '#fcd34d';
                }
                Toast.info(`Step #${index + 1} marked as LOOP (repeats per item)`);
              } else {
                if (roleBadge) {
                  roleBadge.className = 'df-role-badge role-setup';
                  roleBadge.textContent = '⚙️ ONCE';
                }
                if (roleHelper) {
                  roleHelper.textContent = 'Runs once (navigation / form)';
                  roleHelper.style.color = '#64748b';
                }
                if (roleGroup) {
                  roleGroup.style.background = '#f8fafc';
                  roleGroup.style.borderColor = '#e2e8f0';
                }
                Toast.info(`Step #${index + 1} marked as SETUP (runs once)`);
              }
            };
          }

          // Wire Delete Step buttons
          const deleteBtnHeader = nodeEl.querySelector('.df-btn-delete-node');
          const deleteBtnFooter = nodeEl.querySelector('.df-btn-delete-text');
          const triggerDelete = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const currentName = nameInput ? nameInput.value.trim() : friendlyName;
            this.promptDeleteNode(nodeId, currentName);
          };
          if (deleteBtnHeader) deleteBtnHeader.onclick = triggerDelete;
          if (deleteBtnFooter) deleteBtnFooter.onclick = triggerDelete;
        }
      }, 50);

      previousNodeId = nodeId;
      pos_x += 390;
    });
  },

  extractAvailableOptions(step) {
    const options = [];

    // 1. Explicit meta.options
    if (step.meta && Array.isArray(step.meta.options) && step.meta.options.length > 0) {
      return step.meta.options.map(opt => typeof opt === 'string' ? { value: opt, label: opt } : opt);
    }

    // 2. Extract from select element fingerprint text
    const fp = step.target && step.target.fingerprint;
    if (fp && fp.text && (fp.tagName === 'select' || step.type === 'SELECT' || (step.meta && step.meta.selectedIndex !== undefined))) {
      const raw = fp.text.trim();
      // Split by common delimiters or sequential capital letters
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length > 1) {
        return lines.map(t => ({ value: t.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: t }));
      }
      
      // Split by multiple spaces
      const parts = raw.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        return parts.map(t => ({ value: t.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: t }));
      }
    }

    // 3. If meta text or value exists
    if (step.value || (step.meta && step.meta.text)) {
      const label = (step.meta && step.meta.text) || step.value;
      options.push({ value: step.value || label, label });
    }

    return options;
  },

  getFriendlyStepName(step, index) {
    if (step.elementName && typeof step.elementName === 'string' && step.elementName.trim()) {
      return step.elementName.trim();
    }
    if (step.name && typeof step.name === 'string' && step.name.trim() && !step.name.startsWith('act_')) {
      return step.name.trim();
    }
    if (step.target?.elementName) return step.target.elementName;
    if (step.target?.friendlyName) return step.target.friendlyName;

    const fp = step.target?.fingerprint || {};
    const tag = (fp.tagName || '').toLowerCase();
    const actionType = (step.action || step.type || 'CLICK').toUpperCase();

    // Suffix
    let suffix = 'Element';
    if (['button', 'submit'].includes(fp.type) || tag === 'button' || fp.role === 'button') suffix = 'Button';
    else if (fp.type === 'checkbox' || fp.role === 'checkbox' || tag === 'mat-pseudo-checkbox') suffix = 'Checkbox';
    else if (fp.type === 'radio' || fp.role === 'radio') suffix = 'Radio';
    else if (tag === 'select' || tag === 'mat-select' || fp.role === 'combobox') suffix = 'Dropdown';
    else if (tag === 'mat-option' || tag === 'option' || fp.role === 'option') suffix = 'Option';
    else if (tag === 'a' || fp.role === 'link') suffix = 'Link';
    else if (tag === 'canvas') suffix = 'Canvas Area';
    else if (tag === 'input' || tag === 'textarea') {
      suffix = fp.type === 'password' ? 'Password Field' : (fp.type === 'search' ? 'Search Field' : 'Input');
    } else if (actionType === 'CLICK') {
      suffix = 'Button';
    }

    let label = fp.ariaLabel || (fp.attributes && fp.attributes.title) || fp.placeholder || fp.text || '';
    if (!label && fp.name) {
      label = fp.name.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    }
    if (!label && fp.id && !/^\d+$|^mat-|^ng-|^cdk-|^:r/.test(fp.id)) {
      label = fp.id.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b(btn|button|input|txt|lbl|field)\b/gi, '').trim();
    }

    if (label) {
      label = label.replace(/[*:]+$/g, '').trim();
      if (label.length > 35) label = label.slice(0, 32).trim() + '…';
      if (/^[a-z]/.test(label)) label = label.charAt(0).toUpperCase() + label.slice(1);
      if (label.toLowerCase().endsWith(suffix.toLowerCase()) || (suffix === 'Button' && label.toLowerCase().endsWith('btn'))) {
        return label;
      }
      return `${label} ${suffix}`;
    }

    if (actionType === 'NAVIGATE') return 'Open Target Page';
    return `Step #${index + 1} ${suffix}`;
  },

  describeAction(step, friendlyName) {
    const actionType = (step.action || step.type || 'CLICK').toUpperCase();
    const val = step.value || (step.meta && step.meta.value) || '';
    const key = step.key || '';

    const isCb = Boolean(
      step.isCheckbox === true ||
      step.desiredState !== undefined ||
      step.checked !== undefined ||
      step.target?.isCheckbox === true ||
      step.target?.fingerprint?.isCheckbox === true ||
      step.target?.fingerprint?.type === 'checkbox' ||
      step.target?.fingerprint?.role === 'checkbox' ||
      step.target?.fingerprint?.tagName === 'mat-pseudo-checkbox' ||
      friendlyName.toLowerCase().includes('checkbox')
    );

    if (isCb) {
      const isCheck = step.desiredState !== false;
      return `${isCheck ? 'Check' : 'Uncheck'} "${friendlyName}" (ensure state is ${isCheck ? 'ON' : 'OFF'})`;
    }

    if (actionType === 'CLICK') {
      return `Click on "${friendlyName}"`;
    }
    if (actionType === 'DOUBLE_CLICK') {
      return `Double-click "${friendlyName}"`;
    }
    if (actionType === 'TYPE') {
      return val ? `Type "${val}" into ${friendlyName}` : `Type text into ${friendlyName}`;
    }
    if (actionType === 'SELECT') {
      return val ? `Select "${val}" in ${friendlyName}` : `Pick an option from ${friendlyName}`;
    }
    if (actionType === 'NAVIGATE') {
      const url = step.url || val || 'target URL';
      return `Navigate to ${url}`;
    }
    if (actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY' || actionType === 'ENTER') {
      return `Press key [${key || val || 'Enter'}]`;
    }
    return `Perform ${actionType} on ${friendlyName}`;
  },

  isSaving: false,

  async saveWorkflow() {
    if (this.isSaving) return;
    this.isSaving = true;

    const btn = document.getElementById('btnSaveFlow');
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '<span>Saving...</span>';
      btn.disabled = true;
    }

    try {
      if (!this.editor || !this.workflowId) return;

      const exported = this.editor.export();
      const data = exported.drawflow.Home.data;
      const nodes = Object.values(data);
      
      if (nodes.length === 0) {
        Toast.error("Workflow is empty!");
        return;
      }

      // Find the start node (node with no input connections)
      let startNodeId = null;
      for (const node of nodes) {
        const inputConn = node.inputs?.input_1?.connections;
        if (!inputConn || inputConn.length === 0) {
          startNodeId = node.id;
          break;
        }
      }

      if (!startNodeId) {
        // Fallback to leftmost node by X position
        const sorted = [...nodes].sort((a, b) => (a.pos_x || 0) - (b.pos_x || 0));
        startNodeId = sorted[0].id;
      }

      // Helper to extract clean step data from a Drawflow node
      const extractStep = (node, index) => {
        const nodeElement = document.getElementById(`node-${node.id}`);
        const nameInput = nodeElement ? nodeElement.querySelector('.df-name-input') : null;
        const targetInput = nodeElement ? nodeElement.querySelector('.df-target-input') : null;
        const valueInput = nodeElement ? nodeElement.querySelector('.df-value-input') : null;
        const optionSelect = nodeElement ? nodeElement.querySelector('.df-option-select') : null;
        const roleSelect = nodeElement ? nodeElement.querySelector('.df-role-select') : null;

        const originalStep = node.data?.originalStep || {};
        const stepRole = roleSelect ? roleSelect.value : (originalStep.role || 'SETUP');
        const actionType = node.data?.action || originalStep.action || originalStep.type || 'CLICK';
        const stepName = nameInput ? nameInput.value.trim() : (originalStep.name || originalStep.elementName || '');
        const newTargetVal = targetInput ? targetInput.value.trim() : '';

        let newTarget = originalStep.target;
        if (typeof originalStep.target === 'object' && originalStep.target !== null) {
          const candidates = originalStep.target.candidates ? [...originalStep.target.candidates] : [];
          if (candidates.length > 0) {
            candidates[0] = { ...candidates[0], value: newTargetVal };
          } else {
            candidates.push({ strategy: 'css', value: newTargetVal, priority: 1, uniqueness: 1 });
          }
          newTarget = {
            ...originalStep.target,
            candidates,
            elementName: stepName,
            friendlyName: stepName
          };
        } else {
          newTarget = newTargetVal;
        }

        const checkboxSelect = nodeElement ? nodeElement.querySelector('.df-checkbox-select') : null;
        const isCheckboxStep = Boolean(checkboxSelect || originalStep.isCheckbox || (originalStep.target?.fingerprint?.type === 'checkbox'));
        const desiredState = checkboxSelect ? (checkboxSelect.value === 'true') : (originalStep.desiredState ?? originalStep.checked);

        const stepData = {
          ...originalStep,
          index,
          name: stepName,
          elementName: stepName,
          action: actionType,
          type: actionType,
          target: newTarget,
          role: stepRole,
          isLoopCandidate: stepRole === 'LOOP',
          ...(isCheckboxStep ? { isCheckbox: true } : {}),
          ...(desiredState !== undefined ? { desiredState: Boolean(desiredState), checked: Boolean(desiredState) } : {})
        };

        if (optionSelect && optionSelect.value === '__dynamic_loop__') {
          stepData.isLoop = true;
          stepData.loopMode = 'sequential_iteration';
          stepData.role = 'LOOP';
          stepData.isLoopCandidate = true;
        } else if (stepRole === 'SETUP') {
          stepData.isLoop = false;
          stepData.loopMode = null;
          stepData.isLoopCandidate = false;
          stepData.role = 'SETUP';
        } else {
          stepData.role = stepRole;
          stepData.isLoop = stepRole === 'LOOP';
          stepData.isLoopCandidate = stepRole === 'LOOP';
        }

        if (valueInput) {
          stepData.value = valueInput.value;
          if (actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY' || actionType === 'ENTER') {
            stepData.key = valueInput.value || 'Enter';
          }
        }

        return stepData;
      };

      const newSteps = [];
      let currentNodeId = startNodeId;
      const visited = new Set();

      // 1. Follow the connected chain in order
      while (currentNodeId && !visited.has(String(currentNodeId))) {
        visited.add(String(currentNodeId));
        const node = data[currentNodeId];
        if (!node) break;

        newSteps.push(extractStep(node, newSteps.length));

        if (node.outputs?.output_1?.connections?.length > 0) {
          currentNodeId = node.outputs.output_1.connections[0].node;
        } else {
          currentNodeId = null;
        }
      }

      // 2. Only if there are genuinely disconnected nodes that were NEVER visited in the chain
      const unvisitedNodes = nodes.filter(n => !visited.has(String(n.id)));
      if (unvisitedNodes.length > 0) {
        unvisitedNodes.sort((a, b) => (a.pos_x || 0) - (b.pos_x || 0));
        for (const node of unvisitedNodes) {
          visited.add(String(node.id));
          newSteps.push(extractStep(node, newSteps.length));
        }
      }

      // Determine loopStepIndex as index of first step marked LOOP or dynamic loop
      const firstLoopIdx = newSteps.findIndex(s => s.role === 'LOOP' || (s.isLoop === true && s.role !== 'SETUP') || s.loopMode === 'sequential_iteration');
      const hasLoop = firstLoopIdx >= 0;
      const loopStepIndex = hasLoop ? firstLoopIdx : null;
      const wfMode = hasLoop ? 'LOOP' : 'STANDARD';

      const targetUrlInput = document.getElementById('wfTargetUrlInput');
      const updatedTargetUrl = targetUrlInput ? targetUrlInput.value.trim() : (this.workflow.targetUrl || '');

      await Api.updateWorkflow(this.workflowId, {
        steps: newSteps,
        loopStepIndex,
        isLoop: hasLoop,
        mode: wfMode,
        targetUrl: updatedTargetUrl
      });

      if (this.workflow) {
        this.workflow.steps = newSteps;
        this.workflow.loopStepIndex = loopStepIndex;
        this.workflow.isLoop = hasLoop;
        this.workflow.mode = wfMode;
        this.workflow.targetUrl = updatedTargetUrl;
      }

      Toast.success(`Workflow saved successfully (${newSteps.length} steps updated, loop index: ${loopStepIndex != null ? loopStepIndex + 1 : 'None'})!`);
      const badge = document.getElementById('wfStepCounter');
      if (badge) badge.textContent = `${newSteps.length} Steps`;
    } catch (err) {
      console.error(err);
      Toast.error('Failed to save workflow: ' + err.message);
    } finally {
      this.isSaving = false;
      if (btn) {
        btn.innerHTML = origText;
        btn.disabled = false;
      }
    }
  },

  escapeHtml(unsafe) {
    return (unsafe || '').toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  destroy() {
    this.hideConnectionMenu();
    this.hideDeleteModal();
    if (this.keyDeleteHandler) {
      window.removeEventListener('keydown', this.keyDeleteHandler);
      this.keyDeleteHandler = null;
    }
    if (this.editor) {
      try {
        this.editor.clear();
      } catch {}
      this.editor = null;
    }
    this.workflow = null;
    this.selectedConnectionInfo = null;
  }
};
