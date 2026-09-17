import { API } from '../api.js';

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
            <button class="btn btn-secondary" id="btnBack">
              <i class="ph ph-arrow-left"></i> Back
            </button>
            <h2 id="wfTitle" style="margin: 0; font-size: 1.25rem;">Loading Workflow...</h2>
          </div>
          <div>
            <button class="btn btn-primary" id="btnSaveFlow">
              <i class="ph ph-floppy-disk"></i> Save Workflow
            </button>
          </div>
        </div>
        <div class="workflow-editor-canvas" id="drawflow"></div>
      </div>
    `;

    document.getElementById('btnBack').addEventListener('click', () => {
      router.navigate('workflows');
    });

    document.getElementById('btnSaveFlow').addEventListener('click', () => {
      this.saveWorkflow();
    });

    try {
      this.workflow = await API.getWorkflowById(this.workflowId);
      document.getElementById('wfTitle').textContent = `Editing: ${this.workflow.name || 'Workflow'}`;
      this.initDrawflow();
    } catch (err) {
      console.error(err);
      alert('Failed to load workflow for editing.');
    }
  },

  initDrawflow() {
    const container = document.getElementById('drawflow');
    this.editor = new Drawflow(container);
    // Remove default start node if needed
    this.editor.start();
    this.editor.clearModuleSelected();

    this.renderWorkflowSteps();
  },

  renderWorkflowSteps() {
    if (!this.workflow || !this.workflow.steps) return;
    
    let previousNodeId = null;
    let pos_x = 100;
    let pos_y = 150;

    this.workflow.steps.forEach((step, index) => {
      // Step Node HTML setup
      let html = `
        <div class="df-node-header">
          <span>Action: ${step.action}</span>
          <span style="color: var(--text-muted); font-size: 0.75rem;">#${index + 1}</span>
        </div>
        <div class="df-node-body">
          <div class="df-input-group">
            <label>Target Selector</label>
            <input type="text" class="df-target-input" value="${this.escapeHtml(step.target || '')}" placeholder="body > div..." />
          </div>
      `;

      if (step.action === 'TYPE' || step.action === 'NAVIGATE') {
        html += `
          <div class="df-input-group">
            <label>Value</label>
            <input type="text" class="df-value-input" value="${this.escapeHtml(step.value || '')}" placeholder="Value..." />
          </div>
        `;
      }

      html += `
        </div>
      `;

      // Drawflow node definition
      // num_inputs, num_outputs, html, data
      const nodeId = this.editor.addNode(
        'step', 
        previousNodeId ? 1 : 0, 
        1, 
        pos_x, 
        pos_y, 
        'step-node', 
        { action: step.action, originalStep: step }, 
        html
      );

      // Connect to previous
      if (previousNodeId) {
        this.editor.addConnection(previousNodeId, nodeId, "output_1", "input_1");
      }

      previousNodeId = nodeId;
      pos_x += 350; // shift right for next node
    });
  },

  async saveWorkflow() {
    const exported = this.editor.export();
    const data = exported.drawflow.Home.data;
    
    // We need to parse the graph back to a linear array
    // 1. Find the starting node (has 0 inputs or no connections on input_1)
    let startNodeId = null;
    const nodes = Object.values(data);
    
    if (nodes.length === 0) {
      alert("Workflow is empty!");
      return;
    }

    for (const node of nodes) {
      if (Object.keys(node.inputs).length === 0 || node.inputs.input_1.connections.length === 0) {
        startNodeId = node.id;
        break;
      }
    }

    if (!startNodeId) {
      alert("Could not find a valid start node (ensure one node has no inputs)");
      return;
    }

    // Traverse the chain
    const newSteps = [];
    let currentNodeId = startNodeId;
    let fallbackCounter = 0; // Prevent infinite loop

    while (currentNodeId && fallbackCounter < 1000) {
      fallbackCounter++;
      const node = data[currentNodeId];
      
      // We need to extract the updated values from the DOM since Drawflow data object doesn't auto-bind to inner HTML inputs
      const nodeElement = document.getElementById(`node-${node.id}`);
      if (!nodeElement) break;

      const targetInput = nodeElement.querySelector('.df-target-input');
      const valueInput = nodeElement.querySelector('.df-value-input');

      const originalStep = node.data.originalStep || {};
      
      const stepData = {
        ...originalStep,
        action: node.data.action,
        target: targetInput ? targetInput.value : originalStep.target,
      };

      if (valueInput) {
        stepData.value = valueInput.value;
      }

      newSteps.push(stepData);

      // Go to next
      if (node.outputs && node.outputs.output_1 && node.outputs.output_1.connections.length > 0) {
        // Linear workflow assumes only 1 connection output
        currentNodeId = node.outputs.output_1.connections[0].node;
      } else {
        currentNodeId = null;
      }
    }

    try {
      const btn = document.getElementById('btnSaveFlow');
      const origText = btn.innerHTML;
      btn.innerHTML = 'Saving...';
      btn.disabled = true;

      await API.updateWorkflow(this.workflowId, { steps: newSteps });
      
      btn.innerHTML = origText;
      btn.disabled = false;
      alert("Workflow saved successfully!");
    } catch (err) {
      console.error(err);
      alert('Failed to save workflow: ' + err.message);
      document.getElementById('btnSaveFlow').disabled = false;
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
