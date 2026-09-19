/**
 * Workflow Capture — Bot Configuration & Stealth API Controller
 * 
 * Manages humanization parameters: click delays, mouse movement dynamics,
 * keystroke cadence, and anti-captcha stealth evasion flags.
 */

const { db } = require('../database/db');
const { sendJson } = require('../auth/auth-controller');

const PRESETS = {
  ultra_stealth: {
    id: 'ultra_stealth',
    name: 'Ultra Stealth (Anti-Captcha & Fingerprint Guard)',
    description: 'Maximum anti-bot evasion. Complex Bezier mouse trajectories, randomized dwell times, human typo hesitation, and complete navigator mask.',
    timing: {
      minActionDelayMs: 450,
      maxActionDelayMs: 1200,
      clickJitterMs: 250,
      preActionDelayMs: 200
    },
    mouse: {
      enabled: true,
      curveType: 'bezier_cubic',
      speed: 'human',
      wobble: 4,
      overshoot: true,
      hoverBeforeClickMs: 280,
      steps: 32
    },
    typing: {
      minTypingDelayMs: 70,
      maxTypingDelayMs: 210,
      punctuationPauseMs: 350,
      variance: 'gaussian'
    },
    resolution: {
      timeoutMs: 10000,
      pollIntervalMs: 150
    },
    stealth: {
      maskWebdriver: true,
      emulatePlugins: true,
      emulateChromeRuntime: true,
      randomizeScroll: true,
      spoofUserAgent: false
    }
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced Automation (Recommended)',
    description: 'Natural human-like timing and smooth mouse curves with balanced execution throughput.',
    timing: {
      minActionDelayMs: 250,
      maxActionDelayMs: 650,
      clickJitterMs: 120,
      preActionDelayMs: 100
    },
    mouse: {
      enabled: true,
      curveType: 'bezier_cubic',
      speed: 'medium',
      wobble: 2,
      overshoot: true,
      hoverBeforeClickMs: 140,
      steps: 22
    },
    typing: {
      minTypingDelayMs: 40,
      maxTypingDelayMs: 120,
      punctuationPauseMs: 180,
      variance: 'uniform'
    },
    resolution: {
      timeoutMs: 5000,
      pollIntervalMs: 100
    },
    stealth: {
      maskWebdriver: true,
      emulatePlugins: true,
      emulateChromeRuntime: true,
      randomizeScroll: false,
      spoofUserAgent: false
    }
  },
  fast: {
    id: 'fast',
    name: 'Fast Track (Dev & Test Bench)',
    description: 'High-speed playback for local development and rapid regression tests without humanization delays.',
    timing: {
      minActionDelayMs: 50,
      maxActionDelayMs: 150,
      clickJitterMs: 20,
      preActionDelayMs: 20
    },
    mouse: {
      enabled: false,
      curveType: 'linear',
      speed: 'fast',
      wobble: 0,
      overshoot: false,
      hoverBeforeClickMs: 0,
      steps: 5
    },
    typing: {
      minTypingDelayMs: 10,
      maxTypingDelayMs: 30,
      punctuationPauseMs: 0,
      variance: 'none'
    },
    resolution: {
      timeoutMs: 3000,
      pollIntervalMs: 50
    },
    stealth: {
      maskWebdriver: false,
      emulatePlugins: false,
      emulateChromeRuntime: false,
      randomizeScroll: false,
      spoofUserAgent: false
    }
  },
  erp: {
    id: 'erp',
    name: 'ERP / CityMart (Patient Polling & Async Grids)',
    description: 'Extended resolution timeouts (15s) and generous pacing delays (2s - 4.5s) for heavy enterprise ERP portals, Sencha ExtJS, and DevExpress data grids.',
    timing: {
      minActionDelayMs: 2000,
      maxActionDelayMs: 4500,
      clickJitterMs: 200,
      preActionDelayMs: 800
    },
    mouse: {
      enabled: true,
      curveType: 'bezier_cubic',
      speed: 'medium',
      wobble: 2,
      overshoot: true,
      hoverBeforeClickMs: 180,
      steps: 22
    },
    typing: {
      minTypingDelayMs: 30,
      maxTypingDelayMs: 100,
      punctuationPauseMs: 150,
      variance: 'uniform'
    },
    resolution: {
      timeoutMs: 15000,
      pollIntervalMs: 150
    },
    stealth: {
      maskWebdriver: true,
      emulatePlugins: true,
      emulateChromeRuntime: true,
      randomizeScroll: false,
      spoofUserAgent: false
    }
  }
};

const DEFAULT_CONFIG = {
  id: 'global_bot_config',
  preset: 'balanced',
  ...PRESETS.balanced
};

/**
 * Get active bot config
 */
function getActiveBotConfig(userId = null) {
  let config = null;
  if (userId) {
    config = db.findOne('bot_configs', c => c.userId === userId);
  }
  if (!config) {
    config = db.findOne('bot_configs', c => c.id === 'global_bot_config' || c.isGlobal);
  }
  if (!config) {
    config = db.insert('bot_configs', {
      ...DEFAULT_CONFIG,
      id: 'global_bot_config',
      isGlobal: true
    });
  }
  return config;
}

