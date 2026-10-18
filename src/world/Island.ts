import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { Environment } from './Environment';
import type { PuzzleId, PuzzleView, QuestLayout } from '../quest/Quest';
import {
  BELLS,
  bellsLocal,
  BOTTLE,
  CHEST,
  cliffWeightAtAngle,
  coastDistance,
  coastRadius,
  DIG,
  heightAt,
  HILL_CENTER,
  ISLET,
  LIGHTHOUSE,
  normalAt,
  PATH_POINTS,
  pathMask,
  QUEST_SPOTS,
  RUIN,
  SHELLS,
  SPAWN,
} from './IslandShape';
import { Islet } from './Islet';
import { PuzzleProps } from './PuzzleProps';
import { Lighthouse } from './Lighthouse';
import { Ocean } from './Ocean';
import { Ruin } from './Ruin';
import { Terrain } from './Terrain';
import type { GameWorld, IslandMap, ObstacleInfo } from './World';

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
  readonly quest: QuestLayout;
  readonly map: IslandMap;

  private readonly terrain: Terrain;
  private readonly ocean: Ocean;
  private readonly lighthouse: Lighthouse;
  private readonly environment: Environment;
  private readonly ruin: Ruin;
  private readonly islet: Islet;
  private readonly puzzleProps: PuzzleProps;
  private puzzleView: PuzzleView | null = null;
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

    this.puzzleProps = new PuzzleProps(physics);
    this.group.add(this.puzzleProps.group);
    this.obstacles.push(...this.puzzleProps.obstacles);

    const door = this.lighthouse.doorPosition;
    const ground = (p: { x: number; z: number }, lift = 0) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + lift, p.z);
    // Three pieces are hidden until their puzzle is solved; they rise from where the puzzle is.
    const unlocks: Record<string, { unlock: PuzzleId; revealFrom: THREE.Vector3 }> = {
      ruin: { unlock: 'bells', revealFrom: ground(RUIN, RUIN.height + 0.2) },
      woods: { unlock: 'chest', revealFrom: ground(CHEST, 0.55) },
      cliff: { unlock: 'dig', revealFrom: ground(DIG, -0.3) },
    };
    this.quest = {
      spots: [
        ...QUEST_SPOTS.map((q) => ({
          id: q.id,
          label: q.label,
          position: new THREE.Vector3(q.x, q.y ?? heightAt(q.x, q.z) + q.lift, q.z),
          ...unlocks[q.id],
        })),
        { id: 'roof', label: "keeper's hut roof", position: this.lighthouse.roofPiecePosition.clone() },
      ],
      // The finale starts at the lighthouse door, not anywhere near the tower.
      goal: { x: door.x, y: door.y, z: door.z, radius: 1.9 },
      puzzles: {
        bottle: ground(BOTTLE),
        bells: {
          plates: [-1, 0, 1].map((k) => ground(bellsLocal(k * BELLS.plateSpacing, 0))),
          listen: ground(bellsLocal(0, BELLS.listenOffset)),
          song: [...BELLS.song],
        },
        shells: SHELLS.map((p) => ground(p)),
        chest: ground(CHEST),
        dig: ground(DIG),
        // Only the bells need explaining; the chest, stones and crates speak for themselves.
        notes: [{ id: 'bells', position: ground(BELLS), radius: 5.5 }],
      },
    };
    this.map = this.buildMap();

    // Seat everything in the landscape with soft baked contact shadows.
    this.terrain.bakeOcclusion([
      ...this.environment.occluders,
      { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, radius: 3.2, strength: 0.25 },
      ...this.ruin.obstacles.map((o) => ({ x: o.x, z: o.z, radius: o.radius * 2, strength: 0.35 })),
    ]);

    this.addBoundary(physics);
  }

  bindPuzzles(view: PuzzleView): void {
    this.puzzleView = view;
  }

  private buildMap(): IslandMap {
    const coastline = Array.from({ length: 160 }, (_, i) => {
      const t = (i / 160) * Math.PI * 2;
      // The waterline sits a little inside the coast radius on beaches.
      const r = coastRadius(t) * 0.97;
      return { x: Math.cos(t) * r, z: Math.sin(t) * r, cliff: cliffWeightAtAngle(t) };
    });
    const hut = this.lighthouse.obstacles.find((o) => o.kind === 'hut');
    return {
      coastline,
      extent: 70,
      hill: { x: HILL_CENTER.x, z: HILL_CENTER.z, radius: 22 },
      path: PATH_POINTS,
      woods: this.environment.woods.map((w) => ({ x: w.x, z: w.z })),
      landmarks: [
        { kind: 'lighthouse', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z },
        ...(hut ? [{ kind: 'hut' as const, x: hut.x, z: hut.z, piece: 'roof' }] : []),
        { kind: 'ruin', x: RUIN.x, z: RUIN.z, piece: 'ruin' },
        { kind: 'bells', x: BELLS.x, z: BELLS.z },
        { kind: 'chest', x: CHEST.x, z: CHEST.z, piece: 'woods' },
        { kind: 'x', x: DIG.x, z: DIG.z, piece: 'cliff' },
        { kind: 'stones', x: ISLET.rock.x, z: ISLET.rock.z, piece: 'islet' },
        { kind: 'bottle', x: BOTTLE.x, z: BOTTLE.z },
      ],
    };
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
    if (this.puzzleView) this.puzzleProps.update(dt, this.puzzleView);
  }

  dispose(): void {
    this.terrain.dispose();
    this.ocean.dispose();
    this.lighthouse.dispose();
    this.environment.dispose();
    this.ruin.dispose();
    this.islet.dispose();
    this.puzzleProps.dispose();
  }
}
