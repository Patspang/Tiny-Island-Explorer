import * as THREE from 'three';

export interface QuestPieceSpot {
  id: string;
  label: string;
  /** Centre of the floating piece. */
  position: THREE.Vector3;
}

export interface QuestGoal {
  x: number;
  y: number;
  z: number;
  /** Bring the pieces within this horizontal distance of the goal to finish. */
  radius: number;
}

export type QuestState = 'collecting' | 'complete' | 'finale' | 'done';

export interface QuestEvents {
  onCollect?: (collected: number, total: number, label: string) => void;
  onComplete?: () => void;
  onFinaleStart?: () => void;
}

/** Player capsule centre must come this close (3D) to a piece to pick it up. */
export const PICKUP_DISTANCE = 1.1;
const FINALE_LIGHT_TIME = 2.2;
const FINALE_DUSK_TIME = 6;

/**
 * Lighthouse quest: collect the lens pieces, return to the lighthouse, light it.
 * Logic runs in the fixed physics step; visuals animate per rendered frame.
 */
export class Quest {
  readonly group = new THREE.Group();
  state: QuestState = 'collecting';
  /** 0..1 progress of the lighthouse lamp and of the dusk transition. */
  lightLevel = 0;
  duskLevel = 0;

  private readonly collected: boolean[];
  private readonly visuals: PieceVisual[] = [];
  private finaleTime = 0;
  private readonly shared: SharedAssets;

  constructor(
    readonly spots: ReadonlyArray<QuestPieceSpot>,
    readonly goal: QuestGoal,
    private readonly events: QuestEvents = {},
  ) {
    this.collected = spots.map(() => false);
    this.shared = new SharedAssets();
    for (const spot of spots) {
      const v = new PieceVisual(spot.position, this.shared);
      this.visuals.push(v);
      this.group.add(v.group);
    }
  }

  get total(): number {
    return this.spots.length;
  }

  get collectedCount(): number {
    return this.collected.filter(Boolean).length;
  }

  isCollected(i: number): boolean {
    return this.collected[i];
  }

  /** Fixed-step update with the player's capsule centre. */
  fixedUpdate(dt: number, player: THREE.Vector3): void {
    if (this.state === 'collecting') {
      this.spots.forEach((spot, i) => {
        if (this.collected[i]) return;
        if (spot.position.distanceTo(player) <= PICKUP_DISTANCE) this.collect(i);
      });
    } else if (this.state === 'complete') {
      const d = Math.hypot(player.x - this.goal.x, player.z - this.goal.z);
      if (d <= this.goal.radius && Math.abs(player.y - this.goal.y) < 4) {
        this.state = 'finale';
        this.finaleTime = 0;
        this.events.onFinaleStart?.();
      }
    } else if (this.state === 'finale') {
      this.finaleTime += dt;
      this.lightLevel = smooth(Math.min(1, this.finaleTime / FINALE_LIGHT_TIME));
      this.duskLevel = smooth(Math.min(1, Math.max(0, this.finaleTime - 0.8) / FINALE_DUSK_TIME));
      if (this.finaleTime >= FINALE_DUSK_TIME + 0.8) {
        this.lightLevel = 1;
        this.duskLevel = 1;
        this.state = 'done';
      }
    }
  }

  private collect(i: number): void {
    this.collected[i] = true;
    this.visuals[i].collect();
    const n = this.collectedCount;
    this.events.onCollect?.(n, this.total, this.spots[i].label);
    if (n === this.total) {
      this.state = 'complete';
      this.events.onComplete?.();
    }
  }

  /** Per-frame animation. */
  update(dt: number, time: number, cameraPosition: THREE.Vector3): void {
    for (const v of this.visuals) v.update(dt, time, cameraPosition);
  }

