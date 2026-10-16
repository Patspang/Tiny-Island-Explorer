// Procedural prop geometry. Each builder returns one merged, non-indexed geometry with
// vertex colours, ready to be drawn many times through an InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, fbm2 } from './noise';

type Rng = () => number;

const tmpColor = new THREE.Color();

/** Normalise a primitive: non-indexed, no UVs, solid vertex colour. */
function prep(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  const c = tmpColor.set(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Darken downward-facing faces and the lower part of a blob: cheap ambient occlusion. */
function shadeBlob(geo: THREE.BufferGeometry, centerY: number, radius: number, amount = 0.45): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = geo.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const up = nor.getY(i) * 0.5 + 0.5;
    const low = THREE.MathUtils.clamp((pos.getY(i) - (centerY - radius)) / (2 * radius), 0, 1);
    const k = 1 - amount * (1 - (0.55 * up + 0.45 * low));
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
}

/** Push vertices along their direction from the blob centre by smooth noise. */
function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number): void {
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + amount * fbm2(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3 - seed, 2, seed);
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/** Icosphere with shared vertices, so displaced shapes get smooth normals. */
function smoothIco(radius: number, detail: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const merged = mergeVertices(ico, 1e-4);
  ico.dispose();
  merged.computeVertexNormals();
  return merged;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('Failed to merge prop geometry');
  merged.computeBoundingSphere();
  return merged;
}

function trunk(rng: Rng, height: number, r0: number, r1: number, lean: number, color: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, 7, 4);
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  const dir = rng() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    const bend = lean * t * t;
    pos.setX(i, pos.getX(i) + Math.cos(dir) * bend);
    pos.setZ(i, pos.getZ(i) + Math.sin(dir) * bend);
  }
  g.computeVertexNormals();
  const out = prep(g, color);
  shadeBlob(out, height / 2, height / 2, 0.3);
  return out;
}

const LEAF_GREENS = ['#5e9e3e', '#6aab45', '#4f8f3a', '#79b54d', '#588f3c'];

export interface FoliageProp {
  /** Opaque parts: trunk, branches and the inner canopy volume. */
  core: THREE.BufferGeometry;
  /** Alpha-tested leaf cards around the canopy (uses the leaf texture). */
  cards: THREE.BufferGeometry;
}

interface CanopyBlob {
  c: THREE.Vector3;
  r: number;
  color: THREE.Color;
}

/**
 * Leaf cards scattered over the outside of canopy blobs. Normals point away from the canopy
 * centre, so the cloud of cards shades like one soft volume while its silhouette stays leafy.
 */
