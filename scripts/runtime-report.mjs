import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidencePath = resolve(process.cwd(), 'runtime-evidence', 'events.jsonl');
if (!existsSync(evidencePath)) {
  console.log('No runtime evidence has been recorded.');
  process.exit(0);
}

const events = [];
let ignoredLines = 0;
for (const line of readFileSync(evidencePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
  try {
    const event = JSON.parse(line);
    if (typeof event?.type === 'string') events.push(event);
    else ignoredLines += 1;
  } catch {
    ignoredLines += 1;
  }
}

if (ignoredLines > 0) console.log(`Ignored invalid or non-runtime events: ${ignoredLines}`);
if (events.length === 0) {
  console.log('No valid runtime evidence has been recorded.');
  process.exit(0);
}
const sessions = Map.groupBy(events, event => event.sessionId ?? 'unknown');

for (const [id, sessionEvents] of sessions) {
  const types = sessionEvents.map(event => event.type);
  const errors = sessionEvents.filter(event => event.type.endsWith('.error'));
  const renderFrames = sessionEvents.filter(event => event.type === 'render.frame');
  const performanceSamples = sessionEvents.filter(event => event.type === 'performance.sample');
  const fpsValues = performanceSamples
    .map(event => event.details?.fps)
    .filter(value => Number.isFinite(value));
  console.log(`Session ${id}`);
  console.log(`  Started: ${sessionEvents[0]?.receivedAt ?? 'unknown'}`);
  console.log(`  Events: ${types.join(' -> ')}`);
  console.log(`  Reached game: ${types.includes('screen.game') ? 'YES' : 'NO'}`);
  console.log(`  Rendered frame: ${renderFrames.length > 0 ? 'YES' : 'NO'}`);
  console.log(`  FPS samples: ${fpsValues.length > 0 ? fpsValues.join(', ') : 'none'}`);
  console.log(`  Errors: ${errors.length}`);
}
