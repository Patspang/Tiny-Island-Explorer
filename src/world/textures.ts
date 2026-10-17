// Procedural surface textures for built structures, painted on canvases at start-up (no image
// files). Each is near-neutral so materials tint it; most double as their own bump map.

import * as THREE from 'three';
import { createRng } from './noise';

type Rng = () => number;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckle a canvas with soft blotches (weathering) and fine grain. */
function weather(ctx: CanvasRenderingContext2D, size: number, rng: Rng, blotches: number, strength: number): void {
  for (let i = 0; i < blotches; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.02 + rng() * 0.08);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() < 0.6;
    g.addColorStop(0, dark ? `rgba(60,50,40,${strength * rng()})` : `rgba(255,255,250,${strength * rng()})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Lime-washed render: near-white with soft patches and grain. */
export function plasterTexture(repeatX = 2, repeatY = 2): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#f2f0ea';
  ctx.fillRect(0, 0, size, size);
  // Many faint, large patches: an uneven lime wash, not spots.
  weather(ctx, size, createRng(11), 90, 0.07);
  return finish(c, repeatX, repeatY);
}

/**
 * Coursed rubble masonry: rows of irregular stones with darker mortar joints. Rows have random
 * heights and stones random widths, each with its own tone and a lighter top edge.
 */
export function masonryTexture(repeatX = 4, repeatY = 1, seed = 5): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = createRng(seed);
  ctx.fillStyle = '#6f675d';
  ctx.fillRect(0, 0, size, size);
  let y = 0;
  while (y < size) {
    const h = Math.min(size - y, 44 + rng() * 40);
    let x = -rng() * 60;
    while (x < size) {
      const w = 60 + rng() * 90;
      const tone = 150 + rng() * 55;
      const warm = rng() * 14;
      ctx.fillStyle = `rgb(${tone + warm},${tone + warm * 0.5},${tone - 6})`;
      const gap = 4;
      roundRect(ctx, x + gap, y + gap, w - gap * 2, h - gap * 2, 7);
      ctx.fill();
      // Light catches the top of each stone; its foot sits in shade.
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.6, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      roundRect(ctx, x + gap, y + gap, w - gap * 2, h - gap * 2, 7);
      ctx.fill();
      x += w;
    }
    y += h;
  }
  weather(ctx, size, rng, 50, 0.25);
  return finish(c, repeatX, repeatY);
}

/**
 * Flagstone paving for the terrace top, laid out for a cylinder cap (UVs span the disc): an
 * irregular grid of slabs with mossy joints.
 */
export function flagstoneTexture(): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const rng = createRng(23);
  ctx.fillStyle = '#8a8470';
  ctx.fillRect(0, 0, size, size);
  const cell = 46;
  const pts: Array<[number, number]>[] = [];
  const n = Math.ceil(size / cell) + 1;
  for (let i = 0; i <= n; i++) {
    const row: Array<[number, number]> = [];
    for (let j = 0; j <= n; j++) row.push([j * cell + (rng() - 0.5) * cell * 0.45, i * cell + (rng() - 0.5) * cell * 0.45]);
    pts.push(row);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const q = [pts[i][j], pts[i][j + 1], pts[i + 1][j + 1], pts[i + 1][j]];
      // Inset each slab toward its centre to open the joint.
      const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
      const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      const tone = 150 + rng() * 45;
      ctx.fillStyle = `rgb(${tone + 8},${tone + 3},${tone - 8})`;
      ctx.beginPath();
      q.forEach(([x, y], k) => {
        const px = cx + (x - cx) * 0.94;
        const py = cy + (y - cy) * 0.94;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    }
  }
  weather(ctx, size, rng, 140, 0.22);
  return finish(c);
}

/** Weathered timber boards (vertical), with grain lines and dark gaps between planks. */
export function plankTexture(boards = 4, seed = 3): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = createRng(seed);
  const w = size / boards;
  for (let b = 0; b < boards; b++) {
    const tone = 0.85 + rng() * 0.25;
    ctx.fillStyle = `rgb(${Math.round(200 * tone)},${Math.round(170 * tone)},${Math.round(135 * tone)})`;
    ctx.fillRect(b * w, 0, w, size);
    ctx.strokeStyle = 'rgba(70,45,25,0.22)';
    for (let k = 0; k < 7; k++) {
      ctx.lineWidth = 0.6 + rng() * 1.2;
      ctx.beginPath();
      const x0 = b * w + rng() * w;
      ctx.moveTo(x0, 0);
      ctx.bezierCurveTo(x0 + (rng() - 0.5) * 8, size * 0.3, x0 + (rng() - 0.5) * 8, size * 0.7, x0 + (rng() - 0.5) * 6, size);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,15,0.85)';
    ctx.fillRect(b * w, 0, 2.5, size);
  }
  weather(ctx, size, rng, 25, 0.2);
  return finish(c);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Vertex-colour grime for walls: darker and slightly warmer toward the ground (splash-back and
 * damp), plus faint vertical rain streaks below openings. `height` is the wall's local height.
 */
export function applyGrime(geo: THREE.BufferGeometry, groundY: number, reach = 1.2, seed = 1): void {
  const rng = createRng(seed);
  const streaks = Array.from({ length: 6 }, () => ({ a: rng() * Math.PI * 2, w: 0.08 + rng() * 0.12 }));
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - groundY;
    let k = 0.72 + 0.28 * THREE.MathUtils.smoothstep(y, 0, reach);
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    for (const s of streaks) {
      const d = Math.abs(Math.atan2(Math.sin(a - s.a), Math.cos(a - s.a)));
      if (d < s.w) k *= 1 - 0.07 * (1 - d / s.w);
    }
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * 0.985;
    colors[i * 3 + 2] = k * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
