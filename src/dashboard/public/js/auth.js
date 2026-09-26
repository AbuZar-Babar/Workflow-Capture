/**
 * Workflow Capture — Client-Side Authentication Manager
 */

export const Auth = {
  tokenKey: 'workflow_capture_jwt',
  userKey: 'workflow_capture_user',
  
  getToken() {
    return localStorage.getItem(this.tokenKey) || null;
  },
  
  getUser() {
    const user = localStorage.getItem(this.userKey);
    if (!user) return null;
    try {
      return JSON.parse(user);
    } catch {
      return null;
    }
  },
  
  setAuth(token, user) {
    if (token) {
      localStorage.setItem(this.tokenKey, token);
    } else {
      localStorage.removeItem(this.tokenKey);
    }
    if (user) {
      const userStr = typeof user === 'string' ? user : JSON.stringify(user);
      localStorage.setItem(this.userKey, userStr);
    } else {
      localStorage.removeItem(this.userKey);
    }
  },
  
  clearAuth() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  },
  
  isLoggedIn() {
    return Boolean(this.getToken());
  },

  /**
   * Wrapper for fetch that automatically attaches the JWT token.
   */
  async authenticatedFetch(url, options = {}) {
    const token = this.getToken();
    
    const headers = {
      ...options.headers,
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const fetchOptions = {
      ...options,
      headers
    };
    
    const response = await fetch(url, fetchOptions);
    if (response.status === 401 && !url.includes('/api/auth/me')) {
      this.clearAuth();
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('auth:logout'));
      }
    }
    return response;
  }
};
