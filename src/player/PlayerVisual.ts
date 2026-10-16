import * as THREE from 'three';
import { PLAYER } from '../config';

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const COLORS = {
  skin: '#f1c19d',
  blush: '#ef9c8c',
  hair: '#6b3f26',
  shirt: '#2f8f9d',
  shorts: '#d9b77e',
  boots: '#7a4a2c',
  scarf: '#e4572e',
  pack: '#f2b134',
  packStrap: '#9c6b2f',
  bedroll: '#5a7d4f',
  eye: '#2b1d14',
};

export interface PlayerVisualState {
  /** Interpolated feet position. */
  feet: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  landedImpact: number;
  justJumped: boolean;
  snap: boolean;
}

/**
 * The visible explorer: a procedural, stylised character with a lightweight procedural
 * walk/run/jump animation. Purely cosmetic; it follows the physics capsule.
 */
export class PlayerVisual {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly scarfTail = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private facing = Math.PI;
  private phase = 0;
  private moveBlend = 0;
  private airBlend = 0;
  private squash = 0;
  private squashVel = 0;
  private lean = 0;
  private bank = 0;
  private time = 0;

  constructor() {
    const mat = (color: string, roughness = 0.75) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
      this.materials.push(m);
      return m;
    };
    const geo = <T extends THREE.BufferGeometry>(g: T) => {
      this.geometries.push(g);
      return g;
    };
    const part = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const skin = mat(COLORS.skin, 0.6);
    const shirt = mat(COLORS.shirt, 0.8);
    const shorts = mat(COLORS.shorts, 0.85);
    const boots = mat(COLORS.boots, 0.7);
    const hair = mat(COLORS.hair, 0.9);
    const scarf = mat(COLORS.scarf, 0.85);
    const pack = mat(COLORS.pack, 0.7);
    const strap = mat(COLORS.packStrap, 0.8);
    const bedroll = mat(COLORS.bedroll, 0.85);
    const eye = mat(COLORS.eye, 0.3);
    const blush = mat(COLORS.blush, 0.7);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.8;

    // Legs pivot at the hip.
    const legGeo = geo(new THREE.CapsuleGeometry(0.085, 0.42, 6, 12));
    const bootGeo = geo(new THREE.CapsuleGeometry(0.1, 0.12, 6, 12));
    for (const [leg, side] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      leg.position.set(0.11 * side, 0, 0);
      this.hips.add(leg);
      part(legGeo, skin, leg, 0, -0.33, 0);
      const boot = part(bootGeo, boots, leg, 0, -0.66, 0.035);
      boot.rotation.x = Math.PI / 2;
      boot.scale.set(1, 1, 0.85);
    }

    // Shorts.
    const shortsMesh = part(geo(new THREE.CylinderGeometry(0.2, 0.235, 0.26, 16)), shorts, this.hips, 0, -0.02, 0);
    shortsMesh.scale.z = 0.82;

    // Torso pivots at the waist.
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    const chest = part(geo(new THREE.CapsuleGeometry(0.215, 0.22, 8, 16)), shirt, this.torso, 0, 0.2, 0);
    chest.scale.set(1, 1, 0.8);

    // Scarf around the neck, with a tail that flutters.
    const scarfRing = part(geo(new THREE.TorusGeometry(0.15, 0.06, 8, 18)), scarf, this.torso, 0, 0.43, 0);
    scarfRing.rotation.x = Math.PI / 2;
    this.scarfTail.position.set(0.08, 0.42, -0.14);
    this.torso.add(this.scarfTail);
    const tail = part(geo(new THREE.BoxGeometry(0.09, 0.26, 0.035)), scarf, this.scarfTail, 0, -0.12, 0);
    tail.rotation.z = 0.15;

