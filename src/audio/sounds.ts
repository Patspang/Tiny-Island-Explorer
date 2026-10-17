// Procedural sound effects. Every sound is synthesised with Web Audio nodes (no sample files):
// each function schedules one sound at time `t` into `out` on any BaseAudioContext, so the same
// code runs live in the game and offline (to render previews).

export type Surface = 'grass' | 'sand' | 'path' | 'rock' | 'water';

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, shared per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** Brown (integrated) noise: deep and rumbly, the basis of the surf. */
export function brownNoiseBuffer(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return b;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Gain node with an attack/exponential-decay envelope. */
function envelope(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** A filtered noise burst. */
function noiseHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  opts: { type: BiquadFilterType; freq: number; q?: number; to?: number; peak: number; attack: number; decay: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.frequency.setValueAtTime(opts.freq, t);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + opts.attack + opts.decay);
  f.Q.value = opts.q ?? 0.7;
  const g = envelope(ctx, t, opts.peak, opts.attack, opts.decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + opts.attack + opts.decay + 0.05);
}

/** A short pitched blip, e.g. the knock in a footstep on rock. */
function tone(ctx: BaseAudioContext, out: AudioNode, t: number, from: number, to: number, peak: number, decay: number, type: OscillatorType = 'sine'): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay);
  const g = envelope(ctx, t, peak, 0.004, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** A bell-like note: a sine plus an inharmonic partial, long soft decay. */
function bell(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, decay = 1.6): void {
  for (const [ratio, amp, d] of [
    [1, 1, decay],
    [2.76, 0.35, decay * 0.45],
    [5.4, 0.12, decay * 0.25],
  ] as const) {
    const o = ctx.createOscillator();
    o.frequency.value = freq * ratio;
    const g = envelope(ctx, t, peak * amp, 0.006, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.05);
  }
}

/** One footfall. `strength` 0..1 (walking softly .. running). */
export function footstep(ctx: BaseAudioContext, out: AudioNode, t: number, surface: Surface, strength: number): void {
  const v = 0.35 + 0.65 * strength;
  switch (surface) {
    case 'sand':
      // Soft, muffled scuff.
      noiseHit(ctx, out, t, { type: 'lowpass', freq: rand(700, 1000), to: 300, peak: 0.6 * v, attack: 0.02, decay: 0.12 });
      break;
    case 'grass':
      // Swishy brush of blades plus a soft thud.
      noiseHit(ctx, out, t, { type: 'bandpass', freq: rand(2600, 3400), q: 0.8, to: 1800, peak: 0.3 * v, attack: 0.015, decay: 0.11 });
      noiseHit(ctx, out, t, { type: 'lowpass', freq: 400, peak: 0.4 * v, attack: 0.005, decay: 0.06 });
      break;
    case 'path':
      // Crunchy gravel: a few tiny grains in quick succession.
      for (let i = 0; i < 4; i++) {
        noiseHit(ctx, out, t + i * rand(0.008, 0.02), { type: 'bandpass', freq: rand(1500, 3200), q: 2, peak: rand(0.2, 0.36) * v, attack: 0.002, decay: rand(0.02, 0.05) });
      }
      noiseHit(ctx, out, t, { type: 'lowpass', freq: 500, peak: 0.35 * v, attack: 0.004, decay: 0.05 });
      break;
    case 'rock':
      // Hard boot on stone: click plus a short knock.
      noiseHit(ctx, out, t, { type: 'bandpass', freq: rand(2000, 2600), q: 3, peak: 0.2 * v, attack: 0.001, decay: 0.03 });
      tone(ctx, out, t, rand(170, 210), 90, 0.22 * v, 0.07);
      break;
    case 'water':
      splash(ctx, out, t, 0.7 * v);
      break;
  }
}

/** A splash: bright spray falling to a lower slosh. */
export function splash(ctx: BaseAudioContext, out: AudioNode, t: number, strength: number): void {
  noiseHit(ctx, out, t, { type: 'bandpass', freq: 2600, q: 0.9, to: 700, peak: 0.4 * strength, attack: 0.01, decay: 0.22 });
  noiseHit(ctx, out, t + 0.03, { type: 'lowpass', freq: 900, peak: 0.25 * strength, attack: 0.03, decay: 0.25 });
  // Bubbly droplets.
  for (let i = 0; i < 3; i++) tone(ctx, out, t + rand(0.04, 0.2), rand(900, 1600), rand(1800, 2600), 0.04 * strength, 0.05);
}

/** Take-off: a quick airy whoosh. */
export function jump(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  noiseHit(ctx, out, t, { type: 'bandpass', freq: 500, q: 1.2, to: 1700, peak: 0.14, attack: 0.04, decay: 0.16 });
  tone(ctx, out, t, 220, 330, 0.05, 0.12, 'triangle');
}

/** Landing: a thump scaled by impact speed (m/s), with the surface's footstep on top. */
export function land(ctx: BaseAudioContext, out: AudioNode, t: number, impact: number, surface: Surface): void {
  const k = Math.min(1, impact / 9);
  tone(ctx, out, t, 140, 45, 0.35 * k + 0.08, 0.18);
  if (surface === 'water') splash(ctx, out, t, 0.6 + 0.6 * k);
  else footstep(ctx, out, t + 0.01, surface, 0.6 + 0.4 * k);
}

/** One bird call: two to four quick chirps that sweep up. */
export function birdCall(ctx: BaseAudioContext, out: AudioNode, t: number, volume: number): void {
  const base = rand(2400, 3600);
  const n = 2 + Math.floor(Math.random() * 3);
  const gap = rand(0.07, 0.13);
  for (let i = 0; i < n; i++) {
    const s = t + i * gap;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(base * rand(0.9, 1.05), s);
    o.frequency.exponentialRampToValueAtTime(base * rand(1.25, 1.5), s + 0.05);
    const g = envelope(ctx, s, volume, 0.008, 0.05);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(s + 0.08);
  }
}

/** A gull's cry, for the coast: a nasal, falling "kee-ow". */
export function gullCall(ctx: BaseAudioContext, out: AudioNode, t: number, volume: number): void {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(rand(1100, 1300), t);
  o.frequency.linearRampToValueAtTime(rand(1500, 1700), t + 0.08);
  o.frequency.exponentialRampToValueAtTime(rand(700, 850), t + 0.45);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1600;
  f.Q.value = 1.5;
  const g = envelope(ctx, t, volume, 0.05, 0.42);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.55);
}

