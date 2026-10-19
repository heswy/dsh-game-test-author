/**
 * Ember Drift — Game SDK v1 integration.
 *
 *   1. `await game.ready()` before the loop, visible error state on failure;
 *   2. pure synchronous serialize/deserialize (storage.js) for Continue;
 *   3. lifecycle pause/resume/before-save; paused time never enters game clocks;
 *   4. visibilitychange/blur auto-pause handling;
 *   5. keyboard controls (Tab and Escape deliberately untouched);
 *   6. resize + DPR handling in render.js; full-viewport canvas;
 *   7. no network, no external resources, system fonts only;
 *   8. score.submit at the end with visible GM-4006 handling;
 *   9. zh/en copy in i18n.js;
 *  10. Local Runtime Simulator through scripts/dev.mjs.
 */

import { createInitialState, deserializeState, serializeState, RUN_SECONDS } from './storage.js';
import { createI18n } from './i18n.js';
import { createRenderer } from './render.js';
import { nextRandom } from './rng.js';

const canvas = document.getElementById('game');
const hintEl = document.getElementById('hint');
const announcer = document.getElementById('announcer');
const sdk = globalThis.DSH_GAME_SDK;
if (!sdk) {
  throw new Error('DSH_GAME_SDK is missing; build with `npm run build` from the official template.');
}

const game = sdk.createGameSDK();
const renderer = createRenderer(canvas);

const TAU = Math.PI * 2;
const MAX_ASTEROIDS = 22;
const MAX_STARS = 12;
const AUTOSAVE_SECONDS = 2.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

let i18n = createI18n('en');
let state = createInitialState();
let phase = 'loading'; // loading | ready | playing | paused | over | error
let best = null;
let canContinue = false;
let sessionActive = false;
let running = false;
let rafId = 0;
let lastTs = 0;
let saveInFlight = null;
let saveQueued = false;
let saveClock = 0;
let toast = '';
let toastIsError = false;
let toastTimer = null;
let errorCode = '';
let errorMessage = '';
let lastAnnouncedPhase = '';
let theme = 'dark';
let reducedMotion = false;
let particles = [];
let shake = 0;
let inputDir = 0;
let watchTimer = 0;
const keys = { left: false, right: false };

// ---------------------------------------------------------------------------
// Presentation / status
// ---------------------------------------------------------------------------

function applyTheme(nextTheme) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  renderer.refreshPalette();
}

function syncRuntime() {
  if (!game.runtime) return false;
  let changed = false;
  const runtimeTheme = game.runtime.theme;
  if ((runtimeTheme === 'light' || runtimeTheme === 'dark') && runtimeTheme !== theme) {
    applyTheme(runtimeTheme);
    changed = true;
  }
  if (typeof game.runtime.reducedMotion === 'boolean' && game.runtime.reducedMotion !== reducedMotion) {
    reducedMotion = game.runtime.reducedMotion;
    changed = true;
  }
  return changed;
}

function setToast(text, isError, ttl = 2600) {
  toast = text;
  toastIsError = isError;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (text) {
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = '';
      render();
    }, ttl);
  }
  render();
}

function updateHint() {
  const hints = {
    loading: i18n.t('hintLoading'),
    ready: canContinue ? i18n.t('hintReadyContinue') : i18n.t('hintReady'),
    playing: i18n.t('hintPlaying'),
    paused: i18n.t('hintPaused'),
    over: i18n.t('hintOver'),
    error: i18n.t('hintError'),
  };
  const text = hints[phase] || '';
  if (hintEl.textContent !== text) hintEl.textContent = text;

  const token = `${phase}:${canContinue}`;
  if (token !== lastAnnouncedPhase) {
    lastAnnouncedPhase = token;
    let message = `${i18n.t('title')} — ${text}`;
    if (phase === 'over') message = i18n.t('ariaOver', { score: Math.round(state.score) });
    else if (phase === 'paused') message = i18n.t('ariaPaused');
    else if (phase === 'ready' && canContinue) message = i18n.t('ariaContinue');
    announcer.textContent = message;
  }
}

