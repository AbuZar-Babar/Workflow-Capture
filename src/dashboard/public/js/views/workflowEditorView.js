import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Router } from '../router.js';

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
              <span>← Back to Workflows</span>
            </button>
            <h2 id="wfTitle" style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-main);">Loading Workflow...</h2>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span id="wfStepCounter" class="badge-tag success">0 Steps</span>
            <button class="btn btn-primary btn-sm" id="btnSaveFlow">
              <span>💾 Save Workflow</span>
            </button>
          </div>
        </div>
        <div class="workflow-editor-canvas" id="drawflow"></div>
      </div>
    `;

    document.getElementById('btnBack').addEventListener('click', () => {
      Router.navigate('workflows');
    });

    document.getElementById('btnSaveFlow').addEventListener('click', () => {
      this.saveWorkflow();
    });

    try {
      const data = await Api.getWorkflowById(this.workflowId);
      this.workflow = data.workflow || data;
      const wfName = this.workflow.name || 'Workflow';
      document.getElementById('wfTitle').textContent = `Visual Editor: ${wfName}`;
      
      const steps = this.workflow.steps || (this.workflow.recordingData && this.workflow.recordingData.actions) || [];
      const badge = document.getElementById('wfStepCounter');
      if (badge) badge.textContent = `${steps.length} Steps`;

      this.initDrawflow();
    } catch (err) {
      console.error(err);
      Toast.error('Failed to load workflow: ' + err.message);
    }
  },

  initDrawflow() {
    const container = document.getElementById('drawflow');
    if (!container) return;
    this.editor = new Drawflow(container);
    this.editor.start();
    this.editor.clearModuleSelected();

    this.renderWorkflowSteps();
  },

  renderWorkflowSteps() {
    const steps = this.workflow.steps || (this.workflow.recordingData && this.workflow.recordingData.actions) || [];
    if (!steps || steps.length === 0) {
      Toast.info('This workflow has no recorded steps yet.');
      return;
    }
    
    let previousNodeId = null;
    let pos_x = 80;
    let pos_y = 120;

    steps.forEach((step, index) => {
      const actionType = (step.action || step.type || 'CLICK').toUpperCase();

      // Resolve best target selector representation
      let targetSelector = '';
      if (typeof step.target === 'string') {
        targetSelector = step.target;
      } else if (step.target && Array.isArray(step.target.candidates) && step.target.candidates.length > 0) {
        targetSelector = step.target.candidates[0].value || '';
      } else if (step.target && step.target.fingerprint) {
        const fp = step.target.fingerprint;
        if (fp.id) targetSelector = `#${fp.id}`;
        else if (fp.attributes && fp.attributes.name) targetSelector = `[name="${fp.attributes.name}"]`;
        else if (fp.tagName) targetSelector = fp.tagName.toLowerCase();
      }

      const stepValue = step.value || (step.meta && step.meta.value) || '';

      const actionClass = actionType.toLowerCase();
      let actionIcon = '⚡';
      if (actionType === 'CLICK') actionIcon = '👆';
      else if (actionType === 'TYPE') actionIcon = '⌨️';
      else if (actionType === 'NAVIGATE') actionIcon = '🌐';

      // Step Node HTML setup
      let html = `
        <div class="df-node-header">
          <div class="df-action-badge ${actionClass}">
            <span>${actionIcon}</span>
            <span>${this.escapeHtml(actionType)}</span>
          </div>
          <span class="df-step-number">#${index + 1}</span>
        </div>
        <div class="df-node-body">
          <div class="df-input-group">
            <label>Target Selector (CSS / XPath)</label>
            <input type="text" class="df-target-input" value="${this.escapeHtml(targetSelector)}" placeholder="#element-id or .class" spellcheck="false" />
          </div>
      `;

      if (actionType === 'TYPE' || actionType === 'NAVIGATE' || stepValue) {
        html += `
          <div class="df-input-group">
            <label>Value / Input Text</label>
            <input type="text" class="df-value-input" value="${this.escapeHtml(stepValue)}" placeholder="Input text..." spellcheck="false" />
          </div>
        `;
      }

      html += `
        </div>
      `;

      const nodeId = this.editor.addNode(
        'step', 
        previousNodeId ? 1 : 0, 
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

      previousNodeId = nodeId;
      pos_x += 360;
    });
  },

  async saveWorkflow() {
    const exported = this.editor.export();
    const data = exported.drawflow.Home.data;
    
    let startNodeId = null;
    const nodes = Object.values(data);
    
    if (nodes.length === 0) {
      Toast.error("Workflow is empty!");
      return;
    }

    for (const node of nodes) {
      if (Object.keys(node.inputs).length === 0 || !node.inputs.input_1 || node.inputs.input_1.connections.length === 0) {
        startNodeId = node.id;
        break;
      }
    }

    if (!startNodeId) {
      startNodeId = nodes[0].id;
    }

    // Traverse the chain in visual order
    const newSteps = [];
    let currentNodeId = startNodeId;
    let visited = new Set();

    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId);
      const node = data[currentNodeId];
      if (!node) break;
      
      const nodeElement = document.getElementById(`node-${node.id}`);
      const targetInput = nodeElement ? nodeElement.querySelector('.df-target-input') : null;
      const valueInput = nodeElement ? nodeElement.querySelector('.df-value-input') : null;

      const originalStep = node.data.originalStep || {};
      const actionType = node.data.action || originalStep.action || originalStep.type || 'CLICK';
      const newTargetVal = targetInput ? targetInput.value.trim() : '';
      
      let newTarget = originalStep.target;
      if (typeof originalStep.target === 'object' && originalStep.target !== null) {
        const candidates = originalStep.target.candidates ? [...originalStep.target.candidates] : [];
        if (candidates.length > 0) {
          candidates[0] = { ...candidates[0], value: newTargetVal };
        } else {
          candidates.push({ strategy: 'css', value: newTargetVal, priority: 1, uniqueness: 1 });
        }
        newTarget = { ...originalStep.target, candidates };
      } else {
        newTarget = newTargetVal;
      }

      const stepData = {
        ...originalStep,
        action: actionType,
        type: actionType,
        target: newTarget,
      };

      if (valueInput) {
        stepData.value = valueInput.value;
      }

      newSteps.push(stepData);

      if (node.outputs && node.outputs.output_1 && node.outputs.output_1.connections.length > 0) {
        currentNodeId = node.outputs.output_1.connections[0].node;
      } else {
        currentNodeId = null;
      }
    }

    const btn = document.getElementById('btnSaveFlow');
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '<span>Saving...</span>';
      btn.disabled = true;
    }

    try {
      await Api.updateWorkflow(this.workflowId, { steps: newSteps });
      Toast.success(`Workflow saved successfully (${newSteps.length} steps updated)!`);
      const badge = document.getElementById('wfStepCounter');
      if (badge) badge.textContent = `${newSteps.length} Steps`;
    } catch (err) {
      console.error(err);
      Toast.error('Failed to save workflow: ' + err.message);
    } finally {
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
  }
};
