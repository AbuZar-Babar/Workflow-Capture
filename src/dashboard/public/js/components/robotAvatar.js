/**
 * FlowMind / Workflow Agent — Lightweight Robotic Assistant Avatar
 * Pure SVG, zero-dependency, highly scalable robotic visual component.
 * Supports sizes: 'hero', 'card', 'badge', 'mini'
 * Supports states: 'idle', 'waving', 'analyzing', 'running', 'success', 'error', 'warning'
 */

let avatarCounter = 0;

export function renderRobotAvatar({ size = 'card', state = 'idle', className = '', style = '' } = {}) {
  avatarCounter++;
  const uid = `rb_${avatarCounter}_${Math.random().toString(36).substr(2, 5)}`;

  // Size mapping (px)
  let width = 64;
  let height = 72;
  if (size === 'mini') {
    width = 22;
    height = 25;
  } else if (size === 'badge') {
    width = 34;
    height = 38;
  } else if (size === 'card') {
    width = 64;
    height = 72;
  } else if (size === 'medium') {
    width = 96;
    height = 108;
  } else if (size === 'hero') {
    width = 240;
    height = 270;
  } else if (typeof size === 'number') {
    width = size;
    height = Math.round(size * 1.125);
  }

  // Accent colors based on state
  let glowColor = '#00f0ff'; // Cyber cyan default
  let coreStop1 = '#00f0ff';
  let coreStop2 = '#3b82f6';
  let eyeColor = '#00f0ff';

  if (state === 'error') {
    glowColor = '#ef4444';
    coreStop1 = '#f87171';
    coreStop2 = '#dc2626';
    eyeColor = '#ef4444';
  } else if (state === 'success') {
    glowColor = '#10b981';
    coreStop1 = '#34d399';
    coreStop2 = '#059669';
    eyeColor = '#34d399';
  } else if (state === 'warning' || state === 'waiting') {
    glowColor = '#f59e0b';
    coreStop1 = '#fbbf24';
    coreStop2 = '#d97706';
    eyeColor = '#fbbf24';
  } else if (state === 'analyzing') {
    glowColor = '#8b5cf6';
    coreStop1 = '#a78bfa';
    coreStop2 = '#00f0ff';
    eyeColor = '#a78bfa';
  } else if (state === 'running') {
    glowColor = '#00f0ff';
    coreStop1 = '#38bdf8';
    coreStop2 = '#2563eb';
    eyeColor = '#38bdf8';
  }

  // Eye geometry based on state
  let eyesMarkup = `
    <!-- Friendly smiling eye arcs -->
    <path d="M112 128 C116 118 132 118 136 128" fill="none" stroke="${eyeColor}" stroke-width="5" stroke-linecap="round" filter="url(#softGlow_${uid})" />
    <path d="M184 128 C188 118 204 118 208 128" fill="none" stroke="${eyeColor}" stroke-width="5" stroke-linecap="round" filter="url(#softGlow_${uid})" />
  `;

  if (state === 'analyzing') {
    eyesMarkup = `
      <!-- Scanning visor beam -->
      <rect x="104" y="125" width="112" height="6" rx="3" fill="${eyeColor}" filter="url(#softGlow_${uid})">
        <animate attributeName="x" values="104;114;104" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;1;0.8" dur="1.4s" repeatCount="indefinite" />
      </rect>
    `;
  } else if (state === 'error') {
    eyesMarkup = `
      <!-- Concerned / error eyes -->
      <line x1="116" y1="124" x2="132" y2="132" stroke="${eyeColor}" stroke-width="5" stroke-linecap="round" filter="url(#softGlow_${uid})" />
      <line x1="188" y1="132" x2="204" y2="124" stroke="${eyeColor}" stroke-width="5" stroke-linecap="round" filter="url(#softGlow_${uid})" />
    `;
  } else if (state === 'running') {
    eyesMarkup = `
      <!-- Active focused eyes -->
      <circle cx="124" cy="128" r="6" fill="${eyeColor}" filter="url(#softGlow_${uid})" />
      <circle cx="196" cy="128" r="6" fill="${eyeColor}" filter="url(#softGlow_${uid})" />
      <circle cx="126" cy="126" r="2" fill="#ffffff" />
      <circle cx="198" cy="126" r="2" fill="#ffffff" />
    `;
  }

  // Arm geometry: waving or resting
  const isWaving = state === 'waving' || state === 'idle' || size === 'hero';
  const rightArmMarkup = isWaving
    ? `<path d="M216 220 C228 215 238 205 244 195 C247 189 252 192 250 199 C246 211 234 235 220 238" fill="url(#bodyGrad_${uid})" stroke="#ffffff" stroke-width="2" class="robot-arm-wave" />`
    : `<path d="M218 225 C228 235 236 250 234 264 C233 272 226 274 222 268 C216 260 212 244 208 234" fill="url(#bodyGrad_${uid})" stroke="#ffffff" stroke-width="2" />`;

  return `
    <div class="robot-avatar-wrap robot-state-${state} ${className}" style="width:${width}px; height:${height}px; display:inline-flex; align-items:center; justify-content:center; position:relative; ${style}" data-robot-state="${state}">
      <svg width="100%" height="100%" viewBox="0 0 320 360" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block; overflow:visible;">
        <defs>
          <linearGradient id="bodyGrad_${uid}" x1="60" y1="40" x2="260" y2="340" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="65%" stop-color="#edf2fe" />
            <stop offset="100%" stop-color="#cbd5e1" />
          </linearGradient>
          <linearGradient id="visorGrad_${uid}" x1="100" y1="90" x2="220" y2="180" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#060913" />
            <stop offset="100%" stop-color="#0f172a" />
          </linearGradient>
          <linearGradient id="glowEar_${uid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${glowColor}" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
          <linearGradient id="neonCore_${uid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${coreStop1}" />
            <stop offset="100%" stop-color="${coreStop2}" />
          </linearGradient>
          <filter id="softGlow_${uid}" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <!-- Hover shadow -->
        <ellipse cx="160" cy="336" rx="56" ry="9" fill="${glowColor}" opacity="0.32" filter="url(#softGlow_${uid})" />

        <!-- Left Ear Pod -->
        <rect x="62" y="112" width="20" height="38" rx="8" fill="url(#bodyGrad_${uid})" stroke="#94a3b8" stroke-width="1.2" />
        <circle cx="72" cy="131" r="5" fill="url(#glowEar_${uid})" />

        <!-- Right Ear Pod -->
        <rect x="238" y="112" width="20" height="38" rx="8" fill="url(#bodyGrad_${uid})" stroke="#94a3b8" stroke-width="1.2" />
        <circle cx="248" cy="131" r="5" fill="url(#glowEar_${uid})" />

        <!-- Head Capsule -->
        <rect x="74" y="60" width="172" height="142" rx="71" fill="url(#bodyGrad_${uid})" stroke="#ffffff" stroke-width="2.5" />

        <!-- Sleek Glass Visor -->
        <rect x="92" y="86" width="136" height="88" rx="44" fill="url(#visorGrad_${uid})" stroke="rgba(255,255,255,0.15)" stroke-width="1" />

        <!-- Visor Eyes / Scanner -->
        ${eyesMarkup}

        <!-- Robot Torso -->
        <path d="M116 200 C116 200 102 216 102 260 C102 295 125 305 160 305 C195 305 218 295 218 260 C218 216 204 200 204 200 Z" fill="url(#bodyGrad_${uid})" stroke="#ffffff" stroke-width="2" />

        <!-- Chest Core Reactor -->
        <circle cx="160" cy="245" r="13" fill="#0f172a" stroke="#ffffff" stroke-width="1.8" />
        <circle cx="160" cy="245" r="8.5" fill="url(#neonCore_${uid})" filter="url(#softGlow_${uid})" class="robot-core-glow" />

        <!-- Left Arm -->
        <path d="M102 225 C92 235 84 250 86 264 C87 272 94 274 98 268 C104 260 108 244 112 234" fill="url(#bodyGrad_${uid})" stroke="#ffffff" stroke-width="2" />

        <!-- Right Arm -->
        ${rightArmMarkup}
      </svg>
    </div>
  `;
}

export const RobotAvatar = {
  render: renderRobotAvatar
};