/** A cricket chirp burst (dusk). */
export function cricket(ctx: BaseAudioContext, out: AudioNode, t: number, volume: number): void {
  const f = rand(4200, 4800);
  for (let i = 0; i < 3; i++) {
    const s = t + i * 0.045;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = envelope(ctx, s, volume, 0.004, 0.025);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(s + 0.04);
  }
}

// Pentatonic scale (C major pentatonic, two octaves) for all musical cues: always consonant.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

/** Picking up lens piece `index` of `total`: a rising arpeggio that climbs as the quest progresses. */
export function collect(ctx: BaseAudioContext, out: AudioNode, t: number, index: number, total: number): void {
  const start = Math.min(PENTA.length - 4, Math.round((index / Math.max(1, total - 1)) * 4));
  for (let i = 0; i < 4; i++) bell(ctx, out, t + i * 0.085, PENTA[start + i], 0.16 - i * 0.015, 1.4);
  // A soft "clunk" as the matching socket on the plaque fills.
  tone(ctx, out, t + 0.42, 320, 160, 0.08, 0.12, 'triangle');
}

/** All pieces found: a fuller flourish. */
export function complete(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  const notes = [0, 2, 4, 5, 7, 9];
  notes.forEach((n, i) => bell(ctx, out, t + i * 0.07, PENTA[n], 0.13, 2.2));
  bell(ctx, out, t + 0.5, PENTA[5] / 2, 0.18, 3);
}

/** A hint beam appears: a gentle rising shimmer. */
export function hint(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  for (let i = 0; i < 6; i++) bell(ctx, out, t + i * 0.12, PENTA[i % 5 + 3] * 1.0, 0.05, 1.2);
}

/** Door still locked: two muted wooden knocks. */
export function doorLocked(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  for (const dt of [0, 0.18]) {
    tone(ctx, out, t + dt, 210, 120, 0.25, 0.09, 'triangle');
    noiseHit(ctx, out, t + dt, { type: 'lowpass', freq: 800, peak: 0.12, attack: 0.002, decay: 0.05 });
  }
}

/** The lighthouse relights: a warm swelling chord with a bell on top. About six seconds. */
export function finale(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  const chord = [130.81, 196.0, 261.63, 329.63, 392.0];
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(2600, t + 3.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.24, t + 2.5);
  g.gain.setValueAtTime(0.24, t + 4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
  lp.connect(g).connect(out);
  for (const f of chord) {
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = 0.12;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + 7.1);
    }
  }
  [0, 2, 4, 7].forEach((n, i) => bell(ctx, out, t + 2.2 + i * 0.25, PENTA[n] * 2, 0.08, 3));
}
