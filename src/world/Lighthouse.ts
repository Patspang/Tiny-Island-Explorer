import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { LIGHTHOUSE, SPAWN } from './IslandShape';
import { createRng } from './noise';
import type { ObstacleInfo } from './World';

const TOWER_HEIGHT = 9.2;
const BASE_RADIUS = 1.55;
const TOP_RADIUS = 1.12;
const PLATFORM_RADIUS = 4.3;
const PLATFORM_HEIGHT = 0.28;
const BANDS = 5;

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
    const white = m('#f3ede1', { roughness: 0.7 });
    const red = m('#c8473a', { roughness: 0.65 });
    const stone = m('#a69a88', { roughness: 0.95, flatShading: true });
    const darkStone = m('#7d7366', { roughness: 0.95, flatShading: true });
    const metal = m('#3b4447', { roughness: 0.5, metalness: 0.4 });
    const glass = m('#e8eef0', { emissive: '#ffd77a', emissiveIntensity: 0.05, roughness: 0.2 });
    this.glass = glass;
    const windowMat = m('#2f3b45', { roughness: 0.3, emissive: '#16232b', emissiveIntensity: 0.4 });
    const wood = m('#8a5a3a', { roughness: 0.85 });
    const roofTile = m('#b84a3b', { roughness: 0.75, flatShading: true });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true) => {
      const mesh = new THREE.Mesh(this.track(geo), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Irregular stone platform, sunk a little so it blends into the ground.
    const plat = new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 0.35, PLATFORM_HEIGHT + 0.6, 22, 1);
    jitter(plat, 0.18, 7);
    add(plat, stone, 0, PLATFORM_HEIGHT / 2 - 0.3, 0, false);
    const ring = new THREE.CylinderGeometry(BASE_RADIUS + 0.45, BASE_RADIUS + 0.6, 0.55, 18);
    jitter(ring, 0.06, 9);
    add(ring, darkStone, 0, PLATFORM_HEIGHT + 0.27, 0);

    // Striped, gently tapered tower.
    const bandH = TOWER_HEIGHT / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const r0 = BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * (i / BANDS);
      const r1 = BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * ((i + 1) / BANDS);
      add(new THREE.CylinderGeometry(r1, r0, bandH, 28), i % 2 === 0 ? white : red, 0, PLATFORM_HEIGHT + bandH * (i + 0.5), 0);
    }
    const top = PLATFORM_HEIGHT + TOWER_HEIGHT;

    // Door (facing local +Z) with a small step and arch.
    this.doorMat = m('#8a5a3a', { roughness: 0.85, emissive: '#ffc864', emissiveIntensity: 0 });
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
    add(new THREE.ConeGeometry(1.08, 1.05, 20), red, 0, top + 2.1, 0);
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
    const hutWall = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.6, 1.9, 2.1)), white);
    hutWall.position.y = 0.95;
    const roof = new THREE.Mesh(this.track(prismGeometry(3.0, 1.0, 2.5)), roofTile);
    roof.position.y = 1.9;
    const hutDoor = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.7, 1.25, 0.1)), wood);
    hutDoor.position.set(0.5, 0.63, 1.07);
    const hutWindow = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.45, 0.1)), windowMat);
    hutWindow.position.set(-0.6, 1.1, 1.07);
    for (const part of [hutWall, roof, hutDoor, hutWindow]) {
      part.castShadow = part.receiveShadow = true;
      hut.add(part);
    }

    // Crates stacked against the hut: a jump-by-jump way up onto the roof.
    // Tops at 0.6 m and 1.2 m (each above auto-step height), then the eave at 1.9 m.
    const crateMat = m('#b07a45', { roughness: 0.85 });
    const crateBand = m('#7d5230', { roughness: 0.85 });
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

    // Plaque beside the door: a stone slab holding the five lens sockets.
    const plaque = new THREE.Group();
    plaque.position.set(1.55, PLATFORM_HEIGHT, BASE_RADIUS + 0.75);
    plaque.rotation.y = -0.35;
    this.group.add(plaque);
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 1.25, 0.2)), stone);
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
