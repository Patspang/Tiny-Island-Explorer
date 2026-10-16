import * as THREE from 'three';
import { PLAYER } from '../config';

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const COLORS = {
  skin: '#f0bf98',
  skinShade: '#e4a882',
  blush: '#f09a8a',
  hair: '#5e3520',
  shirt: '#2f8f9d',
  shirtDark: '#24727e',
  shorts: '#c9a56d',
  sock: '#efe6d2',
  boot: '#7a4a2c',
  sole: '#3b2a1f',
  hat: '#d4b07a',
  hatBand: '#7a4a2c',
  scarf: '#e4572e',
  pack: '#e8a93a',
  packDark: '#b9802a',
  strap: '#8a5a2e',
  bedroll: '#5f8550',
  belt: '#5b3a24',
  brass: '#d9a441',
  eyeWhite: '#fbfaf6',
  iris: '#3b2416',
  mouth: '#b45a52',
};

// --- Geometry helpers -----------------------------------------------------------------------

/** Smooth tapered limb hanging down from its pivot: rounded caps, radius r0 at top, r1 at bottom. */
function limb(r0: number, r1: number, length: number, radial = 18): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const capSteps = 6;
  // Bottom cap.
  for (let i = 0; i <= capSteps; i++) {
    const a = -Math.PI / 2 + (i / capSteps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, -length + Math.sin(a) * r1 + r1));
  }
  // Body (slight muscle bulge near the top third).
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const r = THREE.MathUtils.lerp(r1, r0, t) * (1 + 0.06 * Math.sin(t * Math.PI));
    pts.push(new THREE.Vector2(r, -length + r1 + t * (length - r1 - r0)));
  }
  // Top cap.
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, -r0 + Math.sin(a) * r0));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** Lathe from (radius, height) pairs, smoothed with a Catmull-Rom spline. */
function lathe(profile: Array<[number, number]>, radial = 32, samples = 40): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  return new THREE.LatheGeometry(curve.getPoints(samples), radial);
}

/** A tube along points with a radius that tapers from r0 to r1. */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, radial = 8, segments = 16): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  // TubeGeometry lays out (segments+1) rings of (radial+1) vertices; scale each ring about its centre.
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const centre = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const idx = s * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Rounded box via an extruded rounded rectangle with a bevel (backpack, pockets, boots). */
function roundedBox(w: number, h: number, d: number, radius: number, bevel = radius * 0.6): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -w / 2 + bevel;
  const y = -h / 2 + bevel;
  const iw = w - bevel * 2;
  const ih = h - bevel * 2;
  const r = Math.min(radius, iw / 2, ih / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + iw - r, y);
  shape.quadraticCurveTo(x + iw, y, x + iw, y + r);
  shape.lineTo(x + iw, y + ih - r);
  shape.quadraticCurveTo(x + iw, y + ih, x + iw - r, y + ih);
  shape.lineTo(x + r, y + ih);
  shape.quadraticCurveTo(x, y + ih, x, y + ih - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(d - bevel * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Side profile of a boot (toe toward +Z), extruded across its width. Origin at the ankle. */
function bootGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.055, 0.06);
  s.lineTo(-0.06, -0.06);
  s.quadraticCurveTo(-0.06, -0.085, -0.035, -0.085);
  s.lineTo(0.12, -0.085);
  s.quadraticCurveTo(0.165, -0.085, 0.16, -0.045);
  s.quadraticCurveTo(0.15, -0.01, 0.08, -0.005);
  s.quadraticCurveTo(0.05, 0.0, 0.045, 0.06);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.016,
    bevelSegments: 4,
    curveSegments: 10,
  });
  geo.translate(0, 0, -0.035);
  geo.rotateY(-Math.PI / 2); // profile was in XY with toe at +X; turn toe to +Z
  geo.computeVertexNormals();
  return geo;
}

export interface PlayerVisualState {
  /** Interpolated feet position. */
  feet: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  landedImpact: number;
  justJumped: boolean;
  snap: boolean;
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
}

