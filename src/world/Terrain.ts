import * as THREE from 'three';
import { WORLD } from '../config';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { cliffWeight, heightAt, normalAt, pathMask } from './IslandShape';
import { fbm2, smoothstep } from './noise';

const PALETTE = {
  seabed: new THREE.Color('#c9b98f'),
  wetSand: new THREE.Color('#d2b582'),
  sand: new THREE.Color('#f0d9a8'),
  grassLight: new THREE.Color('#93c95a'),
  grass: new THREE.Color('#6caf47'),
  grassDeep: new THREE.Color('#4f9440'),
  grassSlope: new THREE.Color('#5c8a3d'),
  path: new THREE.Color('#c9a675'),
  rock: new THREE.Color('#b0a490'),
  rockDark: new THREE.Color('#8a7f70'),
  rockLight: new THREE.Color('#c9bea8'),
  moss: new THREE.Color('#71904a'),
};

const tmp = new THREE.Color();
/** Per-vertex material weights for the detail shader: sand, rock, path. */
const weights = { sand: 0, rock: 0, path: 0 };
const n = { x: 0, y: 1, z: 0 };

function mixInto(target: THREE.Color, c: THREE.Color, w: number) {
  if (w <= 0) return;
  target.lerp(c, Math.min(1, w));
}

/** Colour for a terrain point. Blends are smooth so no region has a hard edge. */
function surfaceColor(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  const variation = fbm2(x / 7, z / 7, 2, 91);
  const large = fbm2(x / 25, z / 25, 2, 92);

  // Start from grass, varied by large-scale noise.
  out.copy(PALETTE.grass);
  mixInto(out, PALETTE.grassLight, 0.5 + large * 0.9);
  mixInto(out, PALETTE.grassDeep, smoothstep(0.1, 0.6, -large) * 0.8 + smoothstep(0.2, 0.7, variation) * 0.25);

  // Slopes darken, then expose rock.
  const slope = 1 - ny; // 0 flat, ~0.3 at 45°
  mixInto(out, PALETTE.grassSlope, smoothstep(0.08, 0.2, slope));
  const cliff = cliffWeight(x, z);
  const rockW = smoothstep(0.22 - cliff * 0.06, 0.34 - cliff * 0.06, slope + variation * 0.04);
  if (rockW > 0) {
    // Horizontal strata: alternating light and dark bands, slightly wavy.
    const band = Math.sin(h * 2.1 + variation * 1.6 + large * 2);
    tmp.copy(PALETTE.rock);
    mixInto(tmp, PALETTE.rockLight, smoothstep(0.3, 0.9, band) * 0.8);
    mixInto(tmp, PALETTE.rockDark, smoothstep(-0.4, -0.95, band) * 0.8);
    mixInto(tmp, PALETTE.moss, smoothstep(0.3, 0.2, slope) * 0.6);
    // Damp, darker rock near the waterline.
    mixInto(tmp, PALETTE.rockDark, smoothstep(1.2, -0.5, h) * 0.6);
    mixInto(out, tmp, rockW);
  }

  // Footpath.
  const p = pathMask(x, z);
  if (p > 0) {
    tmp.copy(PALETTE.path).lerp(PALETTE.sand, 0.15 + variation * 0.15);
    mixInto(out, tmp, p * 0.9 * (1 - rockW));
  }

  // Sand near the water line, wet sand right at it, seabed below.
  const sandW = smoothstep(1.75 + variation * 0.35, 1.1, h) * (1 - rockW * 0.8);
  mixInto(out, PALETTE.sand, sandW);
  mixInto(out, PALETTE.wetSand, smoothstep(0.35, 0.0, h) * (1 - rockW * 0.6));
  mixInto(out, PALETTE.seabed, smoothstep(-0.2, -1.5, h));

  // Fine mottling so large areas don't read as flat gradients.
  const fine = fbm2(x / 2.3, z / 2.3, 2, 93);
  out.multiplyScalar(1 + fine * 0.09);
  weights.sand = Math.max(sandW, smoothstep(0.35, -0.5, h));
  weights.rock = rockW;
  weights.path = p * (1 - rockW);
  return out;
}

