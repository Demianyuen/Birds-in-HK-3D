import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const agentIds = new Set(['dou-dou', 'nian-nian', 'map-agent', 'qa-agent', 'asset-agent']);
const states = new Set(['working', 'reviewing', 'handoff', 'done', 'waiting', 'blocked', 'offline']);
const sensitiveText = /(?:api[ _-]?key|access[ _-]?token|password|credential|bearer\s+|sk-[a-z0-9_-]{8,})/i;
const statePath = resolve(process.cwd(), 'runtime-evidence', 'studio-state.json');
const temporaryPath = `${statePath}.tmp`;

const options = parseOptions(process.argv.slice(2));
const agent = requireOption(options, 'agent');
const state = requireOption(options, 'state');
const task = requireOption(options, 'task');
const runtime = requireOption(options, 'runtime');

if (!agentIds.has(agent)) fail(`Unknown agent: ${agent}`);
if (!states.has(state)) fail(`Unknown state: ${state}`);
if (!isSafeText(task, 160)) fail('Task must be 1-160 characters and contain no credential-like text.');
if (!isSafeText(runtime, 60)) fail('Runtime must be 1-60 characters and contain no credential-like text.');

const now = new Date().toISOString();
const existing = readExistingState();
const agents = existing.agents.filter(candidate => candidate.id !== agent);
agents.push({ id: agent, state, task, runtime, updatedAt: now });
const next = { source: 'local-feed', updatedAt: now, agents };

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
renameSync(temporaryPath, statePath);
console.log(`Studio state updated: ${agent} -> ${state}`);

function readExistingState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (parsed?.source !== 'local-feed' || !Array.isArray(parsed.agents)) return { agents: [] };
    return {
      agents: parsed.agents.filter(candidate => {
        return candidate && agentIds.has(candidate.id) && states.has(candidate.state)
          && isSafeText(candidate.task, 160) && isSafeText(candidate.runtime, 60)
          && typeof candidate.updatedAt === 'string' && !Number.isNaN(Date.parse(candidate.updatedAt));
      }),
    };
  } catch {
    return { agents: [] };
  }
}

function parseOptions(args) {
  if (args.length === 4 && args.every(argument => !argument.startsWith('--'))) {
    return new Map([
      ['agent', args[0].trim()],
      ['state', args[1].trim()],
      ['task', args[2].trim()],
      ['runtime', args[3].trim()],
    ]);
  }
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith('--')) fail('Use --agent, --state, --task, and --runtime.');
    const separator = argument.indexOf('=');
    if (separator > 2) {
      parsed.set(argument.slice(2, separator), argument.slice(separator + 1).trim());
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for ${argument}.`);
    parsed.set(argument.slice(2), value.trim());
    index += 1;
  }
  return parsed;
}

function requireOption(optionsMap, key) {
  const value = optionsMap.get(key);
  if (!value) fail(`Missing --${key}.`);
  return value;
}

function isSafeText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !sensitiveText.test(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