function render() {
  renderer.draw({
    state,
    phase,
    i18n,
    best,
    canContinue,
    reducedMotion,
    toast,
    toastIsError,
    errorCode,
    errorMessage,
    particles,
    shake,
    inputDir,
    now: performance.now() / 1000,
  });
  updateHint();
}

// ---------------------------------------------------------------------------
// Loop. `lastTs` resets on resume so paused time never becomes game time.
// ---------------------------------------------------------------------------

function startLoop() {
  if (running) return;
  running = true;
  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function tick(timestamp) {
  if (!running) return;
  const dt = Math.min(0.05, Math.max(0, (timestamp - lastTs) / 1000));
  lastTs = timestamp;
  if (phase === 'playing') {
    update(dt);
    if (phase !== 'playing') {
      render();
      return;
    }
  }
  syncRuntime();
  render();
  rafId = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Gameplay
// ---------------------------------------------------------------------------

function difficulty() {
  return clamp(state.elapsed / RUN_SECONDS, 0, 1);
}

function resetAsteroidTimer() {
  const d = difficulty();
  state.spawnAsteroidIn = lerp(1.18, 0.46, d) * (0.82 + nextRandom(state) * 0.36);
}

function resetStarTimer() {
  const d = difficulty();
  state.spawnStarIn = lerp(0.96, 0.66, d) * (0.84 + nextRandom(state) * 0.32);
}

function spawnAsteroid() {
  if (state.asteroids.length >= MAX_ASTEROIDS) return;
  const d = difficulty();
  state.asteroids.push({
    id: state.nextId++,
    x: 0.07 + nextRandom(state) * 0.86,
    y: -0.12 - nextRandom(state) * 0.1,
    vy: 0.12 + d * 0.16 + nextRandom(state) * 0.08,
    r: 11 + nextRandom(state) * 11 + d * 10,
    rot: nextRandom(state) * TAU,
    spin: (nextRandom(state) - 0.5) * 1.5,
    seed: (nextRandom(state) * 4294967296) >>> 0,
  });
}

function spawnStar() {
  if (state.stars.length >= MAX_STARS) return;
  const d = difficulty();
  state.stars.push({
    id: state.nextId++,
    x: 0.07 + nextRandom(state) * 0.86,
    y: -0.08 - nextRandom(state) * 0.06,
    vy: 0.09 + d * 0.05 + nextRandom(state) * 0.04,
    r: 6 + nextRandom(state) * 4.5,
    phase: nextRandom(state) * TAU,
  });
}

function spawnBurst(x, y, count, kind, power = 1) {
  const amount = reducedMotion ? Math.ceil(count * 0.45) : count;
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.random() * TAU;
    const speed = (0.035 + Math.random() * 0.16) * power;
    const life = 0.35 + Math.random() * 0.6;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.72 - 0.02,
      life,
      maxLife: life,
      r: 1.2 + Math.random() * 3.2,
      kind,
    });
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}

function updateParticles(dt) {
  const survivors = [];
  for (const particle of particles) {
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 0.16 * dt;
    particle.vx *= Math.max(0, 1 - 1.6 * dt);
    survivors.push(particle);
  }
  particles = survivors;
}

function collectStar(star, metrics, scale) {
  state.starsCollected += 1;
  state.score += 10 * state.streak;
  state.streak = Math.min(5, state.streak + 1);
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  spawnBurst(star.x, star.y, 8, 'star', 0.8);
  if (!reducedMotion) shake = Math.min(0.5, shake + 0.04);
}

function hitAsteroid(asteroid, metrics, scale) {
  if (state.invuln > 0) return false;
  state.lives -= 1;
  state.invuln = 2.2;
  state.streak = 1;
  shake = Math.min(1.2, shake + 0.7);
  spawnBurst(asteroid.x, asteroid.y, 20, 'rose', 1.35);
  if (state.lives <= 0) {
    state.lives = 0;
    finishGame('lost');
  }
  return true;
}

