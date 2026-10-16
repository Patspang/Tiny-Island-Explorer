// The designed island, expressed as a pure, deterministic height function.
// Both the render mesh and the physics trimesh are built from heightAt(), so they always match.

import { angularNoise, clamp, fbm2, lerp, smoothstep } from './noise';

const TAU = Math.PI * 2;

/** Base coast radius and how it wobbles with angle (freq, amplitude, phase). */
const COAST_RADIUS = 60;
const COAST_HARMONICS = [
  [2, 7.5, 0.6],
  [3, 5.0, 2.1],
  [5, 2.6, 0.4],
  [7, 1.4, 4.0],
  [11, 0.7, 1.3],
] as const;

/** Direction (angle in the XZ plane, x = cos, z = sin) of the main landmarks. */
const BEACH_ANGLE = Math.PI / 2; // spawn beach faces +Z
const HILL_ANGLE = -2.05; // lighthouse hill, opposite side

/** Sectors of coastline that are cliffs instead of beach: [centre angle, half-width]. */
const CLIFF_SECTORS = [
  [HILL_ANGLE, 0.62],
  [-0.6, 0.24],
  [0.32, 0.2],
  [2.62, 0.16],
] as const;

const HILL_RADIUS = 31;
const HILL_PEAK = 12.5;
const HILL_DISTANCE = 33;

export const HILL_CENTER = {
  x: Math.cos(HILL_ANGLE) * HILL_DISTANCE,
  z: Math.sin(HILL_ANGLE) * HILL_DISTANCE,
};

export function coastRadius(theta: number): number {
  return COAST_RADIUS + angularNoise(theta, COAST_HARMONICS);
}

function angleDelta(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

/** 1 on cliff coastline, 0 on beach coastline. */
export function cliffWeightAtAngle(theta: number): number {
  let w = 0;
  for (const [centre, half] of CLIFF_SECTORS) {
    w = Math.max(w, smoothstep(half + 0.22, half, angleDelta(theta, centre)));
  }
  return w;
}

/** Normalised distance from the island centre: 1.0 is the coastline. */
export function coastDistance(x: number, z: number): number {
  const theta = Math.atan2(z, x);
  return Math.hypot(x, z) / coastRadius(theta);
}

function hillHeight(x: number, z: number): number {
  const d = Math.hypot(x - HILL_CENTER.x, z - HILL_CENTER.z) / HILL_RADIUS;
  // Flat top for the lighthouse, smooth shoulders, gentle enough to walk up.
  return HILL_PEAK * smoothstep(1.0, 0.17, d);
}

/** Rolling inland terrain without the coastline applied. */
function interiorHeight(x: number, z: number): number {
  const broad = fbm2(x / 34 + 3.1, z / 34 - 1.7, 3, 11);
  const detail = fbm2(x / 9, z / 9, 2, 23);
  const secondary = 3.2 * Math.exp(-((x - 24) ** 2 + (z - 6) ** 2) / 260);
  return 2.6 + 1.9 * broad + 0.35 * detail + secondary + hillHeight(x, z);
}

function beachProfile(d: number): number {
  // Dry sand at d=0.8, waterline just inside d=1.0, then a shelving seabed.
  if (d < 1.0) return 1.3 - 1.45 * Math.pow(clamp((d - 0.8) / 0.2, 0, 1), 1.15);
  return Math.max(-6.5, -0.15 - (d - 1.0) * 18 - (d - 1.0) ** 2 * 60);
}

// --- Exploration path from the spawn beach to the lighthouse --------------------------------

const BEACH_R = coastRadius(BEACH_ANGLE);
export const SPAWN = {
  x: Math.cos(BEACH_ANGLE) * BEACH_R * 0.83,
  z: Math.sin(BEACH_ANGLE) * BEACH_R * 0.83,
};

export const PATH_POINTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: SPAWN.x, z: SPAWN.z - 2 },
  { x: 3, z: 38 },
  { x: 7, z: 25 },
  { x: 2, z: 12 },
  { x: -8, z: 2 },
  { x: -21, z: -6 },
  { x: -31, z: -14 },
  { x: -30, z: -24 },
  { x: -23, z: -29 },
  { x: HILL_CENTER.x - 0.5, z: HILL_CENTER.z + 5 },
];

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