/**
 * The visible explorer: a sculpted procedural character (two-bone limbs, face, hat, gear) with
 * procedural walk/run/jump/idle animation and secondary motion. Purely cosmetic; it follows the
 * physics capsule and never feeds back into it.
 */
export class PlayerVisual {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hat = new THREE.Group();
  private readonly pack = new THREE.Group();
  private readonly eyes: THREE.Group[] = [];
  private readonly scarfTails: THREE.Group[] = [];
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private facing = Math.PI;
  private phase = 0;
  private moveBlend = 0;
  private runBlend = 0;
  private airBlend = 0;
  private squash = 0;
  private squashVel = 0;
  private lean = 0;
  private bank = 0;
  private time = 0;
  private nextBlink = 2.5;
  private blink = 0;
  private hatBounce = 0;
  private hatVel = 0;
  private packSwing = 0;
  private packVel = 0;
  private lastBobY = 0;

  constructor() {
    const std = (color: string, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
      this.materials.push(m);
      return m;
    };
    const cloth = (color: string, roughness = 0.85) => {
      // Sheen gives fabric a soft, velvety edge highlight.
      const m = new THREE.MeshPhysicalMaterial({ color, roughness, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4) });
      this.materials.push(m);
      return m;
    };
    const geo = <T extends THREE.BufferGeometry>(g: T) => {
      this.geometries.push(g);
      return g;
    };
    const part = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      parent: THREE.Object3D,
      x = 0,
      y = 0,
      z = 0,
      cast = true,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const skin = std(COLORS.skin, 0.55);
    const shirt = cloth(COLORS.shirt);
    const shirtDark = cloth(COLORS.shirtDark);
    const shorts = cloth(COLORS.shorts);
    const sock = cloth(COLORS.sock, 0.9);
    const boot = std(COLORS.boot, 0.6);
    const sole = std(COLORS.sole, 0.8);
    const hair = std(COLORS.hair, 0.65);
    const hatMat = cloth(COLORS.hat, 0.9);
    const hatBand = std(COLORS.hatBand, 0.7);
    const scarf = cloth(COLORS.scarf);
    const pack = cloth(COLORS.pack, 0.8);
    const packDark = cloth(COLORS.packDark, 0.8);
    const strap = std(COLORS.strap, 0.75);
    const bedroll = cloth(COLORS.bedroll);
    const belt = std(COLORS.belt, 0.6);
    const brass = std(COLORS.brass, 0.35, { metalness: 0.7 });
    const eyeWhite = std(COLORS.eyeWhite, 0.25);
    const iris = std(COLORS.iris, 0.2);
    const catchlight = std('#ffffff', 0.2, { emissive: '#ffffff', emissiveIntensity: 0.8 });
    const blush = std(COLORS.blush, 0.7, { transparent: true, opacity: 0.55 });
    const mouth = std(COLORS.mouth, 0.6);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.82;

    // --- Legs: thigh (in shorts) -> knee -> shin -> sock -> boot.
    const shortsLegGeo = geo(limb(0.092, 0.084, 0.22));
    const thighGeo = geo(limb(0.07, 0.064, 0.36));
    const shinGeo = geo(limb(0.064, 0.05, 0.36));
    const sockGeo = geo(new THREE.CylinderGeometry(0.058, 0.055, 0.09, 18));
    const cuffGeo = geo(new THREE.TorusGeometry(0.058, 0.014, 8, 20));
    const bootGeo = geo(bootGeometry());
    const soleGeo = geo(roundedBox(0.105, 0.025, 0.24, 0.03, 0.008));
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(0.095 * side, -0.02, 0);
      this.hips.add(hip);
      part(shortsLegGeo, shorts, hip, 0, -0.02, 0);
      part(thighGeo, skin, hip, 0, -0.04, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      part(shinGeo, skin, knee, 0, 0, 0.005);
      part(sockGeo, sock, knee, 0, -0.27, 0.003);
      const sockCuff = part(cuffGeo, sock, knee, 0, -0.23, 0.003);
      sockCuff.rotation.x = Math.PI / 2;
      const ankle = new THREE.Group();
      ankle.position.y = -0.33;
      knee.add(ankle);
      part(bootGeo, boot, ankle, 0, -0.005, 0);
      part(soleGeo, sole, ankle, 0, -0.095, 0.045);
      // Laces: three little bars across the instep.
      for (let i = 0; i < 3; i++) {
        const lace = part(geo(new THREE.CapsuleGeometry(0.006, 0.05, 2, 6)), sock, ankle, 0, 0.0 - i * 0.022, 0.055 + i * 0.022, false);
        lace.rotation.z = Math.PI / 2;
      }
      this.legs.push({ hip, knee, ankle });
    }