function leafCards(rng: Rng, blobs: CanopyBlob[], perBlob: number, size: [number, number]): THREE.BufferGeometry {
  const centroid = new THREE.Vector3();
  for (const b of blobs) centroid.add(b.c);
  centroid.divideScalar(blobs.length);
  let top = -Infinity;
  let bottom = Infinity;
  for (const b of blobs) {
    top = Math.max(top, b.c.y + b.r);
    bottom = Math.min(bottom, b.c.y - b.r);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (const b of blobs) {
    for (let i = 0; i < perBlob; i++) {
      // Point on (or just inside) the blob surface, biased away from the underside.
      dir.set(rng() * 2 - 1, rng() * 1.6 - 0.5, rng() * 2 - 1).normalize();
      const p = b.c.clone().addScaledVector(dir, b.r * (0.72 + rng() * 0.3));
      n.copy(p).sub(centroid).normalize();
      // Card plane: roughly facing outward, randomly twisted.
      const tilt = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(1.2);
      const face = n.clone().add(tilt).normalize();
      u.set(0, 1, 0).cross(face);
      if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
      u.normalize();
      v.crossVectors(face, u).normalize();
      const spin = rng() * Math.PI * 2;
      const cu = u.clone().multiplyScalar(Math.cos(spin)).addScaledVector(v, Math.sin(spin));
      const cv = face.clone().cross(cu).normalize();
      const sz = size[0] + rng() * (size[1] - size[0]);
      const base = pos.length / 3;
      const corners: Array<[number, number]> = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      // Light from above, darker underneath and inside: cheap canopy self-shadowing.
      const height = (p.y - bottom) / Math.max(0.01, top - bottom);
      const ao = 0.68 + 0.42 * height;
      c.copy(b.color).offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.1).multiplyScalar(ao);
      for (const [a, bb] of corners) {
        pos.push(p.x + cu.x * a * sz * 0.5 + cv.x * bb * sz * 0.5, p.y + cu.y * a * sz * 0.5 + cv.y * bb * sz * 0.5, p.z + cu.z * a * sz * 0.5 + cv.z * bb * sz * 0.5);
        nor.push(n.x, n.y, n.z);
        uv.push((a + 1) / 2, (bb + 1) / 2);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Inner canopy volume: lumpy blobs a little smaller than the card shell. */
function canopyCore(blobs: CanopyBlob[], seed: number): THREE.BufferGeometry[] {
  return blobs.map((b, i) => {
    // Dark backfill only: the leaf cards provide the visible surface.
    const g = smoothIco(b.r * 0.68, 1);
    lumpy(g, 0.25, seed + i * 13);
    g.translate(b.c.x, b.c.y, b.c.z);
    const p = prep(g, b.color.clone().multiplyScalar(0.55));
    shadeBlob(p, b.c.y, b.r, 0.5);
    return p;
  });
}

/** Broadleaf tree: flared, bent trunk that forks into branches carrying leafy canopy clusters. */
export function broadleafTree(seed: number): FoliageProp {
  const rng = createRng(seed);
  const h = 2.3 + rng() * 0.8;
  const lean = 0.2 + rng() * 0.3;
  const leanDir = rng() * Math.PI * 2;
  const bark = '#6e4a30';
  const trunkTop = new THREE.Vector3(Math.cos(leanDir) * lean, h, Math.sin(leanDir) * lean);
  const parts: THREE.BufferGeometry[] = [];
  // Trunk with a root flare.
  const trunkPts = [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(trunkTop.x * 0.4, h * 0.55, trunkTop.z * 0.4), trunkTop];
  parts.push(prep(taperTube(trunkPts, 0.34, 0.14, 9, 10, (t) => 1 + 0.6 * Math.pow(1 - Math.min(1, t * 4), 2)), bark));
  const leaf = LEAF_GREENS[Math.floor(rng() * LEAF_GREENS.length)];
  const blobs: CanopyBlob[] = [];
  const baseColor = new THREE.Color(leaf);
  blobs.push({ c: trunkTop.clone().add(new THREE.Vector3(0, 1.1, 0)), r: 1.3, color: baseColor.clone() });
  const branches = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.8;
    const start = trunkPts[2].clone().lerp(trunkTop, 0.4 + rng() * 0.5);
    const out = 1.1 + rng() * 0.6;
    const end = new THREE.Vector3(start.x + Math.cos(a) * out, start.y + 0.7 + rng() * 0.6, start.z + Math.sin(a) * out);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.15, 0));
    parts.push(prep(taperTube([start, mid, end], 0.11, 0.045, 6, 6), bark));
    blobs.push({
      c: end.clone().add(new THREE.Vector3(0, 0.35, 0)),
      r: 0.8 + rng() * 0.35,
      color: baseColor.clone().offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.08),
    });
  }
  parts.push(...canopyCore(blobs, seed));
  return { core: merge(parts), cards: leafCards(rng, blobs, 60, [0.85, 1.25]) };
}

/** Low bush: a leafy shell of cards over a compact core. */
export function bush(seed: number): FoliageProp {
  const rng = createRng(seed);
  const base = new THREE.Color(LEAF_GREENS[Math.floor(rng() * LEAF_GREENS.length)]);
  const blobs: CanopyBlob[] = [];
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.42 + rng() * 0.25;
    const a = (i / n) * Math.PI * 2 + rng() * 0.5;
    blobs.push({ c: new THREE.Vector3(Math.cos(a) * 0.4, r * 0.75, Math.sin(a) * 0.4), r, color: base.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.08) });
  }
  return { core: merge(canopyCore(blobs, seed * 7)), cards: leafCards(rng, blobs, 28, [0.45, 0.7]) };
}

