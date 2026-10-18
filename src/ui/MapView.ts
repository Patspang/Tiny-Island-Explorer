import { MAP } from '../quest/story';
import type { IslandMap, MapLandmark } from '../world/World';

export interface MapState {
  player: { x: number; z: number };
  /** Direction the camera looks, as a world XZ vector. */
  facing: { x: number; z: number };
  /** Lens pieces already found (ids), for ticks on the map. */
  found: ReadonlySet<string>;
  bottleRead: boolean;
}

const LABELS: Partial<Record<MapLandmark['kind'], string>> = {
  lighthouse: 'Lighthouse',
  bells: 'Bells',
  chest: 'Chest',
  ruin: 'Ruin',
  stones: 'Sea rock',
  hut: 'Hut',
};

/**
 * Captain Wren's map: a hand-drawn chart of the island, redrawn each time it opens so it shows
 * where the player is and ticks off finished places. Plain 2D canvas; it reads plain data only.
 */
export class MapView {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly button: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly map: IslandMap,
    onClose: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay map-view hidden';
    const panel = document.createElement('div');
    panel.className = 'panel map';
    const title = document.createElement('h2');
    title.textContent = MAP.title;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', MAP.title);
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'continue';
    this.button.textContent = MAP.close;
    this.button.addEventListener('click', () => {
      this.button.blur();
      onClose();
    });
    panel.append(title, this.canvas, this.button);
    this.el.appendChild(panel);
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  open(state: MapState): void {
    this.el.classList.remove('hidden');
    this.draw(state);
    this.button.focus();
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  private draw(state: MapState): void {
    const size = 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const E = this.map.extent;
    // World X to the right, world Z down: from the spawn beach, "up" on the map is the way to the lighthouse.
    const u = (x: number) => ((x + E) / (2 * E)) * size;
    const v = (z: number) => ((z + E) / (2 * E)) * size;
    const k = size / (2 * E);

    // Parchment and sea.
    ctx.fillStyle = '#f3e4c0';
    ctx.fillRect(0, 0, size, size);
    const sea = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.72);
    sea.addColorStop(0, '#a9d9dc');
    sea.addColorStop(1, '#d9e3c9');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(60, 120, 140, 0.35)';
    ctx.lineWidth = 1.4;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      if (Math.hypot(x - size / 2, y - size / 2) < size * 0.4) continue;
      ctx.beginPath();
      ctx.arc(x - 5, y, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.arc(x + 5, y, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }

    // The island: a sandy rim, green inside, cliffs drawn as a heavy brown edge.
    const coast = this.map.coastline;
    const outline = (scale: number) => {
      ctx.beginPath();
      coast.forEach((p, i) => (i ? ctx.lineTo(u(p.x * scale), v(p.z * scale)) : ctx.moveTo(u(p.x * scale), v(p.z * scale))));
      ctx.closePath();
    };
    outline(1);
    ctx.fillStyle = '#ecd59a';
    ctx.fill();
    outline(0.86);
    ctx.fillStyle = '#a9cf7f';
    ctx.fill();
    const hill = ctx.createRadialGradient(u(this.map.hill.x), v(this.map.hill.z), 0, u(this.map.hill.x), v(this.map.hill.z), this.map.hill.radius * k);
    hill.addColorStop(0, 'rgba(110, 150, 80, 0.75)');
    hill.addColorStop(1, 'rgba(110, 150, 80, 0)');
    ctx.fillStyle = hill;
    ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < coast.length; i++) {
      const a = coast[i];
      const b = coast[(i + 1) % coast.length];
      const cliff = (a.cliff + b.cliff) / 2;
      ctx.strokeStyle = cliff > 0.5 ? '#7b5636' : '#c4a463';
      ctx.lineWidth = cliff > 0.5 ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(u(a.x), v(a.z));
      ctx.lineTo(u(b.x), v(b.z));
      ctx.stroke();
    }

    // Woods: little round trees.
    for (const w of this.map.woods) {
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3 + w.x;
        const x = u(w.x) + Math.cos(a) * 9 * (i % 2 ? 1 : 0.5);
        const y = v(w.z) + Math.sin(a) * 7 * (i % 2 ? 1 : 0.5);
        ctx.fillStyle = '#5b8f45';
        ctx.strokeStyle = '#3d6a2e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // The footpath.
    ctx.strokeStyle = '#9b7148';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    this.map.path.forEach((p, i) => (i ? ctx.lineTo(u(p.x), v(p.z)) : ctx.moveTo(u(p.x), v(p.z))));
    ctx.stroke();
    ctx.setLineDash([]);

    // Landmarks, labels, and ticks on places already done.
    ctx.font = 'bold 12px Georgia, serif';
    ctx.textAlign = 'center';
    for (const l of this.map.landmarks) {
      if (l.kind === 'bottle' && state.bottleRead) continue;
      const x = u(l.x);
      const y = v(l.z);
      drawIcon(ctx, l.kind, x, y);
      const label = LABELS[l.kind];
      if (label) {
        ctx.fillStyle = 'rgba(243, 228, 192, 0.85)';
        const w = ctx.measureText(label).width + 8;
        ctx.fillRect(x - w / 2, y + 13, w, 15);
        ctx.fillStyle = '#4a3a2a';
        ctx.fillText(label, x, y + 25);
      }
      if (l.piece && state.found.has(l.piece)) drawTick(ctx, x + 12, y - 12);
    }

    // You are here.
    const px = u(state.player.x);
    const py = v(state.player.z);
    const len = Math.hypot(state.facing.x, state.facing.z) || 1;
    const fx = state.facing.x / len;
    const fz = state.facing.z / len;
    ctx.fillStyle = '#e4572e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + fx * 15, py + fz * 15);
    ctx.lineTo(px - fz * 8 - fx * 4, py + fx * 8 - fz * 4);
    ctx.lineTo(px + fz * 8 - fx * 4, py - fx * 8 - fz * 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 13px Georgia, serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeText(MAP.you, px, py - 12);
    ctx.fillStyle = '#c2441f';
    ctx.fillText(MAP.you, px, py - 12);

    // Compass rose.
    const cx = size - 42;
    const cy = 46;
    ctx.fillStyle = '#4a3a2a';
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 22, cy + dy * 22);
      ctx.lineTo(cx + dy * 5, cy - dx * 5);
      ctx.lineTo(cx - dy * 5, cy + dx * 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = 'bold 13px Georgia, serif';
    ctx.fillText('N', cx, cy - 26);

    // A worn border.
    ctx.strokeStyle = '#8a6a44';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, size - 6, size - 6);
  }
}

function drawTick(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#2f8f9d';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x - 1, y + 3);
  ctx.lineTo(x + 4, y - 3);
  ctx.stroke();
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: MapLandmark['kind'], x: number, y: number): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#3a2c20';
  switch (kind) {
    case 'lighthouse':
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : '#d8483a';
        const w0 = 7 - i * 0.8;
        const w1 = 7 - (i + 1) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x - w0, y + 8 - i * 6);
        ctx.lineTo(x + w0, y + 8 - i * 6);
        ctx.lineTo(x + w1, y + 2 - i * 6);
        ctx.lineTo(x - w1, y + 2 - i * 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd36b';
      ctx.fillRect(x - 3, y - 20, 6, 5);
      ctx.strokeRect(x - 3, y - 20, 6, 5);
      break;
    case 'hut':
      ctx.fillStyle = '#f2e6cf';
      ctx.fillRect(x - 6, y - 3, 12, 9);
      ctx.strokeRect(x - 6, y - 3, 12, 9);
      ctx.fillStyle = '#c0573a';
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 3);
      ctx.lineTo(x, y - 10);
      ctx.lineTo(x + 8, y - 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'ruin':
      ctx.fillStyle = '#b5aa96';
      for (const [dx, dy, w, h] of [[-8, -2, 7, 9], [0, -8, 7, 15], [8, 0, 6, 7]]) {
        ctx.fillRect(x + dx - w / 2, y + dy, w, h);
        ctx.strokeRect(x + dx - w / 2, y + dy, w, h);
      }
      break;
    case 'bells':
      ctx.fillStyle = '#d9a441';
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 8);
      ctx.quadraticCurveTo(x, y - 13, x + 4, y - 8);
      ctx.lineTo(x + 8, y + 5);
      ctx.lineTo(x - 8, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'chest':
      ctx.fillStyle = '#9a6a43';
      ctx.fillRect(x - 9, y - 4, 18, 11);
      ctx.strokeRect(x - 9, y - 4, 18, 11);
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 4);
      ctx.quadraticCurveTo(x, y - 13, x + 9, y - 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(x - 2, y - 3, 4, 5);
      break;
    case 'x':
      ctx.strokeStyle = '#c0412b';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
      break;
    case 'stones':
      ctx.fillStyle = '#8f877a';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + 18 - i * 6, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'bottle':
      ctx.fillStyle = '#7ccfb5';
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
  }
}
