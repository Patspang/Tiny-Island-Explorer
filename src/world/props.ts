// Procedural prop geometry. Each builder returns one merged, non-indexed geometry with
// vertex colours, ready to be drawn many times through an InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

interface CanopyBlob {
  c: THREE.Vector3;
  r: number;
  color: THREE.Color;
}

/**
 * Solid "cauliflower" canopy: each blob is a core sphere crowned with smaller puffs, so the
 * silhouette is a clean scalloped cloud rather than a scatter of leaf cards. Lighting is baked
 * into vertex colours across the whole canopy (lit, warm crown; cool, dark underside; darker
 * toward the middle) so every puff shades as part of one volume.
 */
function canopy(rng: Rng, blobs: CanopyBlob[], puffsPerBlob: number, seed: number, detail = 1, brightness = 1): THREE.BufferGeometry[] {
  const centroid = new THREE.Vector3();
  for (const b of blobs) centroid.add(b.c);
  centroid.divideScalar(blobs.length);
  let top = -Infinity;
  let bottom = Infinity;
  let reach = 0;
  for (const b of blobs) {
    top = Math.max(top, b.c.y + b.r);
    bottom = Math.min(bottom, b.c.y - b.r);
    reach = Math.max(reach, Math.hypot(b.c.x - centroid.x, b.c.z - centroid.z) + b.r);
  }
  const parts: THREE.BufferGeometry[] = [];
  const dir = new THREE.Vector3();
  const add = (centre: THREE.Vector3, r: number, color: THREE.Color, n: number, d: number) => {
    const g = smoothIco(r, d);
    lumpy(g, 0.12, seed + n * 7.3);
    g.translate(centre.x, centre.y, centre.z);
    parts.push(prep(g, color));
  };
  blobs.forEach((b, i) => {
    add(b.c, b.r * 0.82, b.color, i, 1);
    for (let k = 0; k < puffsPerBlob; k++) {
      // Puffs sit on the upper and outer surface, where light lands and the silhouette forms.
      dir.set(rng() * 2 - 1, rng() * 1.3 - 0.25, rng() * 2 - 1).normalize();
      const r = b.r * (0.5 + rng() * 0.16);
      const p = b.c.clone().addScaledVector(dir, b.r * 0.82 - r * 0.35);
      add(p, r, b.color.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.05), i * 31 + k, detail);
    }
  });
  const warm = new THREE.Color('#c4dc6a');
  const cool = new THREE.Color('#1f4a3a');
  const c = new THREE.Color();
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = g.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const height = THREE.MathUtils.clamp((pos.getY(i) - bottom) / Math.max(0.01, top - bottom), 0, 1);
      const out = THREE.MathUtils.clamp(Math.hypot(pos.getX(i) - centroid.x, pos.getZ(i) - centroid.z) / reach, 0, 1);
      const up = nor.getY(i);
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      // Interior and underside fall off toward a cool shadow green; the crown warms up.
      const light = THREE.MathUtils.clamp(0.35 + 0.4 * height + 0.25 * out + 0.2 * up, 0, 1.15);
      c.multiplyScalar((0.45 + 0.6 * light) * brightness);
      c.lerp(cool, THREE.MathUtils.clamp(0.4 - light * 0.5, 0, 0.3));
      c.lerp(warm, THREE.MathUtils.clamp((up - 0.4) * 0.35 * height, 0, 0.25));
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  return parts;
}

export interface FoliageProp {
  /** Opaque parts: trunk, branches and the dark inner canopy volume. */
  core: THREE.BufferGeometry;
  /** Camera-facing leaf cards over the canopy (see `fluffCards`). */
  cards: THREE.BufferGeometry;
}

/**
 * Fluffy canopy shell: leaf-cluster cards scattered over the canopy blobs. Each card stores its
 * centre in `position` and its corner offset in `corner`; the material turns every card to face
 * the camera, so the canopy never shows cards edge-on. Normals are the blob's sphere normals,
 * so the whole shell lights like one soft volume while its silhouette stays leafy.
 */
