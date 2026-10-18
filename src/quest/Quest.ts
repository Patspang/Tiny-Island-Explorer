import * as THREE from 'three';
import type { NoteId } from './story';

export interface QuestPieceSpot {
  id: string;
  label: string;
  /** Centre of the floating piece. */
  position: THREE.Vector3;
  /** Puzzle that has to be solved before the piece appears (otherwise it is there from the start). */
  unlock?: PuzzleId;
  /** Where the piece rises from when it appears (defaults to just below its spot). */
  revealFrom?: THREE.Vector3;
}

export interface QuestGoal {
  x: number;
  y: number;
  z: number;
  /** Bring the pieces within this horizontal distance of the goal to finish. */
  radius: number;
}

export type PuzzleId = 'bells' | 'chest' | 'dig';

/** Where the puzzles are. All positions are on the ground (y = surface height). */
export interface PuzzleLayout {
  /** The message in a bottle that starts the story. */
  bottle: THREE.Vector3;
  /** Three bells, each rung by stepping on the stone plate under it; the music stone plays the song. */
  bells: { plates: THREE.Vector3[]; listen: THREE.Vector3; song: number[] };
  /** Golden shells; finding them all opens the chest. */
  shells: THREE.Vector3[];
  chest: THREE.Vector3;
  /** The X from the map: standing on it digs up a piece. */
  dig: THREE.Vector3;
  /** Signs and notes that speak when the player comes close. */
  notes: Array<{ id: NoteId; position: THREE.Vector3; radius: number }>;
}

export interface QuestLayout {
  spots: QuestPieceSpot[];
  goal: QuestGoal;
  puzzles?: PuzzleLayout;
}

export type QuestState = 'collecting' | 'complete' | 'finale' | 'done';

/** What happened during a fixed step. Presentation (sound, sparkles, text) reacts to these. */
export type QuestEvent =
  | { type: 'collect'; index: number; collected: number; total: number; label: string }
  | { type: 'complete' }
  | { type: 'finaleStart' }
  /** A hint beam appeared over the nearest unfinished task after a long stretch without progress. */
  | { type: 'hint'; target: string }
  /** The player reached the door without the full lens. */
  | { type: 'doorLocked'; missing: number }
  | { type: 'bottle' }
  /** `demo`: played by the music stone; `right`/`wrong`: the player's attempt; `free`: after solving. */
  | { type: 'bell'; bell: number; kind: 'demo' | 'right' | 'wrong' | 'free' }
  /** The bells start playing their song (`auto`: the first time the player comes near). */
  | { type: 'songStart'; auto: boolean }
  | { type: 'bellsSolved' }
  | { type: 'shell'; index: number; found: number; total: number }
  | { type: 'chestOpen' }
  | { type: 'dig' }
  /** A hidden piece starts to appear. */
  | { type: 'reveal'; index: number }
  | { type: 'note'; id: NoteId };

/** Read-only quest progress for the HUD, the map, world props and tests. */
export interface QuestView {
  readonly state: QuestState;
  readonly bottleRead: boolean;
  readonly bellsSolved: boolean;
  readonly songProgress: number;
  readonly shellsFound: number;
  readonly shellsTotal: number;
  readonly chestOpen: boolean;
  readonly dug: boolean;
  readonly pieces: ReadonlyArray<{ id: string; available: boolean; collected: boolean }>;
}

/** Per-frame state world props animate from (bells swinging, chest lid, shells, bottle). */
export interface PuzzleView {
  readonly bottleRead: boolean;
  readonly bellsSolved: boolean;
  readonly chestOpen: boolean;
  readonly dug: boolean;
  readonly shellsFound: number;
  isShellTaken(i: number): boolean;
  /** Seconds since bell `i` last rang (Infinity if never). */
  bellAge(i: number): number;
}

