import { describe, expect, it } from 'vitest';
import { A4, BELL_NOTES, CHORDS, pitch } from '../src/game/AmbientMusic';

describe('background music', () => {
  it('is tuned to A = 432 Hz', () => {
    expect(A4).toBe(432);
    expect(pitch(0)).toBe(432);
    expect(pitch(-12)).toBeCloseTo(216);
    expect(pitch(12)).toBeCloseTo(864);
  });

  it('stays calm: a few low, slow chords and bell notes from one five-note scale', () => {
    const pentatonic = new Set([0, 2, 4, 7, 9]);
    for (const note of BELL_NOTES) expect(pentatonic.has(((note % 12) + 12) % 12)).toBe(true);
    expect(CHORDS.length).toBeLessThanOrEqual(4);
    // Nothing piercing: every chord note is at or below about 650 Hz.
    for (const chord of CHORDS) for (const note of chord) expect(pitch(note)).toBeLessThan(660);
    // Every chord note belongs to A major.
    const major = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const chord of CHORDS) for (const note of chord) expect(major.has(((note % 12) + 12) % 12)).toBe(true);
  });
});
