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
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
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
