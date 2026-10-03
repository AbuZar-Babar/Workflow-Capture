/**
 * Workflow Capture — Modernized Workflow Editor View
 * Human-friendly visual editor built on Drawflow with clear setup vs repeated distinction,
 * progressive disclosure for technical selectors, accessible node actions,
 * and robust Task 10 lifecycle safeguards.
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { Router } from '../router.js';
import { ExecutionModal } from '../components/executionModal.js';
import { renderRobotAvatar } from '../components/robotAvatar.js';

export const WorkflowEditorView = {
  editor: null,
  workflowId: null,
  workflow: null,
  currentGeneration: 0,
  isMounted: false,
  mountedWorkflowId: null,
  activeTimers: null,
  selectedConnectionInfo: null,
  selectedNodeId: null,
  pendingDeleteNodeId: null,
  isSaving: false,
  isSpaceDown: false,
  isSpacePanning: false,
  spaceStartX: 0,
  spaceStartY: 0,

  // Event handlers for clean removal in destroy()
  keyHandler: null,
  keyUpHandler: null,
  onCanvasMouseDown: null,
  onWindowMouseMove: null,
  onWindowMouseUp: null,

  setSafeTimeout(fn, ms) {
    if (!this.isMounted) return null;
    if (!this.activeTimers) this.activeTimers = new Set();
    const timerId = setTimeout(() => {
      if (this.activeTimers) this.activeTimers.delete(timerId);
      if (!this.isMounted) return;
      fn();
    }, ms);
    this.activeTimers.add(timerId);
    return timerId;
  },

  clearAllTimers() {
    if (this.activeTimers) {
      for (const id of this.activeTimers) {
        clearTimeout(id);
      }
      this.activeTimers.clear();
    }
  },

  async render(container, router, workflowId) {
    // Teardown previous editor instance/listeners before mounting new workflow
    this.destroy();

    // Advance generation counter to invalidate any in-flight requests from previous views
    this.currentGeneration += 1;
    const generation = this.currentGeneration;
    this.isMounted = true;
    this.mountedWorkflowId = workflowId;
    this.workflowId = workflowId;
    this.workflow = null;
    this.activeTimers = new Set();

    container.innerHTML = `
      <div class="workflow-editor-layout">

        <!-- Modernized Robotic Editor Header -->
        <header class="workflow-editor-header" role="region" aria-label="Workflow Editor Header" style="background:rgba(13,19,36,0.85); border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="display:flex; align-items:center; gap:1rem; flex:1; min-width:0;">
            <button class="btn btn-secondary btn-sm" id="btnBack" title="Back to Workflow Library" aria-label="Back to Workflow Library">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back</span>
            </button>

            <!-- Robot Assistant Indicator -->
            <div style="flex-shrink:0;">
              ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
            </div>

            <!-- Editable Workflow Name -->
            <div class="wf-header-title-wrap" style="display:flex; flex-direction:column; gap:2px; min-width:180px; max-width:320px; flex:1;">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <label for="wfNameInput" style="font-size:0.65rem; font-weight:700; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:0.04em;">AGENT WORKFLOW</label>
                <span class="badge-tag success" style="font-size:0.6rem; padding:0.1rem 0.35rem;">● READY</span>
              </div>
              <input
                type="text"
                id="wfNameInput"
                class="wf-title-input"
                value="Loading Workflow…"
                placeholder="Workflow Name"
                aria-label="Workflow Name"
                spellcheck="false"
                style="color:var(--text-primary); font-weight:700;"
              />
            </div>
          </div>

          <!-- Target URL and Primary Actions -->
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">

            <!-- Visible Target Website -->
            <div class="wf-header-target-box" style="display:flex; flex-direction:column; gap:2px;">
              <label for="wfTargetUrlInput" style="font-size:0.65rem; font-weight:700; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.04em;">Target Website</label>
              <div style="display:flex; align-items:center; gap:0.35rem; background:rgba(6,9,19,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:var(--radius-md); padding:0.25rem 0.6rem;">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--accent-cyan); flex-shrink:0;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                </svg>
                <input
                  type="text"
                  id="wfTargetUrlInput"
                  placeholder="https://example.com"
                  aria-label="Target Website URL"
                  style="border:none; background:transparent; font-size:0.78rem; font-family:var(--font-mono); color:var(--text-primary); width:200px; outline:none;"
                  spellcheck="false"
                />
              </div>
            </div>

            <span id="wfStepCounter" class="badge-tag info" style="margin-top:auto; height:32px; display:inline-flex; align-items:center;">0 Steps</span>

            <button class="btn btn-secondary btn-sm" id="btnSaveFlow" style="margin-top:auto;" title="Save changes to this workflow (Ctrl+S)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>Save</span>
            </button>

            <button class="btn btn-primary btn-sm" id="btnExecuteFlowEditor" style="margin-top:auto; font-weight:700; letter-spacing:0.04em;" title="Run this workflow (Ctrl+Enter)">
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>RUN AGENT</span>
            </button>
          </div>
        </header>

        <!-- Split Layout: Step Sequence List + Visual Drawflow Canvas -->
        <div class="wf-editor-container">
          <!-- Step Sequence Sidebar -->
          <aside class="wf-steps-sidebar" id="wfStepsSidebar">
            <div class="wf-steps-header">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-sub);">Step Sequence</span>
                <span class="badge-tag info" id="wfSequenceCountBadge" style="font-size:0.65rem;">0 steps</span>
              </div>
              <button type="button" class="btn btn-ghost btn-xs" id="btnToggleStepsSidebar" title="Toggle steps sidebar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
            </div>
            <div class="wf-steps-scroll" id="wfSequenceScrollList">
              <div style="padding:1.5rem 1rem; text-align:center; color:var(--text-muted); font-size:var(--text-xs);">
                Loading steps sequence…
              </div>
            </div>
          </aside>

          <!-- Drawflow Visual Canvas -->
          <div class="workflow-editor-canvas" id="drawflow" style="flex:1; height:100%; position:relative;">
            <div class="drawflow-canvas-controls" role="toolbar" aria-label="Canvas zoom and view controls">
              <button type="button" id="btnZoomIn" title="Zoom in" aria-label="Zoom in">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button type="button" id="btnZoomOut" title="Zoom out" aria-label="Zoom out">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button type="button" id="btnZoomReset" title="Reset view zoom" aria-label="Reset view zoom">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
              </button>
              <button type="button" id="btnCanvasShortcutsHelp" title="Shortcuts: Space+Drag to Pan · Del to Delete · Ctrl+S to Save · Ctrl+Enter to Run · Esc to Deselect" aria-label="View keyboard shortcuts">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><line x1="6" y1="8" x2="6.01" y2="8"></line><line x1="10" y1="8" x2="10.01" y2="8"></line><line x1="14" y1="8" x2="14.01" y2="8"></line><line x1="18" y1="8" x2="18.01" y2="8"></line><line x1="8" y1="12" x2="8.01" y2="12"></line><line x1="12" y1="12" x2="12.01" y2="12"></line><line x1="16" y1="12" x2="16.01" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>
              </button>
            </div>
          </div>
        </div>

      </div>
    `;

    // Toggle steps sidebar
    document.getElementById('btnToggleStepsSidebar')?.addEventListener('click', () => {
      const sidebar = document.getElementById('wfStepsSidebar');
      if (sidebar) sidebar.classList.toggle('collapsed');
    });

    document.getElementById('btnBack')?.addEventListener('click', () => {
      this.hideConnectionMenu();
      Router.navigate('workflows');
    });

    document.getElementById('btnSaveFlow')?.addEventListener('click', () => {
      this.saveWorkflow();
    });

    document.getElementById('btnExecuteFlowEditor')?.addEventListener('click', () => {
      if (!this.isMounted || !this.mountedWorkflowId) return;
      const targetWfId = this.mountedWorkflowId;
      const steps = this.workflow?.steps || (this.workflow?.recordingData && this.workflow.recordingData.actions) || [];
      ExecutionModal.open({
        workflowId: targetWfId,
        workflowName: this.workflow?.name || 'Workflow',
        stepCount: steps.length,
        loopStepIndex: this.workflow?.loopStepIndex,
        isLoop: this.workflow?.isLoop || this.workflow?.mode === 'LOOP'
      });
    });

    // Update in-memory workflow name as user types in header input
    const nameInput = document.getElementById('wfNameInput');
    if (nameInput) {
      nameInput.addEventListener('input', (e) => {
        if (this.workflow) {
          this.workflow.name = e.target.value;
        }
      });
    }

    try {
      const data = await Api.getWorkflowById(workflowId);

      // Guard: Ignore response if unmounted or if another workflow was mounted in the meantime
      if (!this.isMounted || this.currentGeneration !== generation || this.mountedWorkflowId !== workflowId) {
        return;
      }

      this.workflow = data.workflow || data;
      const wfName = this.workflow.name || 'Workflow';

      if (nameInput) {
        nameInput.value = wfName;
      }

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
      if (!this.isMounted || this.currentGeneration !== generation || this.mountedWorkflowId !== workflowId) {
        return;
      }
      console.error(err);
      Toast.error('Failed to load workflow: ' + (err.message || 'Unknown error'));
    }
  },

  initDrawflow() {
    const container = document.getElementById('drawflow');
    if (!container) return;

    // Ensure parent-drawflow is the primary class so Drawflow internal switch matches
    container.className = 'parent-drawflow workflow-editor-canvas';

    this.editor = new Drawflow(container);
    this.editor.start();
    this.editor.clearModuleSelected();

    // Universal Pan / Drag handler across the entire canvas viewport
    container.addEventListener('mousedown', (e) => {
      if (
        e.target.closest('.drawflow-node') ||
        e.target.closest('.drawflow-canvas-controls') ||
        e.target.closest('button') ||
        e.target.closest('input') ||
        e.target.closest('select') ||
        e.target.closest('details') ||
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

    // Zoom controls
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
    document.getElementById('btnCanvasShortcutsHelp')?.addEventListener('click', (e) => {
      e.stopPropagation();
      Toast.info('Shortcuts: Space+Drag to Pan · Del to Delete · Ctrl+S to Save · Ctrl+Enter to Run · Esc to Deselect');
    });

    this.initDeleteModal();
    this.initConnectionInteractions(container);

    // Refresh visual step numbers when links change
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

  initConnectionInteractions(container) {
    this.selectedConnectionInfo = null;

    container.addEventListener('click', (e) => {
      // 1. Native Drawflow delete button
      if (e.target.closest('.drawflow-delete')) {
        e.stopPropagation();
        this.hideConnectionMenu();
        if (this.selectedConnectionInfo) {
          this.deleteSingleConnection(this.selectedConnectionInfo);
        } else if (this.editor.connection_selected) {
          this.editor.removeConnection();
          this.refreshStepNumbers();
          Toast.info('Link removed.');
        }
        return;
      }

      // 2. Floating menu delete button
      if (e.target.closest('.df-btn-del-conn')) {
        e.stopPropagation();
        if (this.selectedConnectionInfo) {
          this.deleteSingleConnection(this.selectedConnectionInfo);
        }
        return;
      }

      // 3. Connection path click
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

      // 4. Click elsewhere
      if (!e.target.closest('.df-conn-menu')) {
        this.hideConnectionMenu();
        this.selectedConnectionInfo = null;
      }
    });

    this.editor.on('connectionSelected', (info) => {
      this.selectedConnectionInfo = {
        id_output: String(info.output_id),
        id_input: String(info.input_id),
        output_class: info.output_class,
        input_class: info.input_class
      };
    });

    this.editor.on('nodeSelected', (nodeId) => {
      this.selectedNodeId = String(nodeId);
    });
    this.editor.on('nodeUnselected', () => {
      this.selectedNodeId = null;
    });

    // Space-drag Canvas Panning
    this.isSpaceDown = false;
    this.isSpacePanning = false;

    this.onCanvasMouseDown = (e) => {
      if (this.isSpaceDown && e.button === 0) {
        this.isSpacePanning = true;
        this.spaceStartX = e.clientX;
        this.spaceStartY = e.clientY;
        container.classList.add('is-space-panning');
        e.preventDefault();
        e.stopPropagation();
      }
    };
    container.addEventListener('mousedown', this.onCanvasMouseDown, true);

    this.onWindowMouseMove = (e) => {
      if (this.isSpacePanning && this.editor) {
        const dx = e.clientX - this.spaceStartX;
        const dy = e.clientY - this.spaceStartY;
        this.spaceStartX = e.clientX;
        this.spaceStartY = e.clientY;
        this.editor.canvas_x += dx;
        this.editor.canvas_y += dy;
        if (this.editor.precanvas) {
          this.editor.precanvas.style.transform = `translate(${this.editor.canvas_x}px, ${this.editor.canvas_y}px) scale(${this.editor.zoom})`;
        }
      }
    };
    window.addEventListener('mousemove', this.onWindowMouseMove);

    this.onWindowMouseUp = () => {
      if (this.isSpacePanning) {
        this.isSpacePanning = false;
        container.classList.remove('is-space-panning');
      }
    };
    window.addEventListener('mouseup', this.onWindowMouseUp);

    // Keyboard Accelerators: Delete, Backspace, Space, Ctrl+S, Ctrl+Enter, Esc, Enter
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    if (this.keyUpHandler) {
      window.removeEventListener('keyup', this.keyUpHandler);
    }

    this.keyHandler = (e) => {
      const activeTag = document.activeElement?.tagName;
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) || document.activeElement?.isContentEditable;

      // Escape handles modals, menus, and selection
      if (e.key === 'Escape') {
        const deleteModal = document.getElementById('deleteNodeModal');
        if (deleteModal && !deleteModal.classList.contains('hidden')) {
          e.preventDefault();
          this.hideDeleteModal();
          return;
        }
        if (this.selectedConnectionInfo || document.getElementById('dfActiveConnMenu')) {
          e.preventDefault();
          this.hideConnectionMenu();
          this.selectedConnectionInfo = null;
          return;
        }
        if (this.editor?.node_selected) {
          this.editor.node_selected.classList.remove('selected');
          this.editor.node_selected = null;
          this.selectedNodeId = null;
          return;
        }
        return;
      }

      // Enter key confirms delete modal if visible
      if (e.key === 'Enter') {
        const deleteModal = document.getElementById('deleteNodeModal');
        if (deleteModal && !deleteModal.classList.contains('hidden') && this.pendingDeleteNodeId) {
          e.preventDefault();
          this.executeDeleteNode();
          return;
        }
      }

      // Ctrl+S / Cmd+S: Save active workflow
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.saveWorkflow();
        return;
      }

      // Ctrl+Enter / Cmd+Enter: Run active workflow
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btnExecuteFlowEditor')?.click();
        return;
      }

      // Ignore remaining canvas shortcuts when inside input fields
      if (isInputFocused) return;

      // Space key down: trigger canvas pan mode
      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true;
        container.classList.add('is-space-down');
        e.preventDefault();
        return;
      }

      // Delete or Backspace key: deletes selected connection or node
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedConnectionInfo) {
          e.preventDefault();
          this.deleteSingleConnection(this.selectedConnectionInfo);
        } else if (this.selectedNodeId || this.editor?.node_selected) {
          e.preventDefault();
          const targetNode = this.editor?.node_selected;
          const nid = this.selectedNodeId || targetNode?.id?.replace(/^node-/, '');
          if (nid) {
            const nodeData = this.editor?.drawflow?.drawflow?.Home?.data?.[nid];
            const stepName = nodeData?.data?.action || targetNode?.querySelector('.df-node-title')?.textContent || `Step #${nid}`;
            this.promptDeleteNode(nid, stepName);
          }
        }
      }
    };

    this.keyUpHandler = (e) => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        this.isSpacePanning = false;
        container.classList.remove('is-space-down', 'is-space-panning');
      }
    };

    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyUpHandler);
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
      <button type="button" class="df-btn-del-conn" title="Remove this connection">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Remove Link</span>
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
      Toast.info('Link removed. You can relink steps by dragging between ports.');
    } catch (err) {
      console.warn('Could not remove connection via removeSingleConnection:', err);
      try {
        this.editor.removeConnection();
        this.selectedConnectionInfo = null;
        this.hideConnectionMenu();
        this.refreshStepNumbers();
        Toast.info('Link removed.');
      } catch (e2) {
        Toast.error('Failed to remove link');
      }
    }
  },

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
      // Focus cancel button for safe keyboard accessibility
      requestAnimationFrame(() => {
        document.getElementById('btnCancelDeleteStep')?.focus();
      });
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

      this.editor.removeNodeId(`node-${nodeId}`);
      this.hideConnectionMenu();
      this.selectedConnectionInfo = null;
      this.refreshStepNumbers();

      Toast.info('Step removed. Connect remaining steps by dragging from an output port to an input port.');
    } catch (err) {
      Toast.error('Failed to remove step: ' + err.message);
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

    // Identify first loop index
    let activeLoopIndex = null;
    if (Number.isInteger(this.workflow.loopStepIndex) && this.workflow.loopStepIndex >= 0) {
      activeLoopIndex = this.workflow.loopStepIndex;
    } else {
      const foundIdx = steps.findIndex(s => s.role === 'LOOP' || s.isLoop || s.loopMode === 'sequential_iteration');
      if (foundIdx >= 0) activeLoopIndex = foundIdx;
    }

    steps.forEach((step, index) => {
      const rawAction = (step.action || step.type || 'CLICK').toUpperCase();
      const friendlyName = this.getFriendlyStepName(step, index);
      const actionDesc = this.describeAction(step, friendlyName);

      // Determine step role (SETUP vs LOOP)
      let isLoopStep = false;
      if (step.role) {
        isLoopStep = step.role === 'LOOP';
      } else if (activeLoopIndex !== null) {
        isLoopStep = index >= activeLoopIndex;
      }

      const isLoopAnchor = isLoopStep && (index === activeLoopIndex);

      // Map action type to clean, user-friendly label
      const actionLabel = this.getUserActionLabel(step, rawAction, friendlyName);
      const actionClass = rawAction.toLowerCase();
      const actionIcon = this.getActionIcon(actionLabel);

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

      // Parse list / dropdown options from fingerprint or meta
      const availableOptions = this.extractAvailableOptions(step);
      const isListOrSelect = rawAction === 'SELECT' || availableOptions.length > 0 || /select|dropdown|list|option|:nth-child/i.test(targetSelector);

      // Human-readable title: avoid raw selector as title
      const humanNodeTitle = this.getHumanNodeTitle(step, actionLabel, friendlyName);

      // Step Node HTML setup
      let html = `
        <div class="df-node-header">
          <div class="df-action-badge ${actionClass}">
            <span style="display:inline-flex; align-items:center;">${actionIcon}</span>
            <span>${this.escapeHtml(actionLabel)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.35rem;">
            <span class="df-role-badge ${isLoopAnchor ? 'role-anchor' : (isLoopStep ? 'role-loop' : 'role-setup')}" id="badge-role-${index}" title="${isLoopAnchor ? 'Loop discovery anchor · Repeats for each record' : (isLoopStep ? 'Repeats for each record' : 'Runs once during setup')}">
              ${isLoopAnchor ? '🔁 Finds records here' : (isLoopStep ? '🔁 Repeats' : '⚙️ Run once')}
            </span>
            <span class="df-step-number">#${index + 1}</span>
            <button type="button" class="df-btn-delete-node" title="Delete step" aria-label="Delete step #${index + 1}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Human-Readable Hero Header (Never raw selector) -->
        <div class="df-node-hero">
          <span class="df-node-title" id="node-title-${index}">${this.escapeHtml(humanNodeTitle)}</span>
          <span class="df-node-desc" id="node-desc-${index}">${this.escapeHtml(actionDesc)}</span>
        </div>

        <div class="df-node-body">

          <!-- Element / Step Friendly Name -->
          <div class="df-input-group">
            <label style="display:flex; justify-content:space-between; align-items:center;">
              <span>Step Description</span>
              <span style="font-size:0.62rem; color:var(--text-sub); font-weight:normal;">User-facing</span>
            </label>
            <input type="text" class="df-name-input" value="${this.escapeHtml(friendlyName)}" placeholder="e.g. Invoice Button" spellcheck="false" />
          </div>

          <!-- Execution Role: Clearly distinguish 'Run once' from 'Repeats for each record' -->
          <div class="df-input-group df-role-group ${isLoopAnchor ? 'is-anchor' : (isLoopStep ? 'is-loop' : 'is-setup')}">
            <label style="font-weight:700; font-size:0.7rem; display:flex; justify-content:space-between; align-items:center;">
              <span>Execution Role</span>
              <span class="df-role-helper">${isLoopAnchor ? 'Finds records here' : (isLoopStep ? 'Repeats for each record' : 'Runs once')}</span>
            </label>
            <select class="df-role-select">
              <option value="SETUP" ${!isLoopStep ? 'selected' : ''}>⚙️ Run once (setup step)</option>
              <option value="LOOP" ${isLoopStep ? 'selected' : ''}>🔁 Repeats for each record</option>
            </select>
          </div>
      `;

      // Select / Dropdown options
      if (isListOrSelect && availableOptions.length > 0) {
        html += `
          <div class="df-input-group" style="background:var(--bg-surface-sunken); padding:0.6rem; border-radius:var(--radius-md); border:1px solid var(--border-light);">
            <label style="display:flex; justify-content:space-between; align-items:center;">
              <span>Available Options</span>
              <span style="font-size:0.65rem; color:var(--text-sub);">${availableOptions.length} Items</span>
            </label>
            <select class="df-option-select" style="background:var(--bg-surface); font-weight:600;">
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
                Repeats for each record (Iterate sequentially)
              </option>
            </select>
            <small style="font-size:0.65rem; color:var(--text-sub); margin-top:2px;">Select fixed choice or choose to repeat for each record.</small>
          </div>
        `;
      }

      // Value input for Type, Navigate, Key Press
      if (rawAction === 'TYPE' || rawAction === 'NAVIGATE' || rawAction === 'SELECT' || rawAction === 'KEY_PRESS' || rawAction === 'PRESS_KEY' || stepValue || step.key) {
        const valLabel = (rawAction === 'KEY_PRESS' || rawAction === 'PRESS_KEY') ? 'Key to press' : (rawAction === 'NAVIGATE' ? 'Target website URL' : 'Value to enter');
        const displayVal = step.key || stepValue || selectedOptionText || (rawAction === 'KEY_PRESS' ? 'Enter' : '');
        html += `
          <div class="df-input-group">
            <label>${valLabel}</label>
            <input type="text" class="df-value-input" value="${this.escapeHtml(displayVal)}" placeholder="Enter value..." spellcheck="false" />
          </div>
        `;
      }

      // Checkbox Target State: Idempotent action explanation
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
          <div class="df-input-group df-checkbox-group" style="background:var(--accent-subtle); padding:0.6rem; border-radius:var(--radius-md); border:1px solid rgba(37,99,235,0.2);">
            <label style="color:var(--accent-primary); font-weight:700; font-size:0.75rem; display:flex; justify-content:space-between; align-items:center;">
              <span>Checkbox Target State</span>
              <span class="badge-tag info" style="font-size:0.62rem;" title="This action can safely be repeated if the run is retried.">Safe to retry</span>
            </label>
            <select class="df-checkbox-select" style="font-size:0.75rem; font-weight:600; background:var(--bg-surface); color:var(--text-primary); width:100%; border-radius:var(--radius-sm); padding:0.35rem 0.5rem; margin-top:4px;">
              <option value="true" ${desiredCheckboxState !== false ? 'selected' : ''}>Ensure checked (ON)</option>
              <option value="false" ${desiredCheckboxState === false ? 'selected' : ''}>Ensure unchecked (OFF)</option>
            </select>
            <small style="font-size:0.66rem; color:var(--text-sub); display:block; margin-top:3px;">Safe to retry: this action can safely be repeated if the run is retried.</small>
          </div>
        `;
      }

      // Progressive disclosure: Technical details hidden under Advanced
      html += `
          <details class="df-advanced-details">
            <summary class="df-advanced-summary">
              <span>Advanced · Element location</span>
              <svg class="df-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </summary>
            <div class="df-advanced-body">
              <div class="df-input-group">
                <label style="font-size:0.68rem; color:var(--text-sub); font-weight:600;">Element location</label>
                <input type="text" class="df-target-input" value="${this.escapeHtml(targetSelector)}" placeholder="#element-id or .class or //xpath" spellcheck="false" />
                <span style="font-size:0.65rem; color:var(--text-muted); display:block; margin-top:2px;">Browser locator path (CSS or XPath)</span>
              </div>
              ${candidates.length > 1 ? `
                <div style="margin-top:0.45rem;">
                  <span style="font-size:0.66rem; font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.25rem;">Candidate locators (${candidates.length})</span>
                  <div style="display:flex; flex-direction:column; gap:0.25rem; max-height:80px; overflow-y:auto;">
                    ${candidates.slice(0, 4).map(c => `
                      <div style="font-size:0.67rem; font-family:var(--font-mono); background:var(--bg-surface-sunken); padding:2px 6px; border-radius:4px; border:1px solid var(--border-light); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${this.escapeHtml(c.value)}">
                        [${this.escapeHtml(c.strategy)}] ${this.escapeHtml(c.value)}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          </details>

          <!-- Node Footer with Accessible Delete Action -->
          <div class="df-node-footer">
            <button type="button" class="df-btn-delete-text" title="Delete this step from workflow" aria-label="Delete step #${index + 1}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Delete Step</span>
            </button>
          </div>
        </div>
      `;

      const nodeCls = isLoopAnchor ? 'step-node is-loop-anchor' : (isLoopStep ? 'step-node is-loop-node' : 'step-node');

      const nodeId = this.editor.addNode(
        'step',
        1,
        1,
        pos_x,
        pos_y,
        nodeCls,
        { action: rawAction, originalStep: step },
        html
      );

      if (previousNodeId) {
        this.editor.addConnection(previousNodeId, nodeId, "output_1", "input_1");
      }

      // Wire interactive events
      this.setSafeTimeout(() => {
        const nodeEl = document.getElementById(`node-${nodeId}`);
        if (nodeEl) {
          const nameInput = nodeEl.querySelector('.df-name-input');
          const valueInput = nodeEl.querySelector('.df-value-input');
          const titleEl = document.getElementById(`node-title-${index}`);
          const descEl = document.getElementById(`node-desc-${index}`);
          const optionSelect = nodeEl.querySelector('.df-option-select');

          if (nameInput) {
            nameInput.addEventListener('input', (e) => {
              const newName = e.target.value.trim() || `Step #${index + 1}`;
              const newHumanTitle = this.getHumanNodeTitle(step, actionLabel, newName);
              if (titleEl) titleEl.textContent = newHumanTitle;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: rawAction,
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
                action: rawAction,
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
                Toast.info(`Step #${index + 1} will repeat for each record.`);
              } else {
                const selectedOpt = e.target.options[e.target.selectedIndex];
                const label = selectedOpt ? selectedOpt.getAttribute('data-label') : val;
                valueInput.value = val || label || '';
                Toast.success(`Selected option: ${label || val}`);
              }
              const currentName = nameInput ? nameInput.value.trim() : friendlyName;
              if (descEl) descEl.textContent = this.describeAction({
                ...step,
                action: rawAction,
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
                action: rawAction,
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
              const roleGroup = roleSelect.closest('.df-role-group');

              if (newRole === 'LOOP') {
                if (roleBadge) {
                  roleBadge.className = 'df-role-badge role-loop';
                  roleBadge.textContent = '🔁 Repeats';
                  roleBadge.title = 'Repeats for each record';
                }
                if (roleHelper) {
                  roleHelper.textContent = 'Repeats for each record';
                }
                if (roleGroup) {
                  roleGroup.className = 'df-input-group df-role-group is-loop';
                }
                nodeEl.classList.add('is-loop-node');
                Toast.info(`Step #${index + 1} set to repeat for each record`);
              } else {
                if (roleBadge) {
                  roleBadge.className = 'df-role-badge role-setup';
                  roleBadge.textContent = '⚙️ Run once';
                  roleBadge.title = 'Runs once during setup';
                }
                if (roleHelper) {
                  roleHelper.textContent = 'Runs once';
                }
                if (roleGroup) {
                  roleGroup.className = 'df-input-group df-role-group is-setup';
                }
                nodeEl.classList.remove('is-loop-node', 'is-loop-anchor');
                Toast.info(`Step #${index + 1} set to run once (setup)`);
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

    this.renderSequenceList(steps);
  },

  renderSequenceList(steps) {
    const list = document.getElementById('wfSequenceScrollList');
    const badge = document.getElementById('wfSequenceCountBadge');
    if (badge) badge.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
    if (!list) return;

    if (!steps || steps.length === 0) {
      list.innerHTML = `
        <div style="padding:2rem 1rem; text-align:center; color:var(--text-muted); font-size:var(--text-xs);">
          No steps in this workflow yet.
        </div>
      `;
      return;
    }

    list.innerHTML = steps.map((step, idx) => {
      const rawAction = (step.action || step.type || 'CLICK').toUpperCase();
      const friendlyName = this.getFriendlyStepName(step, idx);
      const actionLabel = this.getUserActionLabel(step, rawAction, friendlyName);
      const actionIcon = this.getActionIcon(actionLabel);
      const targetStr = step.target?.selectors?.cssPath || step.target?.selector || (typeof step.target === 'string' ? step.target : (step.url || 'Target Element'));

      return `
        <div class="wf-step-seq-card" data-step-idx="${idx}" id="seq-step-${idx}">
          <div class="wf-step-seq-head">
            <span class="wf-step-num">${idx + 1}</span>
            <span class="step-seq-icon">${actionIcon}</span>
            <div class="wf-step-name">${this.escapeHtml(actionLabel)}: ${this.escapeHtml(friendlyName)}</div>
            <div class="wf-step-seq-actions">
              <button type="button" class="btn-icon btn-seq-up" data-idx="${idx}" title="Move step up" ${idx === 0 ? 'disabled' : ''} style="width:22px; height:22px;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
              </button>
              <button type="button" class="btn-icon btn-seq-down" data-idx="${idx}" title="Move step down" ${idx === steps.length - 1 ? 'disabled' : ''} style="width:22px; height:22px;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button type="button" class="btn-icon btn-seq-del" data-idx="${idx}" title="Delete step" style="width:22px; height:22px; color:var(--color-danger);">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
          <div class="wf-step-target-text">${this.escapeHtml(targetStr)}</div>

          <details style="margin-top:0.45rem; padding-top:0.35rem; border-top:1px dashed var(--border-light); font-size:var(--text-2xs);">
            <summary style="cursor:pointer; color:var(--accent-primary); font-weight:600; outline:none;">
              View Details
            </summary>
            <div style="margin-top:0.4rem; display:flex; flex-direction:column; gap:0.3rem; color:var(--text-sub);">
              <div><span>Target:</span> <code class="mono" style="font-size:0.65rem; word-break:break-all;">${this.escapeHtml(targetStr)}</code></div>
              ${step.value ? `<div><span>Input Value:</span> <strong style="color:var(--text-primary);">${this.escapeHtml(step.value)}</strong></div>` : ''}
              <div><span>Execution:</span> <span class="badge-tag info" style="font-size:0.6rem;">${step.role || 'SETUP'}</span></div>
            </div>
          </details>
        </div>
      `;
    }).join('');

    // Bind card selection to canvas node
    list.querySelectorAll('.wf-step-seq-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('details') || e.target.closest('summary')) return;
        const idx = Number(card.getAttribute('data-step-idx'));
        list.querySelectorAll('.wf-step-seq-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        const nodeEls = document.querySelectorAll('.drawflow-node');
        if (nodeEls[idx]) {
          nodeEls.forEach(n => n.classList.remove('selected'));
          nodeEls[idx].classList.add('selected');
          nodeEls[idx].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      };
    });

    // Bind Reorder Up
    list.querySelectorAll('.btn-seq-up').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        if (idx > 0) {
          const temp = steps[idx];
          steps[idx] = steps[idx - 1];
          steps[idx - 1] = temp;
          this.workflow.steps = steps;
          this.rebuildCanvasFromSteps();
        }
      };
    });

    // Bind Reorder Down
    list.querySelectorAll('.btn-seq-down').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        if (idx < steps.length - 1) {
          const temp = steps[idx];
          steps[idx] = steps[idx + 1];
          steps[idx + 1] = temp;
          this.workflow.steps = steps;
          this.rebuildCanvasFromSteps();
        }
      };
    });

    // Bind Delete
    list.querySelectorAll('.btn-seq-del').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        if (confirm(`Remove step #${idx + 1} from workflow?`)) {
          steps.splice(idx, 1);
          this.workflow.steps = steps;
          this.rebuildCanvasFromSteps();
        }
      };
    });
  },

  rebuildCanvasFromSteps() {
    if (!this.editor) return;
    this.editor.clearModuleSelected();
    this.renderWorkflowSteps();
    const badge = document.getElementById('wfStepCounter');
    const steps = this.workflow.steps || [];
    if (badge) badge.textContent = `${steps.length} Steps`;
    Toast.info('Workflow steps updated');
  },

  getUserActionLabel(step, rawAction, friendlyName) {
    const isDownload = /download|export|save.*disk/i.test(friendlyName) ||
                       /download|export/i.test(step.target?.elementName || '') ||
                       /download|export/i.test(step.name || '');

    if (rawAction === 'CLICK' && isDownload) return 'Download';
    if (rawAction === 'CLICK') return 'Click';
    if (rawAction === 'TYPE') return 'Type';
    if (rawAction === 'SELECT') return 'Select';
    if (rawAction === 'NAVIGATE') return 'Navigate';
    if (rawAction === 'KEY_PRESS' || rawAction === 'PRESS_KEY' || rawAction === 'ENTER') return 'Press Key';
    if (rawAction === 'WAIT' || rawAction === 'SLEEP') return 'Wait';
    return rawAction.charAt(0) + rawAction.slice(1).toLowerCase();
  },

  getActionIcon(actionLabel) {
    if (actionLabel === 'Click') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`;
    }
    if (actionLabel === 'Type') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="6" y1="8" x2="6.01" y2="8"></line><line x1="10" y1="8" x2="10.01" y2="8"></line><line x1="14" y1="8" x2="14.01" y2="8"></line><line x1="18" y1="8" x2="18.01" y2="8"></line><line x1="8" y1="12" x2="8.01" y2="12"></line><line x1="12" y1="12" x2="12.01" y2="12"></line><line x1="16" y1="12" x2="16.01" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>`;
    }
    if (actionLabel === 'Navigate') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
    }
    if (actionLabel === 'Select') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;
    }
    if (actionLabel === 'Download') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    }
    if (actionLabel === 'Press Key') {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;
    }
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  },

  getHumanNodeTitle(step, actionLabel, friendlyName) {
    if (actionLabel === 'Navigate') {
      return 'Open website';
    }
    if (actionLabel === 'Download') {
      return 'Download document';
    }
    if (actionLabel === 'Type') {
      const cleanName = friendlyName.replace(/\b(Input|Field|Text|Box)\b/gi, '').trim();
      return cleanName ? `Enter ${cleanName}` : 'Enter text';
    }
    if (actionLabel === 'Select') {
      const cleanName = friendlyName.replace(/\b(Dropdown|Select|Menu)\b/gi, '').trim();
      return cleanName ? `Select ${cleanName}` : 'Select option';
    }
    if (actionLabel === 'Click') {
      const cleanName = friendlyName.replace(/\b(Button|Btn|Link)\b/gi, '').trim();
      return cleanName ? `Click ${cleanName}` : `Click ${friendlyName}`;
    }
    return `${actionLabel} ${friendlyName}`;
  },

  extractAvailableOptions(step) {
    const options = [];

    if (step.meta && Array.isArray(step.meta.options) && step.meta.options.length > 0) {
      return step.meta.options.map(opt => typeof opt === 'string' ? { value: opt, label: opt } : opt);
    }

    const fp = step.target && step.target.fingerprint;
    if (fp && fp.text && (fp.tagName === 'select' || step.type === 'SELECT' || (step.meta && step.meta.selectedIndex !== undefined))) {
      const raw = fp.text.trim();
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length > 1) {
        return lines.map(t => ({ value: t.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: t }));
      }
      const parts = raw.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        return parts.map(t => ({ value: t.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: t }));
      }
    }

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

    if (actionType === 'NAVIGATE') return 'Target Page';
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
      return val ? `Enter "${val}" into ${friendlyName}` : `Enter text into ${friendlyName}`;
    }
    if (actionType === 'SELECT') {
      return val ? `Select "${val}" in ${friendlyName}` : `Pick an option from ${friendlyName}`;
    }
    if (actionType === 'NAVIGATE') {
      const url = step.url || val || 'target website';
      return `Navigate to ${url}`;
    }
    if (actionType === 'KEY_PRESS' || actionType === 'PRESS_KEY' || actionType === 'ENTER') {
      return `Press key [${key || val || 'Enter'}]`;
    }
    return `Perform ${actionType.toLowerCase()} on ${friendlyName}`;
  },

  async saveWorkflow() {
    if (!this.isMounted || !this.mountedWorkflowId || !this.editor) return;
    if (this.isSaving) return;
    this.isSaving = true;

    const targetWorkflowId = this.mountedWorkflowId;
    const saveGeneration = this.currentGeneration;

    const btn = document.getElementById('btnSaveFlow');
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '<span>Saving…</span>';
      btn.disabled = true;
    }

    try {
      if (!this.editor || !this.isMounted || this.currentGeneration !== saveGeneration) return;

      const exported = this.editor.export();
      const data = exported.drawflow.Home.data;
      const nodes = Object.values(data);

      if (nodes.length === 0) {
        Toast.error("Workflow has no steps to save.");
        return;
      }

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

      // Any unvisited nodes
      const unvisitedNodes = nodes.filter(n => !visited.has(String(n.id)));
      if (unvisitedNodes.length > 0) {
        unvisitedNodes.sort((a, b) => (a.pos_x || 0) - (b.pos_x || 0));
        for (const node of unvisitedNodes) {
          visited.add(String(node.id));
          newSteps.push(extractStep(node, newSteps.length));
        }
      }

      const firstLoopIdx = newSteps.findIndex(s => s.role === 'LOOP' || (s.isLoop === true && s.role !== 'SETUP') || s.loopMode === 'sequential_iteration');
      const hasLoop = firstLoopIdx >= 0;
      const loopStepIndex = hasLoop ? firstLoopIdx : null;
      const wfMode = hasLoop ? 'LOOP' : 'STANDARD';

      const targetUrlInput = document.getElementById('wfTargetUrlInput');
      const updatedTargetUrl = targetUrlInput ? targetUrlInput.value.trim() : (this.workflow?.targetUrl || '');

      const nameInput = document.getElementById('wfNameInput');
      const updatedName = nameInput ? nameInput.value.trim() : (this.workflow?.name || '');

      await Api.updateWorkflow(targetWorkflowId, {
        name: updatedName || this.workflow?.name,
        steps: newSteps,
        loopStepIndex,
        isLoop: hasLoop,
        mode: wfMode,
        targetUrl: updatedTargetUrl
      });

      // Guard: Check if still mounted and on same generation/workflow
      if (!this.isMounted || this.currentGeneration !== saveGeneration || this.mountedWorkflowId !== targetWorkflowId) {
        return;
      }

      if (this.workflow) {
        if (updatedName) this.workflow.name = updatedName;
        this.workflow.steps = newSteps;
        this.workflow.loopStepIndex = loopStepIndex;
        this.workflow.isLoop = hasLoop;
        this.workflow.mode = wfMode;
        this.workflow.targetUrl = updatedTargetUrl;
      }

      Toast.success(`Workflow saved successfully (${newSteps.length} steps updated)!`);
      const badge = document.getElementById('wfStepCounter');
      if (badge) badge.textContent = `${newSteps.length} Steps`;
    } catch (err) {
      if (!this.isMounted || this.currentGeneration !== saveGeneration || this.mountedWorkflowId !== targetWorkflowId) {
        return;
      }
      console.error(err);
      Toast.error('Failed to save workflow: ' + (err.message || 'Unknown error'));
    } finally {
      if (this.isMounted && this.currentGeneration === saveGeneration) {
        this.isSaving = false;
        if (btn) {
          btn.innerHTML = origText;
          btn.disabled = false;
        }
      } else {
        this.isSaving = false;
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
    this.isMounted = false;
    this.currentGeneration += 1;
    this.mountedWorkflowId = null;
    this.workflowId = null;
    this.workflow = null;
    this.isSaving = false;

    this.clearAllTimers();
    this.hideConnectionMenu();
    this.hideDeleteModal();

    const deleteModal = document.getElementById('deleteNodeModal');
    const btnClose = document.getElementById('btnCloseDeleteModal');
    const btnCancel = document.getElementById('btnCancelDeleteStep');
    const btnConfirm = document.getElementById('btnConfirmDeleteStep');
    if (btnClose) btnClose.onclick = null;
    if (btnCancel) btnCancel.onclick = null;
    if (btnConfirm) btnConfirm.onclick = null;
    if (deleteModal) deleteModal.onclick = null;
    this.pendingDeleteNodeId = null;

    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.keyUpHandler) {
      window.removeEventListener('keyup', this.keyUpHandler);
      this.keyUpHandler = null;
    }
    if (this.onCanvasMouseDown) {
      const container = document.getElementById('drawflow');
      container?.removeEventListener('mousedown', this.onCanvasMouseDown, true);
      this.onCanvasMouseDown = null;
    }
    if (this.onWindowMouseMove) {
      window.removeEventListener('mousemove', this.onWindowMouseMove);
      this.onWindowMouseMove = null;
    }
    if (this.onWindowMouseUp) {
      window.removeEventListener('mouseup', this.onWindowMouseUp);
      this.onWindowMouseUp = null;
    }
    if (this.editor) {
      try {
        this.editor.clear();
      } catch {}
      this.editor = null;
    }
    this.selectedConnectionInfo = null;
    this.selectedNodeId = null;
  }
};
