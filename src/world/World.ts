import type * as THREE from 'three';

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
  /** Visual ground height used for camera clearance (physics remains authoritative). */
  groundHeight(x: number, z: number): number;
  /** Whether a grounded position is a good place to respawn after falling. */
  isSafeSpot(x: number, feetY: number, z: number): boolean;
  update(dt: number, time: number, camera: THREE.Camera): void;
  dispose(): void;
}
