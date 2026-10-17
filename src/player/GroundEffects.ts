import * as THREE from 'three';
import type { Surface } from '../audio/sounds';
import { PLAYER, WORLD } from '../config';
import type { GameWorld } from '../world/World';
import type { PlayerVisualState } from './PlayerVisual';

/** Particle look: a soft round puff, or a small leaf that tumbles. */
const PUFF = 0;
const LEAF = 1;

const MAX = 192;
const STRIDE = 0.62;
const RIPPLES = 16;
/** Feet this far below the water surface count as wading. */
const WADE_DEPTH = 0.04;

/** Moments other systems (sound) care about, reported as they happen. */
export interface GroundEvents {
  footstep(surface: Surface, strength: number): void;
  jump(surface: Surface): void;
  land(impact: number, surface: Surface): void;
}

interface Particle {
  life: number;
  maxLife: number;
  kind: number;
  vel: THREE.Vector3;
  size0: number;
  size1: number;
  alpha: number;
  gravity: number;
  drag: number;
  spin: number;
}

const COLORS = {
  sand: new THREE.Color('#eadcbc'),
  path: new THREE.Color('#d9c49b'),
  rock: new THREE.Color('#c9c2b4'),
  spray: [new THREE.Color('#ffffff'), new THREE.Color('#dff4f7'), new THREE.Color('#bfe8ee')],
  grass: [new THREE.Color('#7fb24a'), new THREE.Color('#9fca5c'), new THREE.Color('#6a9d3f')],
  leaf: [new THREE.Color('#5f9e3c'), new THREE.Color('#7cba4c'), new THREE.Color('#4f8a35')],
};

/**
 * Small, cheap reactions where the explorer meets the ground and the plants: dust on sand and
 * paths, flicked grass on grass, spray and ripples when wading, a ring on landing, and leaves
 * shaken loose when pushing through a bush. One `Points` draw call plus one instanced mesh for
 * ripples; purely cosmetic, reads player and world state only.
 */
export class GroundEffects {
  readonly group = new THREE.Group();
  readonly points: THREE.Points;
  /** How hard the player is pushing through foliage right now (0..1), for the rustle sound. */
  rustle = 0;
  private readonly ripples: THREE.InstancedMesh;
  private readonly rippleState = Array.from({ length: RIPPLES }, () => ({ x: 0, z: 0, age: 1, life: 1, size: 1 }));
  private nextRipple = 0;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();
  private readonly particles: Particle[] = [];
  private readonly position = new Float32Array(MAX * 3);
  private readonly color = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly angle = new Float32Array(MAX);
  private readonly kind = new Float32Array(MAX);
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private stride = 0;
  private foot = 1;
  private leafBudget = 0;