function update(dt) {
  state.elapsed = Math.min(RUN_SECONDS, state.elapsed + dt);
  state.timeLeft = Math.max(0, RUN_SECONDS - state.elapsed);
  if (state.timeLeft <= 0) {
    finishGame('complete');
    return;
  }

  const acceleration = 5.4;
  const maxSpeed = 1.18;
  if (inputDir !== 0) state.shipVx += inputDir * acceleration * dt;
  else state.shipVx *= Math.max(0, 1 - 10 * dt);
  state.shipVx = clamp(state.shipVx, -maxSpeed, maxSpeed);
  state.shipX = clamp(state.shipX + state.shipVx * dt, 0, 1);
  if (state.shipX <= 0 || state.shipX >= 1) state.shipVx = 0;

  state.invuln = Math.max(0, state.invuln - dt);

  state.spawnAsteroidIn -= dt;
  if (state.spawnAsteroidIn <= 0) {
    spawnAsteroid();
    resetAsteroidTimer();
  }
  state.spawnStarIn -= dt;
  if (state.spawnStarIn <= 0) {
    spawnStar();
    resetStarTimer();
  }

  const { width, height } = renderer.getSize();
  const metrics = renderer.getMetrics(state.shipX);
  const scale = metrics.scale;
  const shipRx = metrics.width * 0.26 + 2;
  const shipRy = metrics.height * 0.3 + 2;

  const survivingAsteroids = [];
  for (const asteroid of state.asteroids) {
    asteroid.y += asteroid.vy * dt;
    asteroid.rot += asteroid.spin * dt;
    if (asteroid.y * height - asteroid.r * scale > height + 48) continue;
    if (state.invuln <= 0) {
      const ax = asteroid.x * width;
      const ay = asteroid.y * height;
      const ar = asteroid.r * scale * 0.78;
      const dx = (ax - metrics.x) / (shipRx + ar);
      const dy = (ay - metrics.y) / (shipRy + ar);
      if (dx * dx + dy * dy < 1) {
        hitAsteroid(asteroid, metrics, scale);
        if (phase !== 'playing') return;
        continue;
      }
    }
    survivingAsteroids.push(asteroid);
  }
  state.asteroids = survivingAsteroids;

  const survivingStars = [];
  for (const star of state.stars) {
    star.y += star.vy * dt;
    if (star.y * height - star.r * scale > height + 24) continue;
    const sx = star.x * width;
    const sy = star.y * height;
    const reach = star.r * scale + metrics.width * 0.34;
    const dx = (sx - metrics.x) / reach;
    const dy = (sy - metrics.y) / reach;
    if (dx * dx + dy * dy < 1) {
      collectStar(star, metrics, scale);
      continue;
    }
    survivingStars.push(star);
  }
  state.stars = survivingStars;

  updateParticles(dt);
  shake = Math.max(0, shake - dt * 2.4);

  saveClock += dt;
  if (saveClock >= AUTOSAVE_SECONDS) {
    saveClock = 0;
    saveNow();
  }
}

// ---------------------------------------------------------------------------
// Run transitions
// ---------------------------------------------------------------------------

function clearSavedRun() {
  const pending = saveInFlight;
  const remove = () => {
    game.storage.remove('current').catch(() => {});
  };
  if (pending) pending.catch(() => {}).then(remove);
  else remove();
}