    // --- Shorts and belt around the hips.
    part(geo(lathe([[0.0, -0.1], [0.15, -0.09], [0.172, -0.02], [0.168, 0.06], [0.16, 0.12]], 32)), shorts, this.hips, 0, 0, 0).scale.z = 0.8;
    const beltRing = part(geo(new THREE.TorusGeometry(0.163, 0.022, 10, 36)), belt, this.hips, 0, 0.1, 0);
    beltRing.rotation.x = Math.PI / 2;
    beltRing.scale.y = 0.8;
    part(geo(roundedBox(0.06, 0.045, 0.02, 0.01, 0.004)), brass, this.hips, 0, 0.1, 0.132);

    // --- Torso: shaped shirt (waist -> chest -> shoulders), collar, pockets, buttons.
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    const shirtBody = part(
      geo(lathe([[0.0, -0.02], [0.158, 0.0], [0.15, 0.1], [0.175, 0.22], [0.185, 0.3], [0.16, 0.37], [0.09, 0.42], [0.0, 0.43]], 36)),
      shirt,
      this.torso,
    );
    shirtBody.scale.z = 0.76;
    for (const side of [1, -1]) {
      const pocket = part(geo(roundedBox(0.075, 0.07, 0.02, 0.012, 0.004)), shirtDark, this.torso, 0.075 * side, 0.26, 0.128, false);
      pocket.rotation.y = 0.32 * side;
      part(geo(new THREE.SphereGeometry(0.008, 8, 6)), brass, this.torso, 0.075 * side, 0.29, 0.14, false);
      const collar = part(geo(roundedBox(0.07, 0.05, 0.012, 0.01, 0.004)), shirtDark, this.torso, 0.045 * side, 0.385, 0.075, false);
      collar.rotation.set(-0.9, 0.35 * side, 0.4 * side);
    }
    for (let i = 0; i < 3; i++) part(geo(new THREE.SphereGeometry(0.009, 8, 6)), brass, this.torso, 0, 0.11 + i * 0.08, 0.142, false);

    // --- Neck and scarf with two tails that trail behind.
    this.neck.position.y = 0.4;
    this.torso.add(this.neck);
    part(geo(limb(0.044, 0.05, 0.1)), skin, this.neck, 0, 0.08, -0.01);
    const scarfRing = part(geo(new THREE.TorusGeometry(0.085, 0.04, 10, 24)), scarf, this.torso, 0, 0.405, 0);
    scarfRing.rotation.x = Math.PI / 2;
    scarfRing.scale.set(1, 0.85, 0.8);
    const knot = part(geo(new THREE.SphereGeometry(0.035, 12, 10)), scarf, this.torso, 0.05, 0.4, 0.07);
    knot.scale.set(1, 0.8, 0.7);
    const tailGeo = geo(roundedBox(0.055, 0.17, 0.014, 0.02, 0.005));
    for (const [i, x] of [0.04, 0.075].entries()) {
      const tail = new THREE.Group();
      tail.position.set(x, 0.39, 0.075);
      this.torso.add(tail);
      const t = part(tailGeo, scarf, tail, 0, -0.08, 0);
      t.rotation.z = 0.1 + i * 0.15;
      this.scarfTails.push(tail);
    }

