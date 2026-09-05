import { describe, expect, it } from 'vitest';
import { RemoteBirds } from '../src/multiplayer/RemoteBirds';
import type { WorldPlayer } from '../src/multiplayer/protocol';
import { InstancedMesh, Matrix4, Vector3 } from 'three';

describe('remote players in the Three.js scene', () => {
  it('creates one visible bird per peer, interpolates updates and removes departed players', () => {
    const world = new RemoteBirds();
    const peer: WorldPlayer = { id: 'peer-1', name: '同伴', position: [10, 220, 320], quaternion: [0, 0, 0, 1], perched: false };
    world.sync([peer]);
    const body = world.group.getObjectByName('remote-body') as InstancedMesh;
    expect(body).toBeInstanceOf(InstancedMesh);
    expect(body.count).toBe(1);
    const matrix = new Matrix4();
    body.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([10, 220, 320]);
    world.sync([{ ...peer, position: [20, 220, 320] }]);
    world.update(0.05);
    body.getMatrixAt(0, matrix);
    const x = new Vector3().setFromMatrixPosition(matrix).x;
    expect(body.count).toBe(1);
    expect(x).toBeGreaterThan(10);
    expect(x).toBeLessThan(20);
    world.sync([]);
    expect(body.count).toBe(0);
    world.dispose();
  });

  it('represents all 99 remote players in a bounded set of shared draw batches', () => {
    const world = new RemoteBirds();
    const players: WorldPlayer[] = Array.from({ length: 99 }, (_, index) => ({
      id: `${index}`, name: `同伴 ${index}`, position: [index * 3, 220, 320],
      quaternion: [0, 0, 0, 1], perched: false,
    }));
    world.sync(players);
    world.update(0.016);
    const batches = world.group.children.filter((node): node is InstancedMesh => node instanceof InstancedMesh);
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.length).toBeLessThanOrEqual(10);
    for (const batch of batches) expect(batch.count).toBe(99);
    const body = world.group.getObjectByName('remote-body') as InstancedMesh;
    const matrix = new Matrix4();
    body.getMatrixAt(98, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).x).toBe(294);
    world.dispose();
  });
});
