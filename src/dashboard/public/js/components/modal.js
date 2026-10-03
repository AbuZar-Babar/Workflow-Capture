/**
 * Workflow Capture — Step Inspector Modal Component
 */

import { escapeHtml } from '../utils/dom.js';

export const Modal = {
  elModal: null,
  elTitle: null,
  elMeta: null,
  elTimeline: null,
  elBtnClose: null,
  previousActiveElement: null,
  escapeHandler: null,
  keydownHandler: null,

  init() {
    this.elModal = document.getElementById('stepInspectorModal');
    this.elTitle = document.getElementById('modalWorkflowTitle');
    this.elMeta = document.getElementById('modalMetaGrid');
    this.elTimeline = document.getElementById('modalStepsTimeline');
    this.elBtnClose = document.getElementById('btnCloseModal');

    if (this.elBtnClose) {
      this.elBtnClose.onclick = () => this.hide();
    }
    if (this.elModal) {
      this.elModal.onclick = (e) => {
        if (e.target === this.elModal) this.hide();
      };
    }
  },

  inspect(workflow) {
    if (!workflow || !this.elModal) return;

    if (this.elTitle) {
      this.elTitle.textContent = `${workflow.name || 'Workflow'} (${workflow.filename || workflow.id || 'captured'})`;
    }

    if (this.elMeta) {
      this.elMeta.innerHTML = `
        <div><span style="font-size:var(--text-2xs); color:var(--text-sub); display:block;">Total Actions</span><strong style="font-size:1.1rem; color:var(--brand-forest);">${workflow.actionCount || (workflow.actions ? workflow.actions.length : 0)}</strong></div>
        <div><span style="font-size:var(--text-2xs); color:var(--text-sub); display:block;">Start URL</span><strong style="font-size:0.75rem; word-break:break-all;">${escapeHtml(workflow.startUrl || 'N/A')}</strong></div>
        <div><span style="font-size:var(--text-2xs); color:var(--text-sub); display:block;">Captured Date</span><strong style="font-size:0.75rem;">${workflow.startedAt ? new Date(workflow.startedAt).toLocaleString() : 'N/A'}</strong></div>
      `;
    }

    if (this.elTimeline) {
      this.elTimeline.innerHTML = '';
      (workflow.actions || []).forEach(act => {
        const stepRow = document.createElement('div');
        stepRow.className = 'card';
        stepRow.style.padding = '0.85rem';
        stepRow.style.gap = '0.5rem';
        stepRow.style.backgroundColor = 'var(--card-bg)';
        stepRow.style.borderColor = 'var(--border-light)';

        const fp = (act.target && act.target.fingerprint) ? act.target.fingerprint : {};

        let candidatesHtml = '';
        if (act.target && act.target.candidates) {
          candidatesHtml = act.target.candidates.map(c => `
            <div style="display:flex; align-items:center; gap:0.5rem; background:var(--input-bg); padding:0.35rem 0.5rem; border-radius:6px; border:1px solid var(--border-light); font-family:var(--font-mono); font-size:0.72rem; flex-wrap:wrap;">
              <span style="color:var(--brand-forest); font-weight:800;">[${c.strategy}]</span>
              <code style="color:var(--text-main);">${escapeHtml(c.value)}</code>
              <span style="color:var(--text-sub);">(priority: ${c.priority}, count: ${c.uniqueness})</span>
            </div>
          `).join('');
        }

        stepRow.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <strong style="font-size:0.85rem; color:var(--text-main);">#${(act.index !== undefined ? act.index : 0) + 1}</strong>
              <span class="badge-tag success">${escapeHtml(act.type || act.action || 'ACTION')}</span>
            </div>
            ${act.value !== undefined ? `<span style="font-size:0.72rem; color:var(--text-sub); font-family:var(--font-mono);">Value: "<strong>${escapeHtml(act.value)}</strong>"</span>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:0.35rem; margin-top:0.25rem;">
            <span style="font-size:var(--text-2xs); color:var(--text-sub); font-weight:700;">Element location selectors:</span>
            ${candidatesHtml || '<span style="font-size:0.72rem; color:var(--text-sub);">(No candidates recorded)</span>'}
          </div>
          <div style="font-size:var(--text-2xs); color:var(--text-sub); margin-top:0.25rem; font-family:var(--font-mono); background:var(--input-bg); padding:0.35rem 0.5rem; border-radius:6px; border:1px solid var(--border-light);">
            Tag: <code>&lt;${escapeHtml(fp.tagName || 'elem')}&gt;</code> | Text: <em>"${escapeHtml(fp.innerText || '')}"</em> | Classes: <code>${escapeHtml((fp.classList || []).join(', ') || 'none')}</code>
          </div>
        `;

        this.elTimeline.appendChild(stepRow);
      });
    }

    this.show();
  },

  getFocusableElements() {
    if (!this.elModal) return [];
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(this.elModal.querySelectorAll(selector)).filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  },

  show() {
    if (!this.elModal) return;
    this.previousActiveElement = document.activeElement;
    this.elModal.classList.remove('hidden');

    // Accessibility: Keydown handler for Escape and Tab focus trap
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = (e) => {
      if (!this.elModal || this.elModal.classList.contains('hidden')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !this.elModal.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !this.elModal.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    this.escapeHandler = this.keydownHandler;
    window.addEventListener('keydown', this.keydownHandler);

    // Accessibility: focus first actionable element (close button or first focusable)
    requestAnimationFrame(() => {
      const focusable = this.getFocusableElements();
      if (focusable.length > 0) {
        if (this.elBtnClose && focusable.includes(this.elBtnClose)) {
          this.elBtnClose.focus();
        } else {
          focusable[0].focus();
        }
      }
    });
  },

  hide() {
    if (!this.elModal) return;
    this.elModal.classList.add('hidden');

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
      this.escapeHandler = null;
    }

    // Accessibility: Return focus to triggering element
    if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
      try {
        this.previousActiveElement.focus();
      } catch {}
      this.previousActiveElement = null;
    }
  },

  confirm({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false
  } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '9999';

      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width:440px;">
          <div class="modal-header">
            <h3 style="margin:0; font-size:1rem; display:flex; align-items:center; gap:0.5rem;">
              ${danger ? `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              ` : `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              `}
              <span>${escapeHtml(title)}</span>
            </h3>
            <button class="btn btn-ghost btn-xs btn-close-confirm" aria-label="Close dialog">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="modal-body" style="padding:1.25rem 1.5rem; font-size:0.875rem; color:var(--text-sub); line-height:1.5;">
            ${escapeHtml(message)}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm btn-cancel-confirm">${escapeHtml(cancelText)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm btn-ok-confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const btnOk = overlay.querySelector('.btn-ok-confirm');
      const btnCancel = overlay.querySelector('.btn-cancel-confirm');
      const btnClose = overlay.querySelector('.btn-close-confirm');

      let resolved = false;
      const cleanup = (result) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(result);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(true);
        }
      };

      window.addEventListener('keydown', onKeyDown);
      btnOk.onclick = () => cleanup(true);
      btnCancel.onclick = () => cleanup(false);
      btnClose.onclick = () => cleanup(false);
      overlay.onclick = (e) => {
        if (e.target === overlay) cleanup(false);
      };

      requestAnimationFrame(() => {
        if (danger) {
          btnCancel.focus();
        } else {
          btnOk.focus();
        }
      });
    });
  },

  prompt({
    title = 'Input Required',
    message = '',
    defaultValue = '',
    placeholder = '',
    confirmText = 'Save',
    cancelText = 'Cancel'
  } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.zIndex = '9999';

      overlay.innerHTML = `
        <div class="modal-dialog" style="max-width:440px;">
          <div class="modal-header">
            <h3 style="margin:0; font-size:1rem; display:flex; align-items:center; gap:0.5rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
              <span>${escapeHtml(title)}</span>
            </h3>
            <button class="btn btn-ghost btn-xs btn-close-prompt" aria-label="Close dialog">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="modal-body" style="padding:1.25rem 1.5rem;">
            ${message ? `<p style="margin:0 0 0.75rem 0; font-size:0.875rem; color:var(--text-sub);">${escapeHtml(message)}</p>` : ''}
            <input
              type="text"
              class="input prompt-modal-input"
              value="${escapeHtml(defaultValue)}"
              placeholder="${escapeHtml(placeholder)}"
              style="width:100%; box-sizing:border-box; font-size:0.875rem;"
            />
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm btn-cancel-prompt">${escapeHtml(cancelText)}</button>
            <button class="btn btn-primary btn-sm btn-ok-prompt">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = overlay.querySelector('.prompt-modal-input');
      const btnOk = overlay.querySelector('.btn-ok-prompt');
      const btnCancel = overlay.querySelector('.btn-cancel-prompt');
      const btnClose = overlay.querySelector('.btn-close-prompt');

      let resolved = false;
      const cleanup = (result) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(result);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(input.value);
        }
      };

      window.addEventListener('keydown', onKeyDown);
      btnOk.onclick = () => cleanup(input.value);
      btnCancel.onclick = () => cleanup(null);
      btnClose.onclick = () => cleanup(null);
      overlay.onclick = (e) => {
        if (e.target === overlay) cleanup(null);
      };

      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    });
  }
};

if (typeof window !== 'undefined') {
  window.Modal = Modal;
}
