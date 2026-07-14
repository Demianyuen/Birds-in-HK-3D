import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidencePath = resolve(process.cwd(), 'runtime-evidence', 'events.jsonl');
const requiredSchema = 4;

if (!existsSync(evidencePath)) fail('No runtime evidence has been recorded.');

const events = readFileSync(evidencePath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  })
  .filter(event => event?.evidenceSchema === requiredSchema && typeof event.sessionId === 'string');

if (events.length === 0) {
  fail(`No runtime session using evidence schema ${requiredSchema} was found.`);
}

const sessions = Map.groupBy(events, event => event.sessionId);
const session = [...sessions.values()].sort((left, right) => {
  return Date.parse(right[0]?.receivedAt ?? '') - Date.parse(left[0]?.receivedAt ?? '');
})[0];
const sessionId = session[0].sessionId;
const types = session.map(event => event.type);
const blockers = [];

requireOrdered(types, ['screen.boot', 'screen.menu', 'screen.loading', 'screen.game'], blockers);

const errors = session.filter(event => typeof event.type === 'string' && event.type.endsWith('.error'));
if (errors.length > 0) blockers.push(`${errors.length} runtime error event(s) were recorded.`);

const worldReady = session.find(event => event.type === 'world.ready');
if (worldReady?.details?.source !== 'csdi') blockers.push('The official CSDI world was not recorded as ready.');
if (worldReady?.details?.region !== 'tai-po') blockers.push('The official Tai Po region was not recorded as ready.');

const stages = new Set(
  session
    .filter(event => event.type === 'loading.stage')
    .map(event => event.details?.stage)
    .filter(stage => typeof stage === 'string'),
);
for (const stage of [
  'Building Hong Kong terrain',
  'Blender pigeon ready',
  'building layer ready',
]) {
  if (!stages.has(stage)) blockers.push(`Required loading stage was not recorded: ${stage}.`);
}

const frame = session.find(event => event.type === 'render.frame');
if (!isPositive(frame?.details?.width) || !isPositive(frame?.details?.height)) {
  blockers.push('No nonblank WebGL framebuffer evidence was recorded.');
}

const capture = session.find(event => event.type === 'render.capture');
const capturedFramePath = resolve(process.cwd(), 'runtime-evidence', 'frames', `${sessionId}.png`);
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const capturedFrame = existsSync(capturedFramePath) ? readFileSync(capturedFramePath) : null;
if (
  capture?.details?.captured !== true
  || !capturedFrame
  || capturedFrame.length < 8
  || !capturedFrame.subarray(0, 8).equals(pngMagic)
) {
  blockers.push('No valid PNG capture is attached to the runtime session.');
}

const fpsValues = session
  .filter(event => event.type === 'performance.sample')
  .map(event => event.details?.fps)
  .filter(isPositive);
if (fpsValues.length === 0) blockers.push('No positive FPS sample was recorded after entering the game.');

const flying = session.some(event => event.type === 'flight.state' && event.details?.state === 'FLYING');
if (!flying) blockers.push('The bird never entered the FLYING state.');

const materials = session.find(event => event.type === 'building.materials');
if (!isPositive(materials?.details?.texturedMaterials)) {
  blockers.push('No official textured building material was recorded.');
}

if (blockers.length > 0) {
  console.error(`Runtime acceptance failed for session ${sessionId}:`);
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exit(1);
}

console.log(`Runtime acceptance passed for session ${sessionId}.`);
console.log('Flow: screen.boot -> screen.menu -> screen.loading -> screen.game');
console.log('World: official CSDI');
console.log(`Textured building materials: ${materials.details.texturedMaterials}`);
console.log(`Framebuffer: ${frame.details.width}x${frame.details.height}`);
console.log(`Capture: ${capturedFramePath}`);
console.log(`FPS samples: ${fpsValues.join(', ')}`);

function requireOrdered(actual, expected, failures) {
  let cursor = -1;
  for (const type of expected) {
    cursor = actual.indexOf(type, cursor + 1);
    if (cursor === -1) {
      failures.push(`Required screen flow is incomplete at ${type}.`);
      return;
    }
  }
}

function isPositive(value) {
  return Number.isFinite(value) && value > 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
