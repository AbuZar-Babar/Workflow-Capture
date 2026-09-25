/**
 * Workflow Capture — FlowMind Global Theme Manager (Light / Dark Mode)
 */

export const Theme = {
  current: 'light',
  transitionTimeout: null,

  init() {
    const saved = localStorage.getItem('flowmind_theme');
    let initial = 'light';

    if (saved === 'dark' || saved === 'light') {
      initial = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      initial = 'dark';
    }

    this.setTheme(initial, false);

    // Bind all theme toggles
    this.bindButtons();

    // Listen to OS system theme changes if user hasn't overridden
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('flowmind_theme')) {
          this.setTheme(e.matches ? 'dark' : 'light', false);
        }
      });
    }
  },

  bindButtons() {
    const btns = document.querySelectorAll('.theme-toggle-btn');
    btns.forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        this.toggle();
      };
    });
    this.updateUI();
  },

  toggle() {
    const next = this.current === 'dark' ? 'light' : 'dark';
    this.setTheme(next, true);
  },

  setTheme(theme, save = true) {
    this.current = theme;

    // Trigger smooth transition
    const root = document.documentElement;
    root.classList.add('theme-transition');
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 320);

    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }

    if (save) {
      try {
        localStorage.setItem('flowmind_theme', theme);
      } catch (e) {
        // Storage might be restricted
      }
    }

    this.updateUI();

    // Notify listeners (e.g. Drawflow canvas redraw if needed)
    window.dispatchEvent(new CustomEvent('flowmind-theme-change', { detail: { theme } }));
  },

  updateUI() {
    const isDark = this.current === 'dark';
    const labelText = isDark ? 'Light' : 'Dark';
    const tooltipText = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.setAttribute('data-theme-current', this.current);
      btn.setAttribute('title', tooltipText);
      btn.setAttribute('data-tooltip', tooltipText);
      btn.setAttribute('aria-label', tooltipText);

      const labelEl = btn.querySelector('.theme-toggle-label');
      if (labelEl) {
        labelEl.textContent = labelText;
      }
    });
  }
};