/**
 * API: GET /api/bot-config
 */
function getBotConfig(req, res) {
  const userId = req.user ? req.user.id : null;
  const config = getActiveBotConfig(userId);
  return sendJson(res, 200, { success: true, config, presets: PRESETS });
}

/**
 * API: PUT /api/bot-config
 */
function updateBotConfig(req, res, body = {}) {
  const userId = req.user ? req.user.id : null;
  let config = getActiveBotConfig(userId);

  const updates = {
    preset: body.preset || 'custom',
    timing: {
      minActionDelayMs: Math.max(0, parseInt(body.timing?.minActionDelayMs ?? config.timing?.minActionDelayMs ?? 250, 10)),
      maxActionDelayMs: Math.max(0, parseInt(body.timing?.maxActionDelayMs ?? config.timing?.maxActionDelayMs ?? 650, 10)),
      clickJitterMs: Math.max(0, parseInt(body.timing?.clickJitterMs ?? config.timing?.clickJitterMs ?? 120, 10)),
      preActionDelayMs: Math.max(0, parseInt(body.timing?.preActionDelayMs ?? config.timing?.preActionDelayMs ?? 100, 10))
    },
    mouse: {
      enabled: Boolean(body.mouse?.enabled ?? config.mouse?.enabled ?? true),
      curveType: body.mouse?.curveType || config.mouse?.curveType || 'bezier_cubic',
      speed: body.mouse?.speed || config.mouse?.speed || 'medium',
      wobble: Math.max(0, parseInt(body.mouse?.wobble ?? config.mouse?.wobble ?? 2, 10)),
      overshoot: Boolean(body.mouse?.overshoot ?? config.mouse?.overshoot ?? true),
      hoverBeforeClickMs: Math.max(0, parseInt(body.mouse?.hoverBeforeClickMs ?? config.mouse?.hoverBeforeClickMs ?? 140, 10)),
      steps: Math.max(3, parseInt(body.mouse?.steps ?? config.mouse?.steps ?? 22, 10))
    },
    typing: {
      minTypingDelayMs: Math.max(0, parseInt(body.typing?.minTypingDelayMs ?? config.typing?.minTypingDelayMs ?? 40, 10)),
      maxTypingDelayMs: Math.max(0, parseInt(body.typing?.maxTypingDelayMs ?? config.typing?.maxTypingDelayMs ?? 120, 10)),
      punctuationPauseMs: Math.max(0, parseInt(body.typing?.punctuationPauseMs ?? config.typing?.punctuationPauseMs ?? 180, 10)),
      variance: body.typing?.variance || config.typing?.variance || 'uniform'
    },
    resolution: {
      timeoutMs: Math.max(500, parseInt(body.resolution?.timeoutMs ?? config.resolution?.timeoutMs ?? 5000, 10)),
      pollIntervalMs: Math.max(10, parseInt(body.resolution?.pollIntervalMs ?? config.resolution?.pollIntervalMs ?? 100, 10))
    },
    stealth: {
      maskWebdriver: Boolean(body.stealth?.maskWebdriver ?? config.stealth?.maskWebdriver ?? true),
      emulatePlugins: Boolean(body.stealth?.emulatePlugins ?? config.stealth?.emulatePlugins ?? true),
      emulateChromeRuntime: Boolean(body.stealth?.emulateChromeRuntime ?? config.stealth?.emulateChromeRuntime ?? true),
      randomizeScroll: Boolean(body.stealth?.randomizeScroll ?? config.stealth?.randomizeScroll ?? false),
      spoofUserAgent: Boolean(body.stealth?.spoofUserAgent ?? config.stealth?.spoofUserAgent ?? false)
    }
  };

  const updated = db.update('bot_configs', config.id, updates);
  return sendJson(res, 200, { success: true, message: 'Bot configuration updated successfully', config: updated });
}

/**
 * API: POST /api/bot-config/reset
 */
function resetBotConfig(req, res, body = {}) {
  const presetKey = body.preset || 'balanced';
  const targetPreset = PRESETS[presetKey] || PRESETS.balanced;
  const userId = req.user ? req.user.id : null;
  const config = getActiveBotConfig(userId);

  const updated = db.update('bot_configs', config.id, {
    preset: presetKey,
    ...targetPreset
  });

  return sendJson(res, 200, {
    success: true,
    message: `Bot configuration reset to ${targetPreset.name}`,
    config: updated
  });
}

/**
 * API: GET /api/bot-config/presets
 */
function getPresets(req, res) {
  return sendJson(res, 200, { success: true, presets: PRESETS });
}

module.exports = {
  PRESETS,
  DEFAULT_CONFIG,
  getActiveBotConfig,
  getBotConfig,
  updateBotConfig,
  resetBotConfig,
  getPresets
};