/**
 * Island terrain: one render mesh and one static trimesh collider,
 * both built from the same vertex buffer so they can never drift apart.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;

  constructor() {
    const size = WORLD.terrainSize;
    const seg = WORLD.terrainSegments;
    const verts = seg + 1;
    const positions = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const surface = new Float32Array(verts * verts * 3);
    const color = new THREE.Color();

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const x = -size / 2 + (size * i) / seg;
        const z = -size / 2 + (size * j) / seg;
        const h = heightAt(x, z);
        normalAt(x, z, n);
        const k = (j * verts + i) * 3;
        positions[k] = x;
        positions[k + 1] = h;
        positions[k + 2] = z;
        surfaceColor(x, z, h, n.y, color);
        colors[k] = color.r;
        colors[k + 1] = color.g;
        colors[k + 2] = color.b;
        surface[k] = weights.sand;
        surface[k + 1] = weights.rock;
        surface[k + 2] = weights.path;
      }
    }

    const indices = new Uint32Array(seg * seg * 6);
    let t = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * verts + i;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        // Counter-clockwise when viewed from above (+Y).
        indices[t++] = a;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = d;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('surface', new THREE.BufferAttribute(surface, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // Shade with normals of the actual triangles (analytic normals are sharper than the
    // mesh can represent and streak on cliffs).
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
    });
    material.onBeforeCompile = addSurfaceDetail;
    material.customProgramCacheKey = () => 'terrain-detail-v1';
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }

  /**
   * Darken the ground under and around trees, rocks and buildings: cheap baked ambient
   * occlusion that seats props in the landscape instead of letting them float.
   */
  bakeOcclusion(occluders: ReadonlyArray<{ x: number; z: number; radius: number; strength: number }>): void {
    const size = WORLD.terrainSize;
    const seg = WORLD.terrainSegments;
    const verts = seg + 1;
    const cell = size / seg;
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const occ = new Float32Array(verts * verts).fill(1);
    for (const o of occluders) {
      const r = o.radius * 2.2;
      const i0 = Math.max(0, Math.floor((o.x - r + size / 2) / cell));
      const i1 = Math.min(seg, Math.ceil((o.x + r + size / 2) / cell));
      const j0 = Math.max(0, Math.floor((o.z - r + size / 2) / cell));
      const j1 = Math.min(seg, Math.ceil((o.z + r + size / 2) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -size / 2 + i * cell;
          const z = -size / 2 + j * cell;
          const d = Math.hypot(x - o.x, z - o.z) / r;
          if (d >= 1) continue;
          const k = j * verts + i;
          const a = 1 - o.strength * (1 - d * d) * (1 - d * d);
          occ[k] = Math.min(occ[k], a);
        }
      }
    }
    for (let k = 0; k < occ.length; k++) {
      if (occ[k] === 1) continue;
      col.setXYZ(k, col.getX(k) * occ[k], col.getY(k) * occ[k], col.getZ(k) * occ[k]);
    }
    col.needsUpdate = true;
  }

  /** Adds the matching trimesh collider. Uses the exact render vertices and triangles. */
  addCollider(physics: PhysicsWorld): void {
    const pos = this.geometry.getAttribute('position').array as Float32Array;
    const idx = this.geometry.getIndex()!.array as Uint32Array;
    const body = physics.createStaticBody();
    const desc = physics.rapier.ColliderDesc.trimesh(pos, idx)
      .setFriction(0.8)
      .setCollisionGroups(groups(GROUP.terrain, 0xffff));
    physics.world.createCollider(desc, body);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Procedural close-up detail on the terrain: sand ripples, grass mottling, rock cracks and path
 * grit, shaded as real bumps (screen-space bump mapping) and faded out with distance so far
 * terrain doesn't shimmer.
 */
function addSurfaceDetail(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      attribute vec3 surface;
      varying vec3 vSurface;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;`,
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vSurface = surface;
      vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vSurface;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      float tdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tdNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(tdHash(i), tdHash(i + vec2(1.0, 0.0)), f.x), mix(tdHash(i + vec2(0.0, 1.0)), tdHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float tdFbm(vec2 p) { return 0.5 * tdNoise(p) + 0.3 * tdNoise(p * 2.1 + 3.7) + 0.2 * tdNoise(p * 4.3 - 1.3); }
      // Small-scale surface relief (metres) plus a colour tint, blended by material weights.
      float tdHeight(vec3 wp, vec3 wn, vec3 w, out float tint) {
        vec2 p = wp.xz;
        float grassW = clamp(1.0 - w.x - w.y - w.z, 0.0, 1.0);
        // Grass: soft clumps with a faint grain.
        float clumps = tdFbm(p * 1.1);
        float grassH = clumps * 0.035 + tdNoise(p * 6.0) * 0.006;
        // Sand: wind ripples, gently warped.
        float warp = tdFbm(p * 0.35) * 6.0;
        float ripples = sin(dot(p, vec2(2.1, 3.4)) * 1.6 + warp) * 0.5 + 0.5;
        float sandH = ripples * 0.022 + tdNoise(p * 9.0) * 0.003;
        // Rock: sampled across the face on steep ground (so cliffs aren't streaked), with
        // horizontal strata and a few broad cracks.
        float steep = 1.0 - clamp(abs(wn.y), 0.0, 1.0);
        vec2 rp = mix(p, vec2(wp.x + wp.z, wp.y * 1.6), smoothstep(0.3, 0.7, steep));
        float layers = tdFbm(rp * vec2(0.6, 1.8));
        float ridged = 1.0 - abs(tdNoise(rp * 0.9 + 7.1) * 2.0 - 1.0);
        float cracks = smoothstep(0.9, 0.985, ridged);
        float rockH = layers * 0.09 + tdFbm(rp * 3.0) * 0.025 - cracks * 0.03;
        // Path: packed earth with soft embedded stones.
        float stones = smoothstep(0.58, 0.85, tdNoise(p * 2.6));
        float pathH = stones * 0.018 + tdNoise(p * 7.0) * 0.004;
        tint = grassW * (clumps - 0.5) * 0.18 + w.x * (ripples - 0.5) * 0.07 + w.y * ((layers - 0.5) * 0.25 - cracks * 0.16) + w.z * (stones * 0.1 - 0.02);
        return grassW * grassH + w.x * sandH + w.y * rockH + w.z * pathH;
      }
      vec3 tdPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
        vec3 sx = dFdx(surfPos); vec3 sy = dFdy(surfPos);
        vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
        float det = dot(sx, r1) * faceDir;
        vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surfNorm - grad);
      }`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float tdDist = length(vViewPosition);
      float tdFade = 1.0 - smoothstep(14.0, 55.0, tdDist);
      float tdTint;
      float tdH = tdHeight(vWorldPos, normalize(vWorldNormal), vSurface, tdTint);
      diffuseColor.rgb *= 1.0 + tdTint * mix(0.4, 1.0, tdFade);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        vec2 dHdxy = vec2(dFdx(tdH), dFdy(tdH)) * tdFade * 1.3;
        // Detail finer than a pixel turns to noise: back off where the height changes too fast.
        dHdxy *= 1.0 - smoothstep(0.004, 0.02, length(dHdxy));
        normal = tdPerturb(-vViewPosition, normal, dHdxy, faceDirection);
      }`,
    );
}
