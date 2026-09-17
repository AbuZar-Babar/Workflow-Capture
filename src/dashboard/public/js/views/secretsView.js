import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const SecretsView = {
  async render(container, router) {
    container.innerHTML = `
      <div class="view-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2rem;">
        <div>
          <h2>Credential Vault</h2>
          <p style="color:var(--text-secondary); font-size:0.9rem;">Manage secure passwords to inject into workflows using {{secret:name}} placeholders.</p>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns: 300px 1fr; gap: 2rem; align-items: start;">
        
        <!-- Add Secret Form -->
        <div style="background:white; padding:1.5rem; border-radius:var(--radius-md); border:1px solid var(--border-light); box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <h3 style="font-size:1.1rem; margin-bottom:1rem;">Add New Secret</h3>
          <form id="addSecretForm" style="display:flex; flex-direction:column; gap:1rem;">
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Secret Name (ID)</label>
              <input type="text" id="secretName" required placeholder="e.g. github_password" style="padding:0.65rem; border:1px solid var(--border-light); border-radius:var(--radius-sm); outline:none;">
            </div>
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Domain / Context (Optional)</label>
              <input type="text" id="secretDomain" placeholder="e.g. github.com" style="padding:0.65rem; border:1px solid var(--border-light); border-radius:var(--radius-sm); outline:none;">
            </div>
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Secret Value</label>
              <input type="password" id="secretValue" required placeholder="••••••••" style="padding:0.65rem; border:1px solid var(--border-light); border-radius:var(--radius-sm); outline:none;">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top:0.5rem; justify-content:center;">Save Securely</button>
          </form>
        </div>

        <!-- Secrets List -->
        <div style="background:white; border-radius:var(--radius-md); border:1px solid var(--border-light); overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <table style="width:100%; border-collapse:collapse; text-align:left;">
            <thead>
              <tr style="background:#f9fafb; border-bottom:1px solid var(--border-light);">
                <th style="padding:1rem; font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Name</th>
                <th style="padding:1rem; font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Domain</th>
                <th style="padding:1rem; font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Last Updated</th>
                <th style="padding:1rem; font-size:0.85rem; font-weight:600; color:var(--text-secondary); width:80px;">Action</th>
              </tr>
            </thead>
            <tbody id="secretsTableBody">
              <tr>
                <td colspan="4" style="padding:2rem; text-align:center; color:var(--text-tertiary);">Loading secrets...</td>
              </tr>
            </tbody>
          </table>
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
            <td colspan="4" style="padding:2rem; text-align:center; color:var(--text-tertiary);">No secrets found. Add one to get started!</td>
          </tr>
        `;
        return;
      }
      
      this.tableBody.innerHTML = '';
      data.secrets.forEach(secret => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        
        tr.innerHTML = `
          <td style="padding:1rem;">
            <div style="font-weight:600; font-family:'JetBrains Mono', monospace; font-size:0.9rem;">{{secret:${secret.name}}}</div>
          </td>
          <td style="padding:1rem; color:var(--text-secondary);">${secret.domain}</td>
          <td style="padding:1rem; color:var(--text-secondary); font-size:0.85rem;">${new Date(secret.updatedAt).toLocaleString()}</td>
          <td style="padding:1rem;">
            <button class="btn-icon delete-btn" style="color:#ef4444;" title="Delete Secret">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
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
