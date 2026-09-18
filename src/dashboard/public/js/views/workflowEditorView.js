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
        <div class="workflow-editor-canvas" id="drawflow">
          <div class="drawflow-canvas-controls">
            <button type="button" id="btnZoomIn" title="Zoom In">➕</button>
            <button type="button" id="btnZoomOut" title="Zoom Out">➖</button>
            <button type="button" id="btnZoomReset" title="Reset View">⟲</button>
          </div>
        </div>
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
    
    // Ensure parent-drawflow is the primary class so Drawflow's internal switch statement matches
    container.className = 'parent-drawflow workflow-editor-canvas';

    this.editor = new Drawflow(container);
    this.editor.start();
    this.editor.clearModuleSelected();

    // Universal Pan / Drag handler across the entire canvas viewport
    container.addEventListener('mousedown', (e) => {
      // Ignore clicks on nodes, form inputs, or canvas control buttons
      if (e.target.closest('.drawflow-node') || e.target.closest('.drawflow-canvas-controls') || e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
        return;
      }
      this.editor.editor_selected = true;
      this.editor.pos_x = e.clientX;
      this.editor.pos_y = e.clientY;
    }, true);

    container.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1 && !e.target.closest('.drawflow-node') && !e.target.closest('.drawflow-canvas-controls') && !e.target.closest('button')) {
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
    let pos_y = 100;

    steps.forEach((step, index) => {
      const actionType = (step.action || step.type || 'CLICK').toUpperCase();

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
      let actionIcon = '⚡';
      if (actionType === 'CLICK') actionIcon = '👆';
      else if (actionType === 'TYPE') actionIcon = '⌨️';
      else if (actionType === 'NAVIGATE') actionIcon = '🌐';
      else if (actionType === 'SELECT') actionIcon = '📋';

      // Parse list / dropdown options from fingerprint or meta
      const availableOptions = this.extractAvailableOptions(step);
      const isListOrSelect = actionType === 'SELECT' || availableOptions.length > 0 || /select|dropdown|list|option|:nth-child/i.test(targetSelector);

      // Step Node HTML setup
      let html = `
        <div class="df-node-header">
          <div class="df-action-badge ${actionClass}">
            <span>${actionIcon}</span>
            <span>${this.escapeHtml(actionType)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.35rem;">
            ${isListOrSelect ? `<span class="df-badge-pill options" title="Contains selectable options / list items">📋 Choices</span>` : ''}
            <span class="df-step-number">#${index + 1}</span>
          </div>
        </div>
        <div class="df-node-body">
      `;

      // Candidate Selectors (if recorded multiple candidates)
      if (candidates.length > 1) {
        html += `
          <div class="df-input-group">
            <label>Selector Strategy</label>
            <select class="df-candidate-select" style="font-size:0.72rem; padding:5px 8px;">
              ${candidates.map((c, cIdx) => `
                <option value="${this.escapeHtml(c.value)}" ${cIdx === 0 ? 'selected' : ''}>
                  ${this.escapeHtml(c.strategy ? c.strategy.toUpperCase() : 'CSS')}: ${this.escapeHtml(c.value)}
                </option>
              `).join('')}
              <option value="__custom__">Custom Selector...</option>
            </select>
          </div>
        `;
      }

      html += `
          <div class="df-input-group">
            <label>Target Selector (CSS / XPath)</label>
            <input type="text" class="df-target-input" value="${this.escapeHtml(targetSelector)}" placeholder="#element-id or .class" spellcheck="false" />
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
                🔄 [Dynamic Loop] Iterate: Item #1 on Run 1, Item #2 on Run 2...
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
              <option value="fixed" ${!step.isLoop ? 'selected' : ''}>🎯 Fixed Item Target</option>
              <option value="__dynamic_loop__" ${step.isLoop ? 'selected' : ''}>🔄 [Dynamic Loop] Select Item #1 on Run 1, #2 on Run 2...</option>
            </select>
          </div>
        `;
      }

      if (actionType === 'TYPE' || actionType === 'NAVIGATE' || actionType === 'SELECT' || stepValue) {
        html += `
          <div class="df-input-group">
            <label>Selected Value / Text</label>
            <input type="text" class="df-value-input" value="${this.escapeHtml(stepValue || selectedOptionText)}" placeholder="Selected value or input text..." spellcheck="false" />
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

      // Wire interactive events for candidate selector and option dropdown
      setTimeout(() => {
        const nodeEl = document.getElementById(`node-${nodeId}`);
        if (nodeEl) {
          const candidateSelect = nodeEl.querySelector('.df-candidate-select');
          const targetInput = nodeEl.querySelector('.df-target-input');
          const optionSelect = nodeEl.querySelector('.df-option-select');
          const valueInput = nodeEl.querySelector('.df-value-input');

          if (candidateSelect && targetInput) {
            candidateSelect.onchange = (e) => {
              if (e.target.value !== '__custom__') {
                targetInput.value = e.target.value;
              }
            };
          }

          if (optionSelect && valueInput) {
            optionSelect.onchange = (e) => {
              const val = e.target.value;
              if (val === '__dynamic_loop__') {
                valueInput.value = '{{loop:index}}';
                Toast.info(`Step #${index + 1} set to dynamic iteration mode (item #1 on 1st run, item #2 on 2nd run...)`);
              } else {
                const selectedOpt = e.target.options[e.target.selectedIndex];
                const label = selectedOpt ? selectedOpt.getAttribute('data-label') : val;
                valueInput.value = val || label || '';
                Toast.success(`Selected option: ${label || val}`);
              }
            };
          }
        }
      }, 50);

      previousNodeId = nodeId;
      pos_x += 380;
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
      const optionSelect = nodeElement ? nodeElement.querySelector('.df-option-select') : null;

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

      if (optionSelect && optionSelect.value === '__dynamic_loop__') {
        stepData.isLoop = true;
        stepData.loopMode = 'sequential_iteration';
      }

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
