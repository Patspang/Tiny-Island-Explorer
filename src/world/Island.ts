import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { Environment } from './Environment';
import type { QuestGoal, QuestPieceSpot } from '../quest/Quest';
import { coastDistance, coastRadius, heightAt, LIGHTHOUSE, normalAt, PATH_POINTS, pathMask, QUEST_SPOTS, SPAWN } from './IslandShape';
import { Islet } from './Islet';
import { Lighthouse } from './Lighthouse';
import { Ocean } from './Ocean';
import { Ruin } from './Ruin';
import { Terrain } from './Terrain';
import type { GameWorld, ObstacleInfo } from './World';

/** Invisible wall ring just offshore (in normalised coast distance). */
const BOUNDARY_D = 1.07;
const BOUNDARY_SEGMENTS = 96;

/** The playable island: terrain, sea, lighthouse and scenery, plus their colliders. */
const surfaceNormal = { x: 0, y: 1, z: 0 };

export class Island implements GameWorld {
  readonly group = new THREE.Group();
  readonly spawn: THREE.Vector3;
  readonly spawnYaw: number;
  readonly obstacles: ObstacleInfo[] = [];
  readonly route = PATH_POINTS;
  readonly quest: { spots: QuestPieceSpot[]; goal: QuestGoal };

  private readonly terrain: Terrain;
  private readonly ocean: Ocean;
  private readonly lighthouse: Lighthouse;
  private readonly environment: Environment;
  private readonly ruin: Ruin;
  private readonly islet: Islet;
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

    this.ruin = new Ruin(physics);
    this.group.add(this.ruin.group);
    this.obstacles.push(...this.ruin.obstacles);

    this.islet = new Islet(physics);
    this.group.add(this.islet.group);
    this.obstacles.push(...this.islet.obstacles);

    const door = this.lighthouse.doorPosition;
    this.quest = {
      spots: [
        ...QUEST_SPOTS.map((q) => ({
          id: q.id,
          label: q.label,
          position: new THREE.Vector3(q.x, q.y ?? heightAt(q.x, q.z) + q.lift, q.z),
        })),
        { id: 'roof', label: "keeper's hut roof", position: this.lighthouse.roofPiecePosition.clone() },
      ],
      // The finale starts at the lighthouse door, not anywhere near the tower.
      goal: { x: door.x, y: door.y, z: door.z, radius: 1.9 },
    };

    // Seat everything in the landscape with soft baked contact shadows.
    this.terrain.bakeOcclusion([
      ...this.environment.occluders,
      { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, radius: 3.2, strength: 0.25 },
      ...this.ruin.obstacles.map((o) => ({ x: o.x, z: o.z, radius: o.radius * 2, strength: 0.35 })),
    ]);

    this.addBoundary(physics);
  }

  setQuestProgress(collected: number, total: number): void {
    this.lighthouse.setLensProgress(collected, total);
  }

  setLighthouseLight(level: number): void {
    this.lighthouse.setLight(level);
  }

  setDusk(t: number, horizon: THREE.Color): void {
    this.ocean.setDusk(t, horizon);
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

  surfaceAt(x: number, z: number): 'grass' | 'sand' | 'path' | 'rock' {
    const h = heightAt(x, z);
    // Steep ground shows rock (Terrain.surfaceColor exposes it from about this slope).
    if (normalAt(x, z, surfaceNormal).y < 0.72) return 'rock';
    if (pathMask(x, z) > 0.5) return 'path';
    // Matches the terrain's sand band (Terrain.surfaceColor).
    return h < 1.5 ? 'sand' : 'grass';
  }

  get habitats() {
    const coast = Array.from({ length: 6 }, (_, i) => {
      const theta = (i / 6) * Math.PI * 2 + 0.4;
      const r = coastRadius(theta) * 1.08;
      return { x: Math.cos(theta) * r, y: 0, z: Math.sin(theta) * r };
    });
    return { meadows: this.environment.meadows, woods: this.environment.woods, coast };
  }

  lampPosition(): THREE.Vector3 {
    return this.lighthouse.lampPosition();
  }

  coastProximity(x: number, z: number): number {
    return THREE.MathUtils.smoothstep(coastDistance(x, z), 0.55, 0.95);
  }

  foliageAt(x: number, y: number, z: number): number {
    return this.environment.foliageAt(x, y, z);
  }

  update(dt: number, time: number, camera: THREE.Camera, player?: THREE.Vector3): void {
    this.ocean.update(time, camera);
    this.environment.update(time, camera, player);
    this.lighthouse.update(dt, time);
  }

  dispose(): void {
    this.terrain.dispose();
    this.ocean.dispose();
    this.lighthouse.dispose();
    this.environment.dispose();
    this.ruin.dispose();
    this.islet.dispose();
  }
}
