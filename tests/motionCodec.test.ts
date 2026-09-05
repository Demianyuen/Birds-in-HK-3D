import { expect, it } from 'vitest';
import { encodeMotion, decodeMotion } from '../src/multiplayer/motionCodec';
import type { WorldPlayer } from '../src/multiplayer/protocol';

const players: WorldPlayer[] = [
  { id: 'one', name: '甲', position: [1.125, 220, 320], quaternion: [0, 0, 0, 1], perched: false },
  { id: 'two', name: '乙', position: [-2, 221, 319], quaternion: [0, 0, 0, 1], perched: true },
];

it('roundtrips complete motion with identity/name preserved by roster order', () => {
  const packet = encodeMotion(players, 4, 1000);
  expect(packet.poses).toHaveLength(2);
  expect(decodeMotion(packet, players, 4)).toEqual(players);
  expect(JSON.stringify(packet).length).toBeLessThan(JSON.stringify({ type: 'snapshot', players, time: 1000, revision: 4 }).length * 0.6);
});

it('rejects stale rosters, truncated updates and invalid numbers atomically', () => {
  const packet = encodeMotion(players, 4, 1000);
  expect(decodeMotion(packet, players, 5)).toBeNull();
  expect(decodeMotion({ ...packet, poses: packet.poses.slice(1) }, players, 4)).toBeNull();
  const invalid = { ...packet, poses: [[NaN, 0, 0, 0, 0, 0, 1, 0], packet.poses[1]] };
  expect(decodeMotion(invalid, players, 4)).toBeNull();
  expect(players[0].position).toEqual([1.125, 220, 320]);
});
