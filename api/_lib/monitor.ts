/**
 * Visitor feedback and problem reports, kept as hidden rows of memorial_chat (no extra table, no
 * migration): hidden rows are never sent to visitors (row-level security shows visible rows only).
 * Each kind is told apart by its sender_hash:
 *   report:<kind>                         a problem a visitor's browser ran into (no name, no text)
 *   feedback:<id>:<part>/<parts>[:done]   words a visitor sent to the moderator, in 120-character parts
 */
export const REPORT_PREFIX = 'report:';
export const FEEDBACK_PREFIX = 'feedback:';
export const DONE_SUFFIX = ':done';
export const FEEDBACK_MAX = 480;
const PART = 120;

/** Problems a visitor's browser can report. */
export const REPORT_KINDS = Object.freeze({
  'webgl-missing': '瀏覽器不支援立體畫面',
  'graphics-lost': '畫面中斷（顯示卡）',
  'map-failed': '地圖載入失敗',
  'script-error': '程式錯誤',
  'slow': '畫面很慢（自動降到最低畫質）',
} as const);
export type ReportKind = keyof typeof REPORT_KINDS;

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REPORT_KINDS, value);
}

/** A short, plain description: device and browser only, never anything a visitor typed. */
export function cleanDetail(value: unknown): string {
  if (typeof value !== 'string') return '—';
  return value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || '—';
}

/** Feedback split into stored rows. */
export function feedbackRows(id: string, text: string): Array<{ sender_hash: string; body: string }> {
  const clean = text.replace(/\r\n?/g, '\n').trim().slice(0, FEEDBACK_MAX);
  const parts: string[] = [];
  for (let start = 0; start < clean.length; start += PART) parts.push(clean.slice(start, start + PART));
  return parts.map((body, index) => ({ sender_hash: `${FEEDBACK_PREFIX}${id}:${index + 1}/${parts.length}`, body }));
}

export interface StoredRow { id: number; created_at: string; name: string; body: string; sender_hash: string }
export interface Feedback { id: string; rowIds: number[]; created_at: string; name: string; body: string; done: boolean }

/** Stored rows back into whole messages, newest first; a message missing a part shows what arrived. */
export function joinFeedback(rows: readonly StoredRow[]): Feedback[] {
  const byId = new Map<string, { rows: Array<{ part: number; row: StoredRow }>; done: boolean }>();
  for (const row of rows) {
    const match = /^feedback:([A-Za-z0-9-]{6,40}):(\d)\/(\d)(:done)?$/.exec(row.sender_hash);
    if (!match) continue;
    const entry = byId.get(match[1]) ?? { rows: [], done: false };
    entry.rows.push({ part: Number(match[2]), row });
    entry.done = entry.done || Boolean(match[4]);
    byId.set(match[1], entry);
  }
  return [...byId.entries()]
    .map(([id, entry]) => {
      const ordered = entry.rows.sort((a, b) => a.part - b.part);
      return {
        id,
        rowIds: ordered.map(item => item.row.id),
        created_at: ordered[0].row.created_at,
        name: ordered[0].row.name,
        body: ordered.map(item => item.row.body).join(''),
        done: entry.done,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** PostgREST filter that leaves out switches, reports and feedback (the visitors' own chat lines only). */
export function onlyChatFilter(switchSenders: readonly string[]): string {
  return `sender_hash=not.in.(${switchSenders.join(',')})&sender_hash=not.like.${REPORT_PREFIX}*&sender_hash=not.like.${FEEDBACK_PREFIX}*`;
}
