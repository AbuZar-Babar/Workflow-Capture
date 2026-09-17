/**
 * Workflow Capture — Client-Side Authentication Manager
 */

export const Auth = {
  tokenKey: 'workflow_capture_jwt',
  userKey: 'workflow_capture_user',
  
  getToken() {
    return localStorage.getItem(this.tokenKey);
  },
  
  getUser() {
    const user = localStorage.getItem(this.userKey);
    return user ? JSON.parse(user) : null;
  },
  
  setAuth(token, user) {
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.userKey, JSON.stringify(user));
  },
  
  clearAuth() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  },
  
  isLoggedIn() {
    return !!this.getToken();
  },

  /**
   * Wrapper for fetch that automatically attaches the JWT token.
   * Also handles 401 Unauthorized responses by logging the user out.
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
    
    if (response.status === 401) {
      console.warn('Unauthorized request. Logging out...');
      this.clearAuth();
      // Dispatch an event so the router/UI knows to show the login screen
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
    
    return response;
  }
};
