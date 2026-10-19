import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import type { PuzzleView } from '../quest/Quest';
import { BELLS, bellsLocal, BOTTLE, CHEST, DIG, heightAt, SHELLS, SIGNS } from './IslandShape';
import { plankTexture } from './textures';
import type { ObstacleInfo } from './World';

/** Bell colours, biggest (lowest note) first; each bell's plate carries the same colour. */
export const BELL_COLORS = ['#3f7fd6', '#45a85c', '#ef8a3c'] as const;
const BELL_SIZES = [0.5, 0.4, 0.31];
const FRAME_HALF_WIDTH = 2.7;
const BEAM_HEIGHT = 2.85;

/**
 * The puzzle props of the lens quest: the singing bells and their plates, the music stone,
 * Zwartbaard's chest, the golden shells, the message in a bottle, the X on the cliff and the bells sign.
 * Solid parts (frame posts, chest, sign post) get colliders; everything else is walk-through.
 * Presentation only: animation reads the quest's PuzzleView and never writes to it.
 */
export class PuzzleProps {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly bells: Array<{ pivot: THREE.Group; paint: THREE.MeshStandardMaterial; color: THREE.Color }> = [];
  private readonly lid = new THREE.Group();
  private readonly studs: THREE.MeshStandardMaterial[] = [];
  private lidOpen = 0;
  private readonly shells: Array<{ mesh: THREE.Mesh; baseY: number; takenAt: number }> = [];
  private readonly bottle = new THREE.Group();
  private readonly xMark = new THREE.Group();
  private readonly hole = new THREE.Group();
  private time = 0;
  private readonly gold = new THREE.Color('#ffd36b');

