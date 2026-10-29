import { describe, expect, it } from 'vitest';
import { bubbleSeconds, findSpeaker, SpeechBubbles } from '../src/openWorld/speech';

const birds = [
  { id: 'a1', name: '阿明', position: { x: 0, z: 0 } },
  { id: 'b2', name: '陳太', position: { x: 30, z: 0 } },
  { id: 'c3', name: '阿明', position: { x: 500, z: 0 } },
];

describe('speech over birds', () => {
  it('finds the bird by its id', () => {
    expect(findSpeaker({ speaker: 'b2', name: '陳太', x: 999, z: 999 }, birds)).toBe('b2');
  });

  it('falls back to the nearest bird with that name close to where it was said', () => {
    expect(findSpeaker({ speaker: '', name: '阿明', x: 480, z: 10 }, birds)).toBe('c3');
    expect(findSpeaker({ name: '阿明', x: 5, z: 0 }, birds)).toBe('a1');
    expect(findSpeaker({ name: '阿明', x: 250, z: 0 }, birds)).toBeNull();
    expect(findSpeaker({ speaker: 'gone', name: '無名', x: 0, z: 0 }, birds)).toBeNull();
  });

  it('keeps a line up long enough to read, then lets it go', () => {
    const bubbles = new SpeechBubbles();
    bubbles.say('a1', '大家好', 0);
    expect(bubbles.textFor('a1', 3_000)).toBe('大家好');
    expect(bubbles.textFor('a1', bubbleSeconds('大家好') * 1_000 + 1)).toBeNull();
    expect(bubbleSeconds('長'.repeat(120))).toBeLessThanOrEqual(11);
    expect(bubbleSeconds('長'.repeat(40))).toBeGreaterThan(bubbleSeconds('短'));
  });

  it('a new line replaces the last one over the same bird', () => {
    const bubbles = new SpeechBubbles();
    bubbles.say('a1', '一', 0);
    bubbles.say('a1', '二', 100);
    expect(bubbles.textFor('a1', 200)).toBe('二');
    bubbles.forget('a1');
    expect(bubbles.textFor('a1', 200)).toBeNull();
  });
});
