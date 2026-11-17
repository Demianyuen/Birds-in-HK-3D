import { rest, type SupabaseConfig } from './openWorld.js';

/**
 * The quiet switch: when on, nothing visitors write is shown to others (lines over
 * the birds stop, flower words are held back); flowers themselves stay.
 *
 * Stored as a hidden row in memorial_chat (no schema change is needed, and the
 * hosted SQL editor is unreliable): the latest row from this sender wins. Hidden
 * rows are never readable or streamed to visitors.
 */
const SWITCH_SENDER = 'moderator-quiet-switch';
const CACHE_MS = 15_000;
let cached: { quiet: boolean; at: number } | null = null;

export async function readQuiet(config: SupabaseConfig, now = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.quiet;
  try {
    const response = await rest(config, `memorial_chat?select=body&sender_hash=eq.${SWITCH_SENDER}&order=id.desc&limit=1`);
    const rows = (await response.json()) as Array<{ body?: string }>;
    const quiet = rows[0]?.body === 'quiet:on';
    cached = { quiet, at: now };
    return quiet;
  } catch {
    // Cannot tell: keep the last known state (or open, as before the switch existed).
    return cached?.quiet ?? false;
  }
}

export async function writeQuiet(config: SupabaseConfig, quiet: boolean): Promise<void> {
  await rest(config, 'memorial_chat', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { name: '管理員', body: quiet ? 'quiet:on' : 'quiet:off', hidden: true, sender_hash: SWITCH_SENDER },
  });
  cached = { quiet, at: Date.now() };
}

/**
 * Whether a line said over a bird reaches other visitors at once (live) or is held until a
 * moderator shares it. Live is the default (lines appear over the bird at once, as before);
 * the moderator can switch to holding them, and the quiet switch still silences everything.
 * Stored the same way as the quiet switch, under its own sender.
 */
export const SPEECH_SENDER = 'moderator-speech-switch';
export const SWITCH_SENDERS: readonly string[] = [SWITCH_SENDER, SPEECH_SENDER];
let cachedSpeech: { live: boolean; at: number } | null = null;

export async function readSpeechLive(config: SupabaseConfig, now = Date.now()): Promise<boolean> {
  if (cachedSpeech && now - cachedSpeech.at < CACHE_MS) return cachedSpeech.live;
  try {
    const response = await rest(config, `memorial_chat?select=body&sender_hash=eq.${SPEECH_SENDER}&order=id.desc&limit=1`);
    const rows = (await response.json()) as Array<{ body?: string }>;
    const live = rows[0]?.body !== 'speech:hold';
    cachedSpeech = { live, at: now };
    return live;
  } catch {
    // Cannot tell: keep the last known setting, else the default (live).
    return cachedSpeech?.live ?? true;
  }
}

export async function writeSpeechLive(config: SupabaseConfig, live: boolean): Promise<void> {
  await rest(config, 'memorial_chat', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { name: '管理員', body: live ? 'speech:live' : 'speech:hold', hidden: true, sender_hash: SPEECH_SENDER },
  });
  cachedSpeech = { live, at: Date.now() };
}

/** A held line a moderator chose not to share keeps its record under this ending. */
export const NOT_SHARED_SUFFIX = ':not-shared';

/** For tests. */
export function forgetQuiet(): void {
  cached = null;
  cachedSpeech = null;
}
