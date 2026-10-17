import * as THREE from 'three';

type Spot = { x: number; y: number; z: number };

interface Habitats {
  meadows: ReadonlyArray<Spot>;
  woods: ReadonlyArray<Spot>;
  coast: ReadonlyArray<Spot>;
}

const BUTTERFLIES = 22;
const GULLS = 5;
const FIREFLIES = 160;

const BUTTERFLY_COLORS = ['#ffd23f', '#ffffff', '#ff9b54', '#9fd3ff', '#f7a8c8'];

/**
 * Wings that flap in the vertex shader: vertices away from the body (|x|) rotate about the body
 * axis by an angle driven by time and a per-instance phase. `glide` > 0 makes the wings rest in a
 * shallow V most of the time and beat in short bursts (gulls).
 */
function flapMaterial(
  color: THREE.ColorRepresentation,
  time: { value: number },
  speed: number,
  amplitude: number,
  glide: number,
  emissive: THREE.ColorRepresentation = '#000000',
): THREE.MeshLambertMaterial {
  // A little self-light keeps undersides (seen from the ground) from going muddy.
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, emissive });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float beat = sin(uTime * ${speed.toFixed(2)} + aPhase * 6.2831);
          float burst = ${glide.toFixed(2)} > 0.0 ? smoothstep(0.2, 0.8, sin(uTime * 0.5 + aPhase * 9.0)) : 1.0;
          float a = beat * ${amplitude.toFixed(2)} * burst + ${glide.toFixed(2)};
          float side = sign(transformed.x);
          float r = abs(transformed.x);
          transformed.x = side * r * cos(a);
          transformed.y += r * sin(a);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `flap-${speed}-${amplitude}-${glide}`;
  return mat;
}