/** Player capsule centre must come this close (3D) to a piece to pick it up. */
export const PICKUP_DISTANCE = 1.1;
const FINALE_LIGHT_TIME = 2.2;
const FINALE_DUSK_TIME = 6;
/** Seconds of play without progress before a hint beam appears. */
export const DEFAULT_HINT_DELAY = 75;
/** The bottle is the first thing to do: point at it soon if the player wanders off. */
const BOTTLE_HINT_DELAY = 8;
const DOOR_MESSAGE_COOLDOWN = 6;
/** A hidden piece takes this long to rise into place before it can be picked up. */
const REVEAL_TIME = 0.9;
/** Horizontal reach (m) for stepping on a plate, a shell, the bottle or the X. */
const PLATE_RADIUS = 0.62;
const SHELL_RADIUS = 0.85;
const BOTTLE_RADIUS = 1.0;
const DIG_RADIUS = 1.0;
const LISTEN_RADIUS = 0.8;
/** The capsule centre stands about this high above the ground it is on. */
const CENTRE_ABOVE_FEET = 0.87;
/** Song playback: lead-in, then one note every NOTE_GAP seconds. */
const SONG_LEAD = 0.5;
const NOTE_GAP = 0.8;
/** The bells play their song by themselves the first time the player comes this close. */
const SONG_AUTOPLAY_DISTANCE = 7;
const NOTE_COOLDOWN = 12;

/**
 * Lighthouse quest: read the bottle, solve the puzzles that hide three of the lens pieces, find
 * all five pieces, then return to the lighthouse door to light it. Logic runs in the fixed
 * physics step and only reads the player's capsule centre; visuals animate per rendered frame.
 */
export class Quest implements QuestView, PuzzleView {
  readonly group = new THREE.Group();
  state: QuestState = 'collecting';
  /** 0..1 progress of the lighthouse lamp and of the dusk transition. */
  lightLevel = 0;
  duskLevel = 0;

  readonly spots: ReadonlyArray<QuestPieceSpot>;
  readonly goal: QuestGoal;
  readonly puzzles: PuzzleLayout | null;
  private readonly collected: boolean[];
  private readonly available: boolean[];
  /** Quest time at which each hidden piece started to appear (-1: not yet). */
  private readonly revealAt: number[];
  private readonly visuals: PieceVisual[] = [];
  private readonly hintBeam: HintBeam;
  private finaleTime = 0;
  private readonly shared: SharedAssets;
  private time = 0;
  /** Seconds since the last progress (or the quest started). */
  private sinceProgress = 0;
  /** What the hint beam points at (e.g. "piece:cliff", "shell:2"), or null. */
  hintTarget: string | null = null;
  hintDelay = DEFAULT_HINT_DELAY;
  private doorCooldown = 0;

  // Puzzles.
  bottleRead: boolean;
  bellsSolved = false;
  /** How many notes of the song the player has played correctly so far. */
  songProgress = 0;
  private readonly bellRang: number[] = [];
  private plateUnder = -1;
  private onListenStone = false;
  private songAutoplayed = false;
  /** Quest time the song playback started, and how many of its notes have sounded (-1: idle). */
  private songStart = 0;
  private songNext = -1;
  private readonly shellTaken: boolean[];
  chestOpen = false;
  dug = false;
  private readonly noteInside: boolean[];
  private readonly noteCooldown: number[];

  constructor(
    layout: QuestLayout,
    private readonly onEvent: (e: QuestEvent) => void = () => {},
  ) {
    this.spots = layout.spots;
    this.goal = layout.goal;
    this.puzzles = layout.puzzles ?? null;
    const p = this.puzzles;
    this.bottleRead = !p;
    this.collected = this.spots.map(() => false);
    // Without the puzzles (e.g. a test level) every piece is out from the start.
    this.available = this.spots.map((s) => !s.unlock || !p);
    this.revealAt = this.spots.map(() => -1);
    this.shellTaken = p ? p.shells.map(() => false) : [];
    this.noteInside = p ? p.notes.map(() => false) : [];
    this.noteCooldown = p ? p.notes.map(() => 0) : [];
    if (p) for (let i = 0; i < p.bells.plates.length; i++) this.bellRang.push(-Infinity);
    this.shared = new SharedAssets();
    this.spots.forEach((spot, i) => {
      const v = new PieceVisual(spot.position, this.shared, this.available[i]);
      this.visuals.push(v);
      this.group.add(v.group);
    });
    this.hintBeam = new HintBeam(this.shared);
    this.group.add(this.hintBeam.mesh);
  }

  get total(): number {
    return this.spots.length;
  }

  get collectedCount(): number {
    return this.collected.filter(Boolean).length;
  }

  get shellsFound(): number {
    return this.shellTaken.filter(Boolean).length;
  }

  get shellsTotal(): number {
    return this.shellTaken.length;
  }

  get pieces() {
    return this.spots.map((s, i) => ({ id: s.id, available: this.available[i], collected: this.collected[i] }));
  }

  isCollected(i: number): boolean {
    return this.collected[i];
  }

  isAvailable(i: number): boolean {
    return this.available[i];
  }