function fluffCards(rng: Rng, blobs: CanopyBlob[], density: number, size: [number, number]): THREE.BufferGeometry {
  let top = -Infinity;
  let bottom = Infinity;
  for (const b of blobs) {
    top = Math.max(top, b.c.y + b.r);
    bottom = Math.min(bottom, b.c.y - b.r);
  }
  const pos: number[] = [];
  const corner: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const shadow = new THREE.Color('#2b6142');
  const lit = new THREE.Color('#8fd14f');
  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  let maxSize = 0;
  for (const b of blobs) {
    const count = Math.round(density * b.r * b.r);
    for (let i = 0; i < count; i++) {
      dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (dir.lengthSq() < 1e-4) continue;
      dir.normalize();
      const depth = 0.7 + rng() * 0.3;
      const p = b.c.clone().addScaledVector(dir, b.r * depth);
      // Sphere normal, nudged up so the underside picks up some sky light instead of going black.
      n.copy(dir).setY(dir.y + 0.25).normalize();
      // Volumetric gradient: shadow green at the bottom of the canopy to bright yellow-green on
      // top; cards deeper inside the blob are darker.
      const height = THREE.MathUtils.clamp((p.y - bottom) / Math.max(0.01, top - bottom), 0, 1);
      c.copy(shadow).lerp(lit, THREE.MathUtils.smoothstep(height, 0.05, 1) * (0.55 + 0.45 * Math.max(0, dir.y)));
      c.lerp(b.color, 0.25).multiplyScalar(0.88 + 0.14 * (depth - 0.7) / 0.3);
      c.offsetHSL((rng() - 0.5) * 0.015, 0, (rng() - 0.5) * 0.025);
      const sz = (size[0] + rng() * (size[1] - size[0])) * 0.5;
      maxSize = Math.max(maxSize, sz);
      const spin = rng() * Math.PI * 2;
      const cs = Math.cos(spin) * sz;
      const sn = Math.sin(spin) * sz;
      const base = pos.length / 3;
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        pos.push(p.x, p.y, p.z);
        corner.push(u * cs - v * sn, u * sn + v * cs);
        nor.push(n.x, n.y, n.z);
        uv.push((u + 1) / 2, (v + 1) / 2);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // Card centres alone under-estimate the bounds: pad by the largest card's half-diagonal.
  g.boundingSphere!.radius += maxSize * Math.SQRT2;
  return g;
}

/** Broadleaf tree: flared, bent trunk that forks into branches carrying fluffy canopy clusters. */
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
  // Dark inner volume fills the gaps between cards; the cards carry the lit surface.
  const inner = blobs.map((b) => ({ ...b, r: b.r * 0.72 }));
  parts.push(...canopy(rng, inner, 3, seed, 1, 0.45));
  return { core: merge(parts), cards: fluffCards(rng, blobs, 150, [0.75, 1.15]) };
}

/** Low bush: a few fluffy clumps hugging the ground, built like the broadleaf canopy. */
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
  const inner = blobs.map((b) => ({ ...b, r: b.r * 0.72 }));
  return { core: merge(canopy(rng, inner, 2, seed * 7, 1, 0.45)), cards: fluffCards(rng, blobs, 180, [0.4, 0.62]) };
}

/**
 * Conifer: a stack of solid, scalloped skirts. No leaf cards: at this scale a fir reads by its
 * silhouette and the light/shadow banding between tiers, and cards only add noise.
 */
export function pineTree(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const tiers = 5 + Math.floor(rng() * 2);
  const trunkH = 1.0 + rng() * 0.3;
  const parts = [trunk(rng, trunkH + 2.6, 0.2, 0.08, 0.06, '#6b4630')];
  const green = new THREE.Color('#4a9850').offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.04);
  let y = trunkH;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 1.6 - t * 1.15 + (rng() - 0.5) * 0.12;
    const h = (i === tiers - 1 ? 1.25 : 1.05) - t * 0.25;
    const tierColor = green.clone().offsetHSL((rng() - 0.5) * 0.015, 0, t * 0.05);
    parts.push(pineTier(rng, r, h, y, tierColor, i === tiers - 1));
    y += h * (0.5 - t * 0.06);
  }
  return merge(parts);
}