  dispose(): void {
    for (const v of this.visuals) v.dispose();
    this.shared.dispose();
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

class SharedAssets {
  readonly crystalGeo = new THREE.OctahedronGeometry(0.32, 0).scale(0.8, 1.35, 0.8);
  readonly ringGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 28);
  readonly beamGeo = new THREE.CylinderGeometry(0.28, 0.5, 22, 14, 1, true).translate(0, 11, 0);
  readonly crystalMat = new THREE.MeshStandardMaterial({
    color: '#d8f6ff',
    emissive: '#6fd6ff',
    emissiveIntensity: 1.3,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
  });
  readonly ringMat = new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.35, metalness: 0.8 });
  // Normal (not additive) blending so the beam still reads against a bright daytime sky.
  readonly beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 1 }, uColor: { value: new THREE.Color('#c6f4ff') } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() { vY = position.y / 22.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor; varying float vY;
      void main() { float a = pow(1.0 - vY, 1.4) * 0.5 * uOpacity; gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  readonly glowTex: THREE.Texture;
  readonly glowMat: THREE.SpriteMaterial;

  constructor() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(200,245,255,0.9)');
    g.addColorStop(0.35, 'rgba(120,215,255,0.35)');
    g.addColorStop(1, 'rgba(120,215,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.glowTex = new THREE.CanvasTexture(canvas);
    this.glowTex.colorSpace = THREE.SRGBColorSpace;
    this.glowMat = new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  dispose(): void {
    this.crystalGeo.dispose();
    this.ringGeo.dispose();
    this.beamGeo.dispose();
    this.crystalMat.dispose();
    this.ringMat.dispose();
    this.beamMat.dispose();
    this.glowTex.dispose();
    this.glowMat.dispose();
  }
}

/** A floating lens piece: spinning crystal in a brass ring, soft glow, and a far-visible beam. */
class PieceVisual {
  readonly group = new THREE.Group();
  private readonly holder = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly glow: THREE.Sprite;
  private collectedAt = -1;
  private time = 0;

  constructor(position: THREE.Vector3, shared: SharedAssets) {
    this.group.position.copy(position);
    this.group.add(this.holder);
    const crystal = new THREE.Mesh(shared.crystalGeo, shared.crystalMat);
    crystal.castShadow = true;
    this.holder.add(crystal);
    const ring = new THREE.Mesh(shared.ringGeo, shared.ringMat);
    ring.castShadow = true;
    this.holder.add(ring);
    // Per-piece material clones so each can fade independently when collected.
    this.glow = new THREE.Sprite(shared.glowMat.clone());
    this.glow.scale.setScalar(1.6);
    this.group.add(this.glow);
    this.beamMat = shared.beamMat.clone();
    this.beam = new THREE.Mesh(shared.beamGeo, this.beamMat);
    this.beam.position.y = -0.9;
    this.beam.renderOrder = 3;
    this.group.add(this.beam);
  }

  collect(): void {
    this.collectedAt = this.time;
  }

  dispose(): void {
    this.glow.material.dispose();
    this.beamMat.dispose();
  }

  update(dt: number, time: number, cameraPosition: THREE.Vector3): void {
    this.time += dt;
    if (this.collectedAt >= 0) {
      // Fly up, spin fast and shrink away.
      const t = Math.min(1, (this.time - this.collectedAt) / 0.6);
      this.holder.position.y = 0.25 + t * 1.2;
      this.holder.rotation.y += dt * 14;
      const s = 1 - t;
      this.holder.scale.setScalar(Math.max(0.001, s * (1 + t)));
      this.glow.scale.setScalar(1.6 + t * 3);
      this.glow.material.opacity = 1 - t;
      this.beamMat.uniforms.uOpacity.value = 1 - t;
      if (t >= 1) this.group.visible = false;
      return;
    }
    this.holder.position.y = Math.sin(time * 1.8) * 0.12;
    this.holder.rotation.y = time * 1.2;
    this.holder.children[1].rotation.x = Math.PI / 2 + Math.sin(time * 0.9) * 0.25;
    // The beam helps spot pieces from afar but fades out up close so it doesn't clutter.
    const d = cameraPosition.distanceTo(this.group.position);
    this.beamMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(d, 8, 22);
  }
}
