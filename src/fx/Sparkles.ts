import * as THREE from 'three';

const MAX = 320;

interface Spark {
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  size: number;
  gravity: number;
  drag: number;
}

/**
 * Additive four-pointed sparkles for the quest: glints that twinkle around lens pieces, a burst
 * when one is collected, and a shower from the lighthouse lamp when it relights. One `Points`
 * draw call; presentation only.
 */
export class Sparkles {
  readonly points: THREE.Points;
  private readonly sparks: Spark[] = [];
  private readonly position = new Float32Array(MAX * 3);
  private readonly color = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private showerTime = 0;
  private readonly showerAt = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < MAX; i++) this.sparks.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), size: 0, gravity: 0, drag: 0 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 color;
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 p = abs(gl_PointCoord * 2.0 - 1.0);
          // Four-pointed star: thin cross arms plus a soft core.
          float arms = max(1.0 - smoothstep(0.0, 0.12, p.y) , 0.0) * (1.0 - p.x) + max(1.0 - smoothstep(0.0, 0.12, p.x), 0.0) * (1.0 - p.y);
          float core = 1.0 - smoothstep(0.0, 0.45, length(p));
          float a = clamp(arms * 0.8 + core, 0.0, 1.0) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Occasional twinkles around a lens piece (call every frame; `rate` per second). */
  glint(at: THREE.Vector3, dt: number, rate = 5): void {
    if (Math.random() > rate * dt) return;
    const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 0.9));
    this.emit(p, new THREE.Vector3(0, 0.15, 0), COLORS.glint, 0.5 + Math.random() * 0.4, 0.3 + Math.random() * 0.15, 0, 0);
  }

  /** A burst of sparkles flying out from `at`, then drifting down. */
  burst(at: THREE.Vector3, count = 60, speed = 4): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.6 - 0.4, Math.random() * 2 - 1).normalize();
      const c = Math.random() < 0.5 ? COLORS.burstA : COLORS.burstB;
      this.emit(at, dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8)), c, 0.9 + Math.random() * 0.7, 0.2 + Math.random() * 0.16, 1.2, 2.2);
    }
  }

  /** A few seconds of golden sparks falling from the relit lamp. */
  shower(at: THREE.Vector3, seconds = 5): void {
    this.showerAt.copy(at);
    this.showerTime = seconds;
    this.burst(at, 90, 6);
  }

  private emit(p: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, life: number, size: number, gravity: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    Object.assign(this.sparks[i], { life, maxLife: life, size, gravity, drag });
    this.sparks[i].vel.copy(vel);
    this.position.set([p.x, p.y, p.z], i * 3);
    this.color.set([color.r, color.g, color.b], i * 3);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = (viewportHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    if (this.showerTime > 0) {
      this.showerTime -= dt;
      const n = Math.random() < 30 * dt ? 2 : 0;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const vel = new THREE.Vector3(Math.cos(a) * 2.2, 1 + Math.random() * 1.5, Math.sin(a) * 2.2);
        this.emit(this.showerAt, vel, COLORS.gold, 2 + Math.random(), 0.18 + Math.random() * 0.1, 1.4, 0.8);
      }
    }
    for (let i = 0; i < MAX; i++) {
      const s = this.sparks[i];
      if (s.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      s.life -= dt;
      const t = 1 - Math.max(0, s.life) / s.maxLife;
      s.vel.y -= s.gravity * dt;
      s.vel.multiplyScalar(Math.exp(-s.drag * dt));
      this.position[i * 3] += s.vel.x * dt;
      this.position[i * 3 + 1] += s.vel.y * dt;
      this.position[i * 3 + 2] += s.vel.z * dt;
      // Twinkle: quick fade in, flicker, fade out; shrink a little at the end.
      const flicker = 0.75 + 0.25 * Math.sin((s.life + i) * 23);
      this.alpha[i] = Math.min(1, t * 10) * (1 - t) * flicker;
      this.size[i] = s.size * (1 - 0.4 * t);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) g.getAttribute(name).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const COLORS = {
  glint: new THREE.Color('#e8fbff'),
  burstA: new THREE.Color('#bff3ff'),
  burstB: new THREE.Color('#fff2b8'),
  gold: new THREE.Color('#ffd27a'),
};