/** Conifer: stacked, drooping tiers with a feathery shell of needle-clump cards. */
export function pineTree(seed: number): FoliageProp {
  const rng = createRng(seed);
  const tiers = 6 + Math.floor(rng() * 2);
  const h = 1.1 + rng() * 0.4;
  const parts = [trunk(rng, h + 1.5, 0.2, 0.1, 0.08, '#6b4630')];
  const greenColor = new THREE.Color('#3f7d44').offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.05);
  const blobs: CanopyBlob[] = [];
  let y = h;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 1.55 - t * 1.2 + rng() * 0.15;
    const ch = 1.15 - t * 0.4;
    const g = new THREE.ConeGeometry(r * 0.85, ch, 20, 3);
    droopTier(g, ch, rng);
    lumpy(g, 0.1, seed + i);
    g.rotateY(rng() * Math.PI);
    g.translate(0, y + ch / 2, 0);
    // Dark inner volume; the needle cards on top carry the lit surface.
    const p = prep(g, greenColor.clone().multiplyScalar(0.62));
    shadeBlob(p, y + ch / 2, ch / 2, 0.55);
    parts.push(p);
    // Card clusters ring the lower edge of each tier, where a real fir is fullest.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng();
      blobs.push({
        c: new THREE.Vector3(Math.cos(a) * r * 0.45, y + ch * 0.35, Math.sin(a) * r * 0.45),
        r: r * 0.55,
        color: greenColor.clone().offsetHSL(0, 0, 0.08 - t * 0.03).multiplyScalar(1.15),
      });
    }
    y += ch * 0.48;
  }
  return { core: merge(parts), cards: leafCards(rng, blobs, 16, [0.5, 0.8]) };
}

/** Soften a cone tier: a scalloped, drooping hem and a slightly rounded flank. */
function droopTier(g: THREE.BufferGeometry, height: number, rng: Rng): void {
  const pos = g.getAttribute('position');
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + height / 2) / height; // 0 at the hem, 1 at the tip
    const a = Math.atan2(z, x);
    const scallop = 1 + 0.12 * Math.sin(a * 7 + phase) * (1 - t);
    const bulge = 1 + 0.18 * Math.sin(Math.PI * t);
    pos.setXYZ(i, x * scallop * bulge, y - (1 - t) * (1 - t) * 0.28, z * scallop * bulge);
  }
  g.computeVertexNormals();
}

/** Leaning palm with drooping fronds and coconuts. */
export function palmTree(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const height = 4.2 + rng() * 1.4;
  const segments = 7;
  const dir = rng() * Math.PI * 2;
  const lean = 1.2 + rng() * 0.8;
  const parts: THREE.BufferGeometry[] = [];
  const point = (t: number) =>
    new THREE.Vector3(Math.cos(dir) * lean * t * t, height * t, Math.sin(dir) * lean * t * t);
  for (let i = 0; i < segments; i++) {
    const a = point(i / segments);
    const b = point((i + 1) / segments);
    const len = a.distanceTo(b);
    const r = 0.2 - (i / segments) * 0.08;
    const g = new THREE.CylinderGeometry(r * 0.92, r, len * 1.08, 7);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    parts.push(prep(g, i % 2 ? '#9a7550' : '#8a6644'));
  }
  const top = point(1);
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const ang = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    parts.push(frond(rng, top, ang, 2.4 + rng() * 0.6));
  }
  for (let i = 0; i < 3; i++) {
    const g = new THREE.SphereGeometry(0.14, 7, 6);
    const a = (i / 3) * Math.PI * 2;
    g.translate(top.x + Math.cos(a) * 0.2, top.y - 0.2, top.z + Math.sin(a) * 0.2);
    parts.push(prep(g, '#6b4a2b'));
  }
  return merge(parts);
}

function frond(rng: Rng, origin: THREE.Vector3, angle: number, length: number): THREE.BufferGeometry {
  // Arched rib with pinnate leaflets hanging off both sides.
  const segs = 12;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const side = new THREE.Vector3(-dz, 0, dx);
  const rib: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const droop = -t * t * 1.6 + t * 0.6;
    rib.push(new THREE.Vector3(origin.x + dx * t * length, origin.y + droop, origin.z + dz * t * length));
  }
  const pos: number[] = [];
  const push = (...v: THREE.Vector3[]) => v.forEach((p) => pos.push(p.x, p.y, p.z));
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const p = rib[i];
    const along = rib[i + 1].clone().sub(rib[i - 1]).normalize();
    const len = (0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.12) * (0.9 + rng() * 0.2);
    for (const s of [1, -1]) {
      const tip = p.clone().addScaledVector(side, s * len).addScaledVector(along, len * 0.45);
      tip.y -= len * (0.45 + t * 0.4);
      const w = along.clone().multiplyScalar(0.07);
      push(p.clone().sub(w), tip, p.clone().add(w));
    }
  }
  // The rib itself, as a thin strip.
  for (let i = 0; i < segs; i++) {
    const a = rib[i];
    const b = rib[i + 1];
    const wa = side.clone().multiplyScalar(0.035 * (1 - i / segs));
    const wb = side.clone().multiplyScalar(0.035 * (1 - (i + 1) / segs));
    push(a.clone().add(wa), b.clone().add(wb), a.clone().sub(wa), a.clone().sub(wa), b.clone().add(wb), b.clone().sub(wb));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Leaflets catch light from above regardless of their winding.
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.3, Math.abs(nrm.getY(i)) + 0.7, nrm.getZ(i) * 0.3);
  g.normalizeNormals();
  const shade = tmpColor.set('#4f9a3c').offsetHSL(0, 0, (rng() - 0.5) * 0.08).getHexString();
  return prep(g, `#${shade}`);
}

