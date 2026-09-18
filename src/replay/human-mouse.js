/**
 * Workflow Capture — Human-like Mouse Movement & Keystroke Dynamics
 * 
 * Generates natural, stochastic cubic Bezier curve coordinates, dynamic acceleration,
 * micro-wobble offsets, and human typing cadence to defeat bot detection and captchas.
 */

/**
 * Generate random number in range [min, max]
 */
function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Generate Gaussian-distributed random number with given mean and standard deviation
 */
function randomGaussian(mean, stdev) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdev;
}

/**
 * Calculate stochastic delay with specified variance model
 */
function calculateDelay(minMs, maxMs, variance = 'uniform') {
  if (minMs >= maxMs) return minMs;
  if (variance === 'gaussian') {
    const mean = (minMs + maxMs) / 2;
    const stdev = (maxMs - minMs) / 4;
    const val = randomGaussian(mean, stdev);
    return Math.max(minMs, Math.min(maxMs, Math.round(val)));
  }
  return Math.round(randomInRange(minMs, maxMs));
}

/**
 * Calculate per-character typing delay considering punctuation and letter case
 */
function calculateTypingDelay(char, typingConfig = {}) {
  const minDelay = typingConfig.minTypingDelayMs || 40;
  const maxDelay = typingConfig.maxTypingDelayMs || 120;
  const punctuationPause = typingConfig.punctuationPauseMs || 200;
  const variance = typingConfig.variance || 'uniform';

  let delay = calculateDelay(minDelay, maxDelay, variance);

  // Natural human pause when encountering sentence punctuation or spaces
  if (char && /[.,!?;:\n]/.test(char)) {
    delay += punctuationPause + calculateDelay(20, 80);
  } else if (char === ' ') {
    delay += Math.round(minDelay * 0.8);
  } else if (char && char === char.toUpperCase() && /[A-Z]/.test(char)) {
    // Shift key hesitation
    delay += Math.round(minDelay * 0.4);
  }

  return delay;
}

/**
 * Generate Cubic Bezier Curve trajectory points
 * B(t) = (1-t)^3 * P0 + 3*(1-t)^2 * t * P1 + 3*(1-t) * t^2 * P2 + t^3 * P3
 */
function generateBezierPath(from, to, options = {}) {
  const steps = options.steps || 24;
  const wobble = options.wobble !== undefined ? options.wobble : 2;
  const overshoot = options.overshoot !== false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 5 || steps <= 1) {
    return [from, to];
  }

  // Calculate random control points with perpendicular deviation
  const deviation1 = randomInRange(-0.25, 0.25) * distance;
  const deviation2 = randomInRange(-0.25, 0.25) * distance;

  // Midpoint perpendicular vectors
  const p1 = {
    x: from.x + dx * 0.25 - dy * (deviation1 / (distance || 1)),
    y: from.y + dy * 0.25 + dx * (deviation1 / (distance || 1))
  };

  let p2 = {
    x: from.x + dx * 0.75 - dy * (deviation2 / (distance || 1)),
    y: from.y + dy * 0.75 + dx * (deviation2 / (distance || 1))
  };

  // Optional overshoot before settling on the target
  let finalTarget = { x: to.x, y: to.y };
  if (overshoot && distance > 60) {
    const overshootDist = randomInRange(3, 12);
    p2.x += (dx / distance) * overshootDist;
    p2.y += (dy / distance) * overshootDist;
  }

  const points = [];
  for (let i = 0; i <= steps; i++) {
    // Non-linear easing (ease-out cubic / sinusoidal)
    const t = i / steps;
    // EaseInOut formula for smooth human acceleration/deceleration
    const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const u = 1 - easedT;
    const tt = easedT * easedT;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * easedT;

    let x = uuu * from.x + 3 * uu * easedT * p1.x + 3 * u * tt * p2.x + ttt * finalTarget.x;
    let y = uuu * from.y + 3 * uu * easedT * p1.y + 3 * u * tt * p2.y + ttt * finalTarget.y;

    // Add tiny human hand micro-wobble towards middle of trajectory
    if (wobble > 0 && i > 2 && i < steps - 2) {
      const wobbleFactor = Math.sin(t * Math.PI) * wobble;
      x += randomInRange(-wobbleFactor, wobbleFactor);
      y += randomInRange(-wobbleFactor, wobbleFactor);
    }

    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  // Ensure exact final endpoint
  points[points.length - 1] = { x: Math.round(to.x), y: Math.round(to.y) };
  return points;
}

/**
 * Execute humanized mouse movement on Puppeteer Page
 */
async function moveMouseHumanlike(page, fromPoint, toPoint, mouseConfig = {}) {
  if (!page || !page.mouse) return;

  const points = generateBezierPath(fromPoint, toPoint, {
    steps: mouseConfig.steps || 22,
    wobble: mouseConfig.wobble ?? 2,
    overshoot: mouseConfig.overshoot ?? true
  });

  const stepDelayMs = mouseConfig.speed === 'slow' ? 14 : (mouseConfig.speed === 'fast' ? 4 : 8);

  for (const pt of points) {
    try {
      await page.mouse.move(pt.x, pt.y);
      if (stepDelayMs > 0) {
        await new Promise(r => setTimeout(r, stepDelayMs));
      }
    } catch {}
  }
}

module.exports = {
  randomInRange,
  randomGaussian,
  calculateDelay,
  calculateTypingDelay,
  generateBezierPath,
  moveMouseHumanlike
};
