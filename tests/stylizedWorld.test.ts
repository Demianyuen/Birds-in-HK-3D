import { describe, expect, it } from 'vitest';
import { WANG_FUK_TOWER_LAYOUT } from '../src/game/StylizedHongKong';

describe('stylized Hong Kong world data', () => {
  it('contains all eight Wang Fuk Court towers', () => {
    expect(WANG_FUK_TOWER_LAYOUT).toHaveLength(8);
  });

  it('keeps each tower at a unique position', () => {
    const positions = new Set(WANG_FUK_TOWER_LAYOUT.map(position => position.join(',')));
    expect(positions.size).toBe(8);
  });
});
