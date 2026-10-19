/**
 * Small seeded PRNG used for gameplay spawns, so a Continue save resumes the
 * same sequence. Visual-only sparkles may use Math.random.
 *
 * `state.seed` is a uint32 stored in the save snapshot.
 */

const UINT32 = 4294967296;

export function nextRandom(state) {
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / UINT32;
}

export function randomRange(state, min, max) {
  return min + nextRandom(state) * (max - min);
}

export function randomSeed(state) {
  return (nextRandom(state) * UINT32) >>> 0;
}

/** Stable hash in [0,1) used by the renderer for painted asteroid shapes. */
export function hash01(value) {
  let x = (value | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / UINT32;
}