  constructor(physics: PhysicsWorld) {
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);
    const post = (x: number, z: number, radius: number, height: number, kind: string) => {
      const y = heightAt(x, z);
      physics.world.createCollider(
        physics.rapier.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y + height / 2 - 0.2, z).setCollisionGroups(solid),
        body,
      );
      this.obstacles.push({ kind, x, y, z, radius });
    };

    const boards = this.track(plankTexture(3, 17));
    boards.wrapS = boards.wrapT = THREE.RepeatWrapping;
    const wood = this.mat({ color: '#9a6a43', roughness: 0.85, map: boards });
    const darkWood = this.mat({ color: '#6b4a30', roughness: 0.9 });
    const stone = this.mat({ color: '#b8ae9c', roughness: 0.95, flatShading: true });
    // The scene has no environment map, so a strongly metallic bell has nothing to reflect and
    // turns near-black in the roof's shadow. Mostly non-metal plus a faint warm glow keeps it golden.
    const bronze = this.mat({ color: '#d9a646', roughness: 0.4, metalness: 0.25, emissive: '#6b4310', emissiveIntensity: 0.35 });

    // --- The singing bells.
    const frame = new THREE.Group();
    frame.position.set(BELLS.x, heightAt(BELLS.x, BELLS.z), BELLS.z);
    frame.rotation.y = BELLS.rotY;
    this.group.add(frame);
    const postGeo = this.track(new THREE.CylinderGeometry(0.11, 0.14, BEAM_HEIGHT + 0.5, 8));
    for (const side of [-1, 1]) {
      const at = bellsLocal(side * FRAME_HALF_WIDTH, 0);
      const mesh = this.add(new THREE.Mesh(postGeo, darkWood), frame);
      // Posts are sunk into the ground; on a slope each one finds its own footing.
      mesh.position.set(side * FRAME_HALF_WIDTH, heightAt(at.x, at.z) - frame.position.y + (BEAM_HEIGHT + 0.5) / 2 - 0.4, 0);
      post(at.x, at.z, 0.15, BEAM_HEIGHT + 0.6, 'bell-post');
    }
    const beam = this.add(new THREE.Mesh(this.track(new THREE.BoxGeometry(FRAME_HALF_WIDTH * 2 + 0.5, 0.2, 0.2)), darkWood), frame);
    beam.position.y = BEAM_HEIGHT;
    // A little plank roof: gives the frame a friendly silhouette from across the meadow.
    const roofGeo = this.track(new THREE.BoxGeometry(FRAME_HALF_WIDTH * 2 + 0.9, 0.06, 0.75));
    for (const side of [-1, 1]) {
      const plank = this.add(new THREE.Mesh(roofGeo, wood), frame);
      plank.position.set(0, BEAM_HEIGHT + 0.32, side * 0.3);
      plank.rotation.x = side * 0.62;
    }

    // Lathe faces point outward only when the profile runs bottom-to-top / outside-to-inside, so
    // the bell is traced as a closed shell: inner wall down to the rim, then the outside up to the top.
    const bellProfile = [
      [0.02, 0.9], [0.3, 0.88], [0.44, 0.8], [0.49, 0.62], [0.54, 0.38], [0.66, 0.16], [0.72, 0.03],
      [0.88, 0], [0.9, 0.03], [0.74, 0.16], [0.6, 0.4], [0.55, 0.66], [0.5, 0.88], [0.36, 0.98], [0.02, 1.0],
    ].map(([r, y]) => new THREE.Vector2(r, y - 1));
    BELL_SIZES.forEach((size, i) => {
      const lx = (i - 1) * BELLS.plateSpacing;
      const pivot = new THREE.Group();
      pivot.position.set(lx, BEAM_HEIGHT - 0.1, 0);
      frame.add(pivot);
      const rope = this.add(new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5)), darkWood), pivot);
      rope.position.y = -0.1;
      const bellGeo = this.track(new THREE.LatheGeometry(bellProfile, 20));
      bellGeo.scale(size, size * 1.1, size);
      const bell = this.add(new THREE.Mesh(bellGeo, bronze), pivot);
      bell.position.y = -0.2;
      const color = new THREE.Color(BELL_COLORS[i]);
      const paint = this.mat({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0 });
      const band = this.add(new THREE.Mesh(this.track(new THREE.TorusGeometry(size * 0.6, size * 0.06, 6, 24)), paint), pivot);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.2 - size * 1.1 * 0.62;
      this.bells.push({ pivot, paint, color });
      // The plate under the bell: grey stone with an inlay in the bell's colour.
      const at = bellsLocal(lx, 0);
      this.disc(at.x, at.z, 0.6, stone, paint, 0.36);
    });
    const listen = bellsLocal(0, BELLS.listenOffset);
    const noteTex = this.track(noteTexture());
    this.disc(listen.x, listen.z, 0.78, stone, this.mat({ map: noteTex, roughness: 0.6 }), 0.6);

    // --- Zwartbaard's chest.
    const chest = new THREE.Group();
    const chestY = heightAt(CHEST.x, CHEST.z);
    chest.position.set(CHEST.x, chestY - 0.04, CHEST.z);
    chest.rotation.y = CHEST.rotY;
    this.group.add(chest);
    const W = 0.92;
    const H = 0.48;
    const D = 0.6;
    const box = this.add(new THREE.Mesh(this.track(new THREE.BoxGeometry(W, H, D)), wood), chest);
    box.position.y = H / 2;
    const iron = this.mat({ color: '#3b3330', roughness: 0.5, metalness: 0.6 });
    const bandGeo = this.track(new THREE.BoxGeometry(0.07, H + 0.02, D + 0.02));
    for (const side of [-1, 1]) this.add(new THREE.Mesh(bandGeo, iron), chest).position.set(side * (W / 2 - 0.12), H / 2, 0);
    this.lid.position.set(0, H, -D / 2);
    chest.add(this.lid);
    const lidGeo = this.track(new THREE.CylinderGeometry(D / 2, D / 2, W, 16, 1, false, 0, Math.PI));
    lidGeo.rotateZ(Math.PI / 2);
    const lidMesh = this.add(new THREE.Mesh(lidGeo, wood), this.lid);
    lidMesh.position.z = D / 2;
    const lidBandGeo = this.track(new THREE.CylinderGeometry(D / 2 + 0.01, D / 2 + 0.01, 0.07, 16, 1, true, 0, Math.PI));
    lidBandGeo.rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) this.add(new THREE.Mesh(lidBandGeo, iron), this.lid).position.set(side * (W / 2 - 0.12), 0, D / 2);
    // Inside of the chest, seen when the lid is up: a warm golden glow.
    const inside = this.add(new THREE.Mesh(this.track(new THREE.PlaneGeometry(W - 0.08, D - 0.08)), this.mat({ color: '#ffcf6a', emissive: '#ffb238', emissiveIntensity: 0.9 })), chest);
    inside.rotation.x = -Math.PI / 2;
    inside.position.y = H + 0.012;
    // The shell lock: five holes that light up as shells are found.
    const lockPlate = this.add(new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.2, 0.03)), bronze), chest);
    lockPlate.position.set(0, H - 0.14, D / 2 + 0.016);
    const studGeo = this.track(new THREE.SphereGeometry(0.032, 10, 8));
    for (let i = 0; i < SHELLS.length; i++) {
      const m = this.mat({ color: '#2a2622', roughness: 0.4, metalness: 0.3, emissive: '#ffb21e', emissiveIntensity: 0 });
      this.studs.push(m);
      this.add(new THREE.Mesh(studGeo, m), chest).position.set((i - (SHELLS.length - 1) / 2) * 0.085, H - 0.14, D / 2 + 0.035);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CHEST.rotY);
    physics.world.createCollider(
      physics.rapier.ColliderDesc.cuboid(W / 2, (H + D / 2) / 2 + 0.1, D / 2)
        .setTranslation(CHEST.x, chestY + (H + D / 2) / 2 - 0.1, CHEST.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(solid),
      body,
    );
    this.obstacles.push({ kind: 'chest', x: CHEST.x, y: chestY, z: CHEST.z, radius: D / 2 });

    // --- Golden shells.
    const shellGeo = this.track(scallopGeometry());
    const shellMat = this.mat({ color: '#f4c542', roughness: 0.3, metalness: 0.8, emissive: '#8a5a00', emissiveIntensity: 0.45, side: THREE.DoubleSide });
    SHELLS.forEach((s, i) => {
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      const y = heightAt(s.x, s.z) + 0.02;
      mesh.position.set(s.x, y, s.z);
      mesh.rotation.set(-0.12, i * 1.9, 0.08);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.shells.push({ mesh, baseY: y, takenAt: -1 });
    });

    // --- The message in a bottle, half-buried in the sand.
    const glass = this.mat({ color: '#7ccfb5', roughness: 0.08, transparent: true, opacity: 0.55 });
    const bottleGeo = this.track(
      new THREE.LatheGeometry(
        [[0, 0], [0.1, 0], [0.11, 0.02], [0.11, 0.22], [0.09, 0.27], [0.04, 0.31], [0.034, 0.4], [0.04, 0.41], [0, 0.41]].map(
          ([r, y]) => new THREE.Vector2(r, y),
        ),
        16,
      ),
    );
    const flask = this.add(new THREE.Mesh(bottleGeo, glass), this.bottle);
    flask.renderOrder = 2;
    const paper = this.add(new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 10)), this.mat({ color: '#f3e6c4', roughness: 0.9 })), this.bottle);
    paper.position.y = 0.13;
    const cork = this.add(new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.036, 0.03, 0.06, 8)), this.mat({ color: '#a77b4f', roughness: 0.9 })), this.bottle);
    cork.position.y = 0.42;
    this.bottle.position.set(BOTTLE.x, heightAt(BOTTLE.x, BOTTLE.z) + 0.08, BOTTLE.z);
    this.bottle.rotation.set(0, 0.6, Math.PI / 2 - 0.12);
    this.group.add(this.bottle);

    // --- X marks the spot: two red boards on a little sand mound.
    const digY = heightAt(DIG.x, DIG.z);
    this.xMark.position.set(DIG.x, digY, DIG.z);
    this.group.add(this.xMark);
    const sand = this.mat({ color: '#d9bf86', roughness: 1 });
    const mound = this.add(new THREE.Mesh(this.track(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), sand), this.xMark);
    mound.scale.y = 0.22;
    mound.position.y = -0.03;
    const red = this.mat({ color: '#c0412b', roughness: 0.7 });
    const plankGeo = this.track(new THREE.BoxGeometry(1.1, 0.05, 0.17));
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const p = this.add(new THREE.Mesh(plankGeo, red), this.xMark);
      p.position.y = 0.14;
      p.rotation.y = a;
    }
    // After digging: a hole with a heap of sand beside it.
    this.hole.position.copy(this.xMark.position);
    this.hole.visible = false;
    this.group.add(this.hole);
    const pit = this.add(new THREE.Mesh(this.track(new THREE.CircleGeometry(0.5, 18)), this.mat({ color: '#4d3b29', roughness: 1 })), this.hole);
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.03;
    const heap = this.add(new THREE.Mesh(mound.geometry, sand), this.hole);
    heap.scale.set(0.8, 0.35, 0.6);
    heap.position.set(0.9, -0.03, 0.2);

    // --- The signpost by the bells (the only puzzle that needs explaining).
    const at = SIGNS.bells;
    const face = bellsLocal(0, 7);
    const sign = new THREE.Group();
    sign.position.set(at.x, heightAt(at.x, at.z), at.z);
    sign.rotation.y = Math.atan2(face.x - at.x, face.z - at.z) + 0.25;
    this.group.add(sign);
    this.add(new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.07, 0.08, 1.7, 7)), darkWood), sign).position.y = 0.6;
    const board = this.add(new THREE.Mesh(this.track(new THREE.BoxGeometry(1.0, 0.56, 0.07)), wood), sign);
    board.position.y = 1.3;
    const tex = this.track(signTexture());
    const front = this.add(new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.9, 0.48)), this.mat({ map: tex, roughness: 0.85, transparent: true })), sign);
    front.position.set(0, 1.3, 0.04);
    front.castShadow = false;
    post(at.x, at.z, 0.1, 1.8, 'sign');
  }

  private mat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    return this.track(new THREE.MeshStandardMaterial(params));
  }

  private add<T extends THREE.Mesh>(mesh: T, parent: THREE.Object3D): T {
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * A flat round stone set into the ground (walk-on, no collider) with an inlay on top. It sinks
   * to the lowest ground under its rim so it never floats on a slope.
   */
  private disc(x: number, z: number, r: number, stone: THREE.Material, top: THREE.Material, inlay: number): void {
    let base = heightAt(x, z);
    for (let a = 0; a < 6; a++) base = Math.min(base, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    const topY = heightAt(x, z) + 0.05;
    const h = topY - base + 0.08;
    const slab = new THREE.Mesh(this.track(new THREE.CylinderGeometry(r, r * 1.08, h, 18)), stone);
    slab.position.set(x, topY - h / 2, z);
    slab.receiveShadow = true;
    this.group.add(slab);
    const face = new THREE.Mesh(this.track(new THREE.CircleGeometry(r * inlay, 24)), top);
    face.rotation.x = -Math.PI / 2;
    face.position.set(x, topY + 0.005, z);
    face.receiveShadow = true;
    this.group.add(face);
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  update(dt: number, view: PuzzleView): void {
    this.time += dt;
    const t = this.time;
    // Bells swing and their colour lights up when rung; once solved they keep a soft golden glow.
    this.bells.forEach((b, i) => {
      const age = view.bellAge(i);
      const ring = Number.isFinite(age) && age < 5 ? Math.exp(-age * 2.2) : 0;
      b.pivot.rotation.x = 0.32 * ring * Math.sin(age * 9);
      b.paint.emissiveIntensity = 1.4 * ring + (view.bellsSolved ? 0.25 + 0.15 * Math.sin(t * 2 + i) : 0);
    });
    // Chest: lock studs light per shell; the lid swings open once all are in.
    this.studs.forEach((m, i) => {
      const lit = i < view.shellsFound;
      m.color.set(lit ? this.gold : '#2a2622');
      m.emissiveIntensity = lit ? 1.2 : 0;
    });
    this.lidOpen = Math.min(1, this.lidOpen + (view.chestOpen ? dt * 1.4 : 0));
    const e = this.lidOpen;
    // Ease out with a small bounce at the end of the swing.
    this.lid.rotation.x = -(1 - Math.pow(1 - e, 3)) * 1.95 + Math.sin(e * Math.PI) * 0.08;
    // Shells: a gentle shimmer while waiting; a hop, spin and vanish when picked up.
    this.shells.forEach((s, i) => {
      if (!s.mesh.visible) return;
      if (view.isShellTaken(i)) {
        if (s.takenAt < 0) s.takenAt = t;
        const k = Math.min(1, (t - s.takenAt) / 0.45);
        s.mesh.position.y = s.baseY + Math.sin(k * Math.PI) * 0.7 + k * 0.3;
        s.mesh.rotation.y += dt * 16;
        s.mesh.scale.setScalar(1 - k * 0.9);
        if (k >= 1) s.mesh.visible = false;
      } else {
        s.mesh.rotation.z = 0.08 + Math.sin(t * 1.3 + i) * 0.06;
      }
    });
    // The bottle rocks a little, as if the last wave just left it; gone once read.
    this.bottle.visible = !view.bottleRead;
    this.bottle.rotation.x = Math.sin(t * 1.6) * 0.06;
    this.xMark.visible = !view.dug;
    this.hole.visible = view.dug;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** A scallop: a fan of ribs domed into a shell, about 30 cm across, opening toward -Z. */
function scallopGeometry(): THREE.BufferGeometry {
  const rings = 6;
  const segs = 22;
  const R = 0.17;
  const a0 = Math.PI * 0.12;
  const a1 = Math.PI * 0.88;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const r = 0.015 + u * R;
    for (let j = 0; j <= segs; j++) {
      const a = a0 + (a1 - a0) * (j / segs);
      const rib = 0.014 * Math.abs(Math.sin(((j / segs) * 9 + 0.5) * Math.PI)) * u;
      const dome = 0.075 * Math.sqrt(Math.max(0, 1 - u * u * 0.85));
      pos.push(Math.cos(a) * r, dome + rib, -Math.sin(a) * r + R * 0.45);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The hinge "ears" at the narrow end.
  const ears = new THREE.BoxGeometry(0.11, 0.025, 0.04).translate(0, 0.012, R * 0.45 + 0.01);
  const merged = mergeSimple([g, ears]);
  g.dispose();
  ears.dispose();
  return merged;
}

/** Concatenate indexed geometries with position and normal attributes. */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const offset = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + offset);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Top of the music stone: a gold double note on dark slate, with a ring around it. */
function noteTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#3c4a55';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e9c46a';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    drawNote(ctx, s * 0.5, s * 0.5, s * 0.5, '#f2cf72');
  });
}

/** A beamed pair of eighth notes centred on (cx, cy), `h` tall. */
function drawNote(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const head = (x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.4);
    ctx.beginPath();
    ctx.ellipse(0, 0, h * 0.13, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const left = cx - h * 0.22;
  const right = cx + h * 0.22;
  head(left, cy + h * 0.32);
  head(right, cy + h * 0.24);
  ctx.lineWidth = h * 0.05;
  ctx.beginPath();
  ctx.moveTo(left + h * 0.11, cy + h * 0.3);
  ctx.lineTo(left + h * 0.11, cy - h * 0.34);
  ctx.moveTo(right + h * 0.11, cy + h * 0.22);
  ctx.lineTo(right + h * 0.11, cy - h * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left + h * 0.08, cy - h * 0.34);
  ctx.lineTo(right + h * 0.14, cy - h * 0.46);
  ctx.lineTo(right + h * 0.14, cy - h * 0.34);
  ctx.lineTo(left + h * 0.08, cy - h * 0.22);
  ctx.closePath();
  ctx.fill();
}

/** Painted picture on the bells sign (young players read pictures before words): three bells and a note. */
function signTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = 'rgba(250, 240, 214, 0.92)';
    ctx.beginPath();
    ctx.roundRect(s * 0.04, s * 0.2, s * 0.92, s * 0.6, s * 0.05);
    ctx.fill();
    ctx.strokeStyle = '#6b4a30';
    ctx.lineWidth = s * 0.02;
    ctx.stroke();
    const cy = s / 2;
    BELL_COLORS.forEach((c, i) => {
      const x = s * (0.25 + i * 0.25);
      const r = s * (0.1 - i * 0.017);
      ctx.fillStyle = '#c99a3e';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, cy - r);
      ctx.quadraticCurveTo(x, cy - r * 1.5, x + r * 0.5, cy - r);
      ctx.lineTo(x + r, cy + r * 0.6);
      ctx.lineTo(x - r, cy + r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c;
      ctx.fillRect(x - r * 0.85, cy + r * 0.2, r * 1.7, r * 0.25);
    });
    drawNote(ctx, s * 0.84, s * 0.33, s * 0.16, '#3c4a55');
  });
}
