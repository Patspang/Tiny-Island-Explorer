import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { LIGHTHOUSE, SPAWN } from './IslandShape';
import { createRng } from './noise';
import { applyGrime, flagstoneTexture, masonryTexture, plankTexture, plasterTexture } from './textures';
import type { ObstacleInfo } from './World';

const TOWER_HEIGHT = 9.2;
const BASE_RADIUS = 1.55;
const TOP_RADIUS = 1.12;
/** Large enough that the keeper's hut and its crates stand fully on the terrace (pad is 6.5 m). */
const PLATFORM_RADIUS = 6.2;
const PLATFORM_HEIGHT = 0.28;
const BANDS = 5;
/** Hut-local spots for props that get colliders. */
const BARREL = { x: 1.6, z: -0.45 };
const CHIMNEY = { x: 0.85, z: -0.55 };
/** Tower-local bench looking out to sea, away from the door and plaque. */
const BENCH = { x: 2.8, z: -1.6, rot: 2.1 };

/** The island's landmark. Visual only for now (no activation/story yet). */
export class Lighthouse {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  private readonly lamp: THREE.Group;
  private readonly glass: THREE.MeshStandardMaterial;
  private readonly lampMat: THREE.MeshStandardMaterial;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly beams: THREE.Group;
  private readonly light: THREE.PointLight;
  private readonly halo: THREE.Sprite;
  private readonly doorMat: THREE.MeshStandardMaterial;
  private readonly socketMats: THREE.MeshStandardMaterial[] = [];
  private doorReady = false;
  /** World position just outside the door (where the quest finale triggers). */
  readonly doorPosition = new THREE.Vector3();
  /** Unit vector pointing out of the door. */
  readonly doorOutward = new THREE.Vector3();
  /** World position of the lens piece on the keeper's hut roof. */
  readonly roofPiecePosition = new THREE.Vector3();
  private lightLevel = 0;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(physics: PhysicsWorld) {
    const { rapier, world } = physics;
    const baseY = LIGHTHOUSE.y;
    this.group.position.set(LIGHTHOUSE.x, baseY, LIGHTHOUSE.z);
    // Door faces the spawn beach so the approach path arrives at it.
    const facing = Math.atan2(SPAWN.x - LIGHTHOUSE.x, SPAWN.z - LIGHTHOUSE.z);
    this.group.rotation.y = facing;

    const m = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) =>
      this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
    // Surfaces: lime-washed render (with grime baked into vertex colours), coursed stone,
    // flagstones and weathered boards, all painted procedurally (see textures.ts).
    // Repeats follow each surface's real proportions so the patterns are not stretched.
    const plaster = this.track(plasterTexture(2, 2));
    const towerPlaster = this.track(plasterTexture(6, 1.2));
    const towerStone = this.track(masonryTexture(9, 1));
    const terraceStone = this.track(masonryTexture(36, 0.7, 13));
    const wallStone = this.track(masonryTexture(2, 1.2, 9));
    const flags = this.track(flagstoneTexture());
    const boards = this.track(plankTexture());
    const white = m('#f5efe3', { roughness: 0.9, map: plaster, bumpMap: plaster, bumpScale: 0.8, vertexColors: true });
    const towerWhite = m('#f5efe3', { roughness: 0.9, map: towerPlaster, bumpMap: towerPlaster, bumpScale: 0.8, vertexColors: true });
    const red = m('#c24a3c', { roughness: 0.85, map: towerPlaster, bumpMap: towerPlaster, bumpScale: 0.8, vertexColors: true });
    const terraceEdge = m('#b9ae9b', { roughness: 0.95, map: terraceStone, bumpMap: terraceStone, bumpScale: 2.5 });
    const stone = m('#c9bfae', { roughness: 0.95, map: towerStone, bumpMap: towerStone, bumpScale: 2.5 });
    const darkStone = m('#b2a794', { roughness: 0.95, map: wallStone, bumpMap: wallStone, bumpScale: 2.5 });
    const paving = m('#d3c9b6', { roughness: 0.95, map: flags, bumpMap: flags, bumpScale: 2 });
    const metal = m('#3b4447', { roughness: 0.5, metalness: 0.4 });
    const glass = m('#e8eef0', { emissive: '#ffd77a', emissiveIntensity: 0.05, roughness: 0.2 });
    this.glass = glass;
    const windowMat = m('#2f3b45', { roughness: 0.3, emissive: '#16232b', emissiveIntensity: 0.4 });
    const wood = m('#a0714c', { roughness: 0.85, map: boards, bumpMap: boards, bumpScale: 1.5 });
    const paintedWood = m('#6f9a98', { roughness: 0.8, map: boards, bumpMap: boards, bumpScale: 1.5 });
    const iron = m('#2c2a28', { roughness: 0.6, metalness: 0.5 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, cast = true) => {
      const mesh = new THREE.Mesh(this.track(geo), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Flagstone terrace with a rough stone retaining edge, sunk a little so it blends into the
    // ground. Side, top and bottom of the cylinder take their own materials.
    const plat = new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 0.35, PLATFORM_HEIGHT + 0.6, 40, 1);
    jitter(plat, 0.14, 7);
    add(plat, [terraceEdge, paving, terraceEdge], 0, PLATFORM_HEIGHT / 2 - 0.3, 0, false);
    const ring = new THREE.CylinderGeometry(BASE_RADIUS + 0.45, BASE_RADIUS + 0.6, 0.55, 36);
    jitter(ring, 0.04, 9);
    add(ring, stone, 0, PLATFORM_HEIGHT + 0.27, 0);

    // Striped, gently tapered tower; grime collects near the foot.
    const bandH = TOWER_HEIGHT / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const r0 = BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * (i / BANDS);
      const r1 = BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * ((i + 1) / BANDS);
      const band = new THREE.CylinderGeometry(r1, r0, bandH, 40, 6);
      applyGrime(band, -bandH / 2 - bandH * i, 1.6, i + 1);
      add(band, i % 2 === 0 ? towerWhite : red, 0, PLATFORM_HEIGHT + bandH * (i + 0.5), 0);
    }
    const top = PLATFORM_HEIGHT + TOWER_HEIGHT;

    // Door (facing local +Z) with a small step and arch, in a stone surround with iron hinges.
    this.doorMat = m('#8a5a3a', { roughness: 0.85, emissive: '#ffc864', emissiveIntensity: 0, map: boards, bumpMap: boards, bumpScale: 1.5 });
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.16, 1.5, 0.3), stone, side * 0.48, PLATFORM_HEIGHT + 0.75, BASE_RADIUS - 0.06);
      for (const hy of [0.35, 1.15]) add(new THREE.BoxGeometry(0.3, 0.05, 0.03), iron, -0.22, PLATFORM_HEIGHT + hy, BASE_RADIUS + 0.095, false);
    }
    const doorArch = add(new THREE.TorusGeometry(0.48, 0.08, 6, 18, Math.PI), stone, 0, PLATFORM_HEIGHT + 1.45, BASE_RADIUS - 0.02);
    doorArch.scale.z = 1.6;
    add(new THREE.BoxGeometry(0.8, 1.45, 0.25), this.doorMat, 0, PLATFORM_HEIGHT + 0.72, BASE_RADIUS - 0.04);
    const arch = add(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 16, 1, false, 0, Math.PI), this.doorMat, 0, PLATFORM_HEIGHT + 1.45, BASE_RADIUS - 0.04);
    arch.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    add(new THREE.BoxGeometry(1.2, 0.18, 0.6), darkStone, 0, PLATFORM_HEIGHT + 0.09, BASE_RADIUS + 0.2);

    // Windows spiral up the tower.
    for (let i = 0; i < 4; i++) {
      const y = PLATFORM_HEIGHT + 2.6 + i * 1.75;
      const r = BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * ((y - PLATFORM_HEIGHT) / TOWER_HEIGHT);
      const a = i * 2.1 + 0.9;
      const w = add(new THREE.BoxGeometry(0.34, 0.55, 0.12), windowMat, Math.sin(a) * r, y, Math.cos(a) * r);
      w.rotation.y = a;
      // Stone surround and a projecting sill.
      const surround = add(new THREE.BoxGeometry(0.52, 0.74, 0.1), stone, Math.sin(a) * (r - 0.02), y, Math.cos(a) * (r - 0.02));
      surround.rotation.y = a;
      const sill = add(new THREE.BoxGeometry(0.56, 0.07, 0.2), stone, Math.sin(a) * (r + 0.04), y - 0.36, Math.cos(a) * (r + 0.04));
      sill.rotation.y = a;
    }

    // Gallery deck with railing.
    add(new THREE.CylinderGeometry(TOP_RADIUS + 0.62, TOP_RADIUS + 0.38, 0.22, 28), metal, 0, top + 0.11, 0);
    const rail = add(new THREE.TorusGeometry(TOP_RADIUS + 0.55, 0.035, 6, 40), metal, 0, top + 0.78, 0);
    rail.rotation.x = Math.PI / 2;
    const postGeo = this.track(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 5));
    const posts = new THREE.InstancedMesh(postGeo, metal, 16);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mtx.makeTranslation(Math.sin(a) * (TOP_RADIUS + 0.55), top + 0.45, Math.cos(a) * (TOP_RADIUS + 0.55));
      posts.setMatrixAt(i, mtx);
    }
    posts.castShadow = true;
    this.group.add(posts);
    // Iron brackets carrying the gallery.
    const bracketGeo = this.track(new THREE.BoxGeometry(0.07, 0.45, 0.32));
    const brackets = new THREE.InstancedMesh(bracketGeo, metal, 16);
    const q = new THREE.Quaternion();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      q.setFromEuler(new THREE.Euler(0.55, a, 0, 'YXZ'));
      mtx.compose(new THREE.Vector3(Math.sin(a) * (TOP_RADIUS + 0.2), top - 0.15, Math.cos(a) * (TOP_RADIUS + 0.2)), q, new THREE.Vector3(1, 1, 1));
      brackets.setMatrixAt(i, mtx);
    }
    brackets.castShadow = true;
    this.group.add(brackets);

    // Lantern room: glowing glass between thin frames, under a red cap.
    add(new THREE.CylinderGeometry(0.82, 0.82, 1.25, 20), glass, 0, top + 0.85, 0, false);
    const frameGeo = this.track(new THREE.BoxGeometry(0.07, 1.3, 0.07));
    const frames = new THREE.InstancedMesh(frameGeo, metal, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mtx.makeTranslation(Math.sin(a) * 0.84, top + 0.85, Math.cos(a) * 0.84);
      frames.setMatrixAt(i, mtx);
    }
    this.group.add(frames);
    add(new THREE.CylinderGeometry(0.98, 0.98, 0.12, 20), metal, 0, top + 1.52, 0);
    const cap = new THREE.ConeGeometry(1.08, 1.05, 28);
    applyGrime(cap, -10, 1);
    add(cap, red, 0, top + 2.1, 0);
    add(new THREE.SphereGeometry(0.16, 12, 10), metal, 0, top + 2.68, 0);
    add(new THREE.CylinderGeometry(0.02, 0.03, 0.55, 6), metal, 0, top + 2.98, 0);

    // A slowly turning lamp inside the lantern.
    this.lamp = new THREE.Group();
    this.lamp.position.y = top + 0.85;
    const lampMat = m('#fff8e0', { emissive: '#fff1b8', emissiveIntensity: 0 });
    this.lampMat = lampMat;
    const lens = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.55, 0.18)), lampMat);
    lens.position.z = 0.32;
    this.lamp.add(lens);
    this.group.add(this.lamp);

    // Light beams (hidden until the lamp is relit) and a warm light for the hilltop at dusk.
    this.beamMat = this.track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ffe2a0') } },
        vertexShader: /* glsl */ `
          varying float vD;
          void main() { vD = length(position) / 34.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity; uniform vec3 uColor; varying float vD;
          void main() { float a = pow(1.0 - clamp(vD, 0.0, 1.0), 1.3) * 0.6 * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    );
    const beamGeo = this.track(new THREE.ConeGeometry(3.6, 34, 24, 1, true));
    beamGeo.translate(0, -17, 0); // apex at the lamp
    beamGeo.rotateX(Math.PI / 2); // point along -Z
    this.beams = new THREE.Group();
    for (const rot of [0, Math.PI]) {
      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.rotation.y = rot;
      beam.rotation.x = -0.06; // tilt slightly down toward the sea
      beam.renderOrder = 3;
      this.beams.add(beam);
    }
    this.beams.visible = false;
    this.lamp.add(this.beams);
    // Soft halo around the lantern.
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 64;
    const hctx = haloCanvas.getContext('2d')!;
    const grad = hctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.3, 'rgba(255,214,140,0.45)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 64, 64);
    const haloTex = this.track(new THREE.CanvasTexture(haloCanvas));
    haloTex.colorSpace = THREE.SRGBColorSpace;
    this.halo = new THREE.Sprite(
      this.track(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })),
    );
    this.halo.scale.setScalar(7);
    this.halo.position.y = top + 0.85;
    this.halo.visible = false;
    this.group.add(this.halo);
    // Added from the start (at zero) so lighting it later doesn't recompile every shader.
    this.light = new THREE.PointLight('#ffcf85', 0, 60, 1.4);
    this.light.position.y = top + 0.85;
    this.group.add(this.light);

    // Keeper's hut beside the tower.
    const hut = new THREE.Group();
    hut.position.set(-3.4, PLATFORM_HEIGHT, -1.6);
    hut.rotation.y = 0.45;
    this.group.add(hut);
    const hutPart = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) => {
      const mesh = new THREE.Mesh(this.track(geo), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      hut.add(mesh);
      return mesh;
    };
    // Lime-washed walls on a stone plinth, with dressed quoins at the corners.
    const wallGeo = new THREE.BoxGeometry(2.6, 1.9, 2.1, 1, 6, 1);
    applyGrime(wallGeo, -0.95, 1.1, 21);
    hutPart(wallGeo, white, 0, 0.95, 0);
    // The plinth runs down into the ground so the hut never shows a gap underneath.
    hutPart(new THREE.BoxGeometry(2.72, 0.94, 2.22), darkStone, 0, -0.13, 0);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const long = k % 2 === 0;
          const qx = long ? 0.44 : 0.22;
          const qz = long ? 0.22 : 0.44;
          hutPart(new THREE.BoxGeometry(qx, 0.26, qz), stone, cx * (1.3 - qx / 2 + 0.015), 0.5 + k * 0.29, cz * (1.05 - qz / 2 + 0.015));
        }
      }
    }
    // Gable ends: plastered triangles under the roof (the slopes are hidden by the tiles).
    const gable = prismGeometry(2.6, 1.0, 2.1);
    applyGrime(gable, -10, 1);
    hutPart(gable, white, 0, 1.9, 0);
    this.buildTileRoof(hut, wood);
    // Chimney on the back slope (collider below), with a clay pot.
    hutPart(new THREE.BoxGeometry(0.44, 1.05, 0.44), darkStone, CHIMNEY.x, 2.72, CHIMNEY.z);
    hutPart(new THREE.BoxGeometry(0.52, 0.08, 0.52), stone, CHIMNEY.x, 3.27, CHIMNEY.z);
    hutPart(new THREE.CylinderGeometry(0.09, 0.11, 0.24, 10), m('#b5603f', { roughness: 0.8 }), CHIMNEY.x, 3.42, CHIMNEY.z);
    // Plank door in a painted frame, a lantern beside it.
    hutPart(new THREE.BoxGeometry(0.7, 1.25, 0.1), wood, 0.5, 0.63 + 0.12, 1.07);
    for (const [fx, fy, w, h] of [
      [0.12, 0.8, 0.09, 1.45],
      [0.88, 0.8, 0.09, 1.45],
      [0.5, 1.5, 0.85, 0.09],
    ] as const) {
      hutPart(new THREE.BoxGeometry(w, h, 0.08), paintedWood, fx, fy, 1.1);
    }
    hutPart(new THREE.BoxGeometry(0.9, 0.1, 0.35), stone, 0.5, 0.05 + 0.29, 1.2);
    hutPart(new THREE.BoxGeometry(0.16, 0.22, 0.16), iron, 1.12, 1.62, 1.16);
    hutPart(new THREE.BoxGeometry(0.11, 0.15, 0.11), m('#fff1c4', { emissive: '#ffcf7a', emissiveIntensity: 0.6 }), 1.12, 1.62, 1.16, false);
    // Windows: glass in a painted frame, stone sill, open shutters.
    const windowAt = (x: number, z: number, rot: number) => {
      const w = new THREE.Group();
      w.position.set(x, 1.15, z);
      w.rotation.y = rot;
      hut.add(w);
      const piece = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
        const mesh = new THREE.Mesh(this.track(geo), mat);
        mesh.position.set(px, py, pz);
        mesh.castShadow = mesh.receiveShadow = true;
        w.add(mesh);
      };
      piece(new THREE.BoxGeometry(0.5, 0.48, 0.06), windowMat, 0, 0, 0);
      piece(new THREE.BoxGeometry(0.6, 0.06, 0.08), paintedWood, 0, 0.27, 0.01);
      piece(new THREE.BoxGeometry(0.06, 0.54, 0.08), paintedWood, -0.28, 0, 0.01);
      piece(new THREE.BoxGeometry(0.06, 0.54, 0.08), paintedWood, 0.28, 0, 0.01);
      piece(new THREE.BoxGeometry(0.03, 0.5, 0.05), paintedWood, 0, 0, 0.02);
      piece(new THREE.BoxGeometry(0.66, 0.06, 0.18), stone, 0, -0.29, 0.06);
      for (const side of [-1, 1]) piece(new THREE.BoxGeometry(0.27, 0.54, 0.04), paintedWood, side * 0.46, 0, 0.04);
    };
    windowAt(-0.6, 1.07, 0);
    windowAt(1.31, 0.1, Math.PI / 2);
    // A water barrel against the side wall and a coil of rope by the crates.
    const barrel = hutPart(
      new THREE.LatheGeometry([new THREE.Vector2(0.22, 0), new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.28, 0.38), new THREE.Vector2(0.27, 0.56), new THREE.Vector2(0.22, 0.76), new THREE.Vector2(0, 0.76)], 18),
      wood,
      BARREL.x,
      0,
      BARREL.z,
    );
    barrel.rotation.y = 0.3;
    for (const hy of [0.12, 0.64]) {
      const hoop = hutPart(new THREE.TorusGeometry(hy < 0.3 ? 0.245 : 0.262, 0.018, 6, 24), iron, BARREL.x, hy, BARREL.z);
      hoop.rotation.x = Math.PI / 2;
    }
    const ropeMat = m('#c9a874', { roughness: 0.95 });
    for (let k = 0; k < 3; k++) {
      const coil = hutPart(new THREE.TorusGeometry(0.2 - k * 0.025, 0.035, 6, 20), ropeMat, -1.75, 0.04 + k * 0.06, 2.1, false);
      coil.rotation.x = Math.PI / 2;
    }

    // Crates stacked against the hut: a jump-by-jump way up onto the roof.
    // Tops at 0.6 m and 1.2 m (each above auto-step height), then the eave at 1.9 m.
    const crateMat = m('#c08c58', { roughness: 0.85, map: boards, bumpMap: boards, bumpScale: 1.5 });
    const crateBand = m('#4a3524', { roughness: 0.7, metalness: 0.2 });
    const crates: Array<[number, number, number, number]> = [
      // x, z, top height, size  (hut-local)
      [-0.75, 2.45, 0.6, 0.62],
      [-0.75, 1.65, 0.6, 0.66],
      [-0.75, 1.65, 1.2, 0.6],
    ];
    const crateGeos = new Map<number, THREE.BufferGeometry>();
    for (const [x, z, top, size] of crates) {
      // Extend below the platform so crates never float on uneven ground.
      const h = size + (top <= size + 0.01 ? 0.3 : 0);
      let g = crateGeos.get(h * 100 + size);
      if (!g) {
        g = this.track(new THREE.BoxGeometry(size, h, size));
        crateGeos.set(h * 100 + size, g);
      }
      const crate = new THREE.Mesh(g, crateMat);
      crate.position.set(x, top - h / 2, z);
      crate.rotation.y = (x + z) * 0.4;
      crate.castShadow = crate.receiveShadow = true;
      hut.add(crate);
      const band = new THREE.Mesh(this.track(new THREE.BoxGeometry(size * 1.02, 0.08, size * 1.02)), crateBand);
      band.position.set(x, top - size / 2, z);
      band.rotation.y = crate.rotation.y;
      hut.add(band);
    }

    // A weathered bench on the terrace, looking out to sea.
    const bench = new THREE.Group();
    bench.position.set(BENCH.x, PLATFORM_HEIGHT, BENCH.z);
    bench.rotation.y = BENCH.rot;
    this.group.add(bench);
    const benchPart = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(this.track(geo), wood);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      bench.add(mesh);
    };
    benchPart(new THREE.BoxGeometry(1.3, 0.06, 0.38), 0, 0.44, 0);
    benchPart(new THREE.BoxGeometry(1.3, 0.22, 0.05), 0, 0.72, -0.2);
    for (const lx of [-0.55, 0.55]) {
      benchPart(new THREE.BoxGeometry(0.07, 0.44, 0.32), lx, 0.22, 0);
      benchPart(new THREE.BoxGeometry(0.06, 0.4, 0.06), lx, 0.64, -0.2);
    }

    // Plaque beside the door: a stone slab holding the five lens sockets.
    const plaque = new THREE.Group();
    plaque.position.set(1.55, PLATFORM_HEIGHT, BASE_RADIUS + 0.75);
    plaque.rotation.y = -0.35;
    this.group.add(plaque);
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 1.25, 0.2)), darkStone);
    slab.position.y = 0.62;
    slab.castShadow = slab.receiveShadow = true;
    plaque.add(slab);
    const frame = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.29, 0.03, 8, 30)), metal);
    frame.position.set(0, 0.85, 0.11);
    plaque.add(frame);
    const socketGeo = this.track(new THREE.OctahedronGeometry(0.07, 0).scale(0.8, 1.3, 0.5));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      const mat = m('#2a3640', { roughness: 0.25, emissive: '#6fd6ff', emissiveIntensity: 0, flatShading: true });
      this.socketMats.push(mat);
      const sock = new THREE.Mesh(socketGeo, mat);
      sock.position.set(Math.cos(a) * 0.19, 0.85 + Math.sin(a) * 0.19, 0.12);
      plaque.add(sock);
    }

    // --- Colliders (in world space).
    this.group.updateMatrixWorld(true);
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);
    world.createCollider(
      rapier.ColliderDesc.cylinder(0.5 * (TOWER_HEIGHT + 3), BASE_RADIUS + 0.55)
        .setTranslation(LIGHTHOUSE.x, baseY + (TOWER_HEIGHT + 3) / 2, LIGHTHOUSE.z)
        .setCollisionGroups(solid),
      body,
    );
    // Low platform the player can step onto.
    world.createCollider(
      rapier.ColliderDesc.cylinder(0.3, PLATFORM_RADIUS)
        .setTranslation(LIGHTHOUSE.x, baseY + PLATFORM_HEIGHT - 0.3, LIGHTHOUSE.z)
        .setCollisionGroups(groups(GROUP.terrain, 0xffff)),
      body,
    );
    const hutWorld = new THREE.Vector3();
    hut.getWorldPosition(hutWorld);
    const hutQuat = new THREE.Quaternion();
    hut.getWorldQuaternion(hutQuat);
    const hutRot = { x: hutQuat.x, y: hutQuat.y, z: hutQuat.z, w: hutQuat.w };
    const toWorld = (x: number, y: number, z: number) => hut.localToWorld(new THREE.Vector3(x, y, z));
    // Walls up to the eave, then a roof hull matching the visible gable (walkable, ~39°).
    const wallCentre = toWorld(0, 0.95, 0);
    world.createCollider(
      rapier.ColliderDesc.cuboid(1.3, 0.95, 1.05).setTranslation(wallCentre.x, wallCentre.y, wallCentre.z).setRotation(hutRot).setCollisionGroups(solid),
      body,
    );
    const roofPts: number[] = [];
    for (const x of [-1.5, 1.5]) {
      for (const [y, z] of [
        [1.9, -1.25],
        [1.9, 1.25],
        [2.9, 0],
      ] as const) {
        const v = toWorld(x, y, z);
        roofPts.push(v.x, v.y, v.z);
      }
    }
    const roofDesc = rapier.ColliderDesc.convexHull(new Float32Array(roofPts));
    if (roofDesc) world.createCollider(roofDesc.setCollisionGroups(solid), body);
    for (const [x, z, top, size] of crates) {
      const crateTop = toWorld(x, top, z);
      this.obstacles.push({ kind: 'crate', x: crateTop.x, y: crateTop.y, z: crateTop.z, radius: size / 2 });
      const c = toWorld(x, top - size / 2 - 0.15, z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (x + z) * 0.4, 0));
      q.premultiply(hutQuat);
      world.createCollider(
        rapier.ColliderDesc.cuboid(size / 2, size / 2 + 0.15, size / 2)
          .setTranslation(c.x, c.y, c.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(solid),
        body,
      );
    }
    // Props that would look wrong to walk through: barrel, chimney stack, bench.
    const barrelC = toWorld(BARREL.x, 0.38, BARREL.z);
    world.createCollider(
      rapier.ColliderDesc.cylinder(0.38, 0.28).setTranslation(barrelC.x, barrelC.y, barrelC.z).setCollisionGroups(solid),
      body,
    );
    const chimneyC = toWorld(CHIMNEY.x, 2.72, CHIMNEY.z);
    world.createCollider(
      rapier.ColliderDesc.cuboid(0.22, 0.52, 0.22).setTranslation(chimneyC.x, chimneyC.y, chimneyC.z).setRotation(hutRot).setCollisionGroups(solid),
      body,
    );
    const benchC = this.group.localToWorld(new THREE.Vector3(BENCH.x, PLATFORM_HEIGHT + 0.4, BENCH.z));
    const benchQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BENCH.rot, 0)).premultiply(this.group.quaternion);
    world.createCollider(
      rapier.ColliderDesc.cuboid(0.65, 0.4, 0.22)
        .setTranslation(benchC.x, benchC.y, benchC.z)
        .setRotation({ x: benchQ.x, y: benchQ.y, z: benchQ.z, w: benchQ.w })
        .setCollisionGroups(solid),
      body,
    );
    const plaqueWorld = new THREE.Vector3();
    plaque.getWorldPosition(plaqueWorld);
    const plaqueQuat = new THREE.Quaternion();
    plaque.getWorldQuaternion(plaqueQuat);
    world.createCollider(
      rapier.ColliderDesc.cuboid(0.45, 0.65, 0.12)
        .setTranslation(plaqueWorld.x, plaqueWorld.y + 0.62, plaqueWorld.z)
        .setRotation({ x: plaqueQuat.x, y: plaqueQuat.y, z: plaqueQuat.z, w: plaqueQuat.w })
        .setCollisionGroups(solid),
      body,
    );

    this.roofPiecePosition.copy(toWorld(0, 2.9 + 0.85, 0));
    this.doorPosition.copy(this.group.localToWorld(new THREE.Vector3(0, PLATFORM_HEIGHT, BASE_RADIUS + 0.9)));
    this.doorOutward.set(Math.sin(facing), 0, Math.cos(facing));

    this.obstacles.push({ kind: 'lighthouse', x: LIGHTHOUSE.x, y: baseY, z: LIGHTHOUSE.z, radius: BASE_RADIUS + 0.55 });
    this.obstacles.push({ kind: 'hut', x: hutWorld.x, y: hutWorld.y, z: hutWorld.z, radius: 1.05 });
    this.obstacles.push({ kind: 'plaque', x: plaqueWorld.x, y: plaqueWorld.y, z: plaqueWorld.z, radius: 0.12 });
  }

  /**
   * Clay pantile roof over the hut's gable (eaves at 1.9 m, ridge at 2.9 m, 3.0 m long): rows of
   * half-round tiles laid in staggered courses on both slopes, a ridge of capping tiles and timber
   * fascia boards. One instanced mesh for all tiles; the roof collider is the plain gable hull.
   */
  private buildTileRoof(hut: THREE.Group, fascia: THREE.Material): void {
    const tileMat = this.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide }));
    const tileGeo = this.track(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 8, 1, true, Math.PI / 2, Math.PI));
    tileGeo.rotateX(Math.PI / 2);
    tileGeo.scale(1, 0.5, 1);
    const ridgeGeo = this.track(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 10, 1, true, 0, Math.PI));
    ridgeGeo.rotateZ(Math.PI / 2);
    const slope = Math.atan2(1.0, 1.25);
    const length = Math.hypot(1.0, 1.25);
    const placements: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const side of [1, -1]) {
      q.setFromEuler(new THREE.Euler(slope, side > 0 ? 0 : Math.PI, 0, 'YXZ'));
      let row = 0;
      for (let d = 0.04; d < length - 0.12; d += 0.25, row++) {
        for (let x = -1.42 + (row % 2) * 0.11; x <= 1.43; x += 0.22) {
          const y = 1.9 + d * Math.sin(slope) + 0.05 * Math.cos(slope);
          const z = side * (1.25 - d * Math.cos(slope) + 0.05 * Math.sin(slope));
          placements.push(m.clone().compose(new THREE.Vector3(x, y, z), q, one));
        }
      }
    }
    const tiles = new THREE.InstancedMesh(tileGeo, tileMat, placements.length);
    const rng = createRng(31);
    const c = new THREE.Color();
    placements.forEach((p, i) => {
      tiles.setMatrixAt(i, p);
      // Fired clay varies tile to tile; a few have weathered darker or paler.
      tiles.setColorAt(i, c.set('#b9573f').offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12));
    });
    tiles.castShadow = tiles.receiveShadow = true;
    hut.add(tiles);
    const ridge = new THREE.InstancedMesh(ridgeGeo, tileMat, 10);
    for (let i = 0; i < 10; i++) {
      ridge.setMatrixAt(i, m.makeTranslation(-1.35 + i * 0.3, 2.93, 0));
      ridge.setColorAt(i, c.set('#a64d38').offsetHSL(0, 0, (rng() - 0.5) * 0.08));
    }
    ridge.castShadow = ridge.receiveShadow = true;
    hut.add(ridge);
    // Fascia along both eaves and barge boards up the gable edges.
    const board = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(this.track(geo), fascia);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      mesh.castShadow = mesh.receiveShadow = true;
      hut.add(mesh);
    };
    for (const side of [1, -1]) {
      board(new THREE.BoxGeometry(3.0, 0.14, 0.05), 0, 1.87, side * 1.3);
      for (const gx of [-1.5, 1.5]) board(new THREE.BoxGeometry(0.06, 0.16, length + 0.05), gx, 2.4, side * 0.62, side * slope);
    }
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  /** World position of the lamp (finale sparkles). */
  lampPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return this.lamp.getWorldPosition(out);
  }

  /** 0 = dark (daytime, unlit), 1 = fully relit. */
  setLight(level: number): void {
    if (level === this.lightLevel) return;
    this.lightLevel = level;
    this.glass.emissiveIntensity = 0.05 + level * 1.6;
    this.lampMat.emissiveIntensity = level * 3;
    this.beamMat.uniforms.uOpacity.value = level;
    this.beams.visible = level > 0.01;
    this.light.intensity = level * 70;
    this.halo.visible = level > 0.01;
    this.halo.material.opacity = level;
  }

  /** Light up one plaque socket per collected piece; the door glows once all are in. */
  setLensProgress(collected: number, total: number): void {
    this.socketMats.forEach((mat, i) => {
      const lit = i < collected;
      mat.color.set(lit ? '#d8f6ff' : '#2a3640');
      mat.emissiveIntensity = lit ? 1.4 : 0;
    });
    this.doorReady = collected >= total;
  }

  update(_dt: number, time: number): void {
    this.lamp.rotation.y = time * 0.6;
    // A warm, breathing glow around the door once the lens is ready (until the lamp is lit).
    this.doorMat.emissiveIntensity = this.doorReady && this.lightLevel < 1 ? 0.35 + 0.25 * Math.sin(time * 3) : 0;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Gable roof: a triangular prism, ridge along X. */
function prismGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-depth / 2, 0);
  shape.lineTo(depth / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Roughen a cylinder's side so stonework doesn't look machined. */
function jitter(geo: THREE.BufferGeometry, amount: number, seed: number): void {
  const rng = createRng(seed);
  const pos = geo.getAttribute('position');
  const cache = new Map<string, [number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    let d = cache.get(key);
    if (!d) {
      d = [(rng() - 0.5) * amount, (rng() - 0.5) * amount];
      cache.set(key, d);
    }
    pos.setXYZ(i, x + d[0], pos.getY(i), z + d[1]);
  }
  geo.computeVertexNormals();
}
