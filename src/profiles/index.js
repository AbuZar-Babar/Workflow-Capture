/**
 * Workflow Capture — Domain Profile Registry
 * 
 * Manages domain-specific profiles. The core engine is 100% generic by default.
 * If a profile matches the target domain or is explicitly specified, profile-specific
 * hints augment generic extraction.
 */

'use strict';

const citymartProfile = require('./citymart.profile');

const registeredProfiles = [citymartProfile];

class ProfileRegistry {
  /**
   * Find profile matching a given URL or hostname.
   * Returns null if no profile matches (system runs in pure generic mode).
   */
  static getProfileForUrl(url = '') {
    if (!url) return null;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      const hostname = parsed.hostname.toLowerCase();
      for (const profile of registeredProfiles) {
        if (profile.matchDomains && profile.matchDomains.some(d => hostname.includes(d.toLowerCase()))) {
          return profile;
        }
      }
    } catch {}
    return null;
  }

  /**
   * Get profile by ID
   */
  static getProfileById(id = '') {
    return registeredProfiles.find(p => p.id === id) || null;
  }
}

module.exports = ProfileRegistry;
