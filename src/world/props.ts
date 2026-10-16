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

/** Rounded broadleaf tree: bent trunk and a clustered, lumpy canopy. */
export function broadleafTree(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const h = 2.4 + rng() * 0.8;
  const lean = 0.25 + rng() * 0.35;
  const parts = [trunk(rng, h + 0.6, 0.24, 0.13, lean, '#7a5235')];
  const leaf = LEAF_GREENS[Math.floor(rng() * LEAF_GREENS.length)];
  const blobs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = (i === 0 ? 1.45 : 0.85 + rng() * 0.55) * 1.0;
    const a = (i / blobs) * Math.PI * 2 + rng();
    const d = i === 0 ? 0 : 0.8 + rng() * 0.5;
    const g = smoothIco(r, 2);
    lumpy(g, 0.22, seed + i * 13);
    const cy = h + 0.5 + (i === 0 ? 0.55 : rng() * 0.9 - 0.1);
    const cx = Math.cos(a) * d + lean * 0.8;
    const cz = Math.sin(a) * d;
    g.translate(cx, cy, cz);
    const shade = tmpColor.set(leaf).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06).getHexString();
    const p = prep(g, `#${shade}`);
    shadeBlob(p, cy, r, 0.5);
    parts.push(p);
  }
  return merge(parts);
}

/** Conifer: stacked, slightly drooping cones. */
export function pineTree(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const tiers = 4 + Math.floor(rng() * 2);
  const h = 1.2 + rng() * 0.4;
  const parts = [trunk(rng, h + 1.5, 0.2, 0.1, 0.08, '#6b4630')];
  const green = tmpColor.set('#4b8a4a').offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.05).getHexString();
  let y = h;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 1.5 - t * 1.05 + rng() * 0.15;
    const ch = 1.5 - t * 0.5;
    const g = new THREE.ConeGeometry(r, ch, 16, 3);
    droopTier(g, ch, rng);
    lumpy(g, 0.1, seed + i);
    g.rotateY(rng() * Math.PI);
    g.translate(0, y + ch / 2, 0);
    const p = prep(g, `#${green}`);
    shadeBlob(p, y + ch / 2, ch / 2, 0.45);
    parts.push(p);
    y += ch * 0.55;
  }
  return merge(parts);
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
  // A drooping leaf strip: two triangles per segment, widest in the middle.
  const segs = 6;
  const positions: number[] = [];
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const pts: Array<[THREE.Vector3, number]> = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.42 + 0.02;
    const droop = -t * t * 1.5 + t * 0.55;
    pts.push([new THREE.Vector3(origin.x + dx * t * length, origin.y + droop, origin.z + dz * t * length), w]);
  }
  for (let i = 0; i < segs; i++) {
    const [a, wa] = pts[i];
    const [b, wb] = pts[i + 1];
    const a1 = [a.x + px * wa, a.y + 0.05, a.z + pz * wa];
    const a2 = [a.x - px * wa, a.y + 0.05, a.z - pz * wa];
    const b1 = [b.x + px * wb, b.y + 0.05, b.z + pz * wb];
    const b2 = [b.x - px * wb, b.y + 0.05, b.z - pz * wb];
    // Slight V-fold along the rib.
    a1[1] += wa * 0.25;
    a2[1] += wa * 0.25;
    b1[1] += wb * 0.25;
    b2[1] += wb * 0.25;
    positions.push(...a1, ...b1, a.x, a.y, a.z, a.x, a.y, a.z, ...b1, b.x, b.y, b.z);
    positions.push(...a.toArray(), b.x, b.y, b.z, ...a2, ...a2, b.x, b.y, b.z, ...b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  const shade = tmpColor.set('#4f9a3c').offsetHSL(0, 0, (rng() - 0.5) * 0.08).getHexString();
  return prep(g, `#${shade}`);
}

/** Low rounded bush made of a few lumpy blobs. */
export function bush(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const base = LEAF_GREENS[Math.floor(rng() * LEAF_GREENS.length)];
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.45 + rng() * 0.3;
    const g = smoothIco(r, 2);
    lumpy(g, 0.2, seed * 7 + i);
    const a = (i / n) * Math.PI * 2;
    g.translate(Math.cos(a) * 0.45, r * 0.75, Math.sin(a) * 0.45);
    const p = prep(g, `#${tmpColor.set(base).offsetHSL(0, 0, (rng() - 0.5) * 0.08).getHexString()}`);
    shadeBlob(p, r * 0.75, r, 0.5);
    parts.push(p);
  }
  return merge(parts);
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
  const root = new THREE.Color('#62a442');
  const tip = new THREE.Color('#c3df7a');
  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.16 + rng() * 0.2;
    const w = 0.045 + rng() * 0.03;
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
