import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const SecretsView = {
  async render(container, router) {
    container.innerHTML = `
      <div class="view-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.5rem;">
        <div>
          <h2 style="font-size:1.35rem; font-weight:800; color:var(--text-main);">Credential Vault</h2>
          <p style="color:var(--text-sub); font-size:0.85rem; margin-top:0.25rem;">Manage secure passwords to inject into workflows using {{secret:name}} placeholders.</p>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns: 320px 1fr; gap: 1.5rem; align-items: start;">
        
        <!-- Add Secret Form Card -->
        <div class="card" style="padding:1.5rem;">
          <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main); margin-bottom:1.15rem;">Add New Secret</h3>
          <form id="addSecretForm" style="display:flex; flex-direction:column; gap:1rem;">
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:0.35rem; display:block;">Secret Name (ID)</label>
              <input type="text" id="secretName" class="form-control" required placeholder="e.g. github_password">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:0.35rem; display:block;">Domain / Context (Optional)</label>
              <input type="text" id="secretDomain" class="form-control" placeholder="e.g. github.com">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:0.35rem; display:block;">Secret Value</label>
              <input type="password" id="secretValue" class="form-control" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top:0.5rem; justify-content:center;">Save Securely</button>
          </form>
        </div>

        <!-- Secrets List Card -->
        <div class="card" style="padding:1.25rem;">
          <div class="table-responsive">
            <table class="quixotic-table" style="width:100%;">
              <thead>
                <tr>
                  <th style="padding:0.75rem 1rem;">Name</th>
                  <th style="padding:0.75rem 1rem;">Domain</th>
                  <th style="padding:0.75rem 1rem;">Last Updated</th>
                  <th style="padding:0.75rem 1rem; width:80px; text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody id="secretsTableBody">
                <tr>
                  <td colspan="4" style="padding:2.5rem; text-align:center; color:var(--text-sub);">Loading secrets...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.tableBody = document.getElementById('secretsTableBody');
    this.form = document.getElementById('addSecretForm');
    
    this.bindEvents();
    await this.loadSecrets();
  },

  bindEvents() {
    this.form.onsubmit = async (e) => {
      e.preventDefault();
      
      const nameInput = document.getElementById('secretName');
      const domainInput = document.getElementById('secretDomain');
      const valueInput = document.getElementById('secretValue');
      
      const submitBtn = this.form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Saving...';
      
      try {
        await Api.createSecret(nameInput.value, domainInput.value, valueInput.value);
        Toast.show('Secret saved securely', 'success');
        this.form.reset();
        await this.loadSecrets();
      } catch (err) {
        Toast.show(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Save Securely';
      }
    };
  },

  async loadSecrets() {
    try {
      const data = await Api.getSecrets();
      if (!data.secrets || data.secrets.length === 0) {
        this.tableBody.innerHTML = `
          <tr>
            <td colspan="4" style="padding:2.5rem; text-align:center; color:var(--text-sub);">No secrets found. Add one to get started!</td>
          </tr>
        `;
        return;
      }
      
      this.tableBody.innerHTML = '';
      data.secrets.forEach(secret => {
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
          <td style="padding:0.85rem 1rem;">
            <div style="font-weight:700; font-family:var(--font-mono); font-size:0.82rem; color:var(--brand-forest);">{{secret:${secret.name}}}</div>
          </td>
          <td style="padding:0.85rem 1rem; color:var(--text-body); font-size:0.8rem;">${secret.domain || '—'}</td>
          <td style="padding:0.85rem 1rem; color:var(--text-sub); font-size:0.75rem;">${new Date(secret.updatedAt).toLocaleString()}</td>
          <td style="padding:0.85rem 1rem; text-align:right;">
            <button class="btn-icon delete-btn" style="color:var(--color-danger); width:28px; height:28px;" title="Delete Secret">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </td>
        `;
        
        const deleteBtn = tr.querySelector('.delete-btn');
        deleteBtn.onclick = async () => {
          if (confirm(`Are you sure you want to delete the secret '${secret.name}'?`)) {
            try {
              await Api.deleteSecret(secret.id);
              Toast.show('Secret deleted', 'success');
              await this.loadSecrets();
            } catch (err) {
              Toast.show(err.message, 'error');
            }
          }
        };
        
        this.tableBody.appendChild(tr);
      });
    } catch (err) {
      this.tableBody.innerHTML = `
        <tr>
          <td colspan="4" style="padding:2rem; text-align:center; color:#ef4444;">Failed to load secrets: ${err.message}</td>
        </tr>
      `;
    }
  }
};
