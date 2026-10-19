/**
 * Pure save/restore helpers for Ember Drift.
 *
 * `serializeState` and `deserializeState` are synchronous, idempotent and never
 * touch the network or the DOM: the Runtime may ask for a snapshot at any
 * moment. All positions are normalized so a save restored at a different
 * viewport size still makes sense.
 *
 * A finished run is never valid Continue data: `deserializeState` returns null
 * for `gameOver: true`, zero hull or an expired clock.
 */

export const SAVE_VERSION = 1;
export const RUN_SECONDS = 120;
export const START_LIVES = 3;
export const MAX_STREAK = 5;
export const MAX_ASTEROIDS = 40;
export const MAX_STARS = 32;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function wholeNumber(value, fallback, min, max) {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function uint32(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.floor(value) >>> 0;
}

function cloneAsteroid(asteroid) {
  return {
    id: wholeNumber(asteroid && asteroid.id, 1, 1, 2000000000),
    x: finiteNumber(asteroid && asteroid.x, 0.5, 0, 1),
    y: finiteNumber(asteroid && asteroid.y, -0.1, -0.5, 1.5),
    vy: finiteNumber(asteroid && asteroid.vy, 0.18, 0.02, 1.5),
    r: finiteNumber(asteroid && asteroid.r, 16, 6, 48),
    rot: finiteNumber(asteroid && asteroid.rot, 0, -Math.PI * 8, Math.PI * 8),
    spin: finiteNumber(asteroid && asteroid.spin, 0, -4, 4),
    seed: uint32(asteroid && asteroid.seed, 1),
  };
}

function cloneStar(star) {
  return {
    id: wholeNumber(star && star.id, 1, 1, 2000000000),
    x: finiteNumber(star && star.x, 0.5, 0, 1),
    y: finiteNumber(star && star.y, -0.1, -0.5, 1.5),
    vy: finiteNumber(star && star.vy, 0.12, 0.02, 1.2),
    r: finiteNumber(star && star.r, 8, 3, 22),
    phase: finiteNumber(star && star.phase, 0, -Math.PI * 8, Math.PI * 8),
  };
}

export function createInitialState() {
  return {
    saveVersion: SAVE_VERSION,
    score: 0,
    lives: START_LIVES,
    elapsed: 0,
    timeLeft: RUN_SECONDS,
    streak: 1,
    bestStreak: 1,
    starsCollected: 0,
    shipX: 0.5,
    shipVx: 0,
    asteroids: [],
    stars: [],
    invuln: 0,
    spawnAsteroidIn: 0.8,
    spawnStarIn: 0.55,
    seed: 0x1a2b3c4d,
    nextId: 1,
    outcome: '',
    gameOver: false,
  };
}

/** Pure snapshot; returns a fresh JSON-ready object. */
export function serializeState(state) {
  const asteroids = Array.isArray(state.asteroids)
    ? state.asteroids.slice(0, MAX_ASTEROIDS).map(cloneAsteroid)
    : [];
  const stars = Array.isArray(state.stars) ? state.stars.slice(0, MAX_STARS).map(cloneStar) : [];
  return {
    saveVersion: SAVE_VERSION,
    score: finiteNumber(state.score, 0, 0, 1000000),
    lives: wholeNumber(state.lives, START_LIVES, 0, START_LIVES),
    elapsed: finiteNumber(state.elapsed, 0, 0, RUN_SECONDS),
    timeLeft: finiteNumber(state.timeLeft, RUN_SECONDS, 0, RUN_SECONDS),
    streak: wholeNumber(state.streak, 1, 1, MAX_STREAK),
    bestStreak: wholeNumber(state.bestStreak, 1, 1, MAX_STREAK),
    starsCollected: wholeNumber(state.starsCollected, 0, 0, 99999),
    shipX: finiteNumber(state.shipX, 0.5, 0, 1),
    shipVx: finiteNumber(state.shipVx, 0, -2, 2),
    asteroids,
    stars,
    invuln: finiteNumber(state.invuln, 0, 0, 5),
    spawnAsteroidIn: finiteNumber(state.spawnAsteroidIn, 0.8, 0, 5),
    spawnStarIn: finiteNumber(state.spawnStarIn, 0.55, 0, 5),
    seed: uint32(state.seed, 0x1a2b3c4d),
    nextId: wholeNumber(state.nextId, 1, 1, 2000000000),
    outcome: state.outcome === 'complete' || state.outcome === 'lost' ? state.outcome : '',
    gameOver: state.gameOver === true,
  };
}

/**
 * Restore a snapshot. Returns `null` for missing/foreign/finished saves so the
 * caller can start a fresh game (Continue must not resume a finished run).
 */
export function deserializeState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.saveVersion !== SAVE_VERSION) return null;
  if (data.gameOver === true) return null;

  const timeLeft = finiteNumber(data.timeLeft, 0, 0, RUN_SECONDS);
  if (timeLeft <= 0.25) return null;
  const lives = wholeNumber(data.lives, 0, 0, START_LIVES);
  if (lives <= 0) return null;

  const asteroids = Array.isArray(data.asteroids)
    ? data.asteroids.slice(0, MAX_ASTEROIDS).map(cloneAsteroid)
    : [];
  const stars = Array.isArray(data.stars) ? data.stars.slice(0, MAX_STARS).map(cloneStar) : [];
  let nextId = wholeNumber(data.nextId, 1, 1, 2000000000);
  for (const entity of [...asteroids, ...stars]) nextId = Math.max(nextId, entity.id + 1);

  return {
    saveVersion: SAVE_VERSION,
    score: finiteNumber(data.score, 0, 0, 1000000),
    lives,
    elapsed: clamp(RUN_SECONDS - timeLeft, 0, RUN_SECONDS),
    timeLeft,
    streak: wholeNumber(data.streak, 1, 1, MAX_STREAK),
    bestStreak: wholeNumber(data.bestStreak, 1, 1, MAX_STREAK),
    starsCollected: wholeNumber(data.starsCollected, 0, 0, 99999),
    shipX: finiteNumber(data.shipX, 0.5, 0, 1),
    shipVx: 0,
    asteroids,
    stars,
    invuln: finiteNumber(data.invuln, 0, 0, 1.6),
    spawnAsteroidIn: finiteNumber(data.spawnAsteroidIn, 0.8, 0.05, 5),
    spawnStarIn: finiteNumber(data.spawnStarIn, 0.55, 0.05, 5),
    seed: uint32(data.seed, 0x1a2b3c4d),
    nextId,
    outcome: '',
    gameOver: false,
  };
}
