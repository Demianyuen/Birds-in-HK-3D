import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';

// Reserve an ephemeral loopback port, then release it for the isolated process.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ['dist-server/world.mjs'], {
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), WORLD_HOST: '127.0.0.1', WORLD_ORIGINS: 'http://bundle.test' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
const sockets = [];
const exit = once(child, 'exit');
let stderr = '';
child.stderr.on('data', data => { stderr += data.toString().slice(0, 1000); });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bundle startup timeout')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Bundle exited before ready')); });
    child.stdout.on('data', data => {
      if (data.toString().includes('World server listening')) { clearTimeout(timer); resolve(); }
    });
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  if (!health.ok || (await health.json()).protocol !== 2) throw new Error('Health/protocol failure');
  async function join(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/world`, { origin: 'http://bundle.test' });
    sockets.push(ws);
    await once(ws, 'open');
    const welcome = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'join', room: 'tai-po', name }));
    const [data] = await welcome;
    if (JSON.parse(data.toString()).type !== 'welcome') throw new Error('Bundle join failed');
    return ws;
  }
  const a = await join('Bundle A');
  const b = await join('Bundle B');
  const chat = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chat delivery timeout')), 3000);
    b.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'chat' && message.text === 'Bundle handshake') { clearTimeout(timer); resolve(); }
    });
  });
  a.send(JSON.stringify({ type: 'chat', scope: 'room', text: 'Bundle handshake' }));
  await chat;
  if (stderr) throw new Error('Bundle wrote unexpected stderr');
  console.log('PASS compiled Node bundle: health, protocol 2, two guests and cross-client chat.');
} finally {
  for (const ws of sockets) ws.terminate();
  child.kill('SIGTERM');
  await exit;
  // Verify the test process really released its listener.
  let alive = false;
  try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); alive = true; } catch {}
  if (alive) throw new Error('Bundle listener remained after shutdown');
  console.log('PASS test process stopped and loopback listener released.');
}
