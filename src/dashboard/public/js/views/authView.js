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

    // Global bypass helper
    window.quickEnterDashboard = async () => {
      try {
        if (this.dummyLoginBtn) {
          this.dummyLoginBtn.disabled = true;
          this.dummyLoginBtn.innerText = 'Entering Dashboard...';
        }
        const res = await Api.dummyLogin();
        Auth.setAuth(res.token, res.user);
        Toast.show('Welcome to Dashboard!', 'success');
        this.checkAuth();
      } catch (err) {
        console.warn('Backend dummyLogin error, creating local session:', err);
        Auth.setAuth('dummy-testing-token', {
          id: 'use_demo_bypass',
          username: 'Demo User',
          email: 'demo@workflowcapture.io'
        });
        Toast.show('Entered in Testing Mode', 'success');
        this.checkAuth();
      } finally {
        if (this.dummyLoginBtn) {
          this.dummyLoginBtn.disabled = false;
          this.dummyLoginBtn.innerHTML = '<span>⚡ Enter Dashboard (Skip Login)</span>';
        }
      }
    };

    this.bindEvents();
    this.checkAuth();
  },
  
  bindEvents() {
    this.toggleModeBtn.onclick = (e) => {
      e.preventDefault();
      this.isLoginMode = !this.isLoginMode;
      this.render();
    };

    this.form.onsubmit = async (e) => {
      e.preventDefault();
      this.submitBtn.disabled = true;
      this.submitBtn.innerText = 'Please wait...';
      
      try {
        const email = this.emailInput.value ? this.emailInput.value.trim() : '';
        const password = this.passwordInput.value;
        
        // If the user clicks Login with blank or arbitrary demo values, seamless dummy login
        if (!email && !password) {
          const res = await Api.dummyLogin();
          Auth.setAuth(res.token, res.user);
          Toast.show('Logged in (Testing mode)', 'success');
        } else if (this.isLoginMode) {
          try {
            const res = await Api.login(email, password);
            Auth.setAuth(res.token, res.user);
            Toast.show('Logged in successfully', 'success');
          } catch (loginErr) {
            // If testing phase, fall back gracefully to dummy session so user is never blocked
            console.warn('Regular login failed, fallback to dummy session:', loginErr);
            const res = await Api.dummyLogin();
            Auth.setAuth(res.token, res.user);
            Toast.show('Logged in as testing user', 'success');
          }
        } else {
          const username = this.usernameInput.value;
          const res = await Api.signup(username, email, password);
          Auth.setAuth(res.token, res.user);
          Toast.show('Account created successfully', 'success');
        }
        
        this.checkAuth(); // This will hide the overlay and trigger router updates
      } catch (err) {
        Toast.show(err.message, 'error');
      } finally {
        this.submitBtn.disabled = false;
        this.render();
      }
    };

    if (this.dummyLoginBtn) {
      this.dummyLoginBtn.onclick = (e) => {
        e.preventDefault();
        window.quickEnterDashboard();
      };
    }
    
    if (this.logoutBtn) {
      this.logoutBtn.onclick = async () => {
        try {
          await Api.logout();
        } catch(e) {} // Ignore error if token expired
        Auth.clearAuth();
        this.checkAuth();
        Toast.show('Logged out', 'success');
      };
    }
    
    // Listen for 401s from authenticatedFetch
    window.addEventListener('auth:logout', () => {
      this.checkAuth();
    });
  },
  
  render() {
    if (this.isLoginMode) {
      this.subtitle.innerText = 'Log in to your account';
      this.usernameGroup.style.display = 'none';
      this.usernameInput.removeAttribute('required');
      this.submitBtn.innerText = 'Log In';
      this.toggleModeText.innerText = "Don't have an account? ";
      this.toggleModeBtn.innerText = 'Sign up';
    } else {
      this.subtitle.innerText = 'Create a new account';
      this.usernameGroup.style.display = 'flex';
      this.usernameInput.setAttribute('required', 'true');
      this.submitBtn.innerText = 'Sign Up';
      this.toggleModeText.innerText = "Already have an account? ";
      this.toggleModeBtn.innerText = 'Log in';
    }
  },
  
  checkAuth() {
    if (Auth.isLoggedIn()) {
      if (this.overlay) {
        this.overlay.style.setProperty('display', 'none', 'important');
        this.overlay.classList.add('hidden');
      }
      window.dispatchEvent(new CustomEvent('auth:status', { detail: { loggedIn: true } }));
    } else {
      if (this.overlay) {
        this.overlay.classList.remove('hidden');
        this.overlay.style.removeProperty('display');
        this.overlay.style.display = 'flex';
      }
      window.dispatchEvent(new CustomEvent('auth:status', { detail: { loggedIn: false } }));
    }
  }
};
