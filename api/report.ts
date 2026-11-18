import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { checkName } from '../src/openWorld/contentRules.js';
import { cleanDetail, feedbackRows, FEEDBACK_MAX, isReportKind, REPORT_PREFIX } from './_lib/monitor.js';
import { ApiError, countRows, isoSecondsAgo, readJson, rest, senderHash, sendError, sendJson, supabaseConfig, type ApiRequest } from './_lib/openWorld.js';

/** Per visitor network: 3 feedback messages an hour, 30 problem reports an hour. */
const FEEDBACK_PER_HOUR = 3;
const REPORTS_PER_HOUR = 30;
const recent = new Map<string, number[]>();

function allow(key: string, limit: number, now = Date.now()): boolean {
  const times = (recent.get(key) ?? []).filter(at => now - at < 3_600_000);
  if (times.length >= limit) return false;
  times.push(now);
  recent.set(key, times);
  if (recent.size > 5_000) recent.clear();
  return true;
}

/**
 * POST /api/report { kind, detail }       a problem the visitor's browser ran into (no text from the visitor)
 * POST /api/report { kind: 'feedback', name?, body }   words for the moderator, never shown to other visitors
 */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new ApiError(405, 'Method not allowed.');
    }
    const config = supabaseConfig();
    const body = await readJson(req);
    const who = senderHash(req);
    if (body.kind === 'feedback') {
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!text) throw new ApiError(422, '請先寫下你的意見。');
      if (text.length > FEEDBACK_MAX) throw new ApiError(422, `意見最多 ${FEEDBACK_MAX} 字。`);
      if (!allow(`feedback:${who}`, FEEDBACK_PER_HOUR)) throw new ApiError(429, '謝謝你，意見已經收到了。稍後再傳也可以。');
      const name = checkName(body.name);
      const rows = feedbackRows(randomUUID().slice(0, 13), text).map(row => ({
        ...row,
        name: name.ok ? name.text : '',
        hidden: true,
      }));
      await rest(config, 'memorial_chat', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: rows });
      sendJson(res, 201, { ok: true });
      return;
    }
    if (!isReportKind(body.kind)) throw new ApiError(422, 'Unknown report.');
    if (!allow(`report:${who}`, REPORTS_PER_HOUR)) {
      sendJson(res, 202, { ok: true });
      return;
    }
    // Many visitors with the same problem at once: keep at most 200 of a kind an hour.
    const lately = await countRows(config, 'memorial_chat', `sender_hash=eq.${REPORT_PREFIX}${body.kind}&created_at=gte.${isoSecondsAgo(3_600)}`);
    if (lately < 200) {
      await rest(config, 'memorial_chat', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { name: '', body: cleanDetail(body.detail), hidden: true, sender_hash: `${REPORT_PREFIX}${body.kind}` },
      });
    }
    sendJson(res, 202, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}
