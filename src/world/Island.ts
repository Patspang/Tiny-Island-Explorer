import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { Environment } from './Environment';
import { coastDistance, coastRadius, heightAt, LIGHTHOUSE, normalAt, PATH_POINTS, SPAWN } from './IslandShape';
import { Lighthouse } from './Lighthouse';
import { Ocean } from './Ocean';
import { Terrain } from './Terrain';
import type { GameWorld, ObstacleInfo } from './World';

/** Invisible wall ring just offshore (in normalised coast distance). */
const BOUNDARY_D = 1.07;
const BOUNDARY_SEGMENTS = 96;

/** The playable island: terrain, sea, lighthouse and scenery, plus their colliders. */
export class Island implements GameWorld {
  readonly group = new THREE.Group();
  readonly spawn: THREE.Vector3;
  readonly spawnYaw: number;
  readonly obstacles: ObstacleInfo[] = [];
  readonly route = PATH_POINTS;

  private readonly terrain: Terrain;
  private readonly ocean: Ocean;
  private readonly lighthouse: Lighthouse;
  private readonly environment: Environment;
  private readonly n = { x: 0, y: 1, z: 0 };

  constructor(physics: PhysicsWorld) {
    this.spawn = new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
    // Start looking from the beach toward the lighthouse.
    const dx = LIGHTHOUSE.x - SPAWN.x;
    const dz = LIGHTHOUSE.z - SPAWN.z;
    this.spawnYaw = Math.atan2(-dx, -dz);

    this.terrain = new Terrain();
    this.terrain.addCollider(physics);
    this.group.add(this.terrain.mesh);

    this.ocean = new Ocean();
    this.group.add(this.ocean.mesh);

    this.lighthouse = new Lighthouse(physics);
    this.group.add(this.lighthouse.group);
    this.obstacles.push(...this.lighthouse.obstacles);

    this.environment = new Environment(physics);
    this.group.add(this.environment.group);
    this.obstacles.push(...this.environment.obstacles);

    this.addBoundary(physics);
  }

  private addBoundary(physics: PhysicsWorld): void {
    const { rapier, world } = physics;
    const body = physics.createStaticBody();
    const wallGroups = groups(GROUP.boundary, GROUP.player);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < BOUNDARY_SEGMENTS; i++) {
      const t = (i / BOUNDARY_SEGMENTS) * Math.PI * 2;
      const r = coastRadius(t) * BOUNDARY_D;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      const angle = Math.atan2(bz - az, bx - ax);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
      world.createCollider(
        rapier.ColliderDesc.cuboid(len / 2 + 0.4, 25, 0.5)
          .setTranslation((ax + bx) / 2, 10, (az + bz) / 2)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(wallGroups),
        body,
      );
    }
  }

  groundHeight(x: number, z: number): number {
    return heightAt(x, z);
  }

  isSafeSpot(x: number, feetY: number, z: number): boolean {
    if (feetY < 0.35 || coastDistance(x, z) > 0.95) return false;
    return normalAt(x, z, this.n).y > 0.8;
  }

  update(dt: number, time: number, camera: THREE.Camera): void {
    this.ocean.update(time, camera);
    this.environment.update(time);
    this.lighthouse.update(dt, time);
  }

  dispose(): void {
    this.terrain.dispose();
    this.ocean.dispose();
    this.lighthouse.dispose();
    this.environment.dispose();
  }
}
