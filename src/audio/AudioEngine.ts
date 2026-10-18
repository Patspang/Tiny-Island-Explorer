import * as S from './sounds';

export interface AmbienceState {
  /** 1 on the beach, falling to 0 well inland. */
  coast: number;
  /** 0 at sea level, 1 on the hilltop. */
  height: number;
  /** 0 day, 1 dusk (quest finale). */
  dusk: number;
  /** Bush rustle intensity right now, 0..1. */
  rustle: number;
}

const MUTE_KEY = 'tiny-island-muted';
const VOLUME = 0.8;

/**
 * All game audio. Browsers only allow sound after a user gesture, so the context is created by
 * `unlock()` (call it from a click or key press); until then every call is a silent no-op. Sounds
 * are synthesised (see `sounds.ts`); this class owns the context, mixing, mute and the looping
 * ambience beds. Presentation only: it reads game state and never feeds back into it.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private beds: {
    surf: GainNode;
    wash: GainNode;
    wind: GainNode;
    windFilter: BiquadFilterNode;
    rustle: GainNode;
  } | null = null;
  private muted = false;
  private paused = false;
  private nextBird = 3;
  private nextGull = 6;
  private nextCricket = 1;
  private time = 0;
  onMuteChange: (muted: boolean) => void = () => {};

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage unavailable (private mode): default to sound on.
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create or resume the audio context. Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Not persisted; fine.
    }
    this.applyLevel();
    this.onMuteChange(muted);
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /** Pause menu / story screens: keep a quiet bed, no effects. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyLevel();
  }

  private applyLevel(): void {
    if (!this.ctx || !this.master || !this.sfx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.paused ? 0 : 1, t, 0.05);
    this.ambience!.gain.setTargetAtTime(this.paused ? 0.35 : 1, t, 0.3);
  }

  private build(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);

    const loop = (buffer: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.start(0, Math.random() * buffer.duration);
      return src;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    // Surf: deep brown-noise rumble plus a brighter wash that rides each wave.
    const surf = gain();
    const surfLp = ctx.createBiquadFilter();
    surfLp.type = 'lowpass';
    surfLp.frequency.value = 420;
    loop(S.brownNoiseBuffer(ctx)).connect(surfLp).connect(surf).connect(this.ambience);
    const wash = gain();
    const washBp = ctx.createBiquadFilter();
    washBp.type = 'bandpass';
    washBp.frequency.value = 1100;
    washBp.Q.value = 0.5;
    loop(S.noiseBuffer(ctx)).connect(washBp).connect(wash).connect(this.ambience);
    // Wind: a slowly wandering band of noise.
    const wind = gain();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 1.2;
    windFilter.frequency.value = 600;
    loop(S.noiseBuffer(ctx)).connect(windFilter).connect(wind).connect(this.ambience);
    // Leaves rustling while pushing through bushes (part of the effects mix).
    const rustle = gain();
    const rustleBp = ctx.createBiquadFilter();
    rustleBp.type = 'bandpass';
    rustleBp.frequency.value = 3200;
    rustleBp.Q.value = 0.6;
    loop(S.noiseBuffer(ctx)).connect(rustleBp).connect(rustle).connect(this.sfx);
    this.beds = { surf, wash, wind, windFilter, rustle };
    this.applyLevel();
  }

  /** Per frame: steer the ambience beds and schedule birds, gulls and crickets. */
  update(dt: number, s: AmbienceState): void {
    this.time += dt;
    const ctx = this.ctx;
    const b = this.beds;
    if (!ctx || !b || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const smooth = 0.25;
    // Each wave: builds over a few seconds, breaks, then draws back.
    const wave = Math.pow(0.5 + 0.5 * Math.sin(this.time * ((Math.PI * 2) / 7.5)), 2);
    const near = 0.15 + 0.85 * s.coast;
    b.surf.gain.setTargetAtTime(near * (0.28 + 0.22 * wave), t, smooth);
    b.wash.gain.setTargetAtTime(near * s.coast * 0.1 * Math.pow(wave, 3), t, smooth);
    const gust = 0.5 + 0.5 * Math.sin(this.time * 0.23) * Math.sin(this.time * 0.61 + 1);
    b.wind.gain.setTargetAtTime((0.025 + 0.09 * s.height) * (0.5 + gust), t, 0.6);
    b.windFilter.frequency.setTargetAtTime(450 + 450 * gust, t, 0.8);
    b.rustle.gain.setTargetAtTime(this.paused ? 0 : 0.22 * s.rustle, t, 0.06);
    if (this.paused) return;

    const out = this.ambience!;
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2.5 + Math.random() * 5;
      const day = 1 - s.dusk;
      if (day > 0.2 && s.coast < 0.85) this.panned(out, 0.5, (o, at) => S.birdCall(ctx, o, at, 0.05 * day));
    }
    this.nextGull -= dt;
    if (this.nextGull <= 0) {
      this.nextGull = 7 + Math.random() * 12;
      if (s.coast > 0.4 && s.dusk < 0.7) this.panned(out, 0.8, (o, at) => S.gullCall(ctx, o, at, 0.035 * s.coast));
    }
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.35 + Math.random() * 0.9;
      if (s.dusk > 0.25) this.panned(out, 0.9, (o, at) => S.cricket(ctx, o, at, 0.02 * s.dusk));
    }
  }

  /** Run a sound through a random stereo position. */
  private panned(out: AudioNode, width: number, play: (o: AudioNode, at: number) => void): void {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * width;
    p.connect(out);
    play(p, ctx.currentTime + 0.01);
  }

  /** Play a one-shot effect `fn(ctx, out, t)` if audio is running. */
  private play(fn: (ctx: BaseAudioContext, out: AudioNode, t: number) => void): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== 'running' || this.paused) return;
    fn(ctx, this.sfx, ctx.currentTime + 0.005);
  }

  footstep(surface: S.Surface, strength: number): void {
    this.play((c, o, t) => S.footstep(c, o, t, surface, strength));
  }
  jump(): void {
    this.play((c, o, t) => S.jump(c, o, t));
  }
  land(impact: number, surface: S.Surface): void {
    this.play((c, o, t) => S.land(c, o, t, impact, surface));
  }
  collect(index: number, total: number): void {
    this.play((c, o, t) => S.collect(c, o, t, index, total));
  }
  complete(): void {
    this.play((c, o, t) => S.complete(c, o, t + 0.6));
  }
  hint(): void {
    this.play((c, o, t) => S.hint(c, o, t));
  }
  doorLocked(): void {
    this.play((c, o, t) => S.doorLocked(c, o, t));
  }
  finale(): void {
    this.play((c, o, t) => S.finale(c, o, t));
  }
  singingBell(bell: number, soft: boolean): void {
    this.play((c, o, t) => S.singingBell(c, o, t, bell, soft));
  }
  wrongNote(): void {
    this.play((c, o, t) => S.wrongNote(c, o, t));
  }
  bellsSolved(): void {
    this.play((c, o, t) => S.bellsSolved(c, o, t));
  }
  shell(found: number): void {
    this.play((c, o, t) => S.shell(c, o, t, found));
  }
  chestOpen(): void {
    this.play((c, o, t) => S.chestOpen(c, o, t));
  }
  dig(): void {
    this.play((c, o, t) => S.dig(c, o, t));
  }
  letter(): void {
    this.play((c, o, t) => S.letter(c, o, t));
  }
  reveal(): void {
    this.play((c, o, t) => S.reveal(c, o, t));
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