/** Weathered boulder: displaced, slightly flattened, moss on top. Origin at its base. */
export function rock(seed: number, mossy = true): THREE.BufferGeometry {
  const rng = createRng(seed);
  const g = smoothIco(1, 2);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const sx = 1 + rng() * 0.35;
  const sz = 0.8 + rng() * 0.3;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = fbm2(v.x * 1.3 + seed, v.z * 1.3 + v.y, 3, seed);
    // Facets: quantise a little so it reads as stone, not a potato.
    const k = 1 + 0.28 * n1 + 0.08 * Math.round(n1 * 3) / 3;
    v.multiplyScalar(k);
    v.x *= sx;
    v.z *= sz;
    v.y *= 0.72;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3; // flatter underside
    pos.setXYZ(i, v.x, v.y + 0.25, v.z);
  }
  g.computeVertexNormals();
  const out = prep(g, '#9c9283');
  const col = out.getAttribute('color');
  const nor = out.getAttribute('normal');
  const p = out.getAttribute('position');
  const stone = new THREE.Color();
  const moss = new THREE.Color('#6f9a45');
  for (let i = 0; i < col.count; i++) {
    stone.set('#a1978a').offsetHSL(0, 0, fbm2(p.getX(i) * 3, p.getZ(i) * 3 + p.getY(i) * 2, 2, seed + 5) * 0.08);
    const up = nor.getY(i);
    if (mossy) stone.lerp(moss, THREE.MathUtils.smoothstep(up, 0.55, 0.85) * 0.85);
    const ao = 0.65 + 0.35 * THREE.MathUtils.clamp(p.getY(i) / 1.2, 0, 1);
    col.setXYZ(i, stone.r * ao, stone.g * ao, stone.b * ao);
  }
  return out;
}

/** Tuft of grass blades, tips lighter than roots. */
export function grassTuft(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const positions: number[] = [];
  const colors: number[] = [];
  // Roots match the terrain grass so tufts blend in; tips catch the light.
  const root = new THREE.Color('#6cae48');
  const tip = new THREE.Color('#a9cf68');
  const blades = 16;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.14 + rng() * 0.2;
    const w = 0.022 + rng() * 0.018;
    const bend = 0.05 + rng() * 0.12;
    const ba = rng() * Math.PI * 2;
    const tx = x + Math.cos(ba) * bend;
    const tz = z + Math.sin(ba) * bend;
    const px = -Math.sin(ba) * w;
    const pz = Math.cos(ba) * w;
    const t = tmpColor.copy(tip).offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.08);
    positions.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
    colors.push(root.r, root.g, root.b, root.r, root.g, root.b, t.r, t.g, t.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // Normals point up so blades light like the ground they grow from.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  return g;
}

/** Small flower: stem, petals and a yellow centre. */
export function flower(seed: number, petals: THREE.ColorRepresentation): THREE.BufferGeometry {
  const rng = createRng(seed);
  const stemH = 0.28 + rng() * 0.12;
  const stem = new THREE.CylinderGeometry(0.012, 0.015, stemH, 4);
  stem.translate(0, stemH / 2, 0);
  const head = new THREE.IcosahedronGeometry(0.1, 1);
  head.scale(1.25, 0.55, 1.25);
  head.translate(0, stemH + 0.02, 0);
  const centre = new THREE.SphereGeometry(0.03, 5, 4);
  centre.translate(0, stemH + 0.06, 0);
  return merge([prep(stem, '#4f8a3a'), prep(head, petals), prep(centre, '#ffd34d')]);
}