    // Backpack with a bedroll.
    const packMesh = part(geo(new THREE.CapsuleGeometry(0.15, 0.14, 6, 12)), pack, this.torso, 0, 0.2, -0.22);
    packMesh.scale.set(1.05, 1, 0.65);
    const roll = part(geo(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 12)), bedroll, this.torso, 0, 0.41, -0.22);
    roll.rotation.z = Math.PI / 2;
    for (const side of [1, -1]) {
      const s = part(geo(new THREE.BoxGeometry(0.04, 0.34, 0.03)), strap, this.torso, 0.12 * side, 0.22, 0.17);
      s.rotation.x = -0.12;
    }

    // Arms pivot at the shoulder.
    const armGeo = geo(new THREE.CapsuleGeometry(0.06, 0.34, 6, 10));
    const sleeveGeo = geo(new THREE.CapsuleGeometry(0.078, 0.08, 6, 10));
    const handGeo = geo(new THREE.SphereGeometry(0.068, 12, 10));
    for (const [arm, side] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      arm.position.set(0.265 * side, 0.37, 0);
      this.torso.add(arm);
      part(sleeveGeo, shirt, arm, 0, -0.06, 0);
      part(armGeo, skin, arm, 0, -0.22, 0);
      part(handGeo, skin, arm, 0, -0.43, 0.01);
    }

    // Head: slightly oversized for a friendly, animated-film read.
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    part(geo(new THREE.SphereGeometry(0.235, 24, 18)), skin, this.head, 0, 0.13, 0);
    const hairCap = part(geo(new THREE.SphereGeometry(0.25, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair, this.head, 0, 0.16, -0.025);
    hairCap.rotation.x = -0.25;
    const tuft = part(geo(new THREE.ConeGeometry(0.08, 0.18, 8)), hair, this.head, 0.04, 0.4, 0.06);
    tuft.rotation.set(0.5, 0, -0.4);
    const eyeGeo = geo(new THREE.SphereGeometry(0.032, 10, 8));
    const cheekGeo = geo(new THREE.SphereGeometry(0.04, 10, 8));
    for (const side of [1, -1]) {
      const e = part(eyeGeo, eye, this.head, 0.085 * side, 0.15, 0.205);
      e.scale.set(0.85, 1.25, 0.6);
      const c = part(cheekGeo, blush, this.head, 0.14 * side, 0.08, 0.17);
      c.scale.set(1, 0.6, 0.4);
      c.castShadow = false;
    }
    part(geo(new THREE.SphereGeometry(0.035, 10, 8)), skin, this.head, 0, 0.1, 0.23);

    // Soft contact shadow so the character always reads as grounded.
    const shadowTex = makeShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
    this.materials.push(shadowMat);
    this.shadow = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.1, 1.1)), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  /** Separate from root so it can be placed on the ground independently. */
  get shadowMesh(): THREE.Mesh {
    return this.shadow;
  }

  update(dt: number, s: PlayerVisualState, groundY: number | null): void {
    this.time += dt;
    this.root.position.copy(s.feet);

    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const speedN = Math.min(1, speed / PLAYER.runSpeed);

    // Face the direction of travel, banking slightly into turns.
    let turnRate = 0;
    if (speed > 0.4) {
      const want = Math.atan2(s.velocity.x, s.velocity.z);
      const delta = wrapAngle(want - this.facing);
      const step = s.snap ? delta : delta * damp(14, dt);
      this.facing = wrapAngle(this.facing + step);
      turnRate = dt > 0 ? step / dt : 0;
    }
    this.root.rotation.y = this.facing;
    this.bank += (THREE.MathUtils.clamp(-turnRate * 0.03 * speedN, -0.25, 0.25) - this.bank) * damp(8, dt);

    const moving = s.grounded && speed > 0.3 ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * damp(10, dt);
    this.airBlend += ((s.grounded ? 0 : 1) - this.airBlend) * damp(s.grounded ? 18 : 9, dt);

    // Stride: cadence follows ground speed, so feet don't skate.
    this.phase += dt * (2.0 * speed + 1.5 * this.moveBlend);
    const swing = Math.sin(this.phase);
    const stride = (0.35 + 0.55 * speedN) * this.moveBlend;

    // Landing squash spring; jump stretch.
    if (s.landedImpact > 2) this.squashVel -= Math.min(6, s.landedImpact * 0.35);
    if (s.justJumped) this.squashVel += 2.2;
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash += this.squashVel * dt;
    const sq = THREE.MathUtils.clamp(this.squash, -0.22, 0.18);
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    // Body bob and forward lean when running.
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * this.moveBlend * (0.6 + speedN);
    this.hips.position.y = 0.8 + bob - 0.03 * this.moveBlend;
    this.lean += (speedN * 0.22 * (1 - this.airBlend) - this.lean) * damp(8, dt);
    this.hips.rotation.set(this.lean * 0.4, Math.sin(this.phase) * 0.12 * this.moveBlend, this.bank);
    this.torso.rotation.set(this.lean * 0.6, -Math.sin(this.phase) * 0.18 * this.moveBlend, 0);

    // Idle breathing.
    const breathe = Math.sin(this.time * 2.2) * 0.012 * (1 - this.moveBlend);
    this.torso.scale.set(1 + breathe, 1 + breathe * 0.5, 1 + breathe);
    this.head.rotation.x = -this.lean * 0.5 + Math.sin(this.time * 1.1) * 0.03 * (1 - this.moveBlend);

    // Limbs: walk cycle blended with an airborne pose.
    const air = this.airBlend;
    const rising = s.velocity.y > 0 ? 1 : 0;
    this.legL.rotation.x = THREE.MathUtils.lerp(swing * stride, -0.6 * rising - 0.2, air);
    this.legR.rotation.x = THREE.MathUtils.lerp(-swing * stride, 0.35, air);
    this.armL.rotation.x = THREE.MathUtils.lerp(-swing * stride * 1.1, -2.3 * rising - 0.6, air);
    this.armR.rotation.x = THREE.MathUtils.lerp(swing * stride * 1.1, -2.0 * rising - 0.6, air);
    this.armL.rotation.z = THREE.MathUtils.lerp(0.08 + 0.05 * this.moveBlend, 0.5, air);
    this.armR.rotation.z = -THREE.MathUtils.lerp(0.08 + 0.05 * this.moveBlend, 0.5, air);

    // Scarf tail trails behind with speed and flutters.
    this.scarfTail.rotation.x = -0.15 - speedN * 0.9 - air * 0.4 + Math.sin(this.time * 9) * 0.08 * (0.3 + speedN);

    // Contact shadow on the ground beneath, fading with height.
    if (groundY === null) {
      this.shadow.visible = false;
    } else {
      const height = Math.max(0, s.feet.y - groundY);
      this.shadow.visible = height < 6;
      this.shadow.position.set(s.feet.x, groundY + 0.04, s.feet.z);
      const k = 1 / (1 + height * 0.5);
      this.shadow.scale.setScalar(0.6 + 0.4 * k);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;
    }
  }

  dispose(): void {
    for (const m of this.materials) {
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
    for (const g of this.geometries) g.dispose();
  }
}

function makeShadowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(20,30,25,0.9)');
  g.addColorStop(0.55, 'rgba(20,30,25,0.45)');
  g.addColorStop(1, 'rgba(20,30,25,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
