import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../config';

export type Rapier = typeof RAPIER;

/** Collision groups (membership in the high 16 bits, filter in the low 16). */
export const GROUP = {
  terrain: 1 << 0,
  obstacle: 1 << 1,
  player: 1 << 2,
  boundary: 1 << 3,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** What the camera may collide with: solid scenery, never the player or invisible walls. */
export const CAMERA_RAY_GROUPS = groups(0xffff, GROUP.terrain | GROUP.obstacle);

/**
 * Thin wrapper around a Rapier world. Owns initialisation and the fixed step;
 * gameplay code talks to Rapier directly through `world` and `rapier`.
 */
export class PhysicsWorld {
  readonly rapier: Rapier;
  readonly world: RAPIER.World;

  private constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.step;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(RAPIER);
  }

  step(): void {
    this.world.step();
  }

  createStaticBody(x = 0, y = 0, z = 0): RAPIER.RigidBody {
    return this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(x, y, z));
  }

  /** Raycast against solid scenery. Returns hit distance or null. */
  castRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    filterGroups: number,
  ): number | null {
    const ray = new this.rapier.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, undefined, filterGroups);
    return hit ? hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
  }
}
