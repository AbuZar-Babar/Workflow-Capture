/**
 * Workflow Capture — Global Theme Manager (Light / Dark Mode & Palette Support)
 */

export const Theme = {
  current: 'dark',
  transitionTimeout: null,

  getPalette(theme = this.current) {
    if (!theme) return 'slate';
    if (theme.includes('crimson')) return 'crimson';
    if (theme.includes('sage') || theme.includes('mint') || theme.includes('forest')) return 'sage';
    return 'slate';
  },

  getMode(theme = this.current) {
    if (!theme) return 'dark';
    if (theme === 'light' || theme === 'sage' || theme === 'mint' || theme === 'crimson-light') {
      return 'light';
    }
    return 'dark';
  },

  resolve(palette, mode) {
    if (palette === 'crimson') {
      return mode === 'light' ? 'crimson-light' : 'crimson';
    }
    if (palette === 'sage') {
      return mode === 'light' ? 'sage' : 'sage-dark';
    }
    // Slate
    return mode === 'light' ? 'light' : 'dark';
  },

  init() {
    const saved = localStorage.getItem('workflow_capture_theme') || localStorage.getItem('flowmind_theme');
    let initial = 'dark';

    const validThemes = [
      'dark', 'light',
      'crimson', 'crimson-dark', 'charcoal-crimson', 'crimson-light',
      'sage', 'mint', 'sage-dark', 'forest-dark'
    ];

    if (saved && validThemes.includes(saved)) {
      initial = saved;
    }

    this.setTheme(initial, false);

    // Bind all theme toggles
    this.bindButtons();

    // Listen to OS system theme changes if user hasn't explicitly overridden
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('workflow_capture_theme') && !localStorage.getItem('flowmind_theme')) {
          const sysMode = e.matches ? 'dark' : 'light';
          const palette = this.getPalette(this.current);
          this.setTheme(this.resolve(palette, sysMode), false);
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
    const currentMode = this.getMode(this.current);
    const currentPalette = this.getPalette(this.current);
    const nextMode = currentMode === 'dark' ? 'light' : 'dark';
    const nextTheme = this.resolve(currentPalette, nextMode);
    this.setTheme(nextTheme, true);
  },

  setPalette(palette, save = true) {
    const currentMode = this.getMode(this.current);
    const targetTheme = this.resolve(palette, currentMode);
    this.setTheme(targetTheme, save);
  },

  setMode(mode, save = true) {
    const currentPalette = this.getPalette(this.current);
    const targetTheme = this.resolve(currentPalette, mode);
    this.setTheme(targetTheme, save);
  },

  setTheme(theme, save = true) {
    if (theme === 'system') {
      const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const sysMode = isSystemDark ? 'dark' : 'light';
      const curPalette = this.getPalette(this.current);
      theme = this.resolve(curPalette, sysMode);
    }

    this.current = theme;
    const palette = this.getPalette(theme);
    const mode = this.getMode(theme);

    // Trigger smooth transition
    const root = document.documentElement;
    root.classList.add('theme-transition');
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 250);

    root.setAttribute('data-theme', theme);
    root.setAttribute('data-palette', palette);
    root.setAttribute('data-mode', mode);

    if (save) {
      try {
        localStorage.setItem('workflow_capture_theme', theme);
        localStorage.setItem('flowmind_theme', theme);
        localStorage.setItem('workflow_capture_palette', palette);
        localStorage.setItem('workflow_capture_mode', mode);
      } catch (e) {
        // Storage might be restricted
      }
    }

    this.updateUI();

    // Notify listeners (e.g. Drawflow canvas redraw if needed)
    window.dispatchEvent(new CustomEvent('workflow-capture-theme-change', { detail: { theme, palette, mode } }));
    window.dispatchEvent(new CustomEvent('flowmind-theme-change', { detail: { theme, palette, mode } }));
  },

  updateUI() {
    const isDark = this.getMode(this.current) === 'dark';
    const labelText = isDark ? 'Light' : 'Dark';
    const tooltipText = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.setAttribute('data-theme-current', this.current);
      btn.setAttribute('data-theme-palette', this.getPalette(this.current));
      btn.setAttribute('data-theme-mode', this.getMode(this.current));
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
