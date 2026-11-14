/**
 * Quiet background music, made by the browser as it plays (no file to download):
 * slow, soft chords that melt into one another, and now and then a single bell
 * note. Tuned to A = 432 Hz, with very little rise and fall.
 */
export const A4 = 432;

/** Frequency of the note `semitones` away from A4 (equal temperament on A = 432 Hz). */
export function pitch(semitones: number): number {
  return A4 * 2 ** (semitones / 12);
}

/** Four calm chords in A major (semitones from A4), each held for a long while. */
export const CHORDS: readonly (readonly number[])[] = Object.freeze([
  [-24, -17, -12, -8, -5, 2],   // A  E  A  C# E  B   (A add9)
  [-27, -20, -12, -8, -3, 4],   // F# C# A  C# F# C#  (F#m)
  [-19, -12, -7, -3, 0, 4],     // D  A  D  F# A  C#  (D maj7)
  [-17, -10, -5, -3, 2, 7],     // E  B  E  F# B  E   (E sus2)
]);
/** Bell notes: A major pentatonic above A4, so any of them sits well on any chord. */
export const BELL_NOTES: readonly number[] = Object.freeze([0, 2, 4, 7, 9, 12, 14]);

const CHORD_SECONDS = 18;
const FADE_SECONDS = 7;
const LEVEL = 0.2;
const STORAGE_KEY = 'birds-in-hk:music';

interface Voice {
  gain: GainNode;
  stop(at: number): void;
}

export class AmbientMusic {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: GainNode | null = null;
  private current: Voice[] = [];
  private chord = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextChordAt = 0;
  private nextBellAt = 0;
  private wanted = readWanted();
  private readonly onVisibility = (): void => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend().catch(() => undefined);
    else if (this.wanted) void this.context.resume().catch(() => undefined);
  };

  public get on(): boolean {
    return this.wanted;
  }

  /** Call from a tap or key press (browsers only allow sound after one). Starts playing if wanted. */
  public start(): void {
    if (!this.wanted || this.context || typeof window === 'undefined') return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.context = new Context();
    } catch {
      return;
    }
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.setValueAtTime(0, context.currentTime);
    this.master.gain.linearRampToValueAtTime(LEVEL, context.currentTime + 6);
    // Everything passes a gentle low-pass, so nothing is sharp.
    const soften = context.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2_200;
    this.master.connect(soften).connect(context.destination);
    // A long, faint echo gives the bell notes some air.
    const delay = context.createDelay(1.5);
    delay.delayTime.value = 0.62;
    const feedback = context.createGain();
    feedback.gain.value = 0.38;
    this.echo = context.createGain();
    this.echo.gain.value = 0.35;
    this.echo.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(this.master);
    this.nextChordAt = context.currentTime;
    this.nextBellAt = context.currentTime + 9;
    this.timer = setInterval(() => this.schedule(), 500);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  /** Turn the music on or off (remembered in this browser). */
  public setOn(on: boolean): void {
    this.wanted = on;
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* per-browser convenience */ }
    if (on) {
      if (!this.context) this.start();
      else {
        void this.context.resume().catch(() => undefined);
        this.master?.gain.linearRampToValueAtTime(LEVEL, this.context.currentTime + 3);
      }
    } else if (this.context && this.master) {
      const context = this.context;
      this.master.gain.cancelScheduledValues(context.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, context.currentTime);
      this.master.gain.linearRampToValueAtTime(0, context.currentTime + 1.5);
      setTimeout(() => { if (!this.wanted) void context.suspend().catch(() => undefined); }, 1_700);
    }
  }

  public dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private schedule(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const now = context.currentTime;
    if (now >= this.nextChordAt - 1) {
      const at = Math.max(now, this.nextChordAt);
      for (const voice of this.current) {
        voice.gain.gain.cancelScheduledValues(at);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
        voice.gain.gain.linearRampToValueAtTime(0, at + FADE_SECONDS);
        voice.stop(at + FADE_SECONDS + 0.2);
      }
      this.current = CHORDS[this.chord].map((semitones, index) => this.pad(pitch(semitones), at, index));
      this.chord = (this.chord + 1) % CHORDS.length;
      this.nextChordAt = at + CHORD_SECONDS;
    }
    if (now >= this.nextBellAt - 0.5) {
      const at = Math.max(now, this.nextBellAt);
      this.bell(pitch(BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)]), at);
      this.nextBellAt = at + 7 + Math.random() * 9;
    }
  }

  /** One soft, slowly breathing note of a chord: two sines a hair apart. */
  private pad(frequency: number, at: number, index: number): Voice {
    const context = this.context!;
    const gain = context.createGain();
    // Lower notes a little fuller, upper ones fainter.
    const level = 0.2 / (1 + index * 0.45);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + FADE_SECONDS);
    gain.connect(this.master!);
    const oscillators = [-3, 3].map(cents => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = cents;
      oscillator.connect(gain);
      oscillator.start(at);
      return oscillator;
    });
    return { gain, stop: time => oscillators.forEach(oscillator => oscillator.stop(time)) };
  }

  /** A single bell-like note: a sine with a faint octave, struck softly and left to ring. */
  private bell(frequency: number, at: number): void {
    const context = this.context!;
    for (const [multiple, level] of [[1, 0.1], [2, 0.025]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * multiple;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 5);
      oscillator.connect(gain);
      gain.connect(this.master!);
      if (this.echo) gain.connect(this.echo);
      oscillator.start(at);
      oscillator.stop(at + 5.2);
    }
  }
}

function readWanted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
