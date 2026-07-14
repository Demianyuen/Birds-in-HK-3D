import { describe, expect, it } from 'vitest';
import { evaluateWorldReadiness } from '../src/game/worldReadiness';

describe('CSDI runtime readiness gate', () => {
  it('requires parsed models, visible tiles, and a live WebGL context', () => {
    expect(evaluateWorldReadiness({ parsedModels: 1, visibleTiles: 1, webglContextAvailable: true }))
      .toEqual({ ready: true, blockers: [] });
  });

  it.each([
    [{ parsedModels: 0, visibleTiles: 1, webglContextAvailable: true }, 'No CSDI model'],
    [{ parsedModels: 1, visibleTiles: 0, webglContextAvailable: true }, 'No parsed CSDI tile'],
    [{ parsedModels: 1, visibleTiles: 1, webglContextAvailable: false }, 'WebGL context'],
  ] as const)('blocks an incomplete runtime state', (metrics, expectedBlocker) => {
    const result = evaluateWorldReadiness(metrics);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(' ')).toContain(expectedBlocker);
  });
});