    // --- Arms: sleeve -> upper arm -> elbow -> forearm -> hand.
    const sleeveGeo = geo(limb(0.07, 0.066, 0.13));
    const cuffArmGeo = geo(new THREE.TorusGeometry(0.064, 0.016, 8, 20));
    const upperArmGeo = geo(limb(0.052, 0.046, 0.27));
    const foreArmGeo = geo(limb(0.046, 0.038, 0.24));
    const palmGeo = geo(new THREE.SphereGeometry(0.048, 16, 12));
    const thumbGeo = geo(limb(0.016, 0.014, 0.05, 8));
    for (const side of [1, -1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.19 * side, 0.34, 0);
      this.torso.add(shoulder);
      part(sleeveGeo, shirt, shoulder, 0, 0.02, 0);
      const cuff = part(cuffArmGeo, shirtDark, shoulder, 0, -0.1, 0);
      cuff.rotation.x = Math.PI / 2;
      part(upperArmGeo, skin, shoulder, 0, -0.01, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.26;
      shoulder.add(elbow);
      part(foreArmGeo, skin, elbow, 0, 0, 0);
      const wrist = new THREE.Group();
      wrist.position.y = -0.24;
      elbow.add(wrist);
      const palm = part(palmGeo, skin, wrist, 0, -0.035, 0.005);
      palm.scale.set(0.75, 1.1, 0.95);
      const thumb = part(thumbGeo, skin, wrist, -0.03 * side, -0.01, 0.03);
      thumb.rotation.set(-0.5, 0, 0.6 * side);
      this.arms.push({ shoulder, elbow, wrist });
    }

    // --- Backpack with flap, side pocket, bedroll and shoulder straps.
    this.pack.position.set(0, 0.22, -0.13);
    this.torso.add(this.pack);
    part(geo(roundedBox(0.26, 0.3, 0.14, 0.05)), pack, this.pack, 0, 0, -0.07);
    const flap = part(geo(roundedBox(0.25, 0.13, 0.03, 0.03, 0.01)), packDark, this.pack, 0, 0.09, -0.14);
    flap.rotation.x = -0.12;
    part(geo(roundedBox(0.035, 0.05, 0.02, 0.008, 0.004)), brass, this.pack, 0, 0.04, -0.158, false);
    for (const side of [1, -1]) part(geo(roundedBox(0.05, 0.12, 0.09, 0.02)), packDark, this.pack, 0.15 * side, -0.05, -0.07);
    const roll = part(geo(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 20)), bedroll, this.pack, 0, 0.19, -0.07);
    roll.rotation.z = Math.PI / 2;
    for (const x of [-0.09, 0.09]) {
      const tie = part(geo(new THREE.TorusGeometry(0.062, 0.008, 6, 20)), strap, this.pack, x, 0.19, -0.07, false);
      tie.rotation.y = Math.PI / 2;
    }
    for (const side of [1, -1]) {
      const pts = [
        new THREE.Vector3(0.1 * side, 0.36, -0.1),
        new THREE.Vector3(0.11 * side, 0.41, -0.02),
        new THREE.Vector3(0.1 * side, 0.36, 0.1),
        new THREE.Vector3(0.095 * side, 0.2, 0.135),
        new THREE.Vector3(0.11 * side, 0.08, 0.12),
      ];
      part(geo(taperedTube(pts, 0.014, 0.012, 6, 20)), strap, this.torso, 0, 0, 0, false);
    }

