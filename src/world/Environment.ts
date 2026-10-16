import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import {
  cliffWeight,
  coastDistance,
  coastRadius,
  distanceToPath,
  heightAt,
  LIGHTHOUSE,
  normalAt,
  QUEST_SPOTS,
  RUIN,
  SPAWN,
} from './IslandShape';
import { createRng, fbm2, smoothstep } from './noise';
import { bush, broadleafTree, flower, grassTuft, palmTree, pineTree, rock } from './props';
import type { ObstacleInfo } from './World';

interface Placement {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  /** Non-uniform scale tweak for rocks. */
  sy?: number;
}

interface PropKind {
  geometries: THREE.BufferGeometry[];
  material: THREE.Material;
  castShadow: boolean;
  placements: Placement[][];
}

const n = { x: 0, y: 1, z: 0 };

/** Wind sway injected into a standard material; displacement grows with height above `start`. */
function windMaterial(
  base: THREE.MeshStandardMaterialParameters,
  strength: number,
  start: number,
  time: { value: number },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec2 basePos = vec2(0.0);
          #ifdef USE_INSTANCING
            basePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #endif
          float h = max(position.y - ${start.toFixed(2)}, 0.0);
          float t = uTime + basePos.x * 0.21 + basePos.y * 0.17;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + basePos.x * 0.05);
          float sway = (sin(t * 1.4) + 0.45 * sin(t * 2.9 + 1.3)) * gust;
          transformed.x += sway * ${strength.toFixed(4)} * h * h;
          transformed.z += cos(t * 1.1 + 0.7) * 0.6 * ${strength.toFixed(4)} * h * h;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `wind-${strength}-${start}`;
  return mat;
}