function butterflyGeometry(): THREE.BufferGeometry {
  // Two rounded wings either side of the body axis (z forward), each a fan of triangles.
  const pos: number[] = [];
  const wing = (side: number) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      // Larger fore-wing, smaller hind-wing.
      const r = a < Math.PI / 2 ? 0.075 + 0.02 * Math.sin(a * 2) : 0.055;
      pts.push([Math.sin(a) * r * side, Math.cos(a) * r]);
    }
    for (let i = 0; i < pts.length - 1; i++) pos.push(0, 0, 0, pts[i][0], 0, pts[i][1], pts[i + 1][0], 0, pts[i + 1][1]);
  };
  wing(1);
  wing(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function gullGeometry(): THREE.BufferGeometry {
  // Body plus long, swept wings (z forward), about 1.1 m span.
  // Each wing bends at the wrist (raised inner arm, drooping swept-back hand), the classic gull "M".
  const pos: number[] = [];
  for (const s of [1, -1]) {
    const tri = (...v: number[]) => {
      for (let i = 0; i < 9; i += 3) pos.push(v[i] * s, v[i + 1], v[i + 2]);
    };
    tri(0, 0, 0.12, 0.3, 0.06, 0.02, 0.06, 0, -0.12);
    tri(0.06, 0, -0.12, 0.3, 0.06, 0.02, 0.26, 0.06, -0.1);
    tri(0.3, 0.06, 0.02, 0.62, -0.05, -0.16, 0.26, 0.06, -0.1);
  }
  pos.push(
    // body (a thin diamond, slightly raised so it reads from below)
    0, 0.02, 0.3, 0.05, 0, 0, 0, 0.02, -0.25,
    0, 0.02, 0.3, 0, 0.02, -0.25, -0.05, 0, 0,
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

interface Flyer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  home: Spot;
  retarget: number;
}

/**
 * Ambient life: butterflies drifting over the flower meadows (they scatter from the player),
 * gulls circling over the sea, and fireflies in the woods at dusk. Presentation only; three
 * draw calls.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly butterflies: THREE.InstancedMesh;
  private readonly gulls: THREE.InstancedMesh;
  private readonly fireflies: THREE.Points;
  private readonly flyers: Flyer[] = [];
  private readonly gullState: Array<{ centre: Spot; radius: number; height: number; speed: number; angle: number }> = [];
  private readonly flySeeds: Float32Array;
  private readonly flyHomes: Spot[] = [];
  private readonly flyAlpha: Float32Array;
  private readonly flyPos: Float32Array;
  private readonly flyMat: THREE.ShaderMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly groundHeight: (x: number, z: number) => number;

  constructor(habitats: Habitats, groundHeight: (x: number, z: number) => number) {
    const pick = <T>(list: ReadonlyArray<T>) => list[Math.floor(Math.random() * list.length)];

    // Butterflies.
    const bGeo = butterflyGeometry();
    const phases = new Float32Array(BUTTERFLIES).map(() => Math.random());
    bGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const bMat = flapMaterial('#ffffff', this.time, 22, 1.1, 0, '#3a3a3a');
    this.butterflies = new THREE.InstancedMesh(bGeo, bMat, habitats.meadows.length ? BUTTERFLIES : 0);
    const c = new THREE.Color();
    for (let i = 0; i < this.butterflies.count; i++) {
      const home = pick(habitats.meadows);
      const pos = new THREE.Vector3(home.x + (Math.random() - 0.5) * 4, home.y + 0.8, home.z + (Math.random() - 0.5) * 4);
      this.flyers.push({ pos, vel: new THREE.Vector3(), target: pos.clone(), home, retarget: 0 });
      this.butterflies.setColorAt(i, c.set(pick(BUTTERFLY_COLORS)));
    }
    this.butterflies.frustumCulled = false;
    this.groundHeight = groundHeight;

    // Gulls.
    const gGeo = gullGeometry();
    gGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(GULLS).map(() => Math.random()), 1));
    this.gulls = new THREE.InstancedMesh(gGeo, flapMaterial('#f4f2ec', this.time, 7, 0.55, 0.12, '#8d8f8c'), habitats.coast.length ? GULLS : 0);
    for (let i = 0; i < this.gulls.count; i++) {
      this.gullState.push({ centre: pick(habitats.coast), radius: 8 + Math.random() * 14, height: 13 + Math.random() * 9, speed: (0.25 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1), angle: Math.random() * Math.PI * 2 });
    }
    this.gulls.frustumCulled = false;

    // Fireflies: additive glowing points that wander around the woods.
    const n = habitats.woods.length ? FIREFLIES : 0;
    this.flyPos = new Float32Array(n * 3);
    this.flyAlpha = new Float32Array(n);
    this.flySeeds = new Float32Array(n).map(() => Math.random() * 100);
    for (let i = 0; i < n; i++) this.flyHomes.push(pick(habitats.woods));
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3).setUsage(THREE.DynamicDrawUsage));
    fGeo.setAttribute('alpha', new THREE.BufferAttribute(this.flyAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.flyMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 0.42 * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord * 2.0 - 1.0);
          float a = (1.0 - smoothstep(0.0, 1.0, d)) * vAlpha;
          a += (1.0 - smoothstep(0.0, 0.25, d)) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * a, a);
        }`,
    });
    this.fireflies = new THREE.Points(fGeo, this.flyMat);
    this.fireflies.frustumCulled = false;
    this.fireflies.visible = false;

    this.group.add(this.butterflies, this.gulls, this.fireflies);
    this.disposables.push(bGeo, bMat, gGeo, this.gulls.material as THREE.Material, fGeo, this.flyMat, this.butterflies, this.gulls);
  }

  /** Positions for debugging and screenshots. */
  snapshot(): { butterflies: THREE.Vector3[]; gulls: THREE.Vector3[]; fireflies: number } {
    const p = new THREE.Vector3();
    const gulls = this.gullState.map((_, i) => {
      this.gulls.getMatrixAt(i, this.m);
      return p.setFromMatrixPosition(this.m).clone();
    });
    return { butterflies: this.flyers.map((f) => f.pos.clone()), gulls, fireflies: this.fireflies.visible ? this.flyHomes.length : 0 };
  }

  update(dt: number, time: number, dusk: number, player: THREE.Vector3, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.time.value = time;
    const day = 1 - dusk;

    // Butterflies: wander between points over their meadow; scatter up and away from the player.
    this.butterflies.visible = day > 0.05;
    this.flyers.forEach((f, i) => {
      f.retarget -= dt;
      const away = f.pos.distanceTo(player);
      if (f.retarget <= 0 || f.pos.distanceTo(f.target) < 0.3) {
        f.retarget = 1.5 + Math.random() * 3;
        const x = f.home.x + (Math.random() - 0.5) * 7;
        const z = f.home.z + (Math.random() - 0.5) * 7;
        f.target.set(x, this.groundHeight(x, z) + 0.35 + Math.random() * 1.3, z);
      }
      const steer = f.target.clone().sub(f.pos).setLength(1.6);
      if (away < 2.2) steer.add(f.pos.clone().sub(player).setY(0.8).setLength(4 * (1 - away / 2.2)));
      // Erratic flutter on top of the steering.
      steer.y += Math.sin(time * 7 + i) * 1.2;
      f.vel.lerp(steer, Math.min(1, dt * 2.5));
      f.pos.addScaledVector(f.vel, dt);
      const ground = this.groundHeight(f.pos.x, f.pos.z) + 0.15;
      if (f.pos.y < ground) f.pos.y = ground;
      this.e.set(0, Math.atan2(f.vel.x, f.vel.z), 0);
      // Storybook scale (about 30 cm across) so they read from the follow camera.
      const s = day * (1.9 + 0.3 * Math.sin(i));
      this.m.compose(f.pos, this.q.setFromEuler(this.e), this.one.set(s, s, s));
      this.butterflies.setMatrixAt(i, this.m);
    });
    this.butterflies.instanceMatrix.needsUpdate = true;

    // Gulls: slow circles high over the sea, banked into the turn.
    this.gullState.forEach((g, i) => {
      g.angle += g.speed * dt;
      const x = g.centre.x + Math.cos(g.angle) * g.radius;
      const z = g.centre.z + Math.sin(g.angle) * g.radius;
      const y = g.height + Math.sin(time * 0.3 + i) * 1.5;
      const heading = Math.atan2(-Math.sin(g.angle) * Math.sign(g.speed), Math.cos(g.angle) * Math.sign(g.speed));
      this.e.set(0, heading, -0.35 * Math.sign(g.speed), 'YXZ');
      this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e), this.one.set(1, 1, 1));
      this.gulls.setMatrixAt(i, this.m);
    });
    this.gulls.instanceMatrix.needsUpdate = true;
    this.gulls.visible = dusk < 0.85;

    // Fireflies: only at dusk, drifting on smooth noise and blinking slowly.
    this.fireflies.visible = dusk > 0.02;
    if (this.fireflies.visible) {
      this.flyMat.uniforms.uScale.value = (viewportHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      for (let i = 0; i < this.flyHomes.length; i++) {
        const h = this.flyHomes[i];
        const s = this.flySeeds[i];
        const x = h.x + Math.sin(time * 0.21 + s) * 4 + Math.sin(time * 0.53 + s * 2) * 1.2;
        const z = h.z + Math.cos(time * 0.17 + s * 1.3) * 4 + Math.cos(time * 0.47 + s) * 1.2;
        const y = this.groundHeight(x, z) + 0.5 + 1.2 * (0.5 + 0.5 * Math.sin(time * 0.31 + s * 3));
        this.flyPos.set([x, y, z], i * 3);
        const blink = Math.max(0, Math.sin(time * (0.9 + (s % 1)) + s * 7));
        // Never fully dark: a faint glow between slow pulses.
        this.flyAlpha[i] = Math.sqrt(dusk) * (0.25 + 0.75 * blink * blink);
      }
      this.fireflies.geometry.getAttribute('position').needsUpdate = true;
      this.fireflies.geometry.getAttribute('alpha').needsUpdate = true;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
