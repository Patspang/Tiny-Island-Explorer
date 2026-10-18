import type * as THREE from 'three';
import type { PuzzleView, QuestLayout } from '../quest/Quest';

/** A solid obstacle, exposed for debugging and automated tests. */
export interface ObstacleInfo {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** Horizontal radius of the solid part. */
  radius: number;
}

/** What the game needs from a playable level (the island, or the movement sandbox). */
export interface GameWorld {
  readonly group: THREE.Group;
  readonly spawn: THREE.Vector3;
  /** Initial camera yaw at spawn. */
  readonly spawnYaw: number;
  readonly obstacles: ReadonlyArray<ObstacleInfo>;
  /** Main walking route (spawn -> landmark), if the level has one. */
  readonly route: ReadonlyArray<{ x: number; z: number }>;
  /** Lighthouse quest layout, if the level has one. */
  readonly quest?: QuestLayout;
  /** Drawing data for the in-game map, if the level has one. */
  readonly map?: IslandMap;
  /** Let puzzle props animate from the quest's state (called once, after the quest exists). */
  bindPuzzles?(view: PuzzleView): void;
  /** Quest progress, for in-world feedback (e.g. sockets on the lighthouse plaque). */
  setQuestProgress?(collected: number, total: number): void;
  /** Lighthouse lamp level, 0..1 (quest finale). */
  setLighthouseLight?(level: number): void;
  /** Day-to-dusk blend for world materials (the ocean); the sky itself is owned by Atmosphere. */
  setDusk?(t: number, horizon: THREE.Color): void;
  /** Visual ground height used for camera clearance (physics remains authoritative). */
  groundHeight(x: number, z: number): number;
  /** Whether a grounded position is a good place to respawn after falling. */
  isSafeSpot(x: number, feetY: number, z: number): boolean;
  /** Where a point sits on the ground, for footstep effects. */
  surfaceAt?(x: number, z: number): 'grass' | 'sand' | 'path' | 'rock';
  /** Where wildlife gathers: flower meadows (butterflies), woods (fireflies), coast (gulls). */
  readonly habitats?: {
    meadows: ReadonlyArray<{ x: number; y: number; z: number }>;
    woods: ReadonlyArray<{ x: number; y: number; z: number }>;
    /** Points out over the sea near the shore. */
    coast: ReadonlyArray<{ x: number; y: number; z: number }>;
  };
  /** Where the lighthouse lamp is, for finale effects. */
  lampPosition?(): THREE.Vector3;
  /** 1 on the shore (or in the sea), falling to 0 well inland; drives the surf sound. */
  coastProximity?(x: number, z: number): number;
  /** How deep a point is inside foliage the player can walk through (0..1), for leaf effects. */
  foliageAt?(x: number, y: number, z: number): number;
  /** `player` is the rendered feet position; plants bend away from it. */
  update(dt: number, time: number, camera: THREE.Camera, player?: THREE.Vector3): void;
  dispose(): void;
}

/** What the in-game map draws: world XZ coordinates, plain data (no Three.js). */
export interface IslandMap {
  /** Coastline, going round the island; `cliff` is 0 for beach, 1 for cliff. */
  coastline: ReadonlyArray<{ x: number; z: number; cliff: number }>;
  /** Half-size of the square area the map covers, centred on the origin. */
  extent: number;
  hill: { x: number; z: number; radius: number };
  path: ReadonlyArray<{ x: number; z: number }>;
  woods: ReadonlyArray<{ x: number; z: number }>;
  landmarks: ReadonlyArray<MapLandmark>;
}

export interface MapLandmark {
  kind: 'lighthouse' | 'hut' | 'ruin' | 'bells' | 'chest' | 'x' | 'stones' | 'bottle';
  x: number;
  z: number;
  /** Lens piece this landmark leads to, for a tick once it is found. */
  piece?: string;
}
