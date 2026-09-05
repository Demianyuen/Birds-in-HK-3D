import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { startWorldServer } from '../server/worldServer';

it('admits 100 guests in one world, broadcasts all participants, and rejects guest 101', async () => {
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', origins: ['http://localhost:5173'] });
  const sockets: WebSocket[] = [];
  const identities = new Set<string>();
  let maxSnapshot = 0;
  try {
    async function join(index: number): Promise<string> {
      const ws = new WebSocket(server.url, { origin: 'http://localhost:5173' });
      sockets.push(ws);
      const answer = new Promise<string>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Join timed out')), 5000);
        ws.on('error', error => { clearTimeout(deadline); reject(error); });
        ws.on('message', data => {
          const event = JSON.parse(data.toString());
          if (event.type === 'welcome') {
            clearTimeout(deadline);
            identities.add(event.id);
            resolve('welcome');
          } else if (event.type === 'error') { clearTimeout(deadline); resolve(event.code); }
          else if (event.type === 'snapshot') maxSnapshot = Math.max(maxSnapshot, event.players.length);
        });
      });
      await once(ws, 'open');
      ws.send(JSON.stringify({ type: 'join', name: `Player ${index}`, room: 'tai-po' }));
      return answer;
    }
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => join(i)));
    expect(results.filter(result => result === 'welcome')).toHaveLength(100);
    expect(identities.size).toBe(100);
    await expect.poll(() => maxSnapshot).toBe(100);
    expect(await join(101)).toBe('room_full');
  } finally {
    for (const ws of sockets) ws.terminate();
    await server.close();
  }
}, 15000);
