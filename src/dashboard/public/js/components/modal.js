/**
 * Workflow Capture — Step Inspector Modal Component
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const Modal = {
  elModal: null,
  elTitle: null,
  elMeta: null,
  elTimeline: null,
  elBtnClose: null,

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
      this.elTitle.textContent = `${workflow.name} (${workflow.filename})`;
    }

    if (this.elMeta) {
      this.elMeta.innerHTML = `
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Total Actions</span><strong style="font-size:1.1rem; color:var(--brand-forest);">${workflow.actionCount}</strong></div>
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Start URL</span><strong style="font-size:0.75rem; word-break:break-all;">${escapeHtml(workflow.startUrl || 'N/A')}</strong></div>
        <div><span style="font-size:0.68rem; color:var(--text-sub); display:block;">Captured Date</span><strong style="font-size:0.75rem;">${new Date(workflow.startedAt).toLocaleString()}</strong></div>
      `;
    }

    if (this.elTimeline) {
      this.elTimeline.innerHTML = '';
      (workflow.actions || []).forEach(act => {
        const stepRow = document.createElement('div');
        stepRow.className = 'card';
        stepRow.style.padding = '0.85rem';
        stepRow.style.gap = '0.5rem';
        stepRow.style.backgroundColor = '#f9fafb';

        const fp = (act.target && act.target.fingerprint) ? act.target.fingerprint : {};

        let candidatesHtml = '';
        if (act.target && act.target.candidates) {
          candidatesHtml = act.target.candidates.map(c => `
            <div style="display:flex; align-items:center; gap:0.5rem; background:#ffffff; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid rgba(0,0,0,0.06); font-family:var(--font-mono); font-size:0.72rem; flex-wrap:wrap;">
              <span style="color:var(--brand-forest); font-weight:800;">[${c.strategy}]</span>
              <code>${escapeHtml(c.value)}</code>
              <span style="color:var(--text-sub);">(priority: ${c.priority}, count: ${c.uniqueness})</span>
            </div>
          `).join('');
        }

        stepRow.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <strong style="font-size:0.85rem; color:var(--text-main);">#${act.index + 1}</strong>
              <span class="badge-tag success">${act.type}</span>
            </div>
            ${act.value !== undefined ? `<span style="font-size:0.72rem; color:var(--text-sub); font-family:var(--font-mono);">Value: "<strong>${escapeHtml(act.value)}</strong>"</span>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:0.35rem; margin-top:0.25rem;">
            <span style="font-size:0.7rem; color:var(--text-sub); font-weight:700;">Candidate Selectors:</span>
            ${candidatesHtml}
          </div>
          <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.25rem; font-family:var(--font-mono); background:#ffffff; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid rgba(0,0,0,0.06);">
            Tag: <code>&lt;${fp.tagName || 'elem'}&gt;</code> | Text: <em>"${escapeHtml(fp.innerText || '')}"</em> | Classes: <code>${(fp.classList || []).join(', ') || 'none'}</code>
          </div>
        `;

        this.elTimeline.appendChild(stepRow);
      });
    }

    this.show();
  },

  show() {
    if (this.elModal) this.elModal.classList.remove('hidden');
  },

  hide() {
    if (this.elModal) this.elModal.classList.add('hidden');
  }
};
