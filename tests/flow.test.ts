import { describe, expect, it } from 'vitest';
import { transitionFlow } from '../src/app/flow';

describe('game flow', () => {
  it('follows the complete successful vertical slice', () => {
    const menu = transitionFlow('boot', 'continue');
    const loading = transitionFlow(menu, 'start');
    const game = transitionFlow(loading, 'world-ready');
    expect([menu, loading, game]).toEqual(['menu', 'loading', 'game']);
  });

  it('supports failure and retry without skipping loading', () => {
    const error = transitionFlow('loading', 'world-error');
    expect(transitionFlow(error, 'retry')).toBe('loading');
  });

  it('returns from a map error to the real-region selector', () => {
    const error = transitionFlow('loading', 'world-error');
    expect(transitionFlow(error, 'change-region')).toBe('menu');
  });

  it('rejects invalid screen jumps', () => {
    expect(() => transitionFlow('boot', 'world-ready')).toThrow(/Invalid game flow transition/);
  });
});