    // --- Head: slightly oversized, friendly proportions.
    this.head.position.y = 0.13;
    this.neck.add(this.head);
    const skull = part(geo(new THREE.SphereGeometry(0.17, 40, 30)), skin, this.head, 0, 0.12, 0);
    skull.scale.set(0.97, 1.02, 0.98);
    const cheekGeo = geo(new THREE.SphereGeometry(0.085, 20, 16));
    for (const side of [1, -1]) {
      // Fuller cheeks and jaw.
      const cheek = part(cheekGeo, skin, this.head, 0.07 * side, 0.06, 0.06, false);
      cheek.scale.set(0.9, 0.85, 0.8);
      const ear = part(geo(new THREE.SphereGeometry(0.035, 14, 10)), skin, this.head, 0.163 * side, 0.115, -0.005);
      ear.scale.set(0.45, 1, 0.75);
      // Eyes: white, iris, catchlight; grouped so they can blink.
      const eye = new THREE.Group();
      eye.position.set(0.058 * side, 0.135, 0.145);
      eye.rotation.y = 0.25 * side;
      this.head.add(eye);
      const white = part(geo(new THREE.SphereGeometry(0.026, 16, 12)), eyeWhite, eye, 0, 0, 0, false);
      white.scale.set(1, 1.15, 0.55);
      const ir = part(geo(new THREE.SphereGeometry(0.017, 14, 10)), iris, eye, 0, -0.002, 0.012, false);
      ir.scale.set(1, 1.15, 0.5);
      part(geo(new THREE.SphereGeometry(0.005, 8, 6)), catchlight, eye, 0.006, 0.007, 0.02, false);
      this.eyes.push(eye);
      // Eyebrows.
      const brow = part(
        geo(taperedTube([new THREE.Vector3(-0.025, -0.004, 0), new THREE.Vector3(0, 0.006, 0.006), new THREE.Vector3(0.026, 0.0, 0)], 0.007, 0.005, 6, 10)),
        hair,
        this.head,
        0.06 * side,
        0.18,
        0.15,
        false,
      );
      brow.rotation.set(0, 0.25 * side, -0.12 * side);
      const b = part(cheekGeo, blush, this.head, 0.09 * side, 0.075, 0.12, false);
      b.scale.set(0.35, 0.2, 0.15);
    }
    const nose = part(geo(new THREE.SphereGeometry(0.022, 14, 10)), skin, this.head, 0, 0.095, 0.17, false);
    nose.scale.set(0.9, 0.85, 0.9);
    part(
      geo(taperedTube([new THREE.Vector3(-0.026, 0.004, 0), new THREE.Vector3(0, -0.006, 0.006), new THREE.Vector3(0.026, 0.004, 0)], 0.005, 0.005, 6, 10)),
      mouth,
      this.head,
      0,
      0.045,
      0.16,
      false,
    );

    // Hair: back volume, sideburns and a fringe of tufts peeking out under the hat.
    part(geo(hairShell()), hair, this.head, 0, 0.12, 0);
    const tuftGeo = geo(limb(0.03, 0.006, 0.11, 10));
    const tufts: Array<[number, number, number, number, number]> = [
      [-0.09, 0.22, 0.13, 0.9, 0.5],
      [-0.035, 0.24, 0.15, 1.0, 0.15],
      [0.025, 0.24, 0.15, 1.05, -0.15],
      [0.08, 0.22, 0.135, 0.9, -0.45],
      [0.15, 0.15, 0.06, 0.4, -0.9],
      [-0.15, 0.15, 0.06, 0.4, 0.9],
    ];
    for (const [x, y, z, rx, rz] of tufts) {
      const t = part(tuftGeo, hair, this.head, x, y, z);
      t.rotation.set(rx, 0, rz);
    }

    // Explorer hat: domed crown, curled brim, band; it bounces a little when moving.
    this.hat.position.set(0, 0.26, -0.01);
    this.hat.rotation.x = -0.08;
    this.head.add(this.hat);
    part(geo(lathe([[0.0, 0.13], [0.09, 0.12], [0.135, 0.07], [0.15, 0.0], [0.152, -0.02]], 32)), hatMat, this.hat);
    part(geo(lathe([[0.15, 0.0], [0.2, -0.01], [0.25, -0.012], [0.275, 0.005], [0.28, 0.02]], 40, 24)), hatMat, this.hat);
    part(geo(lathe([[0.28, 0.018], [0.25, -0.022], [0.2, -0.025], [0.15, -0.015]], 40, 16)), hatMat, this.hat);
    part(geo(lathe([[0.152, -0.005], [0.155, 0.02], [0.152, 0.045]], 32, 8)), hatBand, this.hat);

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
    this.bank += (THREE.MathUtils.clamp(-turnRate * 0.03 * speedN, -0.22, 0.22) - this.bank) * damp(8, dt);