/** Tube along points with a radius that tapers r0 -> r1 (optionally shaped by `profile`). */
function taperTube(
  points: THREE.Vector3[],
  r0: number,
  r1: number,
  radial: number,
  segments: number,
  profile: (t: number) => number = () => 1,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const centre = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, t) * profile(t);
    for (let j = 0; j <= radial; j++) {
      const k = s * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Leaf-cluster texture (near-white; tinted per card by vertex colour). */
export function leafTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = createRng(77);
  const leaf = (x: number, y: number, len: number, wid: number, rot: number, shade: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgb(${170 * shade},${180 * shade},${160 * shade})`);
    g.addColorStop(1, `rgb(${255 * shade},${255 * shade},${235 * shade})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
    ctx.quadraticCurveTo(len * 0.45, wid, 0, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(90,100,70,0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(len * 0.08, 0);
    ctx.lineTo(len * 0.9, 0);
    ctx.stroke();
    ctx.restore();
  };
  // Leaves radiate from the middle and fill most of the tile, so cards read as dense clumps.
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * size * 0.16;
    leaf(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, size * (0.24 + rng() * 0.12), size * (0.075 + rng() * 0.035), a + (rng() - 0.5) * 0.9, 0.82 + rng() * 0.18);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Fern: a rosette of arching fronds made of small leaflets. */
export function fern(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.4;
    const len = 0.55 + rng() * 0.3;
    const g = frond(rng, new THREE.Vector3(0, 0.05, 0), a, len);
    // Ferns arch up first: lift the frond and scale it down to fern size.
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const d = Math.hypot(pos.getX(k), pos.getZ(k)) / len;
      pos.setY(k, pos.getY(k) * 0.45 + Math.sin(Math.min(1, d) * Math.PI * 0.9) * 0.32);
    }
    g.computeVertexNormals();
    const c = g.getAttribute('color');
    const tint = tmpColor.set('#5d9a3e').offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.1);
    for (let k = 0; k < c.count; k++) c.setXYZ(k, tint.r, tint.g, tint.b);
    parts.push(g);
  }
  return merge(parts);
}

/** Mushroom cluster: two or three stems with domed, spotted caps. */
export function mushrooms(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const count = 2 + Math.floor(rng() * 2);
  const red = rng() < 0.5;
  for (let i = 0; i < count; i++) {
    const s = 0.6 + rng() * 0.6;
    const x = (rng() - 0.5) * 0.25;
    const z = (rng() - 0.5) * 0.25;
    const stem = new THREE.LatheGeometry(
      [new THREE.Vector2(0.03 * s, 0), new THREE.Vector2(0.035 * s, 0.05 * s), new THREE.Vector2(0.025 * s, 0.14 * s), new THREE.Vector2(0.0, 0.15 * s)],
      10,
    );
    stem.translate(x, 0, z);
    parts.push(prep(stem, '#efe6d0'));
    const cap = new THREE.LatheGeometry(
      [new THREE.Vector2(0.0, 0.2 * s), new THREE.Vector2(0.06 * s, 0.19 * s), new THREE.Vector2(0.1 * s, 0.15 * s), new THREE.Vector2(0.11 * s, 0.12 * s), new THREE.Vector2(0.02 * s, 0.13 * s)],
      16,
    );
    cap.translate(x, 0, z);
    parts.push(prep(cap, red ? '#c8442f' : '#9a6a3e'));
    if (red) {
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2;
        const r = (0.03 + rng() * 0.05) * s;
        const dot = new THREE.SphereGeometry(0.012 * s, 6, 4);
        dot.scale(1, 0.4, 1);
        dot.translate(x + Math.cos(a) * r, 0.2 * s - (r / (0.1 * s)) * 0.045 * s + 0.004, z + Math.sin(a) * r);
        parts.push(prep(dot, '#fbf5e8'));
      }
    }
  }
  return merge(parts);
}

/** Bleached driftwood log with a couple of broken branch stubs. */
export function driftwood(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const len = 1.6 + rng() * 1.2;
  const pts = [new THREE.Vector3(-len / 2, 0.08, 0), new THREE.Vector3(-len / 6, 0.12, (rng() - 0.5) * 0.3), new THREE.Vector3(len / 6, 0.1, (rng() - 0.5) * 0.3), new THREE.Vector3(len / 2, 0.06, 0)];
  const parts = [prep(taperTube(pts, 0.12, 0.06, 8, 12), '#b8ab97')];
  for (let i = 0; i < 2; i++) {
    const p = pts[1 + i];
    const end = p.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, 0.25 + rng() * 0.2, (rng() - 0.5) * 0.6));
    parts.push(prep(taperTube([p, p.clone().lerp(end, 0.5), end], 0.05, 0.02, 6, 4), '#a99c88'));
  }
  return merge(parts);
}

/** Starfish lying on the sand. */
export function starfish(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const shape = new THREE.Shape();
  const arms = 5;
  for (let i = 0; i <= arms * 2; i++) {
    const a = (i / (arms * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.12 : 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.015, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.015, 0);
  const colours = ['#e8743b', '#d9534f', '#f0a04b'];
  return prep(g, colours[Math.floor(rng() * colours.length)]);
}