/**
 * Trees, bushes, rocks, grass and flowers. Placement is deterministic and rule-based:
 * clusters with clearings, nothing on the path, a clear view from the beach to the
 * lighthouse, and colliders only on solid things (trunks and big rocks).
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  private readonly time = { value: 0 };
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly occupied: Array<{ x: number; z: number; r: number }> = [];

  constructor(physics: PhysicsWorld) {
    const rng = createRng(4242);
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);

    const foliage = this.track(windMaterial({ vertexColors: true, roughness: 0.85 }, 0.006, 2.2, this.time));
    const palmMat = this.track(
      windMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }, 0.004, 3.5, this.time),
    );
    const bushMat = this.track(windMaterial({ vertexColors: true, roughness: 0.9 }, 0.03, 0.3, this.time));
    const grassMat = this.track(windMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }, 0.35, 0, this.time));
    const rockMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));

    const broadleaf: PropKind = { geometries: [11, 23, 37, 51].map(broadleafTree), material: foliage, castShadow: true, placements: [] };
    const pines: PropKind = { geometries: [5, 17, 29].map(pineTree), material: foliage, castShadow: true, placements: [] };
    const palms: PropKind = { geometries: [3, 41, 77].map(palmTree), material: palmMat, castShadow: true, placements: [] };
    const bushes: PropKind = { geometries: [8, 19, 33].map(bush), material: bushMat, castShadow: true, placements: [] };
    const rocks: PropKind = { geometries: [2, 13, 31, 47].map((s) => rock(s)), material: rockMat, castShadow: true, placements: [] };
    const seaRocks: PropKind = { geometries: [61, 73].map((s) => rock(s, false)), material: rockMat, castShadow: true, placements: [] };
    const grass: PropKind = { geometries: [1, 2, 3].map(grassTuft), material: grassMat, castShadow: false, placements: [] };
    const flowers: PropKind = {
      geometries: ['#ffffff', '#ffd23f', '#f78fb3', '#b8a1ff', '#ff9b54'].map((c, i) => flower(90 + i, c)),
      material: bushMat,
      castShadow: false,
      placements: [],
    };
    const kinds = [broadleaf, pines, palms, bushes, rocks, seaRocks, grass, flowers];
    for (const k of kinds) {
      for (const g of k.geometries) this.track(g);
      k.placements = k.geometries.map(() => []);
    }

    // Reserve the lighthouse pad and the spawn area.
    this.occupied.push({ x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: LIGHTHOUSE.padRadius + 3.5 });
    this.occupied.push({ x: SPAWN.x, z: SPAWN.z, r: 5 });

    // Keep quest pieces (and the ruin) in the open.
    for (const q of QUEST_SPOTS) this.occupied.push({ x: q.x, z: q.z, r: 2.5 });
    this.occupied.push({ x: RUIN.x, z: RUIN.z, r: 3.5 });

    // --- Trees, in clusters so the island has woods and open meadows.
    // The woodland quest piece sits in a clearing inside one of the woods.
    const woods = QUEST_SPOTS.find((q) => q.id === 'woods');
    const clusterCentres: Array<{ x: number; z: number }> = woods ? [{ x: woods.x, z: woods.z }] : [];
    for (let tries = 0; clusterCentres.length < 15 && tries < 600; tries++) {
      const x = (rng() - 0.5) * 120;
      const z = (rng() - 0.5) * 120;
      const d = coastDistance(x, z);
      if (d > 0.85 || d < 0.05) continue;
      if (distanceToPath(x, z) < 6 || this.inViewCorridor(x, z, 8)) continue;
      if (clusterCentres.some((c) => Math.hypot(c.x - x, c.z - z) < 16)) continue;
      clusterCentres.push({ x, z });
    }
    for (const c of clusterCentres) {
      const count = 4 + Math.floor(rng() * 6);
      for (let i = 0, tries = 0; i < count && tries < 60; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 9;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (!this.isGround(x, z, y, 1.7, 0.88) || distanceToPath(x, z) < 3 || this.inViewCorridor(x, z, 5)) continue;
        const scale = 0.85 + rng() * 0.45;
        if (!this.reserve(x, z, 2.2 * scale)) continue;
        const usePine = y > 7.5 || fbm2(x / 30, z / 30, 1, 3) > 0.45;
        const kind = usePine ? pines : broadleaf;
        const variant = Math.floor(rng() * kind.geometries.length);
        kind.placements[variant].push({ x, y: y - 0.15, z, rotY: rng() * Math.PI * 2, scale });
        this.addTrunkCollider(physics, body, solid, x, y, z, (usePine ? 0.22 : 0.26) * scale, 3.2 * scale);
        i++;
      }
    }

    // --- Palms along the beaches, leaning seaward.
    for (let tries = 0, count = 0; count < 16 && tries < 800; tries++) {
      const theta = rng() * Math.PI * 2;
      if (cliffWeight(Math.cos(theta), Math.sin(theta)) > 0.05) continue;
      const R = coastRadius(theta) * (0.8 + rng() * 0.08);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      if (y < 0.7 || y > 3 || distanceToPath(x, z) < 3 || this.inViewCorridor(x, z, 4)) continue;
      if (!this.reserve(x, z, 3)) continue;
      const variant = Math.floor(rng() * palms.geometries.length);
      palms.placements[variant].push({ x, y: y - 0.1, z, rotY: rng() * Math.PI * 2, scale: 0.85 + rng() * 0.35 });
      this.addTrunkCollider(physics, body, solid, x, y, z, 0.22, 2.4);
      count++;
    }

    // --- Big boulders: on cliff tops, at the hill's shoulders and as meadow landmarks.
    for (let tries = 0, count = 0; count < 34 && tries < 3000; tries++) {
      const x = (rng() - 0.5) * 130;
      const z = (rng() - 0.5) * 130;
      const d = coastDistance(x, z);
      if (d > 0.93 || d < 0.1) continue;
      const nearCliff = cliffWeight(x, z) > 0.5 && d > 0.78;
      if (!nearCliff && rng() > 0.35) continue;
      const y = heightAt(x, z);
      if (y < 1.2 || distanceToPath(x, z) < 3.2 || this.inViewCorridor(x, z, 3)) continue;
      const scale = nearCliff ? 1.0 + rng() * 1.1 : 0.8 + rng() * 0.7;
      if (!this.reserve(x, z, 1.6 * scale)) continue;
      const variant = Math.floor(rng() * rocks.geometries.length);
      // Tall enough with steep enough sides that the character controller can't walk up them.
      const p = { x, y: y - 0.2 * scale, z, rotY: rng() * Math.PI * 2, scale, sy: 1.25 + rng() * 0.45 };
      rocks.placements[variant].push(p);
      this.addRockCollider(physics, body, solid, rocks.geometries[variant], p);
      this.obstacles.push({ kind: 'rock', x, y, z, radius: scale * 0.85 });
      count++;
    }

    // --- Sea stacks and boulders at the foot of the cliffs (break up the cliff line).
    for (let i = 0; i < 70; i++) {
      const theta = rng() * Math.PI * 2;
      const cw = cliffWeight(Math.cos(theta), Math.sin(theta));
      if (cw < 0.6) continue;
      const R = coastRadius(theta) * (0.955 + rng() * 0.06);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      const scale = 1.2 + rng() * 2.2;
      const variant = Math.floor(rng() * seaRocks.geometries.length);
      seaRocks.placements[variant].push({ x, y: Math.min(y, -0.5) - 0.6 * scale, z, rotY: rng() * Math.PI * 2, scale, sy: 1.1 + rng() * 0.9 });
    }

    // --- Outcrops set into the cliff faces (visual only; the faces are not walkable anyway).
    for (let i = 0; i < 90; i++) {
      const theta = rng() * Math.PI * 2;
      if (cliffWeight(Math.cos(theta), Math.sin(theta)) < 0.7) continue;
      const R = coastRadius(theta) * (0.945 + rng() * 0.025);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      const scale = 1.4 + rng() * 1.6;
      const variant = Math.floor(rng() * seaRocks.geometries.length);
      seaRocks.placements[variant].push({ x, y: y - scale * 0.9, z, rotY: rng() * Math.PI * 2, scale, sy: 0.6 + rng() * 0.4 });
    }

    // --- Pebbles and small stones along the beaches (decorative, no colliders).
    for (let tries = 0, count = 0; count < 70 && tries < 2000; tries++) {
      const theta = rng() * Math.PI * 2;
      const R = coastRadius(theta) * (0.86 + rng() * 0.13);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      if (y < -0.2 || y > 1.6 || distanceToPath(x, z) < 1.5 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3) continue;
      const variant = Math.floor(rng() * seaRocks.geometries.length);
      const scale = 0.12 + rng() * 0.22;
      seaRocks.placements[variant].push({ x, y: y - scale * 0.3, z, rotY: rng() * Math.PI * 2, scale, sy: 0.6 + rng() * 0.4 });
      count++;
    }

    // --- Bushes: at wood edges, along the path verge and under the hill.
    for (let tries = 0, count = 0; count < 90 && tries < 4000; tries++) {
      const x = (rng() - 0.5) * 120;
      const z = (rng() - 0.5) * 120;
      const y = heightAt(x, z);
      if (!this.isGround(x, z, y, 1.6, 0.85)) continue;
      const nearTrees = clusterCentres.some((c) => Math.hypot(c.x - x, c.z - z) < 13);
      const pd = distanceToPath(x, z);
      const verge = pd > 2.6 && pd < 4.5;
      if (!nearTrees && !(verge && rng() < 0.5)) continue;
      if (pd < 2.6 || this.inViewCorridor(x, z, 2)) continue;
      const scale = 0.7 + rng() * 0.6;
      if (!this.reserve(x, z, 0.9 * scale)) continue;
      const variant = Math.floor(rng() * bushes.geometries.length);
      bushes.placements[variant].push({ x, y: y - 0.1, z, rotY: rng() * Math.PI * 2, scale });
      count++;
    }

    // --- Grass tufts (meadows, via noise) and flower patches. Purely decorative.
    for (let tries = 0, count = 0; count < 7000 && tries < 40000; tries++) {
      const x = (rng() - 0.5) * 130;
      const z = (rng() - 0.5) * 130;
      const meadow = fbm2(x / 14, z / 14, 2, 61);
      if (rng() > smoothstep(-0.35, 0.25, meadow)) continue;
      const y = heightAt(x, z);
      if (!this.isGround(x, z, y, 1.45, 0.8, false) || distanceToPath(x, z) < 1.4) continue;
      const variant = Math.floor(rng() * grass.geometries.length);
      grass.placements[variant].push({ x, y: y - 0.03, z, rotY: rng() * Math.PI * 2, scale: 0.7 + rng() * 0.8 });
      count++;
    }
    for (let patch = 0; patch < 40; patch++) {
      const cx = (rng() - 0.5) * 110;
      const cz = (rng() - 0.5) * 110;
      const colour = Math.floor(rng() * flowers.geometries.length);
      const size = 8 + Math.floor(rng() * 18);
      for (let i = 0; i < size; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 3.2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (!this.isGround(x, z, y, 1.6, 0.85, false) || distanceToPath(x, z) < 1.5) continue;
        const variant = rng() < 0.85 ? colour : Math.floor(rng() * flowers.geometries.length);
        flowers.placements[variant].push({ x, y: y - 0.02, z, rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5 });
      }
    }

    for (const k of kinds) this.buildInstances(k);
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  /** Dry, walkable ground away from the beach. */
  private isGround(x: number, z: number, y: number, minHeight: number, minNormalY: number, checkOccupied = true): boolean {
    if (y < minHeight || coastDistance(x, z) > 0.94) return false;
    if (normalAt(x, z, n).y < minNormalY) return false;
    if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < LIGHTHOUSE.padRadius + 1) return false;
    if (checkOccupied && this.occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) return false;
    return true;
  }

  private reserve(x: number, z: number, r: number): boolean {
    if (this.occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r)) return false;
    this.occupied.push({ x, z, r });
    return true;
  }

  /** Keep the sight line from the spawn beach to the lighthouse open. */
  private inViewCorridor(x: number, z: number, halfWidth: number): boolean {
    const ax = SPAWN.x;
    const az = SPAWN.z;
    const bx = LIGHTHOUSE.x;
    const bz = LIGHTHOUSE.z;
    const abx = bx - ax;
    const abz = bz - az;
    const t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
    // Only the near half matters; further along, the hill lifts the lighthouse above the trees.
    if (t > 0.55) return false;
    return Math.hypot(x - (ax + abx * t), z - (az + abz * t)) < halfWidth + t * 10;
  }

  private addTrunkCollider(
    physics: PhysicsWorld,
    body: ReturnType<PhysicsWorld['createStaticBody']>,
    groupsMask: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
  ): void {
    physics.world.createCollider(
      physics.rapier.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y + height / 2 - 0.3, z).setCollisionGroups(groupsMask),
      body,
    );
    this.obstacles.push({ kind: 'tree', x, y, z, radius });
  }

  private addRockCollider(
    physics: PhysicsWorld,
    body: ReturnType<PhysicsWorld['createStaticBody']>,
    groupsMask: number,
    geometry: THREE.BufferGeometry,
    p: Placement,
  ): void {
    const m = this.matrixFor(p);
    const src = geometry.getAttribute('position');
    // A subsample of vertices is plenty for a convex hull.
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i += 3) {
      v.fromBufferAttribute(src, i).applyMatrix4(m);
      pts.push(v.x, v.y, v.z);
    }
    const desc = physics.rapier.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) physics.world.createCollider(desc.setCollisionGroups(groupsMask), body);
  }

  private matrixFor(p: Placement): THREE.Matrix4 {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, p.y, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY),
      new THREE.Vector3(p.scale, p.scale * (p.sy ?? 1), p.scale),
    );
  }

  private buildInstances(kind: PropKind): void {
    kind.geometries.forEach((geo, i) => {
      const list = kind.placements[i];
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, kind.material, list.length);
      list.forEach((p, j) => mesh.setMatrixAt(j, this.matrixFor(p)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = kind.castShadow;
      // Thin grass blades only produce shadow-map noise; they take their light from the ground.
      mesh.receiveShadow = kind.castShadow;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.disposables.push({ dispose: () => mesh.dispose() });
    });
  }

  /** Total number of placed instances (debugging/perf checks). */
  get instanceCount(): number {
    let total = 0;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) total += (o as THREE.InstancedMesh).count;
    });
    return total;
  }

  update(time: number): void {
    this.time.value = time;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