    const moving = s.grounded && speed > 0.3 ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * damp(10, dt);
    const running = speed > (PLAYER.walkSpeed + PLAYER.runSpeed) / 2 ? 1 : 0;
    this.runBlend += (running - this.runBlend) * damp(6, dt);
    this.airBlend += ((s.grounded ? 0 : 1) - this.airBlend) * damp(s.grounded ? 18 : 9, dt);

    // Stride: cadence follows ground speed so feet don't skate.
    this.phase += dt * (2.15 * speed + 1.5 * this.moveBlend);
    const mb = this.moveBlend;
    const rb = this.runBlend;
    const air = this.airBlend;

    // Landing squash spring; jump stretch.
    if (s.landedImpact > 2) this.squashVel -= Math.min(6, s.landedImpact * 0.35);
    if (s.justJumped) this.squashVel += 2.2;
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash += this.squashVel * dt;
    const sq = THREE.MathUtils.clamp(this.squash, -0.2, 0.16);
    this.body.scale.set(1 - sq * 0.45, 1 + sq, 1 - sq * 0.45);

    // Pelvis: bob twice per stride, sway side to side, lean into speed.
    const bob = Math.abs(Math.cos(this.phase)) * (0.035 + 0.04 * rb) * mb;
    this.hips.position.y = 0.82 + bob - (0.025 + 0.03 * rb) * mb;
    this.hips.position.x = Math.sin(this.phase) * 0.018 * mb * (1 - rb);
    this.lean += ((0.06 + 0.2 * rb) * speedN * (1 - air) - this.lean) * damp(8, dt);
    this.hips.rotation.set(this.lean * 0.35, Math.sin(this.phase) * (0.1 + 0.06 * rb) * mb, this.bank + Math.cos(this.phase) * 0.04 * mb);
    this.torso.rotation.set(this.lean * 0.65, -Math.sin(this.phase) * (0.16 + 0.08 * rb) * mb, -Math.cos(this.phase) * 0.03 * mb);

    // Idle: breathing, gentle weight shift and an occasional glance around.
    const idle = 1 - mb;
    const breathe = Math.sin(this.time * 2.1) * 0.014 * idle;
    this.torso.scale.set(1 + breathe, 1 + breathe * 0.4, 1 + breathe);
    this.hips.position.x += Math.sin(this.time * 0.6) * 0.012 * idle;
    this.neck.rotation.x = -this.lean * 0.55 + 0.04 * air;
    this.head.rotation.y = Math.sin(this.time * 0.45) * 0.35 * idle * idle;
    this.head.rotation.z = Math.sin(this.time * 0.8) * 0.03 * idle;

    // Legs: thigh swing, knee flexes on the forward swing, foot stays roughly level.
    const strideA = (0.42 + 0.38 * rb) * mb;
    const kneeA = (0.55 + 0.6 * rb) * mb;
    this.legs.forEach((leg, i) => {
      const p = this.phase + i * Math.PI;
      const swing = Math.sin(p);
      let thigh = -swing * strideA;
      let knee = Math.max(0, Math.cos(p)) * kneeA + 0.05 * mb;
      // Airborne: tuck while rising, reach for the ground while falling.
      const rising = s.velocity.y > 0 ? 1 : 0;
      const airThigh = i === 0 ? -0.75 * rising - 0.25 : 0.3 - 0.2 * rising;
      const airKnee = i === 0 ? 1.1 * rising + 0.3 : 0.45;
      thigh = THREE.MathUtils.lerp(thigh, airThigh, air);
      knee = THREE.MathUtils.lerp(knee, airKnee, air);
      // Idle: a soft knee.
      knee += 0.06 * idle * (1 - air);
      leg.hip.rotation.x = thigh;
      leg.knee.rotation.x = knee;
      leg.ankle.rotation.x = -(thigh + knee) * 0.75 + Math.max(0, -Math.cos(p)) * 0.25 * mb * (1 - air);
    });

