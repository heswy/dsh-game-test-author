/**
 * Ember Drift canvas renderer.
 *
 * - DPR-aware backing store, capped at 2;
 * - full-viewport logical size, no internal letterbox or stage frame;
 * - palette read from CSS custom properties so light/dark follows DSH;
 * - procedural "hand-painted" sky, asteroids, skiff and stars (no images,
 *   fonts or network resources);
 * - platform overlay safe areas respected (HUD below 112px, no controls at the
 *   bottom-right 96x96).
 */

import { hash01 } from './rng.js';

const TAU = Math.PI * 2;
const DISPLAY_FONT = '"Palatino Linotype", Palatino, Georgia, "Songti SC", "Times New Roman", serif';
const BODY_FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const DEFAULT_PALETTE = {
  bg: '#140d12',
  stage: '#1a1017',
  ink: '#f7e8d6',
  muted: '#c2a690',
  ember: '#ff9b5e',
  emberStrong: '#ffd6a5',
  star: '#ffd27a',
  rose: '#f0708a',
  panel: 'rgba(36, 22, 27, 0.9)',
  line: 'rgba(255, 225, 190, 0.18)',
  nebulaA: 'rgba(214, 94, 58, 0.22)',
  nebulaB: 'rgba(94, 64, 132, 0.24)',
  moon: '#ffcf9f',
  moonGlow: 'rgba(255, 170, 100, 0.22)',
  horizon: 'rgba(90, 36, 40, 0.55)',
  paper: 'rgba(255, 235, 205, 0.055)',
  vignette: 'rgba(8, 4, 8, 0.55)',
  rockHi: '#7d5148',
  rockLo: '#2b1a24',
  rockLine: '#140c12',
  ship1: '#ffe0b0',
  ship2: '#dd7247',
  shipLine: 'rgba(70, 30, 20, 0.75)',
  hudShadow: 'rgba(10, 5, 8, 0.55)',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function formatNumber(value) {
  return String(Math.max(0, Math.round(Number(value) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function familyFor(name) {
  if (name === 'display') return DISPLAY_FONT;
  if (name === 'mono') return MONO_FONT;
  return BODY_FONT;
}

function colorForKind(palette, kind) {
  if (kind === 'rose') return palette.rose;
  if (kind === 'ember') return palette.ember;
  return palette.star;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const bgCanvas = document.createElement('canvas');
  const bgContext = bgCanvas.getContext('2d');
  let width = 960;
  let height = 540;
  let dpr = 1;
  let palette = { ...DEFAULT_PALETTE };
  let bgDirty = true;
  let grainPattern = null;

  function refreshPalette() {
    try {
      const style = getComputedStyle(canvas);
      const read = (name, fallback) => {
        const value = style.getPropertyValue(name).trim();
        return value || fallback;
      };
      palette = {
        bg: read('--bg', DEFAULT_PALETTE.bg),
        stage: read('--stage', DEFAULT_PALETTE.stage),
        ink: read('--ink', DEFAULT_PALETTE.ink),
        muted: read('--muted', DEFAULT_PALETTE.muted),
        ember: read('--ember', DEFAULT_PALETTE.ember),
        emberStrong: read('--ember-strong', DEFAULT_PALETTE.emberStrong),
        star: read('--star', DEFAULT_PALETTE.star),
        rose: read('--rose', DEFAULT_PALETTE.rose),
        panel: read('--panel', DEFAULT_PALETTE.panel),
        line: read('--line', DEFAULT_PALETTE.line),
        nebulaA: read('--nebula-a', DEFAULT_PALETTE.nebulaA),
        nebulaB: read('--nebula-b', DEFAULT_PALETTE.nebulaB),
        moon: read('--moon', DEFAULT_PALETTE.moon),
        moonGlow: read('--moon-glow', DEFAULT_PALETTE.moonGlow),
        horizon: read('--horizon', DEFAULT_PALETTE.horizon),
        paper: read('--paper', DEFAULT_PALETTE.paper),
        vignette: read('--vignette', DEFAULT_PALETTE.vignette),
        rockHi: read('--rock-hi', DEFAULT_PALETTE.rockHi),
        rockLo: read('--rock-lo', DEFAULT_PALETTE.rockLo),
        rockLine: read('--rock-line', DEFAULT_PALETTE.rockLine),
        ship1: read('--ship-1', DEFAULT_PALETTE.ship1),
        ship2: read('--ship-2', DEFAULT_PALETTE.ship2),
        shipLine: read('--ship-line', DEFAULT_PALETTE.shipLine),
        hudShadow: read('--hud-shadow', DEFAULT_PALETTE.hudShadow),
      };
    } catch (_error) {
      palette = { ...DEFAULT_PALETTE };
    }
    grainPattern = null;
    bgDirty = true;
  }

  function resize() {
    const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    const rawWidth = (rect && rect.width) || canvas.clientWidth || 960;
    const rawHeight = (rect && rect.height) || canvas.clientHeight || 540;
    width = Math.max(1, Math.round(rawWidth));
    height = Math.max(1, Math.round(rawHeight));
    const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    dpr = clamp(Number(ratio) || 1, 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    refreshPalette();
    return { width, height, dpr };
  }

  function getMetrics(shipX) {
    const scale = Math.min(width, height) / 540;
    const shipWidth = clamp(width * 0.052, 30, 64);
    const shipHeight = shipWidth * 0.78;
    const margin = shipWidth * 0.7 + 10;
    const usable = Math.max(1, width - margin * 2);
    return {
      x: margin + clamp(shipX, 0, 1) * usable,
      y: height * 0.815,
      width: shipWidth,
      height: shipHeight,
      scale,
      margin,
    };
  }

  // -------------------------------------------------------------------------
  // Painted background (cached until resize/theme change)
  // -------------------------------------------------------------------------

  function buildGrain() {
    const size = 128;
    const grain = document.createElement('canvas');
    grain.width = size;
    grain.height = size;
    const grainContext = grain.getContext('2d');
    let seed = 0x51f15e;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    grainContext.clearRect(0, 0, size, size);
    grainContext.fillStyle = palette.paper;
    for (let index = 0; index < 760; index += 1) {
      grainContext.globalAlpha = 0.12 + random() * 0.8;
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      grainContext.fillRect(x, y, 1, random() < 0.14 ? 2 : 1);
    }
    grainContext.globalAlpha = 1;
    grainPattern = bgContext.createPattern(grain, 'repeat');
  }

  function buildBackground() {
    bgCanvas.width = Math.max(1, Math.round(width * dpr));
    bgCanvas.height = Math.max(1, Math.round(height * dpr));
    bgContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgContext.clearRect(0, 0, width, height);
    if (!grainPattern) buildGrain();

    const minSide = Math.min(width, height);
    const maxSide = Math.max(width, height);

    const base = bgContext.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, palette.bg);
    base.addColorStop(0.56, palette.stage);
    base.addColorStop(1, palette.bg);
    bgContext.fillStyle = base;
    bgContext.fillRect(0, 0, width, height);

    const blobs = [
      { x: 0.16, y: 0.18, radius: 0.6, color: palette.nebulaA },
      { x: 0.84, y: 0.32, radius: 0.62, color: palette.nebulaB },
      { x: 0.52, y: 1.02, radius: 0.74, color: palette.nebulaA },
    ];
    for (const blob of blobs) {
      const grad = bgContext.createRadialGradient(
        blob.x * width,
        blob.y * height,
        0,
        blob.x * width,
        blob.y * height,
        maxSide * blob.radius
      );
      grad.addColorStop(0, blob.color);
      grad.addColorStop(0.58, blob.color);
      grad.addColorStop(1, 'transparent');
      bgContext.fillStyle = grad;
      bgContext.fillRect(0, 0, width, height);
    }

    // Long, loose brush strokes give the night its painted wash.
    bgContext.save();
    bgContext.lineCap = 'round';
    for (let index = 0; index < 24; index += 1) {
      const x0 = -0.12 * width + hash01(index * 7 + 1) * width * 1.2;
      const y0 = hash01(index * 11 + 3) * height;
      const cx = x0 + (hash01(index * 13 + 5) - 0.5) * width * 0.55;
      const cy = y0 + (hash01(index * 17 + 7) - 0.5) * height * 0.4;
      const x1 = x0 + (hash01(index * 19 + 9) - 0.2) * width * 0.68;
      const y1 = y0 + (hash01(index * 23 + 11) - 0.5) * height * 0.32;
      bgContext.strokeStyle = index % 2 === 0 ? palette.nebulaA : palette.nebulaB;
      bgContext.globalAlpha = 0.14 + hash01(index * 29 + 13) * 0.22;
      bgContext.lineWidth = 22 + hash01(index * 31 + 15) * 92;
      bgContext.beginPath();
      bgContext.moveTo(x0, y0);
      bgContext.quadraticCurveTo(cx, cy, x1, y1);
      bgContext.stroke();
    }
    bgContext.restore();

    // A warm moon low in the corner of the sky.
    const moonX = width * 0.79;
    const moonY = height * 0.23;
    const moonRadius = minSide * 0.135;
    const glow = bgContext.createRadialGradient(moonX, moonY, moonRadius * 0.18, moonX, moonY, moonRadius * 2.35);
    glow.addColorStop(0, palette.moon);
    glow.addColorStop(0.24, palette.moonGlow);
    glow.addColorStop(0.68, palette.moonGlow);
    glow.addColorStop(1, 'transparent');
    bgContext.globalAlpha = 0.52;
    bgContext.fillStyle = glow;
    bgContext.fillRect(0, 0, width, height);
    bgContext.globalAlpha = 0.19;
    bgContext.fillStyle = palette.moon;
    bgContext.beginPath();
    bgContext.arc(moonX, moonY, moonRadius, 0, TAU);
    bgContext.fill();
    bgContext.globalAlpha = 0.16;
    bgContext.strokeStyle = palette.moon;
    for (let ring = 0; ring < 3; ring += 1) {
      bgContext.lineWidth = 1 + ring * 0.6;
      bgContext.beginPath();
      bgContext.arc(
        moonX,
        moonY,
        moonRadius * (1.06 + ring * 0.08),
        Math.PI * (0.18 + ring * 0.07),
        Math.PI * (1.28 + ring * 0.1)
      );
      bgContext.stroke();
    }
    // Painted mottling inside the moon.
    for (let index = 0; index < 9; index += 1) {
      const angle = hash01(index * 41 + 21) * TAU;
      const distance = hash01(index * 43 + 23) * moonRadius * 0.72;
      bgContext.globalAlpha = 0.08 + hash01(index * 47 + 27) * 0.12;
      bgContext.fillStyle = palette.ember;
      bgContext.beginPath();
      bgContext.arc(
        moonX + Math.cos(angle) * distance,
        moonY + Math.sin(angle) * distance,
        moonRadius * (0.06 + hash01(index * 53 + 29) * 0.13),
        0,
        TAU
      );
      bgContext.fill();
    }

    // Horizon warmth, like a painted sea of embers below the play space.
    const horizon = bgContext.createLinearGradient(0, height * 0.58, 0, height);
    horizon.addColorStop(0, 'transparent');
    horizon.addColorStop(0.72, palette.horizon);
    horizon.addColorStop(1, palette.horizon);
    bgContext.globalAlpha = 0.75;
    bgContext.fillStyle = horizon;
    bgContext.fillRect(0, 0, width, height);
    bgContext.globalAlpha = 1;
    bgContext.save();
    bgContext.lineCap = 'round';
    bgContext.strokeStyle = palette.ember;
    bgContext.globalAlpha = 0.12;
    bgContext.lineWidth = 2;
    bgContext.beginPath();
    bgContext.moveTo(width * 0.04, height * 0.9);
    bgContext.quadraticCurveTo(width * 0.42, height * 0.86, width * 0.96, height * 0.92);
    bgContext.stroke();
    bgContext.restore();

    // Distant fixed stars: small, low contrast, lots of them.
    bgContext.globalAlpha = 1;
    for (let index = 0; index < 150; index += 1) {
      const x = hash01(index * 37 + 1) * width;
      const y = hash01(index * 53 + 7) * height * 0.9;
      const alpha = 0.05 + hash01(index * 59 + 11) * 0.4;
      const size = hash01(index * 61 + 13) < 0.1 ? 2 : 1;
      bgContext.globalAlpha = alpha;
      bgContext.fillStyle = palette.ink;
      bgContext.fillRect(Math.round(x), Math.round(y), size, size);
    }
    for (let index = 0; index < 8; index += 1) {
      const x = hash01(index * 71 + 17) * width;
      const y = hash01(index * 73 + 19) * height * 0.55;
      bgContext.globalAlpha = 0.1 + hash01(index * 79 + 23) * 0.2;
      bgContext.strokeStyle = palette.ink;
      bgContext.lineWidth = 1;
      bgContext.beginPath();
      bgContext.moveTo(x - 4, y);
      bgContext.lineTo(x + 4, y);
      bgContext.moveTo(x, y - 4);
      bgContext.lineTo(x, y + 4);
      bgContext.stroke();
    }

    if (grainPattern) {
      bgContext.globalAlpha = 1;
      bgContext.fillStyle = grainPattern;
      bgContext.fillRect(0, 0, width, height);
    }

    const vignette = bgContext.createRadialGradient(
      width / 2,
      height * 0.46,
      minSide * 0.18,
      width / 2,
      height * 0.5,
      maxSide * 0.78
    );
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(0.72, 'transparent');
    vignette.addColorStop(1, palette.vignette);
    bgContext.globalAlpha = 1;
    bgContext.fillStyle = vignette;
    bgContext.fillRect(0, 0, width, height);

    bgDirty = false;
  }

  // -------------------------------------------------------------------------
  // Atmosphere
  // -------------------------------------------------------------------------

  function drawTwinkles(now, reducedMotion) {
    context.save();
    for (let index = 0; index < 18; index += 1) {
      const x = hash01(index * 67 + 3) * width;
      const y = hash01(index * 71 + 5) * height * 0.72;
      const speed = 0.5 + hash01(index * 73 + 9) * 1.5;
      const twinkle = reducedMotion ? 0.55 : 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(now * speed + index * 0.9));
      context.globalAlpha = twinkle * 0.8;
      context.fillStyle = palette.ink;
      context.beginPath();
      context.arc(x, y, 0.8 + hash01(index * 79 + 11) * 1.1, 0, TAU);
      context.fill();
      if (index % 5 === 0) {
        context.globalAlpha = twinkle * 0.35;
        context.strokeStyle = palette.ink;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x - 4, y);
        context.lineTo(x + 4, y);
        context.moveTo(x, y - 4);
        context.lineTo(x, y + 4);
        context.stroke();
      }
    }
    context.restore();
  }

  function drawMotes(now, reducedMotion) {
    context.save();
    for (let index = 0; index < 28; index += 1) {
      const speed = 0.004 + hash01(index * 83 + 3) * 0.012;
      const baseY = hash01(index * 89 + 5);
      const baseX = hash01(index * 97 + 7);
      const y = reducedMotion ? baseY : ((baseY - now * speed) % 1 + 1) % 1;
      const x = reducedMotion ? baseX : (baseX + Math.sin(now * 0.25 + index) * 0.012 + 1) % 1;
      context.globalAlpha = 0.08 + hash01(index * 101 + 11) * 0.18;
      context.fillStyle = palette.ember;
      context.beginPath();
      context.arc(x * width, y * height, 0.7 + hash01(index * 103 + 13) * 1.6, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  // -------------------------------------------------------------------------
  // Gameplay objects
  // -------------------------------------------------------------------------

  function drawCollectibles(model) {
    const scale = Math.min(width, height) / 540;
    const now = model.now;
    const reducedMotion = model.reducedMotion === true;
    for (const star of model.state.stars) {
      const x = star.x * width;
      const y = star.y * height;
      const radius = clamp(star.r * scale, 3.5, 18);
      if (y < -radius * 4 || y > height + radius * 4) continue;
      const twinkle = reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(now * 3.1 + star.phase);
      context.save();

      // A soft halo, painted with broad low-alpha rings.
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3.8);
      glow.addColorStop(0, palette.star);
      glow.addColorStop(0.2, palette.star);
      glow.addColorStop(0.55, palette.moonGlow);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = 0.34 * twinkle;
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius * 3.8, 0, TAU);
      context.fill();

      // A warm trailing brush stroke.
      context.globalAlpha = 0.16;
      context.strokeStyle = palette.star;
      context.lineWidth = Math.max(1, radius * 0.16);
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(x - radius * 0.2, y + radius * 1.1);
      context.quadraticCurveTo(x + radius * 0.35, y + radius * 2.2, x - radius * 0.22, y + radius * 3.4);
      context.stroke();

      context.translate(x, y);
      context.rotate((reducedMotion ? 0.2 : now * 0.35) + star.phase * 0.25);
      context.beginPath();
      for (let point = 0; point < 8; point += 1) {
        const angle = (point * TAU) / 8 - Math.PI / 2;
        const pointRadius = point % 2 === 0 ? radius * (1.05 + 0.1 * (twinkle - 0.8)) : radius * 0.32;
        const px = Math.cos(angle) * pointRadius;
        const py = Math.sin(angle) * pointRadius;
        if (point === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.globalAlpha = 1;
      context.fillStyle = palette.star;
      context.fill();
      context.globalAlpha = 0.35;
      context.strokeStyle = palette.rockLine;
      context.lineWidth = Math.max(0.7, radius * 0.075);
      context.stroke();

      context.globalAlpha = 1;
      context.fillStyle = palette.emberStrong;
      context.beginPath();
      context.arc(0, 0, Math.max(1.2, radius * 0.2), 0, TAU);
      context.fill();
      context.restore();
    }
  }

  function drawAsteroids(model) {
    const scale = Math.min(width, height) / 540;
    const reducedMotion = model.reducedMotion === true;
    for (const asteroid of model.state.asteroids) {
      const radius = asteroid.r * scale;
      const x = asteroid.x * width;
      const y = asteroid.y * height;
      if (y < -radius * 2.5 || y > height + radius * 2.5) continue;

      if (!reducedMotion) {
        context.save();
        context.globalAlpha = 0.1;
        context.fillStyle = palette.ember;
        for (let ember = 0; ember < 2; ember += 1) {
          const drift = (hash01(asteroid.seed + ember * 17) - 0.5) * radius;
          context.beginPath();
          context.arc(x + drift, y - radius * (1.25 + ember * 0.42), Math.max(0.8, radius * (0.07 - ember * 0.03)), 0, TAU);
          context.fill();
        }
        context.restore();
      }

      context.save();
      context.translate(x, y);
      context.rotate(asteroid.rot);
      context.beginPath();
      const points = 9;
      for (let index = 0; index < points; index += 1) {
        const angle = (index / points) * TAU;
        const uneven = radius * (0.72 + hash01(asteroid.seed + index * 17) * 0.4);
        const px = Math.cos(angle) * uneven;
        const py = Math.sin(angle) * uneven;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();

      const rock = context.createRadialGradient(
        -radius * 0.35,
        -radius * 0.4,
        radius * 0.1,
        0,
        0,
        radius * 1.2
      );
      rock.addColorStop(0, palette.rockHi);
      rock.addColorStop(0.6, palette.rockLo);
      rock.addColorStop(1, palette.rockLine);
      context.fillStyle = rock;
      context.fill();
      context.strokeStyle = palette.rockLine;
      context.globalAlpha = 0.85;
      context.lineWidth = Math.max(1, radius * 0.06);
      context.stroke();
      context.globalAlpha = 1;

      for (let crater = 0; crater < 2; crater += 1) {
        const angle = hash01(asteroid.seed + 101 + crater * 31) * TAU;
        const distance = radius * (0.22 + hash01(asteroid.seed + 103 + crater * 37) * 0.38);
        const craterRadius = radius * (0.1 + hash01(asteroid.seed + 107 + crater * 41) * 0.15);
        const cx = Math.cos(angle) * distance;
        const cy = Math.sin(angle) * distance;
        context.globalAlpha = 0.55;
        context.fillStyle = palette.rockLine;
        context.beginPath();
        context.arc(cx, cy, craterRadius, 0, TAU);
        context.fill();
        context.globalAlpha = 0.3;
        context.strokeStyle = palette.rockHi;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(cx, cy, craterRadius * 0.82, Math.PI * 0.9, Math.PI * 1.8);
        context.stroke();
      }

      // A dry-brush highlight along one shoulder.
      context.globalAlpha = 0.5;
      context.strokeStyle = palette.rockHi;
      context.lineWidth = Math.max(1, radius * 0.08);
      context.lineCap = 'round';
      context.beginPath();
      context.arc(-radius * 0.08, -radius * 0.08, radius * 0.72, Math.PI * 1.05, Math.PI * 1.45);
      context.stroke();

      // A hot ember rim on the side facing the fall.
      context.globalAlpha = 0.32;
      context.strokeStyle = palette.ember;
      context.lineWidth = Math.max(1, radius * 0.07);
      context.beginPath();
      context.arc(0, 0, radius * 0.9, 0.38, 1.42);
      context.stroke();
      context.restore();
    }
  }

  function drawShip(model) {
    const { state, now, reducedMotion, phase } = model;
    const metrics = getMetrics(state.shipX);
    const x = metrics.x;
    const y = metrics.y;
    const w = metrics.width;
    const h = metrics.height;
    const scale = metrics.scale;
    const tilt = reducedMotion ? 0 : clamp(state.shipVx * 0.22, -0.3, 0.3);

    context.save();
    context.lineCap = 'round';
    for (let trail = 0; trail < 3; trail += 1) {
      context.globalAlpha = 0.18 - trail * 0.045;
      context.strokeStyle = palette.ember;
      context.lineWidth = Math.max(1, (3.2 - trail * 0.8) * scale);
      context.beginPath();
      context.moveTo(x + (trail - 1) * w * 0.1, y + h * 0.36);
      context.quadraticCurveTo(
        x - state.shipVx * 22 + trail * 4,
        y + h * 0.82,
        x - state.shipVx * 42 + trail * 6,
        y + h * 1.14
      );
      context.stroke();
    }
    context.restore();

    context.save();
    context.translate(x, y);
    context.rotate(tilt);

    const flicker = reducedMotion ? 1 : 0.78 + 0.22 * Math.sin(now * 26 + x * 0.02);
    const flame = context.createLinearGradient(0, h * 0.2, 0, h * 1.45);
    flame.addColorStop(0, palette.star);
    flame.addColorStop(0.5, palette.ember);
    flame.addColorStop(1, 'transparent');
    context.globalAlpha = 0.9;
    context.fillStyle = flame;
    context.beginPath();
    context.moveTo(-w * 0.16, h * 0.28);
    context.quadraticCurveTo(-w * 0.08, h * (0.55 + 0.45 * flicker), 0, h * (0.82 + 0.6 * flicker));
    context.quadraticCurveTo(w * 0.08, h * (0.55 + 0.45 * flicker), w * 0.16, h * 0.28);
    context.closePath();
    context.fill();
    context.globalAlpha = 0.75;
    context.fillStyle = palette.emberStrong;
    context.beginPath();
    context.moveTo(-w * 0.07, h * 0.3);
    context.quadraticCurveTo(-w * 0.03, h * (0.5 + 0.3 * flicker), 0, h * (0.6 + 0.35 * flicker));
    context.quadraticCurveTo(w * 0.035, h * (0.5 + 0.3 * flicker), w * 0.07, h * 0.3);
    context.closePath();
    context.fill();

    const hull = context.createLinearGradient(0, -h * 0.65, 0, h * 0.42);
    hull.addColorStop(0, palette.ship1);
    hull.addColorStop(0.58, palette.ship1);
    hull.addColorStop(1, palette.ship2);
    context.beginPath();
    context.moveTo(0, -h * 0.62);
    context.bezierCurveTo(w * 0.34, -h * 0.32, w * 0.5, h * 0.02, w * 0.3, h * 0.36);
    context.lineTo(0, h * 0.22);
    context.lineTo(-w * 0.3, h * 0.36);
    context.bezierCurveTo(-w * 0.5, h * 0.02, -w * 0.34, -h * 0.32, 0, -h * 0.62);
    context.closePath();
    context.fillStyle = hull;
    context.fill();
    context.strokeStyle = palette.shipLine;
    context.lineWidth = Math.max(1.4, w * 0.045);
    context.stroke();

    // Painted sail highlights.
    context.globalAlpha = 0.55;
    context.strokeStyle = palette.ship1;
    context.lineWidth = Math.max(1, w * 0.026);
    context.beginPath();
    context.moveTo(-w * 0.04, -h * 0.4);
    context.quadraticCurveTo(-w * 0.3, -h * 0.06, -w * 0.2, h * 0.3);
    context.stroke();
    context.globalAlpha = 0.3;
    context.beginPath();
    context.moveTo(w * 0.03, -h * 0.36);
    context.quadraticCurveTo(w * 0.22, -h * 0.06, w * 0.16, h * 0.22);
    context.stroke();

    // Cockpit glow.
    context.save();
    context.shadowColor = palette.star;
    context.shadowBlur = reducedMotion ? 0 : 12;
    context.fillStyle = palette.star;
    context.beginPath();
    context.ellipse(0, -h * 0.18, w * 0.11, h * 0.15, 0, 0, TAU);
    context.fill();
    context.restore();
    context.globalAlpha = 0.5;
    context.strokeStyle = palette.shipLine;
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(0, -h * 0.18, w * 0.11, h * 0.15, 0, 0, TAU);
    context.stroke();

    if (state.invuln > 0 && phase === 'playing') {
      context.globalAlpha = reducedMotion ? 0.42 : 0.34 + 0.24 * Math.sin(now * 9);
      context.strokeStyle = palette.emberStrong;
      context.lineWidth = 1.5;
      context.setLineDash([4, 7]);
      context.lineDashOffset = reducedMotion ? 0 : -now * 16;
      context.beginPath();
      context.ellipse(0, -h * 0.06, w * 0.78, h * 0.82, 0, 0, TAU);
      context.stroke();
      context.setLineDash([]);
    }
    context.restore();
  }

  function drawParticles(model) {
    const scale = Math.min(width, height) / 540;
    for (const particle of model.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const x = particle.x * width;
      const y = particle.y * height;
      const radius = Math.max(0.6, particle.r * scale * (0.5 + 0.5 * alpha));
      context.save();
      context.globalAlpha = alpha * 0.9;
      context.fillStyle = colorForKind(palette, particle.kind);
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      if (particle.kind === 'star' && radius > 2) {
        context.globalAlpha = alpha * 0.35;
        context.fillStyle = palette.emberStrong;
        context.beginPath();
        context.arc(x, y, radius * 0.35, 0, TAU);
        context.fill();
      }
      context.restore();
    }
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  function hudScale() {
    return clamp(Math.min(width / 960, height / 540), 0.78, 1.15);
  }

  function drawHeart(cx, cy, size, filled) {
    context.save();
    context.translate(cx, cy);
    context.beginPath();
    context.moveTo(0, size * 0.4);
    context.bezierCurveTo(-size * 0.95, -size * 0.22, -size * 0.56, -size * 0.9, 0, -size * 0.36);
    context.bezierCurveTo(size * 0.56, -size * 0.9, size * 0.95, -size * 0.22, 0, size * 0.4);
    context.closePath();
    if (filled) {
      context.globalAlpha = 0.9;
      context.fillStyle = palette.ember;
      context.fill();
    } else {
      context.globalAlpha = 0.45;
      context.strokeStyle = palette.muted;
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();
  }

  function drawHud(model) {
    if (model.phase !== 'playing') return;
    const s = hudScale();
    const { state, best, i18n } = model;
    const margin = 20 * Math.max(0.9, s);

    context.save();
    context.shadowColor = palette.hudShadow;
    context.shadowBlur = 9 * s;
    context.textBaseline = 'middle';

    context.textAlign = 'left';
    context.fillStyle = palette.muted;
    context.font = `600 ${11 * s}px ${BODY_FONT}`;
    context.fillText(i18n.t('score').toUpperCase(), margin, 127);

    const scoreText = formatNumber(state.score);
    context.fillStyle = palette.ink;
    context.font = `700 ${31 * s}px ${DISPLAY_FONT}`;
    context.fillText(scoreText, margin, 152);
    const scoreWidth = context.measureText(scoreText).width;
    context.shadowBlur = 0;
    context.globalAlpha = 0.45;
    context.strokeStyle = palette.ember;
    context.lineWidth = 2 * s;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(margin + 1, 169);
    context.quadraticCurveTo(margin + scoreWidth * 0.5 + 4, 166, margin + scoreWidth + 5, 168);
    context.stroke();
    context.globalAlpha = 1;

    context.shadowBlur = 7 * s;
    context.fillStyle = palette.muted;
    context.font = `500 ${10.5 * s}px ${BODY_FONT}`;
    context.fillText(`${i18n.t('best').toUpperCase()}  ${best === null || best === undefined ? '—' : formatNumber(best)}`, margin, 186);

    for (let heart = 0; heart < 3; heart += 1) {
      drawHeart(margin + 9 * s + heart * 19 * s, 205, 8.5 * s, heart < state.lives);
    }

    context.textAlign = 'right';
    context.fillStyle = palette.muted;
    context.font = `600 ${11 * s}px ${BODY_FONT}`;
    context.fillText(i18n.t('time').toUpperCase(), width - margin, 127);

    const urgent = state.timeLeft <= 10;
    context.fillStyle = urgent ? palette.rose : palette.ink;
    context.font = `700 ${28 * s}px ${DISPLAY_FONT}`;
    context.fillText(formatClock(state.timeLeft), width - margin, 152);

    context.shadowBlur = 0;
    const barWidth = Math.min(150 * s, width * 0.24);
    const barX = width - margin - barWidth;
    const barY = 170;
    context.lineCap = 'round';
    context.lineWidth = 3 * s;
    context.strokeStyle = palette.line;
    context.beginPath();
    context.moveTo(barX, barY);
    context.lineTo(width - margin, barY);
    context.stroke();
    const ratio = clamp(state.timeLeft / 120, 0, 1);
    context.strokeStyle = urgent ? palette.rose : palette.ember;
    context.beginPath();
    context.moveTo(barX, barY);
    context.lineTo(barX + Math.max(2, barWidth * ratio), barY);
    context.stroke();

    context.shadowBlur = 7 * s;
    context.textAlign = 'right';
    context.font = `600 ${10.5 * s}px ${BODY_FONT}`;
    context.fillStyle = state.streak > 1 ? palette.star : palette.muted;
    context.fillText(`${i18n.t('streak').toUpperCase()} ×${state.streak}`, width - margin, 190);

    context.restore();
  }

  // -------------------------------------------------------------------------
  // Panels, overlays and toasts
  // -------------------------------------------------------------------------

  function wrapText(text, maxWidth) {
    const source = String(text || '');
    if (!source) return [''];
    if (context.measureText(source).width <= maxWidth) return [source];
    const lines = [];
    let line = '';
    for (const character of source) {
      const next = line + character;
      if (context.measureText(next).width > maxWidth && line) {
        lines.push(line.trimEnd());
        line = character === ' ' ? '' : character;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line.trimEnd());
    return lines.length > 0 ? lines : [source];
  }

  function drawPanelBlocks(blocks) {
    const s = hudScale();
    const maxWidth = Math.min(width - 36, 570);
    const padX = 28 * s;
    const padY = 23 * s;
    const innerWidth = Math.max(80, maxWidth - padX * 2);
    const prepared = [];
    let contentHeight = 0;

    for (const block of blocks) {
      const size = block.size * s;
      context.font = `${block.weight || 500} ${size}px ${familyFor(block.font)}`;
      const lines = wrapText(block.text, innerWidth);
      const lineHeight = size * 1.22;
      const gap = (block.gapBefore || 0) * s;
      contentHeight += gap + lines.length * lineHeight;
      prepared.push({ block, lines, size, lineHeight, gap });
    }

    const panelHeight = Math.max(112 * s, contentHeight + padY * 2);
    const panelX = (width - maxWidth) / 2;
    let panelY = (height - panelHeight) / 2;
    panelY = Math.max(116, panelY);
    if (panelY + panelHeight > height - 52) {
      panelY = Math.max(112, height - 52 - panelHeight);
    }

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.3)';
    context.shadowBlur = 26 * s;
    context.fillStyle = palette.panel;
    roundRect(context, panelX, panelY, maxWidth, panelHeight, 20 * s);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = palette.line;
    context.lineWidth = 1.2;
    context.stroke();
    context.globalAlpha = 0.55;
    roundRect(context, panelX + 4, panelY + 4, maxWidth - 8, panelHeight - 8, 16 * s);
    context.strokeStyle = palette.line;
    context.lineWidth = 0.8;
    context.stroke();
    context.globalAlpha = 1;

    // Two tiny ember diamonds as a painter's signature.
    for (const direction of [-1, 1]) {
      const cx = width / 2 + direction * 42 * s;
      const cy = panelY + panelHeight - 9 * s;
      context.save();
      context.translate(cx, cy);
      context.rotate(Math.PI / 4);
      context.globalAlpha = 0.55;
      context.fillStyle = palette.ember;
      context.fillRect(-2.2 * s, -2.2 * s, 4.4 * s, 4.4 * s);
      context.restore();
    }

    let cursorY = panelY + padY;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const item of prepared) {
      cursorY += item.gap;
      context.font = `${item.block.weight || 500} ${item.size}px ${familyFor(item.block.font)}`;
      context.fillStyle = item.block.color || palette.ink;
      for (const line of item.lines) {
        context.fillText(line, width / 2, cursorY);
        cursorY += item.lineHeight;
      }
      if (item.block.underline) {
        context.globalAlpha = 0.5;
        context.strokeStyle = palette.ember;
        context.lineWidth = 2 * s;
        context.lineCap = 'round';
        context.beginPath();
        const underlineY = cursorY - item.lineHeight * 0.35;
        context.moveTo(width / 2 - 34 * s, underlineY);
        context.quadraticCurveTo(width / 2, underlineY - 3 * s, width / 2 + 34 * s, underlineY);
        context.stroke();
        context.globalAlpha = 1;
      }
    }
    context.restore();
  }

  function drawOverlay(model) {
    const s = hudScale();
    const { phase, i18n, state, best } = model;
    if (phase === 'playing') return;

    if (phase === 'loading') {
      drawPanelBlocks([
        { text: i18n.t('title').toUpperCase(), size: 38, font: 'display', weight: 700, color: palette.ink, underline: true },
        { text: i18n.t('loading'), size: 13, font: 'body', weight: 500, color: palette.muted, gapBefore: 16 },
      ]);
      return;
    }

    if (phase === 'ready') {
      const blocks = [
        { text: i18n.t('title').toUpperCase(), size: 40, font: 'display', weight: 700, color: palette.ink, underline: true },
        { text: i18n.t('kicker'), size: 12.5, font: 'body', weight: 500, color: palette.muted, gapBefore: 9 },
        {
          text: model.canContinue ? i18n.t('readyContinue') : i18n.t('readyNew'),
          size: 13.5,
          font: 'body',
          weight: 500,
          color: palette.ink,
          gapBefore: 19,
        },
        { text: i18n.t('readyGoal'), size: 12.5, font: 'body', weight: 400, color: palette.muted, gapBefore: 7 },
      ];
      if (best !== null && best !== undefined) {
        blocks.push({
          text: `${i18n.t('best').toUpperCase()}  ${formatNumber(best)}`,
          size: 10.5,
          font: 'body',
          weight: 500,
          color: palette.muted,
          gapBefore: 10,
        });
      }
      blocks.push({
        text: model.canContinue ? i18n.t('continueHint') : i18n.t('startHint'),
        size: 14,
        font: 'body',
        weight: 700,
        color: palette.emberStrong,
        gapBefore: 17,
      });
      if (model.canContinue) {
        blocks.push({
          text: i18n.t('newHint'),
          size: 11.5,
          font: 'body',
          weight: 500,
          color: palette.muted,
          gapBefore: 7,
        });
      }
      drawPanelBlocks(blocks);
      return;
    }

    if (phase === 'paused') {
      drawPanelBlocks([
        { text: i18n.t('paused').toUpperCase(), size: 34, font: 'display', weight: 700, color: palette.ink, underline: true },
        { text: i18n.t('pausedBody'), size: 13, font: 'body', weight: 500, color: palette.muted, gapBefore: 10 },
        {
          text: `${i18n.t('score').toUpperCase()}  ${formatNumber(state.score)}    ${i18n.t('time').toUpperCase()}  ${formatClock(state.timeLeft)}`,
          size: 12,
          font: 'mono',
          weight: 600,
          color: palette.ink,
          gapBefore: 15,
        },
        { text: i18n.t('resumeHint'), size: 13.5, font: 'body', weight: 700, color: palette.emberStrong, gapBefore: 13 },
      ]);
      return;
    }

    if (phase === 'over') {
      const lost = state.outcome === 'lost';
      const blocks = [
        {
          text: (lost ? i18n.t('lostTitle') : i18n.t('completeTitle')).toUpperCase(),
          size: 34,
          font: 'display',
          weight: 700,
          color: lost ? palette.rose : palette.ink,
          underline: true,
        },
        {
          text: lost ? i18n.t('lostBody') : i18n.t('completeBody'),
          size: 12.5,
          font: 'body',
          weight: 500,
          color: palette.muted,
          gapBefore: 9,
        },
        {
          text: i18n.t('finalScore').toUpperCase(),
          size: 10.5,
          font: 'body',
          weight: 600,
          color: palette.muted,
          gapBefore: 16,
        },
        {
          text: formatNumber(state.score),
          size: 46,
          font: 'display',
          weight: 700,
          color: palette.emberStrong,
          gapBefore: 2,
        },
        {
          text: `${i18n.t('bestScore').toUpperCase()}  ${
            best === null || best === undefined ? '—' : formatNumber(best)
          }    ·    ${i18n.t('starsCollected').toUpperCase()}  ${formatNumber(state.starsCollected)}`,
          size: 11,
          font: 'body',
          weight: 500,
          color: palette.ink,
          gapBefore: 8,
        },
        { text: i18n.t('restartHint'), size: 13.5, font: 'body', weight: 700, color: palette.emberStrong, gapBefore: 14 },
      ];
      drawPanelBlocks(blocks);
      return;
    }

    if (phase === 'error') {
      drawPanelBlocks([
        { text: i18n.t('errorTitle').toUpperCase(), size: 32, font: 'display', weight: 700, color: palette.rose, underline: true },
        {
          text: i18n.t('readyFailed', { code: model.errorCode || 'GM-5000' }),
          size: 12.5,
          font: 'body',
          weight: 500,
          color: palette.ink,
          gapBefore: 14,
        },
        ...(model.errorMessage
          ? [{ text: model.errorMessage, size: 10.5, font: 'mono', weight: 400, color: palette.muted, gapBefore: 7 }]
          : []),
        { text: i18n.t('reloadHint'), size: 12.5, font: 'body', weight: 700, color: palette.emberStrong, gapBefore: 14 },
      ]);
    }
    void s;
  }

  function truncateText(text, maxWidth) {
    const source = String(text);
    if (context.measureText(source).width <= maxWidth) return source;
    let output = source;
    while (output.length > 1 && context.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
    return `${output}…`;
  }

  function drawToast() {
    if (!toastText()) return;
    const text = toastText();
    const isError = toastError();
    const s = hudScale();
    const maxWidth = Math.max(120, width - 160);
    context.save();
    context.font = `500 ${11.5 * s}px ${BODY_FONT}`;
    const label = truncateText(text, maxWidth - 24);
    const boxWidth = Math.min(maxWidth, context.measureText(label).width + 24);
    const boxX = 16;
    const boxY = Math.max(212, height - 104);
    context.fillStyle = palette.panel;
    roundRect(context, boxX, boxY, boxWidth, 28 * Math.max(0.9, s), 9);
    context.fill();
    context.strokeStyle = isError ? palette.rose : palette.line;
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = isError ? palette.rose : palette.emberStrong;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(label, boxX + 12, boxY + 14 * Math.max(0.9, s));
    context.restore();
  }

  // The toast data lives in the model; these tiny accessors make the draw
  // functions above easy to read without threading two more parameters.
  let currentToast = '';
  let currentToastError = false;
  function toastText() {
    return currentToast;
  }
  function toastError() {
    return currentToastError;
  }

  // -------------------------------------------------------------------------
  // Public draw
  // -------------------------------------------------------------------------

  function draw(model) {
    currentToast = model.toast || '';
    currentToastError = model.toastIsError === true;
    if (bgDirty) buildBackground();
    const now = model.now || 0;
    const reducedMotion = model.reducedMotion === true;

    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(bgCanvas, 0, 0, width, height);

    drawTwinkles(now, reducedMotion);
    drawMotes(now, reducedMotion);

    const shakeAmount = reducedMotion ? 0 : model.shake || 0;
    const shakeX = Math.sin(now * 67) * shakeAmount * 9;
    const shakeY = Math.cos(now * 74) * shakeAmount * 7;
    context.save();
    context.translate(shakeX, shakeY);
    drawCollectibles(model);
    drawAsteroids(model);
    drawShip(model);
    drawParticles(model);
    context.restore();

    drawHud(model);
    drawOverlay(model);
    drawToast();
    context.restore();
  }

  return {
    resize,
    draw,
    refreshPalette,
    getSize() {
      return { width, height, dpr };
    },
    getMetrics,
  };
}
