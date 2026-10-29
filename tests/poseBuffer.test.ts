import { describe, expect, it } from 'vitest';
import { PoseBuffer } from '../src/openWorld/PoseBuffer';

const IDENTITY = [0, 0, 0, 1];

describe('PoseBuffer', () => {
  it('glides between messages instead of jumping when they arrive 4 times a second', () => {
    const buffer = new PoseBuffer();
    for (let step = 0; step < 6; step += 1) buffer.push([step * 6.5, 100, 0], IDENTITY, false, 1_000 + step * 250);
    const seen: number[] = [];
    for (let time = 2_000; time <= 2_250; time += 25) seen.push(buffer.sample(time)!.position[0]);
    for (let index = 1; index < seen.length; index += 1) {
      const step = seen[index] - seen[index - 1];
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(1.2); // 6.5 m per 250 ms => 0.65 m per 25 ms, never a 6.5 m jump
    }
  });

  it('draws a little in the past and adapts the delay to slower senders', () => {
    const fast = new PoseBuffer();
    const slow = new PoseBuffer();
    for (let step = 0; step < 8; step += 1) {
      fast.push([0, 0, 0], IDENTITY, false, step * 250);
      slow.push([0, 0, 0], IDENTITY, false, step * 500);
    }
    expect(fast.delay).toBeGreaterThanOrEqual(250);
    expect(slow.delay).toBeGreaterThan(fast.delay);
    expect(slow.delay).toBeLessThanOrEqual(700);
  });

  it('carries on along the last direction for half a second when a message is late, then holds', () => {
    const buffer = new PoseBuffer();
    buffer.push([0, 0, 0], IDENTITY, false, 0);
    buffer.push([10, 0, 0], IDENTITY, false, 250);
    const late = buffer.sample(250 + buffer.delay + 250)!;
    expect(late.position[0]).toBeGreaterThan(10);
    const long = buffer.sample(250 + buffer.delay + 5_000)!;
    const held = buffer.sample(250 + buffer.delay + 10_000)!;
    expect(held.position[0]).toBe(long.position[0]);
    expect(long.position[0]).toBeLessThanOrEqual(30.01);
  });

  it('does not glide across a jump to another place', () => {
    const buffer = new PoseBuffer();
    buffer.push([0, 0, 0], IDENTITY, false, 0);
    buffer.push([2_000, 0, 0], IDENTITY, false, 250);
    buffer.push([2_001, 0, 0], IDENTITY, false, 500);
    const middle = buffer.sample(125 + buffer.delay)!;
    expect(middle.position[0] === 0 || middle.position[0] >= 2_000).toBe(true);
  });

  it('shows nothing before the first message and the first pose until a second arrives', () => {
    const buffer = new PoseBuffer();
    expect(buffer.sample(1_000)).toBeNull();
    buffer.push([5, 6, 7], IDENTITY, true, 1_000);
    expect(buffer.sample(5_000)).toMatchObject({ position: [5, 6, 7], perched: true });
  });

  it('turns smoothly between two headings', () => {
    const buffer = new PoseBuffer();
    const half = Math.SQRT1_2;
    buffer.push([0, 0, 0], [0, 0, 0, 1], false, 0);
    buffer.push([0, 0, 0], [0, half, 0, half], false, 250); // 90 degrees about y
    const middle = buffer.sample(125 + buffer.delay)!;
    expect(middle.quaternion[1]).toBeGreaterThan(0.2);
    expect(middle.quaternion[1]).toBeLessThan(half - 0.1);
  });
});
