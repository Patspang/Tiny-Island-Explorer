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
  PUZZLE_CLEARINGS,
  QUEST_SPOTS,
  RUIN,
  SPAWN,
} from './IslandShape';
import { createRng, fbm2, smoothstep } from './noise';
import { broadleafTree, bush, driftwood, fern, flower, grassTuft, leafClusterTexture, mushrooms, palmTree, pineTree, rock, starfish } from './props';
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
  /** Defaults to `castShadow`. */
  receiveShadow?: boolean;
  /** Shadow-pass material for geometry the vertex shader reshapes (billboards). */
  depthMaterial?: THREE.Material;
}

/** Grass is split into chunks so off-screen and distant patches can be skipped. */
const GRASS_CHUNK = 24;
const GRASS_DRAW_DISTANCE = 60;

const n = { x: 0, y: 1, z: 0 };

/** How a plant gives way to the player: horizontal radius (m), lean per metre of height, sag. */
interface Push {
  radius: number;
  lean: number;
  sag: number;
}

/**
 * Player position shared by every plant material, so grass, flowers, ferns and bushes part
 * around the explorer. Purely visual: plants have no colliders.
 */
const playerUniform = { value: new THREE.Vector3(0, -1000, 0) };

/**
 * Vertex shader chunk: bend away from the player within `push.radius`, more toward the top of
 * the plant and with a little sag, converted into the instance's local frame.
 */
function pushChunk(push: Push): string {
  return /* glsl */ `
        #ifdef USE_INSTANCING
        {
          mat3 im = mat3( instanceMatrix );
          vec3 wp = ( instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          vec2 away = wp.xz - uPlayer.xz;
          float d = length( away );
          float f = ( 1.0 - smoothstep( ${(push.radius * 0.3).toFixed(3)}, ${push.radius.toFixed(3)}, d ) ) * step( abs( wp.y - uPlayer.y ), 2.5 );
          float hh = max( position.y, 0.0 );
          vec2 dir = away / max( d, 1e-3 );
          vec3 bend = vec3( dir.x, 0.0, dir.y ) * f * ${push.lean.toFixed(3)} * hh - vec3( 0.0, f * ${push.sag.toFixed(3)} * hh, 0.0 );
          transformed += ( transpose( im ) * bend ) / dot( im[0], im[0] );
        }
        #endif`;
}

/** Vertex shader chunk: wind sway that grows with height above `start`. */
function windChunk(strength: number, start: number, push?: Push): string {
  return /* glsl */ `#include <begin_vertex>
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
        }${push ? pushChunk(push) : ''}`;
}

/** Wind sway injected into a standard material; displacement grows with height above `start`. */
function windMaterial(
  base: THREE.MeshStandardMaterialParameters,
  strength: number,
  start: number,
  time: { value: number },
  push?: Push,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uPlayer = playerUniform;
    // Foliage is two-sided but its normals describe the plant's volume (outward from a canopy,
    // up for grass). Don't flip them on back faces, or every frond or blade seen from behind turns black.
    if (mat.side === THREE.DoubleSide) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );',
      );
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;')
      .replace('#include <begin_vertex>', windChunk(strength, start, push));
  };
  mat.customProgramCacheKey = () => `wind-${strength}-${start}-${mat.side}-${push ? Object.values(push).join('-') : ''}`;
  return mat;
}

/**
 * Camera-facing leaf cards (geometry from `fluffCards`): each card's centre goes through the
 * normal transform, then its `corner` offset is added in view space, scaled with the instance.
 * The same trick in the shadow pass turns cards toward the light, so shadows stay leafy and full.
 */
function billboard(
  shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> },
  time: { value: number },
  strength: number,
  start: number,
  push?: Push,
): void {
  shader.uniforms.uTime = time;
  shader.uniforms.uPlayer = playerUniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;\nattribute vec2 corner;')
    .replace('#include <begin_vertex>', windChunk(strength, start, push))
    .replace(
      '#include <project_vertex>',
      /* glsl */ `vec4 mvPosition = vec4( transformed, 1.0 );
      float cardScale = 1.0;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        cardScale = length( instanceMatrix[0].xyz );
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      mvPosition.xy += corner * cardScale;
      gl_Position = projectionMatrix * mvPosition;`,
    );
}