export function distanceToPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const a = PATH_POINTS[i];
    const b = PATH_POINTS[i + 1];
    best = Math.min(best, distanceToSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/** 1 on the footpath, fading to 0 at its edge. Wobbles slightly so it looks worn, not drawn. */
export function pathMask(x: number, z: number): number {
  const wobble = 0.35 * fbm2(x / 6, z / 6, 2, 77);
  return smoothstep(2.2, 1.0, distanceToPath(x, z) + wobble);
}

// --- Final height ---------------------------------------------------------------------------

const LIGHTHOUSE_PAD_RADIUS = 6.5;
let plateauHeight: number | null = null;

function rawHeight(x: number, z: number): number {
  const theta = Math.atan2(z, x);
  const r = Math.hypot(x, z);
  const R = coastRadius(theta);
  const d = r / R;
  const cliff = cliffWeightAtAngle(theta);
  const inland = interiorHeight(x, z);

  // Beach coast: blend from interior to the sand profile.
  const beachBlend = smoothstep(0.62, 0.86, d);
  const beachCoast = lerp(inland, beachProfile(d), beachBlend);

  // Cliff coast: interior holds its height (raised a little) then drops steeply into the sea.
  const plateau = inland + 2.2 * smoothstep(0.55, 0.85, d);
  const drop = smoothstep(0.935, 0.99, d);
  const strata = 0.45 * Math.sin(plateau * 2.2 + fbm2(x / 5, z / 5, 1, 5) * 2) * drop * (1 - drop) * 4;
  const cliffCoast = lerp(plateau, -3.5 - (d - 0.99) * 30, drop) + strata;

  let h = lerp(beachCoast, d > 0.99 ? Math.min(beachCoast, cliffCoast) : cliffCoast, cliff);
  // Uniform deep seabed away from the island.
  return lerp(Math.max(h, -8), -7, smoothstep(1.12, 1.4, d));
}

export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);

  // Level pad for the lighthouse.
  if (plateauHeight === null) plateauHeight = rawHeight(HILL_CENTER.x, HILL_CENTER.z);
  const dl = Math.hypot(x - HILL_CENTER.x, z - HILL_CENTER.z);
  h = lerp(h, plateauHeight, smoothstep(LIGHTHOUSE_PAD_RADIUS + 3, LIGHTHOUSE_PAD_RADIUS, dl));

  // Gently smooth the worn footpath (pressed slightly into the ground).
  h -= 0.12 * pathMask(x, z);
  return h;
}

/** Surface normal by central differences of heightAt. */
export function normalAt(x: number, z: number, out: { x: number; y: number; z: number }, eps = 0.35) {
  const hx = heightAt(x + eps, z) - heightAt(x - eps, z);
  const hz = heightAt(x, z + eps) - heightAt(x, z - eps);
  const nx = -hx;
  const ny = 2 * eps;
  const nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

export const LIGHTHOUSE = {
  get x() {
    return HILL_CENTER.x;
  },
  get z() {
    return HILL_CENTER.z;
  },
  get y() {
    return heightAt(HILL_CENTER.x, HILL_CENTER.z);
  },
  padRadius: LIGHTHOUSE_PAD_RADIUS,
};

export function cliffWeight(x: number, z: number): number {
  return cliffWeightAtAngle(Math.atan2(z, x));
}

// --- Stage 2 quest: where the lost lens pieces lie ------------------------------------------

export interface QuestSpot {
  id: string;
  /** Short description for hints/debugging. */
  label: string;
  x: number;
  z: number;
  /** Height of the piece above the ground (the ruin piece sits on top of the ruin). */
  lift: number;
  /** Absolute height instead of ground + lift (pieces standing on built features). */
  y?: number;
}

/** The old stone ruin: its top is out of step reach, so the piece on it needs a jump. */
export const RUIN = { x: 24, z: 6, height: 1.0, halfSize: 0.8 } as const;

export interface Pillar {
  x: number;
  z: number;
  /** Absolute height of the flat top. */
  top: number;
  radius: number;
}

/**
 * Stepping stones from the western cove out to a small sea rock. Each top is ~0.38 m higher
 * than the last (above auto-step), so every hop is a jump; the water below is deep enough to
 * send the player back to the beach.
 */
export const ISLET = (() => {
  const theta = 3.1;
  const R = coastRadius(theta);
  const dir = { x: Math.cos(theta), z: Math.sin(theta) };
  const at = (d: number) => ({ x: dir.x * R * d, z: dir.z * R * d });
  const shore = at(0.9);
  const shoreY = heightAt(shore.x, shore.z);
  // ~1.8 m between stone centres (~0.7 m gaps): a confident hop, not a pixel-perfect one.
  const stones: Pillar[] = [0.935, 0.965, 0.995].map((d, i) => ({ ...at(d), top: shoreY + 0.38 * (i + 1), radius: 0.58 }));
  const rock: Pillar = { ...at(1.035), top: shoreY + 0.38 * 4, radius: 1.5 };
  return { shore, stones, rock };
})();

export const QUEST_SPOTS: ReadonlyArray<QuestSpot> = [
  { id: 'islet', label: 'sea rock off the western cove', x: ISLET.rock.x, z: ISLET.rock.z, lift: 0, y: ISLET.rock.top + 0.85 },
  { id: 'cliff', label: 'north-east cliff top', x: 40.8, z: -27.9, lift: 0.9 },
  { id: 'ruin', label: 'top of the old ruin', x: RUIN.x, z: RUIN.z, lift: RUIN.height + 0.75 },
  { id: 'woods', label: 'woodland clearing', x: -28, z: 8, lift: 0.9 },
];
