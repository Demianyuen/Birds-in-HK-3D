import { startWorldServer } from './worldServer';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const origins = (process.env.WORLD_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
if (origins.length === 0) throw new Error('At least one WORLD_ORIGINS entry is required.');
const server = await startWorldServer({ port, host: process.env.WORLD_HOST ?? '127.0.0.1', origins });
console.log(`World server listening on port ${port}; guest sessions, no persistent chat.`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => process.exit(0), () => process.exit(1));
  });
}
