import { finiteTuple, isRecord, type WorldPlayer } from './protocol';

export function encodeMotion(players: readonly WorldPlayer[], revision: number, time: number) {
  return {
    type: 'motion' as const, revision, time,
    poses: players.map(player => [...player.position, ...player.quaternion, Number(player.perched)]),
  };
}

/** Absolute poses, not cumulative deltas: a dropped update cannot accumulate drift. */
export function decodeMotion(packet: unknown, roster: readonly WorldPlayer[], revision: number): WorldPlayer[] | null {
  if (!isRecord(packet) || packet.type !== 'motion' || packet.revision !== revision
    || !Number.isFinite(packet.time) || !Array.isArray(packet.poses) || packet.poses.length !== roster.length
    || !packet.poses.every(pose => finiteTuple(pose, 8) && (pose[7] === 0 || pose[7] === 1)
      && Math.abs(Math.hypot(pose[3], pose[4], pose[5], pose[6]) - 1) <= 0.02)) return null;
  const poses = packet.poses as number[][];
  return roster.map((player, index) => {
    const pose = poses[index];
    return { ...player, position: [pose[0], pose[1], pose[2]], quaternion: [pose[3], pose[4], pose[5], pose[6]], perched: pose[7] === 1 };
  });
}
