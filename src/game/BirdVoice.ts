import type { BirdProfileId } from './birdProfiles';

/** One note of a call: when it starts (s), how long, pitch at start and end (Hz), loudness (0–1). */
export interface CallNote {
  at: number;
  length: number;
  from: number;
  to: number;
  gain: number;
  /** 'sine' is a soft coo; 'triangle' is brighter (chirps and whistles). */
  wave?: OscillatorType;
  /** Flutter in Hz (a rolling coo or a trill), if any. */
  flutter?: number;
}

/**
 * Each bird's call, written as a few notes and played with the browser's own
 * sound (no recordings to download). Quiet on purpose.
 */
export const BIRD_CALLS: Readonly<Record<BirdProfileId, readonly CallNote[]>> = Object.freeze({
  // Spotted dove: the soft three-part "咕咕—咕" heard round every estate.
  spotted: [
    { at: 0, length: 0.2, from: 560, to: 600, gain: 0.5 },
    { at: 0.3, length: 0.46, from: 640, to: 560, gain: 0.6 },
    { at: 0.95, length: 0.3, from: 520, to: 480, gain: 0.5 },
  ],
  // Feral pigeon: a low rolling coo.
  pigeon: [
    { at: 0, length: 0.5, from: 330, to: 370, gain: 0.5, flutter: 24 },
    { at: 0.62, length: 0.6, from: 360, to: 300, gain: 0.5, flutter: 24 },
  ],
  // White dove: a gentle, even coo.
  dove: [
    { at: 0, length: 0.36, from: 450, to: 480, gain: 0.45 },
    { at: 0.5, length: 0.6, from: 480, to: 420, gain: 0.5 },
  ],
  // Tree sparrow: a few quick chirps.
  sparrow: [
    { at: 0, length: 0.07, from: 3400, to: 4300, gain: 0.22, wave: 'triangle' },
    { at: 0.16, length: 0.07, from: 3600, to: 4500, gain: 0.22, wave: 'triangle' },
    { at: 0.36, length: 0.09, from: 3300, to: 4100, gain: 0.2, wave: 'triangle' },
  ],
  // Magpie: a dry chatter.
  magpie: [0, 0.11, 0.22, 0.33, 0.44].map(at => ({ at, length: 0.07, from: 1500, to: 1200, gain: 0.2, wave: 'triangle' as OscillatorType, flutter: 90 })),
  // Black kite: a long falling, quavering whistle.
  eagle: [
    { at: 0, length: 0.5, from: 2500, to: 2100, gain: 0.2, wave: 'triangle' },
    { at: 0.5, length: 0.7, from: 2100, to: 1700, gain: 0.18, wave: 'triangle', flutter: 16 },
  ],
});

const MASTER = 0.22;

/** Plays the bird's own call now and then while it rests on the ground. */
export class BirdVoice {
  private context: AudioContext | null = null;
  private wait = 2.5;
  private muted = false;

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  /** Call once from a tap or key press: browsers only allow sound after one. */
  public unlock(): void {
    if (this.context || typeof window === 'undefined') return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.context = new Context();
    } catch {
      this.context = null;
    }
  }

  /** `resting`: perched or standing, not flying. Calls shortly after landing, then every half minute or so. */
  public update(deltaSeconds: number, resting: boolean, profile: BirdProfileId): void {
    if (!resting) {
      this.wait = 2.5;
      return;
    }
    this.wait -= deltaSeconds;
    if (this.wait > 0) return;
    this.wait = 22 + Math.random() * 20;
    this.call(profile);
  }

  public call(profile: BirdProfileId): void {
    const context = this.context;
    if (!context || this.muted) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime + 0.05;
    for (const note of BIRD_CALLS[profile]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave ?? 'sine';
      const from = start + note.at;
      const to = from + note.length;
      oscillator.frequency.setValueAtTime(note.from, from);
      oscillator.frequency.exponentialRampToValueAtTime(note.to, to);
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(note.gain * MASTER, from + Math.min(0.04, note.length * 0.3));
      gain.gain.linearRampToValueAtTime(0, to);
      if (note.flutter) {
        const flutter = context.createOscillator();
        const depth = context.createGain();
        flutter.frequency.value = note.flutter;
        depth.gain.value = note.from * 0.04;
        flutter.connect(depth).connect(oscillator.frequency);
        flutter.start(from);
        flutter.stop(to + 0.02);
      }
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(from);
      oscillator.stop(to + 0.02);
    }
  }

  public dispose(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