/**
 * One fir tier: a skirt whose hem is a ring of rounded, drooping lobes, plus a shallow underside.
 * Vertex colours carry the stylised lighting: lit, slightly warm lobe tips, darker toward the
 * trunk and underneath, so tiers separate cleanly from each other.
 */
function pineTier(rng: Rng, radius: number, height: number, base: number, color: THREE.Color, isTop: boolean): THREE.BufferGeometry {
  const lobes = 7 + Math.floor(rng() * 3);
  const radial = lobes * 4;
  const rows = 4;
  const phase = rng() * Math.PI * 2;
  const jitter = Array.from({ length: lobes }, () => 0.85 + rng() * 0.3);
  // Lobe shape around the hem: 1 at a lobe's tip, 0 in the notch between lobes.
  const lobeAt = (a: number) => {
    const u = ((a + phase) / (Math.PI * 2)) * lobes;
    const k = Math.floor(u);
    const f = u - k;
    const peak = Math.pow(Math.sin(Math.PI * f), 0.7);
    return { peak, size: jitter[((k % lobes) + lobes) % lobes] };
  };
  const pos: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  const tipY = base + height;
  const hemY = base;
  // Upper surface: rows from tip (0) to hem (rows); underside: hem back in toward the trunk.
  const ringCount = rows + 2;
  for (let ring = 0; ring <= ringCount; ring++) {
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const { peak, size } = lobeAt(a);
      const out = 0.72 + 0.28 * peak * size;
      let r: number;
      let yy: number;
      let s: number;
      if (ring <= rows) {
        const t = ring / rows;
        // Convex flank that flares near the hem; lobes only shape the outer half.
        const lobeMix = THREE.MathUtils.smoothstep(t, 0.35, 1);
        r = radius * Math.pow(t, 0.85) * THREE.MathUtils.lerp(0.86, out, lobeMix);
        yy = THREE.MathUtils.lerp(tipY, hemY, Math.pow(t, 1.15)) - lobeMix * peak * size * height * 0.16;
        // Lit lobe tips and crown, darker in the notches between lobes.
        s = 0.8 + 0.12 * (1 - t) + lobeMix * (0.22 * peak - 0.08);
        if (isTop && ring === 0) s = 0.98;
      } else {
        const u = (ring - rows) / 2;
        r = radius * out * THREE.MathUtils.lerp(1, 0.2, u);
        yy = hemY - peak * size * height * 0.16 * (1 - u) + height * 0.22 * u;
        s = 0.42;
      }
      pos.push(Math.cos(a) * r, yy, Math.sin(a) * r);
      shade.push(s);
    }
  }
  const w = radial + 1;
  for (let ring = 0; ring < ringCount; ring++) {
    for (let j = 0; j < radial; j++) {
      const a = ring * w + j;
      const b = a + w;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  // Weld the seam and the tip so normals are smooth all the way round.
  const welded = mergeVertices(g, 1e-4);
  g.dispose();
  welded.computeVertexNormals();
  const out = welded.toNonIndexed();
  welded.dispose();
  const sh = out.getAttribute('shade');
  const nor = out.getAttribute('normal');
  const n = sh.count;
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();
  const warm = new THREE.Color('#9fc95a');
  for (let i = 0; i < n; i++) {
    const s = sh.getX(i);
    // Upward-facing tips pick up a warm yellow-green highlight, like sunlit needles.
    const up = THREE.MathUtils.clamp(nor.getY(i), 0, 1);
    c.copy(color).multiplyScalar(s).lerp(warm, THREE.MathUtils.clamp((s - 0.84) * 1.6, 0, 0.3) * up);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  out.deleteAttribute('shade');
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
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

/**
 * Chiselled boulder: a lumpy blob cut by a handful of random planes, so it reads as stone with
 * broad flat faces and softened edges rather than a smooth potato. Side cuts are kept steep
 * (the character controller must not walk up them); top cuts may be flat. Freshly cut faces are
 * a little lighter than the weathered rind, crevices and the base darker, moss on top.
 * Origin at its base. `detail` trades facet crispness for triangles (3 for big boulders).
 */
export function rock(seed: number, mossy = true, detail = 3): THREE.BufferGeometry {
  const rng = createRng(seed);
  const g = smoothIco(1, detail);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const sx = 1 + rng() * 0.35;
  const sz = 0.8 + rng() * 0.3;
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.16 * fbm2(v.x * 1.3 + seed, v.z * 1.3 + v.y, 3, seed));
    v.x *= sx;
    v.z *= sz;
    v.y *= 0.8;
    reach = Math.max(reach, Math.hypot(v.x, v.z));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const cut = new Float32Array(pos.count);
  const n = new THREE.Vector3();
  const cuts = 9 + Math.floor(rng() * 5);
  for (let c = 0; c < cuts; c++) {
    const a = rng() * Math.PI * 2;
    const ny = rng() < 0.3 ? 0.7 + rng() * 0.3 : -0.2 + rng() * 0.65;
    const h = Math.sqrt(1 - ny * ny);
    n.set(Math.cos(a) * h, ny, Math.sin(a) * h);
    let support = -Infinity;
    for (let i = 0; i < pos.count; i++) support = Math.max(support, v.fromBufferAttribute(pos, i).dot(n));
    // Varied depths: a few deep cuts make the big faces, shallow ones nick the corners.
    const d = support * (rng() < 0.4 ? 0.66 + rng() * 0.1 : 0.82 + rng() * 0.12);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = v.dot(n) - d;
      if (k <= 0) continue;
      v.addScaledVector(n, -k);
      pos.setXYZ(i, v.x, v.y, v.z);
      cut[i] = 1;
    }
  }
  // Restore the footprint the cuts shaved off (placement radii and colliders assume it), and
  // flatten the underside so the boulder sits in the ground.
  let after = 0;
  for (let i = 0; i < pos.count; i++) after = Math.max(after, Math.hypot(pos.getX(i), pos.getZ(i)));
  const grow = reach / Math.max(0.01, after);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x *= grow;
    v.z *= grow;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3;
    pos.setXYZ(i, v.x, v.y + 0.25, v.z);
  }
  g.setAttribute('cut', new THREE.BufferAttribute(cut, 1));
  // Crisp edges where faces meet at a real angle; smooth shading across the weathered rind.
  const creased = toCreasedNormals(g, THREE.MathUtils.degToRad(28));
  g.dispose();
  const out = prep(creased, '#9a958c');
  const col = out.getAttribute('color');
  const nor = out.getAttribute('normal');
  const p = out.getAttribute('position');
  const cutA = out.getAttribute('cut');
  const stone = new THREE.Color();
  const moss = new THREE.Color('#6f9a45');
  for (let i = 0; i < col.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    stone.set('#a39e94').offsetHSL(0, 0, fbm2(x * 2.2, z * 2.2 + y * 1.7, 3, seed + 5) * 0.1);
    // Cut faces: fresher, lighter stone. Uncut rind between them: older, darker.
    stone.multiplyScalar(0.86 + 0.16 * cutA.getX(i));
    const up = nor.getY(i);
    // Moss only in patches on upward faces, so the stone still reads.
    const patch = THREE.MathUtils.smoothstep(fbm2(x * 1.6 + 9, z * 1.6 - y, 2, seed + 11), -0.05, 0.25);
    if (mossy) stone.lerp(moss, THREE.MathUtils.smoothstep(up, 0.75, 0.95) * patch * 0.65);
    const ao = 0.74 + 0.26 * THREE.MathUtils.clamp(p.getY(i) / 1.1, 0, 1);
    col.setXYZ(i, stone.r * ao, stone.g * ao, stone.b * ao);
  }
  out.deleteAttribute('cut');
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

/**
 * Wildflower clump: two or three small blossoms on slender, leaning stems over a few basal
 * leaves. Each blossom is a ring of separate, upturned petals around a domed centre, with petals
 * deepening in colour toward the middle so the head reads as a flower, not a disc.
 */
export function flower(seed: number, petals: THREE.ColorRepresentation): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const petalColor = new THREE.Color(petals);
  const deep = petalColor.clone().offsetHSL(0, 0.1, -0.18);
  const hsl = petalColor.getHSL({ h: 0, s: 0, l: 0 });
  // Yellow petals get an orange eye; everything else a yellow one.
  const centreColor = hsl.h > 0.1 && hsl.h < 0.2 && hsl.s > 0.5 ? '#d9792a' : '#ffd34d';
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.SphereGeometry(1, 5, 2);
    leaf.scale(0.025, 0.008, 0.11);
    leaf.translate(0, 0, 0.1);
    leaf.rotateX(-0.5 - rng() * 0.3);
    leaf.rotateY((i / 3) * Math.PI * 2 + rng());
    parts.push(prep(leaf, '#4f8f3a'));
  }
  const heads = 2 + Math.floor(rng() * 2);
  for (let k = 0; k < heads; k++) {
    const h = 0.17 + rng() * 0.15;
    const a = (k / heads) * Math.PI * 2 + rng() * 0.6;
    const lean = 0.03 + rng() * 0.05;
    const top = new THREE.Vector3(Math.cos(a) * lean, h, Math.sin(a) * lean);
    const stem = taperTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(top.x * 0.3, h * 0.5, top.z * 0.3), top], 0.008, 0.006, 4, 4);
    parts.push(prep(stem, '#4f8a3a'));
    const size = 1.15 + rng() * 0.35;
    const count = 5 + (rng() < 0.3 ? 1 : 0);
    const spin = rng() * Math.PI * 2;
    for (let p = 0; p < count; p++) {
      const g = new THREE.SphereGeometry(1, 5, 2);
      g.scale(0.034 * size, 0.008 * size, 0.019 * size);
      g.translate(0.032 * size, 0, 0);
      g.rotateZ(0.32); // cup the petals upward
      g.rotateY(spin + (p / count) * Math.PI * 2);
      const out = prep(g, petalColor);
      // Gradient: deeper colour at the petal base, full colour at the tip.
      const pos = out.getAttribute('position');
      const col = out.getAttribute('color');
      for (let v = 0; v < pos.count; v++) {
        const d = THREE.MathUtils.clamp(Math.hypot(pos.getX(v), pos.getZ(v)) / (0.06 * size), 0, 1);
        tmpColor.copy(deep).lerp(petalColor, THREE.MathUtils.smoothstep(d, 0.15, 0.7));
        col.setXYZ(v, tmpColor.r, tmpColor.g, tmpColor.b);
      }
      out.translate(top.x, top.y, top.z);
      parts.push(out);
    }
    const centre = new THREE.SphereGeometry(0.016 * size, 5, 3);
    centre.scale(1, 0.7, 1);
    centre.translate(top.x, top.y + 0.008, top.z);
    parts.push(prep(centre, centreColor));
  }
  return merge(parts);
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

/**
 * Fluffy leaf-cluster texture: dozens of small leaves pointing outward around a solid middle,
 * so alpha-tested cards get a soft, leafy edge. Near-white; cards are tinted by vertex colour.
 */
export function leafClusterTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = createRng(91);
  const mid = size / 2;
  const leaf = (x: number, y: number, len: number, wid: number, rot: number, shade: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgb(${Math.round(222 * shade)},${Math.round(228 * shade)},${Math.round(212 * shade)})`);
    g.addColorStop(1, `rgb(${Math.round(245 * shade)},${Math.round(248 * shade)},${Math.round(232 * shade)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
    ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
    ctx.fill();
    ctx.restore();
  };
  // Solid middle so cards overlap without holes, then a ring of outward-pointing leaves that
  // gives each card its scalloped, leafy silhouette.
  ctx.fillStyle = 'rgb(236,240,226)';
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 130; i++) {
    const a = rng() * Math.PI * 2;
    const r = size * (0.16 + rng() * 0.16);
    const len = size * (0.08 + rng() * 0.05);
    leaf(mid + Math.cos(a) * r, mid + Math.sin(a) * r, len, len * 0.42, a + (rng() - 0.5) * 0.7, 0.86 + rng() * 0.14);
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
