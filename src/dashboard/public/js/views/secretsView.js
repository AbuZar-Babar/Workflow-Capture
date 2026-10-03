/**
 * Workflow Capture — Modernized Secrets View
 * Secure credential vault for credentials injected into workflows with {{secret:name}}.
 * Features:
 * - Secret name
 * - Connected status (● Connected)
 * - Masked value (••••••••••••)
 * - Actions: Copy placeholder, Delete with Confirmation dialog
 * - Zero plaintext leakage
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';
import { renderRobotAvatar } from '../components/robotAvatar.js';
import { escapeHtml } from '../utils/dom.js';

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

export const SecretsView = {
  secrets: [],
  searchQuery: '',
  container: null,

  async render(container, router) {
    this.container = container;

    container.innerHTML = `
      <div class="secrets-view-shell" style="max-width:1440px; margin:0 auto; padding-bottom:2rem;">

        <!-- Page Header -->
        <div class="wf-page-header">
          <div style="display:flex; align-items:center; gap:0.85rem;">
            <div>
              ${renderRobotAvatar({ size: 'badge', state: 'idle' })}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h1 class="wf-page-title" style="margin:0; font-size:1.35rem; font-weight:800; letter-spacing:-0.02em;">AGENT SECRETS VAULT</h1>
                <span class="badge-tag info" style="font-size:var(--text-2xs); font-weight:700;">ENCRYPTED TOKENS</span>
              </div>
              <p class="wf-page-subtitle" style="margin:0.2rem 0 0;">Store credentials securely. Reference them in workflow steps using {{secret:name}}.</p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <button class="btn btn-primary btn-sm" id="btnOpenAddSecretModal">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>+ Add Secret</span>
            </button>
          </div>
        </div>

        <!-- Add Secret Modal (Hidden by default) -->
        <div id="addSecretModal" class="card hidden" style="margin-bottom:1.5rem; padding:1.25rem 1.5rem; border-left:4px solid var(--accent-primary); background:var(--bg-surface);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent-primary);"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <h3 style="font-size:0.95rem; font-weight:700; color:var(--text-primary); margin:0;">Store New Secret</h3>
            </div>
            <button class="btn-icon" id="btnCloseAddSecretModal" title="Close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <form id="addSecretForm" style="display:grid; grid-template-columns: 1fr 1fr 1.2fr auto; gap:0.75rem; align-items:end;">
            <div class="form-group" style="margin:0;">
              <label style="font-size:var(--text-xs); font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.25rem;">Secret Name</label>
              <input type="text" id="secretName" class="form-control mono" required placeholder="e.g. portal_password" style="font-size:var(--text-xs);">
            </div>
            <div class="form-group" style="margin:0;">
              <label style="font-size:var(--text-xs); font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.25rem;">Domain Context (Optional)</label>
              <input type="text" id="secretDomain" class="form-control" placeholder="e.g. app.portal.com" style="font-size:var(--text-xs);">
            </div>
            <div class="form-group" style="margin:0;">
              <label style="font-size:var(--text-xs); font-weight:700; color:var(--text-sub); display:block; margin-bottom:0.25rem;">Secret Value (Encrypted)</label>
              <input type="password" id="secretValue" class="form-control" required placeholder="••••••••••••" autocomplete="new-password" style="font-size:var(--text-xs);">
            </div>
            <button type="submit" class="btn btn-primary" id="btnSubmitSecret" style="height:38px; white-space:nowrap;">
              Save Securely
            </button>
          </form>
        </div>

        <!-- Toolbar & Filter -->
        <div class="wf-toolbar" style="margin-bottom:1.25rem;">
          <div class="search-input-wrap" style="flex:1; max-width:320px;">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="secretSearchInput" class="search-input" placeholder="Search secrets by key or domain…" aria-label="Search secrets">
          </div>
          <div style="font-size:var(--text-xs); color:var(--text-sub);">
            Total: <strong id="secretsCountLabel" style="color:var(--text-primary);">0</strong> secrets
          </div>
        </div>

        <!-- Secrets List Card -->
        <div class="card" style="padding:1.25rem; border-radius:var(--radius-lg);">
          <div class="table-responsive">
            <table class="data-table" style="width:100%; border-collapse:collapse;" aria-label="Secrets vault table">
              <thead>
                <tr style="border-bottom:1px solid var(--border-light); text-align:left;">
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Secret Name</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Status</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Masked Value</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Domain</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub);">Updated</th>
                  <th style="padding:0.75rem 1rem; font-size:var(--text-xs); font-weight:700; color:var(--text-sub); text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="secretsTableBody">
                <tr>
                  <td colspan="6" style="padding:3rem 1.5rem; text-align:center; color:var(--text-muted); font-size:var(--text-sm);">
                    Loading secrets vault…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Delete Secret Confirmation Dialog -->
      <div class="modal-overlay hidden" id="confirmDeleteSecretModal" role="dialog" aria-modal="true" aria-labelledby="confirmDeleteTitle" style="z-index:9999;">
        <div class="modal-dialog" style="max-width:420px; background:var(--bg-surface); border-radius:var(--radius-lg); border:1px solid var(--border-light); padding:1.5rem; box-shadow:var(--shadow-xl);">
          <div style="display:flex; align-items:center; gap:0.6rem; color:var(--color-danger); margin-bottom:0.75rem;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <h3 id="confirmDeleteTitle" style="font-size:1rem; font-weight:700; margin:0;">Delete Secret</h3>
          </div>
          <p style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom:1.25rem; line-height:1.5;">
            Are you sure you want to permanently delete <strong id="deleteSecretTargetName" class="mono" style="color:var(--text-primary);"></strong>? Any workflow referencing this token will fail to authenticate.
          </p>
          <div style="display:flex; justify-content:flex-end; gap:0.6rem;">
            <button class="btn btn-secondary btn-sm" id="btnCancelDeleteSecret">Cancel</button>
            <button class="btn btn-danger btn-sm" id="btnConfirmDeleteSecret">Delete Secret</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    await this.loadSecrets();
  },

  bindEvents() {
    const modalAdd = document.getElementById('addSecretModal');
    const btnOpenModal = document.getElementById('btnOpenAddSecretModal');
    const btnCloseModal = document.getElementById('btnCloseAddSecretModal');
    const form = document.getElementById('addSecretForm');

    if (btnOpenModal && modalAdd) {
      btnOpenModal.onclick = () => {
        modalAdd.classList.toggle('hidden');
        if (!modalAdd.classList.contains('hidden')) {
          document.getElementById('secretName')?.focus();
        }
      };
    }

    if (btnCloseModal && modalAdd) {
      btnCloseModal.onclick = () => modalAdd.classList.add('hidden');
    }

    // Form submission
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('secretName');
        const domainInput = document.getElementById('secretDomain');
        const valueInput = document.getElementById('secretValue');
        const submitBtn = document.getElementById('btnSubmitSecret');

        if (submitBtn) submitBtn.disabled = true;
        Toast.info('Storing secret in vault…');

        try {
          await Api.createSecret(nameInput.value.trim(), domainInput.value.trim(), valueInput.value);
          Toast.success(`Secret "${nameInput.value.trim()}" saved securely`);
          form.reset();
          if (modalAdd) modalAdd.classList.add('hidden');
          await this.loadSecrets();
        } catch (err) {
          Toast.error(err.message || 'Failed to save secret');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      };
    }

    // Search filter
    const searchInput = document.getElementById('secretSearchInput');
    if (searchInput) {
      searchInput.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderTable();
      };
    }

    // Confirmation dialog cancel
    const btnCancel = document.getElementById('btnCancelDeleteSecret');
    const confirmModal = document.getElementById('confirmDeleteSecretModal');
    if (btnCancel && confirmModal) {
      btnCancel.onclick = () => confirmModal.classList.add('hidden');
    }
  },

  async loadSecrets() {
    try {
      const data = await Api.getSecrets().catch(() => ({ secrets: [] }));
      this.secrets = data.secrets || [];
      const countLabel = document.getElementById('secretsCountLabel');
      if (countLabel) countLabel.textContent = this.secrets.length;
      this.renderTable();
    } catch (err) {
      const tbody = document.getElementById('secretsTableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:2rem; text-align:center; color:var(--color-danger);">Failed to load secrets: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  },

  renderTable() {
    const tbody = document.getElementById('secretsTableBody');
    if (!tbody) return;

    let filtered = this.secrets;
    if (this.searchQuery) {
      filtered = filtered.filter(s =>
        (s.name || '').toLowerCase().includes(this.searchQuery) ||
        (s.domain || '').toLowerCase().includes(this.searchQuery)
      );
    }

    if (filtered.length === 0) {
      if (this.secrets.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:3.5rem 1.5rem; text-align:center;">
              <div class="modern-empty-state" style="border:none; padding:1rem 0;">
                <div style="margin-bottom:1rem; display:inline-block;">
                  ${renderRobotAvatar({ size: 'medium', state: 'idle' })}
                </div>
                <h3 class="empty-state-title" style="font-size:1.05rem; color:var(--text-primary); font-weight:700;">No credentials stored yet</h3>
                <p class="empty-state-desc" style="color:var(--text-sub); max-width:380px; margin:0.35rem auto 1rem;">Store passwords and auth keys to safely inject them into autonomous agent workflows using {{secret:name}}.</p>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('btnOpenAddSecretModal')?.click()">+ Add First Secret</button>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:2.5rem; text-align:center; color:var(--text-muted); font-size:var(--text-sm);">
              No secrets match "${escapeHtml(this.searchQuery)}".
            </td>
          </tr>
        `;
      }
      return;
    }

    tbody.innerHTML = filtered.map(secret => {
      const token = `{{secret:${secret.name}}}`;
      return `
        <tr style="border-bottom:1px solid var(--border-subtle); transition:background-color 0.15s ease;">
          <td style="padding:0.85rem 1rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <strong style="font-size:var(--text-sm); font-family:var(--font-mono); color:var(--accent-primary);">${escapeHtml(secret.name)}</strong>
              <button class="btn-icon btn-copy-token" data-token="${escapeHtml(token)}" title="Copy placeholder ${escapeHtml(token)}" style="width:22px; height:22px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
          </td>
          <td style="padding:0.85rem 1rem;">
            <span class="badge-tag success" style="font-size:var(--text-2xs); display:inline-flex; align-items:center; gap:0.35rem;">
              <span class="status-dot online" style="width:6px; height:6px;"></span>
              <span>Connected</span>
            </span>
          </td>
          <td style="padding:0.85rem 1rem;">
            <span class="secret-mask-badge">••••••••••••</span>
          </td>
          <td style="padding:0.85rem 1rem; font-size:var(--text-xs); color:var(--text-secondary);">
            ${escapeHtml(secret.domain || 'All Domains')}
          </td>
          <td style="padding:0.85rem 1rem; font-size:var(--text-xs); color:var(--text-muted);">
            ${formatDate(secret.updatedAt || secret.createdAt)}
          </td>
          <td style="padding:0.85rem 1rem; text-align:right;">
            <button class="btn btn-ghost btn-sm btn-delete-secret" data-id="${escapeHtml(secret.id)}" data-name="${escapeHtml(secret.name)}" style="color:var(--color-danger); height:28px; padding:0 0.5rem;" title="Delete secret">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span style="font-size:var(--text-xs);">Delete</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Bind copy token buttons
    tbody.querySelectorAll('.btn-copy-token').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const tok = btn.getAttribute('data-token');
        navigator.clipboard.writeText(tok);
        Toast.success(`Copied placeholder: ${tok}`);
      };
    });

    // Bind delete confirmation buttons
    tbody.querySelectorAll('.btn-delete-secret').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const confirmModal = document.getElementById('confirmDeleteSecretModal');
        const targetNameEl = document.getElementById('deleteSecretTargetName');
        const confirmBtn = document.getElementById('btnConfirmDeleteSecret');

        if (confirmModal && targetNameEl && confirmBtn) {
          targetNameEl.textContent = `"${name}"`;
          confirmModal.classList.remove('hidden');

          confirmBtn.onclick = async () => {
            confirmBtn.disabled = true;
            try {
              await Api.deleteSecret(id);
              Toast.success(`Secret "${name}" deleted`);
              confirmModal.classList.add('hidden');
              await this.loadSecrets();
            } catch (err) {
              Toast.error(err.message || 'Failed to delete secret');
            } finally {
              confirmBtn.disabled = false;
            }
          };
        }
      };
    });
  }
};