function finishGame(outcome) {
  if (phase !== 'playing') return;
  phase = 'over';
  state.gameOver = true;
  state.outcome = outcome;
  state.shipVx = 0;
  stopLoop();
  inputDir = 0;
  keys.left = false;
  keys.right = false;
  saveClock = 0;
  clearSavedRun();

  const finalScore = Math.max(0, Math.round(state.score));
  render();

  game.score
    .submit(finalScore, {
      stars: state.starsCollected,
      bestStreak: state.bestStreak,
      outcome,
      seconds: Math.round(state.elapsed),
    })
    .then((result) => {
      if (result && typeof result.best === 'number') best = result.best;
      else if (best === null || finalScore > best) best = finalScore;
      render();
    })
    .catch((error) => {
      if (error && error.code === 'GM-4006') {
        setToast(i18n.t('scoreRange', { code: error.code }), true, 5200);
      } else if (!error || error.code !== 'GM-4032') {
        setToast(i18n.t('saveFailed', { code: error && error.code ? error.code : 'GM-5000' }), true, 4200);
      }
    })
    .finally(() => {
      game.session
        .end({ outcome: outcome === 'complete' ? 'completed' : 'lost', score: finalScore })
        .catch(() => {})
        .finally(() => {
          sessionActive = false;
          render();
        });
    });
}

function beginFromReady() {
  if (phase !== 'ready') return;
  canContinue = false;
  phase = 'playing';
  state.shipVx = 0;
  state.invuln = Math.max(state.invuln, 0.8);
  saveClock = 0;
  ensureSession();
  startLoop();
  render();
}

function startNewRun() {
  state = createInitialState();
  canContinue = false;
  sessionActive = false;
  particles = [];
  shake = 0;
  saveClock = 0;
  inputDir = 0;
  keys.left = false;
  keys.right = false;
  game.storage.remove('current').catch(() => {});
  phase = 'playing';
  ensureSession();
  startLoop();
  render();
}

function pauseGame() {
  if (phase !== 'playing') return;
  phase = 'paused';
  stopLoop();
  inputDir = 0;
  keys.left = false;
  keys.right = false;
  saveNow();
  render();
}

function resumeGame() {
  if (phase !== 'paused') return;
  phase = 'playing';
  saveClock = 0;
  startLoop();
  render();
}

function togglePause() {
  if (phase === 'playing') pauseGame();
  else if (phase === 'paused') resumeGame();
}

// ---------------------------------------------------------------------------
// SDK integration
// ---------------------------------------------------------------------------

function saveNow() {
  if (phase === 'loading' || phase === 'error' || phase === 'over') return Promise.resolve();
  if (phase === 'ready' && !canContinue && state.elapsed <= 0) return Promise.resolve();
  if (saveInFlight) {
    saveQueued = true;
    return saveInFlight;
  }
  const snapshot = serializeState(state);
  saveInFlight = game.storage
    .save('current', snapshot)
    .catch((error) => {
      if (error && (error.code === 'GM-4031' || error.code === 'GM-4032')) return;
      setToast(i18n.t('saveFailed', { code: error && error.code ? error.code : 'GM-5000' }), true, 3600);
    })
    .finally(() => {
      saveInFlight = null;
      if (saveQueued) {
        saveQueued = false;
        saveNow();
      }
    });
  return saveInFlight;
}

async function ensureSession() {
  if (sessionActive) return;
  try {
    await game.session.start();
    sessionActive = true;
  } catch (error) {
    if (error && (error.code === 'GM-4033' || error.code === 'GM-4093')) return;
    setToast(error && error.code ? error.code : 'GM-5000', true, 2600);
  }
}

// Register lifecycle and Agent listeners before ready (events may be buffered).
game.lifecycle.on('pause', () => {
  if (phase === 'playing') {
    pauseGame();
    return;
  }
  if (phase === 'over' || phase === 'error' || phase === 'loading') return;
  saveNow();
  render();
});

game.lifecycle.on('resume', () => {
  if (phase === 'paused') {
    resumeGame();
    return;
  }
  if (phase === 'ready') beginFromReady();
});

game.lifecycle.on('hidden', () => {
  if (phase === 'playing') pauseGame();
  else saveNow();
  if (phase !== 'playing') render();
});

game.lifecycle.on('visible', () => {
  syncRuntime();
  render();
});

