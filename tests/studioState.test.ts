import { describe, expect, it } from 'vitest';
import { AGENTS, applyLiveState, parseLiveState } from '../src/studio/data';

describe('studio live-state boundary', () => {
  it('accepts only the small public agent state schema', () => {
    const live = parseLiveState({
      source: 'local-feed',
      updatedAt: '2026-07-22T14:00:00.000Z',
      agents: [{
        id: 'dou-dou',
        state: 'reviewing',
        task: '驗證藝術村 dashboard',
        runtime: 'Codex runtime',
        updatedAt: '2026-07-22T14:00:00.000Z',
      }],
    });

    expect(live?.agents).toHaveLength(1);
    expect(applyLiveState(AGENTS, live).find(agent => agent.id === 'dou-dou')).toMatchObject({
      state: 'reviewing',
      focus: '驗證藝術村 dashboard',
    });
  });

  it('rejects unknown agents, credential-like text, and oversized tasks', () => {
    const base = {
      source: 'local-feed',
      updatedAt: '2026-07-22T14:00:00.000Z',
    };
    expect(parseLiveState({ ...base, agents: [{ id: 'unknown', state: 'working', task: 'work', runtime: 'local', updatedAt: base.updatedAt }] })).toBeNull();
    expect(parseLiveState({ ...base, agents: [{ id: 'dou-dou', state: 'working', task: 'API key is present', runtime: 'local', updatedAt: base.updatedAt }] })).toBeNull();
    expect(parseLiveState({ ...base, agents: [{ id: 'dou-dou', state: 'working', task: 'x'.repeat(161), runtime: 'local', updatedAt: base.updatedAt }] })).toBeNull();
  });
});