  constructor(private readonly events?: GroundEvents) {
    for (let i = 0; i < MAX; i++) {
      this.particles.push({ life: 0, maxLife: 1, kind: PUFF, vel: new THREE.Vector3(), size0: 0, size1: 0, alpha: 0, gravity: 0, drag: 0, spin: 0 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('angle', new THREE.BufferAttribute(this.angle, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('kind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 color;
        attribute float size;
        attribute float alpha;
        attribute float angle;
        attribute float kind;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vAngle;
        varying float vKind;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vAngle = angle;
          vKind = kind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vAngle;
        varying float vKind;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a;
          if (vKind < 0.5) {
            a = 1.0 - smoothstep(0.35, 1.0, length(p));
          } else {
            float c = cos(vAngle), s = sin(vAngle);
            p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            a = 1.0 - smoothstep(0.85, 1.0, length(vec2(p.x * 2.2, p.y)));
          }
          if (a * vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;

    // Ripples: flat rings on the water, faded by colour under additive blending.
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ripples = new THREE.InstancedMesh(ringGeo, ringMat, RIPPLES);
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 2;
    for (let i = 0; i < RIPPLES; i++) {
      this.ripples.setMatrixAt(i, this.tmpMatrix.makeScale(0, 0, 0));
      this.ripples.setColorAt(i, this.tmpColor.setRGB(0, 0, 0));
    }
    this.group.add(this.points, this.ripples);
  }

  /** `viewportHeight` in device pixels, so particle sizes are in metres. */
  update(dt: number, s: PlayerVisualState, world: GameWorld, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = (viewportHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const surface: Surface = s.feet.y < WORLD.waterLevel - WADE_DEPTH ? 'water' : (world.surfaceAt?.(s.feet.x, s.feet.z) ?? 'path');

    // Footfalls: one small burst per stride, alternating feet, more when running.
    if (s.grounded && speed > 1.2 && dt > 0) {
      this.stride += speed * dt;
      if (this.stride > STRIDE) {
        this.stride = 0;
        this.foot = -this.foot;
        const run = THREE.MathUtils.clamp((speed - PLAYER.walkSpeed) / (PLAYER.runSpeed - PLAYER.walkSpeed), 0, 1);
        const side = new THREE.Vector3(s.velocity.z, 0, -s.velocity.x).normalize().multiplyScalar(0.1 * this.foot);
        this.footfall(s.feet.clone().add(side), surface, 1 + Math.round(run * 2), s.velocity, 0.6 + 0.4 * run);
        this.events?.footstep(surface, 0.3 + 0.7 * run);
      }
    }
    if (s.landedImpact > 2) {
      this.events?.land(s.landedImpact, surface);
      if (surface === 'water') this.ripple(s.feet, 1.2 + s.landedImpact * 0.08, 1.1);
      const n = surface === 'water' ? 2 : Math.min(16, 6 + Math.round(s.landedImpact * 1.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        this.footfall(s.feet.clone().addScaledVector(dir, 0.2), surface, 1, dir.multiplyScalar(2.2), 0.9);
      }
    }
    if (s.justJumped) {
      this.events?.jump(surface);
      for (let i = 0; i < 5; i++) this.footfall(s.feet, surface, 1, s.velocity.clone().multiplyScalar(-0.15), 0.7);
    }

    // Leaves shaken loose while pushing through a bush.
    const inside = world.foliageAt?.(s.feet.x, s.feet.y, s.feet.z) ?? 0;
    this.rustle = inside > 0 ? Math.min(1, (0.3 + inside) * Math.min(1, speed / PLAYER.walkSpeed)) : 0;
    if (inside > 0 && speed > 0.5) {
      this.leafBudget += dt * (3 + 14 * inside) * Math.min(1, speed / PLAYER.walkSpeed);
      while (this.leafBudget >= 1) {
        this.leafBudget -= 1;
        const a = Math.random() * Math.PI * 2;
        const p = s.feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, 0.35 + Math.random() * 0.6, Math.sin(a) * 0.45));
        const vel = new THREE.Vector3(Math.cos(a) * 0.8, 0.9 + Math.random() * 0.8, Math.sin(a) * 0.8).addScaledVector(s.velocity, 0.15);
        this.emit(p, vel, pick(COLORS.leaf), LEAF, 1.6 + Math.random() * 0.6, 0.17, 0.17, 1, 2.2, 1.6, (Math.random() - 0.5) * 9);
      }
    } else {
      this.leafBudget = 0;
    }

    this.step(dt);
    this.stepRipples(dt);
  }

  /** Start an expanding ring on the water surface at `at`. */
  private ripple(at: THREE.Vector3, size: number, life: number): void {
    const r = this.rippleState[this.nextRipple];
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
    Object.assign(r, { x: at.x, z: at.z, age: 0, life, size });
  }

  private stepRipples(dt: number): void {
    const y = WORLD.waterLevel + 0.03;
    this.rippleState.forEach((r, i) => {
      if (r.age >= r.life) return;
      r.age += dt;
      const t = Math.min(1, r.age / r.life);
      const scale = r.size * (0.25 + 0.75 * Math.sqrt(t));
      this.ripples.setMatrixAt(i, this.tmpMatrix.makeScale(scale, 1, scale).setPosition(r.x, y, r.z));
      const fade = 0.55 * (1 - t) * (1 - t);
      this.ripples.setColorAt(i, this.tmpColor.setRGB(fade, fade, fade));
    });
    this.ripples.instanceMatrix.needsUpdate = true;
    if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
  }

  private footfall(at: THREE.Vector3, surface: Surface, count: number, push: THREE.Vector3, strength: number): void {
    if (surface === 'water') {
      // Spray thrown up and forward, and a ring spreading where the foot went in.
      for (let i = 0; i < 4 + count * 3; i++) {
        const vel = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6).addScaledVector(push, 0.2);
        const p = new THREE.Vector3(at.x, WORLD.waterLevel + 0.05, at.z);
        this.emit(p, vel, pick(COLORS.spray), PUFF, 0.45 + Math.random() * 0.25, 0.06, 0.04, 0.9, 9, 0.8, 0);
      }
      this.ripple(at, 0.55 + 0.35 * strength, 0.9);
      return;
    }
    for (let i = 0; i < count; i++) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.03, (Math.random() - 0.5) * 0.15);
      const p = at.clone().add(jitter);
      if (surface === 'grass') {
        // Flicked grass bits: small, quick, fall back down.
        const vel = new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2).addScaledVector(push, 0.12);
        this.emit(p, vel, pick(COLORS.grass), LEAF, 0.5 + Math.random() * 0.2, 0.07, 0.06, 0.95, 9, 1.5, (Math.random() - 0.5) * 14);
      } else {
        // Dust: a soft puff that swells, drifts up a little and fades.
        const vel = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6).addScaledVector(push, 0.08);
        const c = surface === 'sand' ? COLORS.sand : surface === 'path' ? COLORS.path : COLORS.rock;
        this.emit(p, vel, c, PUFF, 0.7 + Math.random() * 0.3, 0.18 * strength, 0.55 * strength, 0.45 * strength, -0.1, 2.5, 0);
      }
    }
  }

  private emit(
    p: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    kind: number,
    life: number,
    size0: number,
    size1: number,
    alpha: number,
    gravity: number,
    drag: number,
    spin: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const q = this.particles[i];
    Object.assign(q, { life, maxLife: life, kind, size0, size1, alpha, gravity, drag, spin });
    q.vel.copy(vel);
    this.position.set([p.x, p.y, p.z], i * 3);
    this.color.set([color.r, color.g, color.b], i * 3);
    this.angle[i] = Math.random() * Math.PI;
    this.kind[i] = kind;
  }

  private step(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      const q = this.particles[i];
      if (q.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      q.life -= dt;
      const t = 1 - Math.max(0, q.life) / q.maxLife;
      q.vel.y -= q.gravity * dt;
      q.vel.multiplyScalar(Math.exp(-q.drag * dt));
      if (q.kind === LEAF && q.gravity < 5) {
        // Leaves flutter side to side as they fall.
        q.vel.x += Math.sin((q.life + i) * 7) * dt * 1.5;
      }
      this.position[i * 3] += q.vel.x * dt;
      this.position[i * 3 + 1] += q.vel.y * dt;
      this.position[i * 3 + 2] += q.vel.z * dt;
      this.angle[i] += q.spin * dt;
      this.size[i] = THREE.MathUtils.lerp(q.size0, q.size1, Math.sqrt(t));
      this.alpha[i] = q.alpha * Math.min(1, t * 8) * (1 - t * t);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha', 'angle', 'kind']) g.getAttribute(name).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.ripples.geometry.dispose();
    (this.ripples.material as THREE.Material).dispose();
    this.ripples.dispose();
  }
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