game.lifecycle.on('before-save', () => saveNow());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (phase === 'playing') pauseGame();
    else saveNow();
  } else {
    syncRuntime();
    render();
  }
});

window.addEventListener('blur', () => {
  keys.left = false;
  keys.right = false;
  inputDir = 0;
  if (phase === 'playing') pauseGame();
});

window.addEventListener('focus', () => {
  syncRuntime();
  render();
});

game.onError((error) => {
  if (phase === 'error') return;
  phase = 'error';
  errorCode = error && error.code ? error.code : 'GM-5000';
  errorMessage = error && error.message ? error.message : '';
  stopLoop();
  render();
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function syncInputDir() {
  inputDir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
}

function isDriftKey(key) {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'a' || key === 'A' || key === 'd' || key === 'D';
}

function isActionKey(key) {
  return key === ' ' || key === 'Enter';
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;

  if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    keys.left = true;
    syncInputDir();
    event.preventDefault();
    return;
  }
  if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    keys.right = true;
    syncInputDir();
    event.preventDefault();
    return;
  }
  if (event.repeat) {
    if (isDriftKey(key) || isActionKey(key) || key === 'p' || key === 'P' || key === 'n' || key === 'N') {
      event.preventDefault();
    }
    return;
  }
  if (key === 'p' || key === 'P') {
    if (phase === 'playing' || phase === 'paused') togglePause();
    event.preventDefault();
    return;
  }
  if (isActionKey(key)) {
    if (phase === 'ready') beginFromReady();
    else if (phase === 'over') startNewRun();
    else if (phase === 'paused') resumeGame();
    event.preventDefault();
    return;
  }
  if ((key === 'n' || key === 'N') && phase === 'ready' && canContinue) {
    startNewRun();
    event.preventDefault();
    return;
  }
  // Escape and Tab are deliberately not intercepted: Runtime uses Escape to
  // leave the game and Tab must be able to leave the canvas.
});

window.addEventListener('keyup', (event) => {
  const key = event.key;
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    keys.left = false;
    syncInputDir();
    event.preventDefault();
  } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    keys.right = false;
    syncInputDir();
    event.preventDefault();
  }
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.focus({ preventScroll: true });
  if (phase === 'ready') beginFromReady();
  else if (phase === 'over') startNewRun();
  else if (phase === 'paused') resumeGame();
  if (event.pointerType !== 'mouse') event.preventDefault();
});

window.addEventListener('resize', () => {
  renderer.resize();
  render();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  renderer.resize();
  render();
  try {
    const info = await game.ready();
    i18n = createI18n(info.locale);
    applyTheme(info.theme);
    reducedMotion = info.reducedMotion === true;

    try {
      const bestScore = await game.score.getBest();
      best = bestScore && typeof bestScore.score === 'number' ? bestScore.score : null;
    } catch (error) {
      if (!error || error.code !== 'GM-4032') setToast(error && error.code ? error.code : 'GM-5000', true);
    }

    let restored = null;
    let hadSave = false;
    try {
      const saved = await game.storage.load('current');
      if (saved && saved.data) {
        hadSave = true;
        restored = deserializeState(saved.data);
      }
    } catch (error) {
      if (!error || error.code !== 'GM-4032') setToast(error && error.code ? error.code : 'GM-5000', true);
    }
    if (hadSave && !restored) game.storage.remove('current').catch(() => {});

    state = restored || createInitialState();
    canContinue = Boolean(restored);
    phase = 'ready';
    canvas.focus({ preventScroll: true });
    render();
  } catch (error) {
    phase = 'error';
    errorCode = error && error.code ? error.code : 'GM-5000';
    errorMessage = error && error.message ? error.message : '';
    stopLoop();
    render();
  }

  watchTimer = setInterval(() => {
    if (phase === 'loading' || phase === 'error') return;
    const changed = syncRuntime();
    if (!running || changed) render();
  }, 320);
}

boot();
void watchTimer;
