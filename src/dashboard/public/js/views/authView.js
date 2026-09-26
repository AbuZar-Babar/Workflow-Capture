import { Auth } from '../auth.js';
import { Api } from '../api.js';
import { Toast } from '../components/toast.js';

export const AuthView = {
  isLoginMode: true,
  
  init() {
    this.overlay = document.getElementById('authOverlay');
    this.form = document.getElementById('authForm');
    this.toggleModeBtn = document.getElementById('authToggleMode');
    this.toggleModeText = document.getElementById('authToggleText');
    this.subtitle = document.getElementById('authSubtitle');
    this.submitBtn = document.getElementById('authSubmitBtn');
    
    this.usernameGroup = document.getElementById('usernameGroup');
    this.usernameInput = document.getElementById('authUsername');
    this.emailInput = document.getElementById('authEmail');
    this.passwordInput = document.getElementById('authPassword');
    this.logoutBtn = document.getElementById('btnLogout');
    this.dummyLoginBtn = document.getElementById('btnDummyLogin');

    // Global bypass helper (strictly gated by server response)
    window.quickEnterDashboard = async () => {
      await this.handleDummyLogin();
    };

    this.bindEvents();
    this.render();

    // Verify authenticated session against /api/auth/me on startup
    this.checkAuth();
  },
  
  bindEvents() {
    if (this.toggleModeBtn) {
      this.toggleModeBtn.onclick = (e) => {
        e.preventDefault();
        this.isLoginMode = !this.isLoginMode;
        this.render();
      };
    }

    if (this.form) {
      this.form.onsubmit = async (e) => {
        e.preventDefault();
        if (this.submitBtn) {
          this.submitBtn.disabled = true;
          this.submitBtn.innerText = 'Please wait...';
        }
        
        try {
          const email = this.emailInput && this.emailInput.value ? this.emailInput.value.trim() : '';
          const password = this.passwordInput && this.passwordInput.value ? this.passwordInput.value : '';

          if (this.isLoginMode) {
            if (!email || !password) {
              throw new Error('Email/Username and password are required');
            }

            const res = await Api.login(email, password);
            if (res && res.token) {
              Auth.setAuth(res.token, res.user);
              Toast.show('Logged in successfully', 'success');
              if (this.emailInput) this.emailInput.value = '';
              if (this.passwordInput) this.passwordInput.value = '';
              this.hideLoginForm();
            } else {
              throw new Error('Login failed: Invalid server response');
            }
          } else {
            const username = this.usernameInput && this.usernameInput.value ? this.usernameInput.value.trim() : '';
            if (!username || !email || !password) {
              throw new Error('Username, email, and password are required');
            }

            const res = await Api.signup(username, email, password);
            if (res && res.token) {
              Auth.setAuth(res.token, res.user);
              Toast.show('Account created successfully', 'success');
              if (this.usernameInput) this.usernameInput.value = '';
              if (this.emailInput) this.emailInput.value = '';
              if (this.passwordInput) this.passwordInput.value = '';
              this.hideLoginForm();
            } else {
              throw new Error('Registration failed: Invalid server response');
            }
          }
        } catch (err) {
          // Do not silently fall back to dummy login when real credentials fail. Show a useful error and keep the login form available.
          Toast.show(err.message || 'Authentication failed', 'error');
        } finally {
          if (this.submitBtn) {
            this.submitBtn.disabled = false;
          }
          this.render();
        }
      };
    }

    if (this.dummyLoginBtn) {
      this.dummyLoginBtn.onclick = async (e) => {
        e.preventDefault();
        await this.handleDummyLogin();
      };
    }
    
    if (this.logoutBtn) {
      this.logoutBtn.onclick = async () => {
        try {
          await Api.logout();
        } catch (err) {
          console.warn('Server logout notice:', err);
        }
        Auth.clearAuth();
        if (this.emailInput) this.emailInput.value = '';
        if (this.passwordInput) this.passwordInput.value = '';
        if (this.usernameInput) this.usernameInput.value = '';
        this.showLoginForm();
        Toast.show('Logged out successfully', 'success');
      };
    }
    
    // Listen for 401s from authenticatedFetch or session expiry
    window.addEventListener('auth:logout', () => {
      Auth.clearAuth();
      this.showLoginForm();
    });
  },

  async handleDummyLogin() {
    if (this.dummyLoginBtn) {
      this.dummyLoginBtn.disabled = true;
    }
    try {
      const res = await Api.dummyLogin();
      if (res && res.token) {
        Auth.setAuth(res.token, res.user);
        Toast.show('Logged in with developer bypass', 'success');
        this.hideLoginForm();
      } else {
        throw new Error('Developer bypass failed');
      }
    } catch (err) {
      Toast.show(err.message || 'Developer bypass is disabled in secure mode', 'error');
    } finally {
      if (this.dummyLoginBtn) {
        this.dummyLoginBtn.disabled = false;
      }
    }
  },
  
  render() {
    if (this.isLoginMode) {
      if (this.subtitle) this.subtitle.innerText = 'Log in to your account';
      if (this.usernameGroup) this.usernameGroup.style.display = 'none';
      if (this.usernameInput) this.usernameInput.removeAttribute('required');
      if (this.submitBtn) this.submitBtn.innerText = 'Log In';
      if (this.toggleModeText) this.toggleModeText.innerText = "Don't have an account? ";
      if (this.toggleModeBtn) this.toggleModeBtn.innerText = 'Sign up';
    } else {
      if (this.subtitle) this.subtitle.innerText = 'Create a new account';
      if (this.usernameGroup) this.usernameGroup.style.display = 'flex';
      if (this.usernameInput) this.usernameInput.setAttribute('required', 'true');
      if (this.submitBtn) this.submitBtn.innerText = 'Sign Up';
      if (this.toggleModeText) this.toggleModeText.innerText = "Already have an account? ";
      if (this.toggleModeBtn) this.toggleModeBtn.innerText = 'Log in';
    }
  },
  
  showLoginForm() {
    if (this.overlay) {
      this.overlay.classList.remove('hidden');
      this.overlay.style.removeProperty('display');
      this.overlay.style.removeProperty('visibility');
      this.overlay.style.removeProperty('pointer-events');
      this.overlay.style.display = 'flex';
      this.overlay.style.zIndex = '10000';
    }
    if (this.logoutBtn) {
      this.logoutBtn.style.display = 'none';
    }
    window.dispatchEvent(new CustomEvent('auth:status', { detail: { loggedIn: false } }));
  },

  hideLoginForm() {
    if (this.overlay) {
      this.overlay.classList.add('hidden');
      this.overlay.style.display = 'none';
    }
    if (this.logoutBtn) {
      this.logoutBtn.style.display = '';
    }
    window.dispatchEvent(new CustomEvent('auth:status', { detail: { loggedIn: true, user: Auth.getUser() } }));
  },

  async checkAuth() {
    try {
      const res = await Auth.authenticatedFetch('/api/auth/me');
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.user) {
          Auth.setAuth(Auth.getToken(), data.user);
          this.hideLoginForm();
          return true;
        }
      }
    } catch (err) {
      console.warn('Session verification check failed:', err);
    }

    // No valid authenticated session: clear client auth and show login form
    Auth.clearAuth();
    this.showLoginForm();
    return false;
  }
};
