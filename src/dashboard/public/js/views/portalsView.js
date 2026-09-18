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
                <div class="portal-card-icon">
                  <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                </div>
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
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-1.8a4 4 0 002.5-3.66m-7.07-5.05a6 6 0 017.38-5.84h1.8a4 4 0 00-3.66 2.5m1.34-3.14l4.24-4.24a1 1 0 011.42 0l1.41 1.41a1 1 0 010 1.42l-4.24 4.24m-2.83 2.83l-2.12 2.12a1 1 0 01-1.42 0l-1.41-1.41a1 1 0 010-1.42l2.12-2.12"/></svg>
                <span>Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-portal.html" target="_blank" title="Open directly in browser tab">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                <span>Direct URL</span>
              </a>
            </div>
          </article>

          <!-- Portal 2: Stratos Sales CRM -->
          <article class="portal-feature-card">
            <div>
              <div class="portal-card-top">
                <div class="portal-card-icon">
                  <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                </div>
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
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-1.8a4 4 0 002.5-3.66m-7.07-5.05a6 6 0 017.38-5.84h1.8a4 4 0 00-3.66 2.5m1.34-3.14l4.24-4.24a1 1 0 011.42 0l1.41 1.41a1 1 0 010 1.42l-4.24 4.24m-2.83 2.83l-2.12 2.12a1 1 0 01-1.42 0l-1.41-1.41a1 1 0 010-1.42l2.12-2.12"/></svg>
                <span>Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-sales-portal.html" target="_blank" title="Open directly in browser tab">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                <span>Direct URL</span>
              </a>
            </div>
          </article>

          <!-- Portal 3: Alexandria Library -->
          <article class="portal-feature-card">
            <div>
              <div class="portal-card-top">
                <div class="portal-card-icon">
                  <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                </div>
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
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-1.8a4 4 0 002.5-3.66m-7.07-5.05a6 6 0 017.38-5.84h1.8a4 4 0 00-3.66 2.5m1.34-3.14l4.24-4.24a1 1 0 011.42 0l1.41 1.41a1 1 0 010 1.42l-4.24 4.24m-2.83 2.83l-2.12 2.12a1 1 0 01-1.42 0l-1.41-1.41a1 1 0 010-1.42l2.12-2.12"/></svg>
                <span>Launch in Chrome</span>
              </button>
              <a class="btn btn-secondary" href="/portal/mock-library-portal.html" target="_blank" title="Open directly in browser tab">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                <span>Direct URL</span>
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
