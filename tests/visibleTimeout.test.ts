import { describe, expect, it } from 'vitest';
import { createVisibleTimeout } from '../src/game/visibleTimeout';

function harness() {
  let time = 0;
  let hidden = false;
  let tick: (() => void) | null = null;
  return {
    options: {
      now: () => time,
      isHidden: () => hidden,
      setTick: (callback: () => void) => { tick = callback; return () => { tick = null; }; },
    },
    advance(ms: number, step = 500) {
      for (let elapsed = 0; elapsed < ms; elapsed += step) { time += step; tick?.(); }
    },
    setHidden(value: boolean) { hidden = value; },
    get running() { return tick !== null; },
  };
}

describe('visible-time timeout', () => {
  it('fires after the limit while the page is visible', () => {
    const h = harness();
    let fired = 0;
    createVisibleTimeout(60_000, () => { fired += 1; }, h.options);
    h.advance(59_000);
    expect(fired).toBe(0);
    h.advance(1_500);
    expect(fired).toBe(1);
    h.advance(10_000);
    expect(fired).toBe(1);
  });

  it('does not count time while the tab is hidden', () => {
    const h = harness();
    let fired = 0;
    createVisibleTimeout(60_000, () => { fired += 1; }, h.options);
    h.advance(30_000);
    h.setHidden(true);
    h.advance(120_000);
    expect(fired).toBe(0);
    h.setHidden(false);
    h.advance(31_000);
    expect(fired).toBe(1);
  });

  it('can be cancelled', () => {
    const h = harness();
    let fired = 0;
    const cancel = createVisibleTimeout(1_000, () => { fired += 1; }, h.options);
    cancel();
    expect(h.running).toBe(false);
    h.advance(5_000);
    expect(fired).toBe(0);
  });
});
