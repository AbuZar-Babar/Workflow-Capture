/**
 * Workflow Capture — Client-Side Authentication Manager
 */

export const Auth = {
  tokenKey: 'workflow_capture_jwt',
  userKey: 'workflow_capture_user',
  
  getToken() {
    return localStorage.getItem(this.tokenKey) || 'dev-testing-token';
  },
  
  getUser() {
    const user = localStorage.getItem(this.userKey);
    return user ? JSON.parse(user) : {
      id: 'dev_user_001',
      username: 'Developer',
      email: 'developer@workflowcapture.local'
    };
  },
  
  setAuth(token, user) {
    if (token) localStorage.setItem(this.tokenKey, token);
    if (user) localStorage.setItem(this.userKey, JSON.stringify(user));
  },
  
  clearAuth() {
    // Keep dev session intact so dashboard is always open
    localStorage.setItem(this.tokenKey, 'dev-testing-token');
  },
  
  isLoggedIn() {
    return true;
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
    return response;
  }
};