  isShellTaken(i: number): boolean {
    return this.shellTaken[i];
  }

  bellAge(i: number): number {
    return this.time - (this.bellRang[i] ?? -Infinity);
  }

  /** Fixed-step update with the player's capsule centre. */
  fixedUpdate(dt: number, player: THREE.Vector3): void {
    this.time += dt;
    this.doorCooldown = Math.max(0, this.doorCooldown - dt);
    const atDoor =
      Math.hypot(player.x - this.goal.x, player.z - this.goal.z) <= this.goal.radius &&
      Math.abs(player.y - this.goal.y) < 2.5;
    if (this.puzzles) this.updatePuzzles(dt, player, this.puzzles);
    this.updateReveals();
    if (this.state === 'collecting') {
      this.spots.forEach((spot, i) => {
        if (this.collected[i] || !this.available[i]) return;
        if (spot.position.distanceTo(player) <= PICKUP_DISTANCE) this.collect(i);
      });
      if (this.state !== 'collecting') return;
      if (atDoor && this.doorCooldown === 0) {
        this.doorCooldown = DOOR_MESSAGE_COOLDOWN;
        this.onEvent({ type: 'doorLocked', missing: this.total - this.collectedCount });
      }
      this.sinceProgress += dt;
      const delay = this.bottleRead ? this.hintDelay : Math.min(this.hintDelay, BOTTLE_HINT_DELAY);
      if (this.hintTarget === null && this.sinceProgress >= delay) this.showHint(player);
    } else if (this.state === 'complete') {
      if (atDoor) {
        this.state = 'finale';
        this.finaleTime = 0;
        this.onEvent({ type: 'finaleStart' });
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

  private updatePuzzles(dt: number, player: THREE.Vector3, p: PuzzleLayout): void {
    // Everything here is "stand on it": horizontal reach plus the player being on that ground.
    const standingOn = (at: THREE.Vector3, radius: number) =>
      Math.hypot(player.x - at.x, player.z - at.z) <= radius && Math.abs(player.y - CENTRE_ABOVE_FEET - at.y) < 0.9;

    // --- Signs speak once per visit (and not again straight away). First, so that puzzle
    // feedback from the same step (a wrong bell, a shell) is the message left on screen.
    p.notes.forEach((note, i) => {
      this.noteCooldown[i] = Math.max(0, this.noteCooldown[i] - dt);
      const d = Math.hypot(player.x - note.position.x, player.z - note.position.z);
      if (!this.noteInside[i] && d <= note.radius) {
        this.noteInside[i] = true;
        if (this.noteCooldown[i] === 0) {
          this.noteCooldown[i] = NOTE_COOLDOWN;
          this.onEvent({ type: 'note', id: note.id });
        }
      } else if (this.noteInside[i] && d > note.radius + 2) {
        this.noteInside[i] = false;
      }
    });

    if (!this.bottleRead && standingOn(p.bottle, BOTTLE_RADIUS)) {
      this.bottleRead = true;
      this.progress();
      this.onEvent({ type: 'bottle' });
    }

    // --- Singing bells.
    // The first visit plays the song once by itself. Checked before the plates, so a note the
    // player steps on in the same moment is kept (it stops the song) instead of being wiped.
    if (!this.songAutoplayed && !this.bellsSolved) {
      const near = Math.hypot(player.x - p.bells.listen.x, player.z - p.bells.listen.z) < SONG_AUTOPLAY_DISTANCE;
      if (near) {
        this.songAutoplayed = true;
        this.startSong(true);
      }
    }
    const plate = p.bells.plates.findIndex((at) => standingOn(at, PLATE_RADIUS));
    if (plate !== this.plateUnder) {
      this.plateUnder = plate;
      if (plate >= 0) this.ringBell(plate, p.bells.song);
    }
    const onListen = standingOn(p.bells.listen, LISTEN_RADIUS);
    if (onListen && !this.onListenStone && !this.bellsSolved) this.startSong(false);
    this.onListenStone = onListen;
    if (this.songNext >= 0) {
      const due = this.songStart + SONG_LEAD + this.songNext * NOTE_GAP;
      if (this.time >= due) {
        const bell = p.bells.song[this.songNext];
        this.bellRang[bell] = this.time;
        this.onEvent({ type: 'bell', bell, kind: 'demo' });
        this.songNext++;
        if (this.songNext >= p.bells.song.length) this.songNext = -1;
      }
    }

    // --- Golden shells and the chest.
    p.shells.forEach((at, i) => {
      if (this.shellTaken[i] || !standingOn(at, SHELL_RADIUS)) return;
      this.shellTaken[i] = true;
      this.progress();
      const found = this.shellsFound;
      this.onEvent({ type: 'shell', index: i, found, total: this.shellsTotal });
      if (found === this.shellsTotal) {
        this.chestOpen = true;
        this.onEvent({ type: 'chestOpen' });
        this.unlock('chest');
      }
    });

    // --- X marks the spot.
    if (!this.dug && standingOn(p.dig, DIG_RADIUS)) {
      this.dug = true;
      this.onEvent({ type: 'dig' });
      this.unlock('dig');
    }

  }

  private startSong(auto: boolean): void {
    this.songStart = this.time;
    this.songNext = 0;
    this.songProgress = 0;
    this.onEvent({ type: 'songStart', auto });
  }

  private ringBell(bell: number, song: number[]): void {
    this.bellRang[bell] = this.time;
    if (this.bellsSolved) {
      this.onEvent({ type: 'bell', bell, kind: 'free' });
      return;
    }
    // Playing stops the bells' own song so the two don't get mixed up.
    this.songNext = -1;
    if (bell === song[this.songProgress]) {
      this.songProgress++;
      this.onEvent({ type: 'bell', bell, kind: 'right' });
      if (this.songProgress === song.length) {
        this.bellsSolved = true;
        this.onEvent({ type: 'bellsSolved' });
        this.unlock('bells');
      }
    } else {
      // A wrong note starts the song over (counting this note if it is the first one).
      this.songProgress = bell === song[0] ? 1 : 0;
      this.onEvent({ type: 'bell', bell, kind: 'wrong' });
    }
  }

  private unlock(puzzle: PuzzleId): void {
    this.progress();
    this.spots.forEach((spot, i) => {
      if (spot.unlock !== puzzle || this.available[i] || this.revealAt[i] >= 0) return;
      this.revealAt[i] = this.time;
      this.visuals[i].reveal(spot.revealFrom ?? spot.position.clone().setY(spot.position.y - 0.9), REVEAL_TIME);
      this.onEvent({ type: 'reveal', index: i });
    });
  }

  private updateReveals(): void {
    this.revealAt.forEach((at, i) => {
      if (at >= 0 && !this.available[i] && this.time - at >= REVEAL_TIME) this.available[i] = true;
    });
  }

  /** Something was achieved: drop any hint and restart the hint timer. */
  private progress(): void {
    this.sinceProgress = 0;
    this.hintTarget = null;
    this.hintBeam.hide();
  }

  /** Raise a beam over the nearest unfinished task. */
  private showHint(player: THREE.Vector3): void {
    const targets: Array<{ key: string; at: THREE.Vector3; lift: number }> = [];
    const p = this.puzzles;
    if (p && !this.bottleRead) {
      targets.push({ key: 'bottle', at: p.bottle, lift: 0 });
    } else {
      this.spots.forEach((spot, i) => {
        if (this.available[i] && !this.collected[i]) targets.push({ key: `piece:${spot.id}`, at: spot.position, lift: -0.9 });
      });
      if (p) {
        if (!this.bellsSolved) targets.push({ key: 'bells', at: p.bells.listen, lift: 0 });
        if (!this.chestOpen) p.shells.forEach((at, i) => !this.shellTaken[i] && targets.push({ key: `shell:${i}`, at, lift: 0 }));
        if (!this.dug) targets.push({ key: 'dig', at: p.dig, lift: 0 });
      }
    }
    let best: (typeof targets)[number] | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const d = t.at.distanceTo(player);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return;
    this.hintTarget = best.key;
    this.hintBeam.show(best.at, best.lift);
    this.onEvent({ type: 'hint', target: best.key });
  }

  private collect(i: number): void {
    this.collected[i] = true;
    this.visuals[i].collect();
    this.progress();
    const n = this.collectedCount;
    this.onEvent({ type: 'collect', index: i, collected: n, total: this.total, label: this.spots[i].label });
    if (n === this.total) {
      this.state = 'complete';
      this.onEvent({ type: 'complete' });
    }
  }

  /** Per-frame animation. */
  update(dt: number, time: number, cameraPosition: THREE.Vector3): void {
    for (const v of this.visuals) v.update(dt, time, cameraPosition);
    this.hintBeam.update(dt, cameraPosition);
  }

  dispose(): void {
    for (const v of this.visuals) v.dispose();
    this.hintBeam.dispose();
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

/** A floating lens piece: spinning crystal in a brass ring with a soft glow. */
class PieceVisual {
  readonly group = new THREE.Group();
  private readonly holder = new THREE.Group();
  private readonly glow: THREE.Sprite;
  private readonly home = new THREE.Vector3();
  private readonly revealFrom = new THREE.Vector3();
  private collectedAt = -1;
  private revealAt = -1;
  private revealTime = 1;
  private time = 0;

  constructor(position: THREE.Vector3, shared: SharedAssets, visible: boolean) {
    this.home.copy(position);
    this.group.position.copy(position);
    this.group.visible = visible;
    this.group.add(this.holder);
    const crystal = new THREE.Mesh(shared.crystalGeo, shared.crystalMat);
    crystal.castShadow = true;
    this.holder.add(crystal);
    const ring = new THREE.Mesh(shared.ringGeo, shared.ringMat);
    ring.castShadow = true;
    this.holder.add(ring);
    // Per-piece material clone so each can fade independently when collected.
    this.glow = new THREE.Sprite(shared.glowMat.clone());
    this.glow.scale.setScalar(1.6);
    this.group.add(this.glow);
  }

  collect(): void {
    this.collectedAt = this.time;
  }

  /** A hidden piece rises from `from` (a chest, the ground) up to its spot. */
  reveal(from: THREE.Vector3, seconds: number): void {
    this.revealFrom.copy(from);
    this.revealAt = this.time;
    this.revealTime = seconds;
    this.group.visible = true;
  }

  dispose(): void {
    this.glow.material.dispose();
  }

  update(dt: number, time: number, _cameraPosition: THREE.Vector3): void {
    this.time += dt;
    if (!this.group.visible) return;
    if (this.collectedAt >= 0) {
      // Fly up, spin fast and shrink away.
      const t = Math.min(1, (this.time - this.collectedAt) / 0.6);
      this.holder.position.y = 0.25 + t * 1.2;
      this.holder.rotation.y += dt * 14;
      const s = 1 - t;
      this.holder.scale.setScalar(Math.max(0.001, s * (1 + t)));
      this.glow.scale.setScalar(1.6 + t * 3);
      this.glow.material.opacity = 1 - t;
      if (t >= 1) this.group.visible = false;
      return;
    }
    let grow = 1;
    if (this.revealAt >= 0) {
      const t = Math.min(1, (this.time - this.revealAt) / this.revealTime);
      const e = smooth(t);
      this.group.position.lerpVectors(this.revealFrom, this.home, e);
      // A little overshoot hop so it reads as popping out, not sliding.
      this.group.position.y += Math.sin(t * Math.PI) * 0.6;
      grow = 0.2 + 0.8 * e;
    }
    this.holder.scale.setScalar(grow);
    this.holder.position.y = Math.sin(time * 1.8) * 0.12;
    this.holder.rotation.y = time * 1.2;
    this.holder.children[1].rotation.x = Math.PI / 2 + Math.sin(time * 0.9) * 0.25;
    // Without a beam, a slow twinkle is the only tell: it reads up close, not across the island.
    const twinkle = 0.75 + 0.25 * Math.sin(time * 4.3 + this.home.x);
    this.glow.scale.setScalar(1.3 * twinkle * grow);
  }
}

/** The hint: a tall soft beam of light over whatever the player should do next. */
class HintBeam {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private on = false;
  private level = 0;

  constructor(shared: SharedAssets) {
    this.material = shared.beamMat.clone();
    this.mesh = new THREE.Mesh(shared.beamGeo, this.material);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** `lift` shifts the beam's foot relative to `at` (pieces float above the ground). */
  show(at: THREE.Vector3, lift: number): void {
    this.mesh.position.set(at.x, at.y + lift, at.z);
    this.on = true;
  }

  hide(): void {
    this.on = false;
    // Snap off: the task it pointed at is done, so it must not linger over the wrong place.
    this.level = 0;
    this.mesh.visible = false;
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    // Fades in over ~2 s, and fades out up close so it doesn't clutter.
    this.level = THREE.MathUtils.clamp(this.level + (this.on ? dt : -dt) * 0.5, 0, 1);
    const d = cameraPosition.distanceTo(this.mesh.position);
    this.material.uniforms.uOpacity.value = this.level * THREE.MathUtils.smoothstep(d, 8, 22);
    this.mesh.visible = this.level > 0;
  }

  dispose(): void {
    this.material.dispose();
  }
}