function fluffMaterials(map: THREE.Texture, time: { value: number }, strength: number, start: number, push?: Push) {
  const key = `${strength}-${start}-${push ? Object.values(push).join('-') : ''}`;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map, alphaTest: 0.5, alphaToCoverage: true });
  material.onBeforeCompile = (shader) => billboard(shader, time, strength, start, push);
  material.customProgramCacheKey = () => `fluff-${key}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  depth.onBeforeCompile = (shader) => billboard(shader, time, strength, start, push);
  depth.customProgramCacheKey = () => `fluff-depth-${key}`;
  return { material, depth };
}

/**
 * Stone: vertex-coloured, with fine mottling and speckle computed per pixel from the rock's own
 * (object-space) position, so the pattern sticks to the rock and scales with it.
 */
function stoneMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStonePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vStonePos;
        float stoneHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float stoneNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(stoneHash(i), stoneHash(i + vec3(1, 0, 0)), f.x), mix(stoneHash(i + vec3(0, 1, 0)), stoneHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(stoneHash(i + vec3(0, 0, 1)), stoneHash(i + vec3(1, 0, 1)), f.x), mix(stoneHash(i + vec3(0, 1, 1)), stoneHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 q = vStonePos * 3.0;
          float m = stoneNoise(q) * 0.55 + stoneNoise(q * 2.3) * 0.3 + stoneNoise(q * 5.1) * 0.15;
          float speck = smoothstep(0.8, 0.95, stoneNoise(vStonePos * 31.0));
          diffuseColor.rgb *= (0.72 + 0.5 * m) * (1.0 - 0.1 * speck);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'stone';
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
  /** Ground darkening under props (baked into the terrain colours). */
  readonly occluders: Array<{ x: number; z: number; radius: number; strength: number }> = [];
  private readonly time = { value: 0 };
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly occupied: Array<{ x: number; z: number; r: number }> = [];
  private readonly grassChunks: Array<{ mesh: THREE.InstancedMesh; centre: THREE.Vector3 }> = [];
  private readonly bushSpots: Array<{ x: number; y: number; z: number; r: number }> = [];
  /** Flower-patch centres (butterflies) and wood centres (fireflies). */
  readonly meadows: Array<{ x: number; y: number; z: number }> = [];
  readonly woods: Array<{ x: number; y: number; z: number }> = [];

  constructor(physics: PhysicsWorld) {
    const rng = createRng(4242);
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);

    const foliage = this.track(windMaterial({ vertexColors: true, roughness: 0.85 }, 0.006, 2.2, this.time));
    const palmMat = this.track(
      windMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }, 0.004, 3.5, this.time),
    );
    const bushPush: Push = { radius: 1.3, lean: 0.35, sag: 0.12 };
    const bushMat = this.track(windMaterial({ vertexColors: true, roughness: 0.9 }, 0.03, 0.3, this.time, bushPush));
    const flowerMat = this.track(windMaterial({ vertexColors: true, roughness: 0.9 }, 0.03, 0.3, this.time, { radius: 0.6, lean: 1.4, sag: 0.4 }));
    const grassMat = this.track(
      windMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }, 0.35, 0, this.time, { radius: 0.65, lean: 1.6, sag: 0.6 }),
    );
    const rockMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));

    const fernMat = this.track(
      windMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, 0.08, 0.05, this.time, { radius: 0.9, lean: 0.9, sag: 0.4 }),
    );
    const trees = [11, 23, 37, 51, 67].map(broadleafTree);
    const bushProps = [8, 19, 33].map(bush);
    const broadleaf: PropKind = { geometries: trees.map((t) => t.core), material: foliage, castShadow: true, placements: [] };
    const leafTex = this.track(leafClusterTexture());
    const fluff = fluffMaterials(leafTex, this.time, 0.006, 2.2);
    this.track(fluff.material);
    this.track(fluff.depth);
    // Leaf cards share the trees' placements (aliased below). They don't receive shadow maps:
    // across hundreds of small cards that reads as speckle; the gradient is baked in instead.
    const broadleafLeaves: PropKind = { geometries: trees.map((t) => t.cards), material: fluff.material, depthMaterial: fluff.depth, castShadow: true, receiveShadow: false, placements: [] };
    const pineProps = [5, 17, 29].map(pineTree);
    const pines: PropKind = { geometries: pineProps, material: foliage, castShadow: true, placements: [] };
    const palms: PropKind = { geometries: [3, 41, 77].map(palmTree), material: palmMat, castShadow: true, placements: [] };
    const bushes: PropKind = { geometries: bushProps.map((b) => b.core), material: bushMat, castShadow: true, placements: [] };
    const bushFluff = fluffMaterials(leafTex, this.time, 0.03, 0.3, bushPush);
    this.track(bushFluff.material);
    this.track(bushFluff.depth);
    const bushLeaves: PropKind = { geometries: bushProps.map((b) => b.cards), material: bushFluff.material, depthMaterial: bushFluff.depth, castShadow: true, receiveShadow: false, placements: [] };
    const ferns: PropKind = { geometries: [5, 6, 7].map(fern), material: fernMat, castShadow: false, placements: [] };
    const fungi: PropKind = { geometries: [3, 4, 9].map(mushrooms), material: rockMat, castShadow: false, placements: [] };
    const beachwood: PropKind = { geometries: [21, 22].map(driftwood), material: rockMat, castShadow: true, placements: [] };
    const stars: PropKind = { geometries: [1, 2, 3].map(starfish), material: rockMat, castShadow: false, placements: [] };
    const stoneMat = this.track(stoneMaterial());
    const rocks: PropKind = { geometries: [2, 13, 31, 47].map((s) => rock(s)), material: stoneMat, castShadow: true, placements: [] };
    // Sea rocks, outcrops and pebbles are numerous and mostly seen from afar: fewer triangles.
    const seaRocks: PropKind = { geometries: [61, 73, 89].map((s) => rock(s, false, 2)), material: stoneMat, castShadow: true, placements: [] };
    const grass: PropKind = { geometries: [1, 2, 3].map(grassTuft), material: grassMat, castShadow: false, placements: [] };
    const flowers: PropKind = {
      geometries: ['#ffffff', '#ffd23f', '#f78fb3', '#b8a1ff', '#ff9b54'].map((c, i) => flower(90 + i, c)),
      material: flowerMat,
      castShadow: false,
      placements: [],
    };
    const kinds = [broadleaf, broadleafLeaves, pines, palms, bushes, bushLeaves, rocks, seaRocks, flowers, ferns, fungi, beachwood, stars];
    for (const k of [...kinds, grass]) {
      for (const g of k.geometries) this.track(g);
      k.placements = k.geometries.map(() => []);
    }
    broadleafLeaves.placements = broadleaf.placements;
    bushLeaves.placements = bushes.placements;

    // Reserve the lighthouse pad and the spawn area.
    this.occupied.push({ x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: LIGHTHOUSE.padRadius + 3.5 });
    this.occupied.push({ x: SPAWN.x, z: SPAWN.z, r: 5 });

    // Keep quest pieces (and the ruin) in the open.
    for (const q of QUEST_SPOTS) this.occupied.push({ x: q.x, z: q.z, r: 2.5 });
    this.occupied.push({ x: RUIN.x, z: RUIN.z, r: 3.5 });
    // ...and the puzzle props (bells, chest, signs, shells, the X, the bottle).
    for (const c of PUZZLE_CLEARINGS) this.occupied.push(c);

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
        this.occluders.push({ x, z, radius: (usePine ? 1.5 : 2.0) * scale, strength: 0.38 });
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
      this.occluders.push({ x, z, radius: 1.1, strength: 0.22 });
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
      this.occluders.push({ x, z, radius: scale * 1.1, strength: 0.5 });
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
      this.bushSpots.push({ x, y, z, r: 0.95 * scale });
      this.occluders.push({ x, z, radius: 0.8 * scale, strength: 0.32 });
      count++;
    }

    // --- Grass tufts (meadows, via noise) and flower patches. Purely decorative.
    for (let tries = 0, count = 0; count < 14000 && tries < 80000; tries++) {
      const x = (rng() - 0.5) * 130;
      const z = (rng() - 0.5) * 130;
      const meadow = fbm2(x / 14, z / 14, 2, 61);
      if (rng() > smoothstep(-0.35, 0.25, meadow)) continue;
      const y = heightAt(x, z);
      if (!this.isGround(x, z, y, 1.45, 0.8, false) || distanceToPath(x, z) < 1.4) continue;
      // Keep stone plates, the chest and the X readable.
      if (PUZZLE_CLEARINGS.some((c) => Math.hypot(c.x - x, c.z - z) < c.r * 0.7)) continue;
      const variant = Math.floor(rng() * grass.geometries.length);
      grass.placements[variant].push({ x, y: y - 0.03, z, rotY: rng() * Math.PI * 2, scale: 0.6 + rng() * 0.5 });
      count++;
    }
    for (let patch = 0; patch < 40; patch++) {
      const cx = (rng() - 0.5) * 110;
      const cz = (rng() - 0.5) * 110;
      const colour = Math.floor(rng() * flowers.geometries.length);
      const size = 8 + Math.floor(rng() * 18);
      let placed = 0;
      for (let i = 0; i < size; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 3.2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (!this.isGround(x, z, y, 1.6, 0.85, false) || distanceToPath(x, z) < 1.5) continue;
        const variant = rng() < 0.85 ? colour : Math.floor(rng() * flowers.geometries.length);
        flowers.placements[variant].push({ x, y: y - 0.02, z, rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5 });
        placed++;
      }
      if (placed >= 4) this.meadows.push({ x: cx, y: heightAt(cx, cz), z: cz });
    }
    for (const c of clusterCentres) this.woods.push({ x: c.x, y: heightAt(c.x, c.z), z: c.z });

    // --- Woodland floor: ferns and mushrooms around the woods.
    for (const c of clusterCentres) {
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const r = 2 + Math.sqrt(rng()) * 9;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (!this.isGround(x, z, y, 1.6, 0.85, false) || distanceToPath(x, z) < 1.8) continue;
        const variant = Math.floor(rng() * ferns.geometries.length);
        ferns.placements[variant].push({ x, y: y - 0.03, z, rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6 });
      }
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const r = 1.5 + rng() * 7;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (!this.isGround(x, z, y, 1.6, 0.85, false) || distanceToPath(x, z) < 1.5) continue;
        const variant = Math.floor(rng() * fungi.geometries.length);
        fungi.placements[variant].push({ x, y: y - 0.01, z, rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6 });
      }
    }

    // --- Beachcombing: driftwood above the tide line, starfish on the wet sand.
    for (let tries = 0, count = 0; count < 9 && tries < 600; tries++) {
      const theta = rng() * Math.PI * 2;
      if (cliffWeight(Math.cos(theta), Math.sin(theta)) > 0.05) continue;
      const R = coastRadius(theta) * (0.86 + rng() * 0.06);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      if (y < 0.3 || y > 1.5 || distanceToPath(x, z) < 2.5 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3) continue;
      if (!this.reserve(x, z, 1.4)) continue;
      const variant = Math.floor(rng() * beachwood.geometries.length);
      beachwood.placements[variant].push({ x, y: y - 0.05, z, rotY: theta + Math.PI / 2 + (rng() - 0.5) * 0.8, scale: 0.9 + rng() * 0.3 });
      count++;
    }
    for (let tries = 0, count = 0; count < 22 && tries < 1500; tries++) {
      const theta = rng() * Math.PI * 2;
      if (cliffWeight(Math.cos(theta), Math.sin(theta)) > 0.05) continue;
      const R = coastRadius(theta) * (0.95 + rng() * 0.04);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const y = heightAt(x, z);
      if (y < -0.25 || y > 0.45) continue;
      const variant = Math.floor(rng() * stars.geometries.length);
      stars.placements[variant].push({ x, y, z, rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5 });
      count++;
    }

    for (const k of kinds) this.buildInstances(k);
    this.buildGrassChunks(grass);
  }

  /** Grass in square chunks (one instanced mesh per chunk and variant) for distance culling. */
  private buildGrassChunks(grass: PropKind): void {
    const chunks = new Map<string, Placement[][]>();
    grass.placements.forEach((list, variant) => {
      for (const p of list) {
        const key = `${Math.floor(p.x / GRASS_CHUNK)},${Math.floor(p.z / GRASS_CHUNK)}`;
        let c = chunks.get(key);
        if (!c) {
          c = grass.geometries.map(() => []);
          chunks.set(key, c);
        }
        c[variant].push(p);
      }
    });
    for (const [key, lists] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      const centre = new THREE.Vector3((cx + 0.5) * GRASS_CHUNK, 0, (cz + 0.5) * GRASS_CHUNK);
      lists.forEach((list, variant) => {
        if (list.length === 0) return;
        const mesh = new THREE.InstancedMesh(grass.geometries[variant], grass.material, list.length);
        list.forEach((p, j) => mesh.setMatrixAt(j, this.matrixFor(p)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        this.grassChunks.push({ mesh, centre });
        this.disposables.push({ dispose: () => mesh.dispose() });
      });
    }
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
      mesh.receiveShadow = kind.receiveShadow ?? kind.castShadow;
      if (kind.depthMaterial) mesh.customDepthMaterial = kind.depthMaterial;
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

  /** How deep a point is inside a bush: 0 outside, 1 at a bush's centre (for leaf effects). */
  foliageAt(x: number, y: number, z: number): number {
    let best = 0;
    for (const b of this.bushSpots) {
      if (Math.abs(b.y - y) > 1.5) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < b.r) best = Math.max(best, 1 - d / b.r);
    }
    return best;
  }

  update(time: number, camera?: THREE.Camera, player?: THREE.Vector3): void {
    this.time.value = time;
    if (player) playerUniform.value.copy(player);
    if (camera) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      const limit = GRASS_DRAW_DISTANCE + GRASS_CHUNK * 0.71;
      for (const c of this.grassChunks) c.mesh.visible = Math.hypot(c.centre.x - cx, c.centre.z - cz) < limit;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