    // Arms: swing opposite to the legs, elbows bend more when running.
    this.arms.forEach((arm, i) => {
      const p = this.phase + i * Math.PI;
      const swing = Math.sin(p) * (0.38 + 0.45 * rb) * mb;
      const side = i === 0 ? 1 : -1;
      const rising = s.velocity.y > 0 ? 1 : 0;
      arm.shoulder.rotation.x = THREE.MathUtils.lerp(swing, -1.6 * rising - 0.4, air);
      arm.shoulder.rotation.z = THREE.MathUtils.lerp((0.1 + 0.04 * mb) * side, 0.65 * side, air) + Math.sin(this.time * 2.1) * 0.015 * idle * side;
      const elbowBend = 0.2 + 0.25 * mb + 0.9 * rb * mb + Math.max(0, -Math.sin(p)) * 0.3 * mb;
      arm.elbow.rotation.x = -THREE.MathUtils.lerp(elbowBend, 0.5, air);
      arm.wrist.rotation.x = -0.1 - 0.1 * rb;
    });

    // Blink every few seconds.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.13;
      this.nextBlink = 2.2 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt);
    const lid = this.blink > 0 ? 0.12 : 1;
    for (const e of this.eyes) e.scale.y = lid;

    // Secondary motion: hat and backpack lag behind vertical motion; scarf tails trail.
    const bobVel = dt > 0 ? (bob - this.lastBobY) / dt : 0;
    this.lastBobY = bob;
    this.hatVel += (-this.hatBounce * 260 - this.hatVel * 14 - bobVel * 6 - (s.justJumped ? 30 : 0)) * dt;
    this.hatBounce += this.hatVel * dt;
    this.hat.position.y = 0.26 + THREE.MathUtils.clamp(this.hatBounce * 0.01, -0.015, 0.02);
    this.hat.rotation.x = -0.08 - THREE.MathUtils.clamp(this.hatBounce * 0.02, -0.08, 0.08) - speedN * 0.05;
    this.packVel += (-this.packSwing * 120 - this.packVel * 10 - bobVel * 4 + (s.landedImpact > 2 ? 20 : 0)) * dt;
    this.packSwing += this.packVel * dt;
    this.pack.rotation.x = THREE.MathUtils.clamp(this.packSwing * 0.03, -0.15, 0.15) + this.lean * 0.2;
    this.scarfTails.forEach((tail, i) => {
      tail.rotation.x = -0.1 - speedN * (1.1 + i * 0.2) - air * 0.5 + Math.sin(this.time * 10 + i * 1.7) * 0.1 * (0.25 + speedN);
      tail.rotation.z = Math.sin(this.time * 7 + i) * 0.08 * speedN;
    });

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

/**
 * Hair over the back and sides of the head only (the face stays open), with soft strand ridges
 * and a wavy lower edge so it reads as hair rather than a helmet.
 */
function hairShell(): THREE.BufferGeometry {
  // Sphere phi: front (+Z) is at PI/2. Leave a ~130° opening for the face.
  const open = (130 * Math.PI) / 180;
  const geo = new THREE.SphereGeometry(0.176, 48, 28, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.72);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lon = Math.atan2(v.z, v.x);
    const lat = Math.acos(THREE.MathUtils.clamp(v.y / 0.176, -1, 1)); // 0 top .. PI bottom
    // Strand ridges, stronger toward the ends; lower edge scalloped into locks.
    const ridge = 1 + 0.035 * Math.sin(lon * 16) * Math.min(1, lat / 1.2);
    const lock = lat > 1.7 ? 0.012 * Math.sin(lon * 9) : 0;
    v.multiplyScalar(ridge);
    v.y -= lock;
    // Hair sits a little fuller at the back.
    if (v.z < 0) v.z *= 1.06;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
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
