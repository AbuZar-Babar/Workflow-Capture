/**
 * Workflow Capture — Test Portals View (Synthetic Test Beds)
 */

import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const PortalsView = {
  async render(container) {
    container.innerHTML = `
      <section class="card" style="min-height:70vh;">
        
        <!-- Header -->
        <div class="card-header-row" style="margin-bottom:1.5rem;">
          <div class="card-title-wrap">
            <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main);">Interactive Test Environments</h2>
            <p>Pre-configured web application benchmarks designed for testing recorder and selector heuristic resolution</p>
          </div>
        </div>

        <!-- 3 Feature Cards Grid -->
        <div class="portals-grid">
          
          <!-- Portal 1: NovaGear -->
          <article class="portal-feature-card">
            <div>
              <div class="portal-card-top">
                <div class="portal-card-icon">🛒</div>
                <div>
                  <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">NovaGear Store</h3>
                  <span class="badge-tag success">E-Commerce Flow</span>
                </div>
              </div>

              <p style="font-size:0.75rem; color:var(--text-sub); margin:0.85rem 0 1rem;">
                Full-featured online tech store with product catalog, dynamic shopping cart, discount vouchers, and checkout modal.
              </p>

              <h4 style="font-size:0.75rem; font-weight:700; color:var(--text-body); margin-bottom:0.4rem;">Scenario Coverage:</h4>
              <ul class="portal-checklist">
                <li>Search input with live auto-complete</li>
                <li>Dynamic product filter dropdowns</li>
                <li>Cart counter state changes</li>
                <li>Masked credit card and shipping form</li>
              </ul>
            </div>

            <div style="display:flex; gap:0.5rem; margin-top:1rem;">
              <button class="btn btn-primary btn-portal-launch" data-portal="ecommerce" style="flex:1;">
                <span>🚀 Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-portal.html" target="_blank" title="Open directly in browser tab">
                <span>🔗 Direct URL</span>
              </a>
            </div>
          </article>

          <!-- Portal 2: Stratos Sales CRM -->
          <article class="portal-feature-card">
            <div>
              <div class="portal-card-top">
                <div class="portal-card-icon">💼</div>
                <div>
                  <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Stratos Sales CRM</h3>
                  <span class="badge-tag amber">B2B SaaS Engine</span>
                </div>
              </div>

              <p style="font-size:0.75rem; color:var(--text-sub); margin:0.85rem 0 1rem;">
                Enterprise CRM lead qualification pipeline with complex multi-tab navigation, quote calculator, and dynamic table rows.
              </p>

              <h4 style="font-size:0.75rem; font-weight:700; color:var(--text-body); margin-bottom:0.4rem;">Scenario Coverage:</h4>
              <ul class="portal-checklist">
                <li>Multi-step lead pipeline stages</li>
                <li>Dynamic inline row creation & deletion</li>
                <li>Pricing quote configuration slider</li>
                <li>Async confirmation dialogs</li>
              </ul>
            </div>

            <div style="display:flex; gap:0.5rem; margin-top:1rem;">
              <button class="btn btn-primary btn-portal-launch" data-portal="sales" style="flex:1;">
                <span>🚀 Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-sales-portal.html" target="_blank" title="Open directly in browser tab">
                <span>🔗 Direct URL</span>
              </a>
            </div>
          </article>

          <!-- Portal 3: Alexandria Library -->
          <article class="portal-feature-card">
            <div>
              <div class="portal-card-top">
                <div class="portal-card-icon">📚</div>
                <div>
                  <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Alexandria Library</h3>
                  <span class="badge-tag info">Catalog & DRM</span>
                </div>
              </div>

              <p style="font-size:0.75rem; color:var(--text-sub); margin:0.85rem 0 1rem;">
                Digital repository catalog featuring asynchronous book borrowing, DRM key generation, and modal reader overlays.
              </p>

              <h4 style="font-size:0.75rem; font-weight:700; color:var(--text-body); margin-bottom:0.4rem;">Scenario Coverage:</h4>
              <ul class="portal-checklist">
                <li>Multi-criteria author & category search</li>
                <li>Borrowing state toggle & async license generation</li>
                <li>Overlaid PDF/ePub reader view</li>
                <li>DOM tree mutation stress test</li>
              </ul>
            </div>

            <div style="display:flex; gap:0.5rem; margin-top:1rem;">
              <button class="btn btn-primary btn-portal-launch" data-portal="library" style="flex:1;">
                <span>🚀 Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-library-portal.html" target="_blank" title="Open directly in browser tab">
                <span>🔗 Direct URL</span>
              </a>
            </div>
          </article>

        </div>

      </section>
    `;

    this.bindEvents();
  },

  bindEvents() {
    document.querySelectorAll('.btn-portal-launch').forEach(btn => {
      btn.onclick = async () => {
        const portal = btn.getAttribute('data-portal');
        Toast.info(`Opening ${portal} in Chrome with CDP...`);
        try {
          await Api.openPortal(portal);
          Toast.success(`Loaded portal in Chrome!`);
        } catch (err) {
          Toast.error(err.message);
        }
      };
    });
  }
};
