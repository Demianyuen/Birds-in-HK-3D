/**
 * Shared rules for what visitors may write and where flowers may be laid.
 * Used by the Vercel API (authoritative) and the game (instant feedback).
 *
 * Moderation model (decided with the project owner):
 * - Flowers and names appear at once, after an automatic filter.
 * - Written messages are held as "pending" until a moderator approves them.
 * - Live chat is filtered automatically, rate-limited, and can be hidden later.
 */

export const NAME_MAX = 24;
export const MESSAGE_MAX = 200;
export const CHAT_MAX = 120;

export type FlowerKind = 'white-chrysanthemum' | 'yellow-chrysanthemum' | 'lily' | 'lantern';
export const FLOWER_KINDS: readonly FlowerKind[] = ['white-chrysanthemum', 'yellow-chrysanthemum', 'lily', 'lantern'];

/**
 * Memorial ground: a circle around Wang Fuk Court in the Tai Po local frame
 * (metres; +x east, +z south; origin = the Tai Po region centre at the estate).
 * Flowers may be laid anywhere on the estate grounds and the streets around it.
 */
export const MEMORIAL_CENTRE = Object.freeze({ x: 18, z: 22 });
export const MEMORIAL_RADIUS = 190;

/**
 * Where every visit begins: high above Tolo Harbour, about 1.7 km east-north-east
 * of the estate and facing it, so arriving is a flight of a minute or so with
 * the flower in the beak, not a drop onto the court.
 */
export const MEMORIAL_APPROACH = Object.freeze({ x: 1560, y: 260, z: -640 });

/**
 * Words that are never shown. Kept short and specific: common Cantonese and
 * English profanity and slurs. Messages also go through human moderation.
 */
const BLOCKED_TERMS = [
  '屌', '撚', '閪', '柒頭', '仆街', '冚家', '冚家鏟', '戇鳩', '躝屍', '含撚', 'on9',
  'fuck', 'fck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'dick', 'pussy',
];

const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|hk|io|cn|xyz|top|ly|me)\b)/i;
const PHONE_PATTERN = /(?:\+?852[\s-]?)?\b[2-9]\d{3}[\s-]?\d{4}\b/;
// Control characters and invisible formatting marks used to dodge filters.
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export type RejectReason = 'empty' | 'too-long' | 'blocked-word' | 'link' | 'phone';

export interface TextCheck {
  ok: boolean;
  /** Normalised text (trimmed, whitespace collapsed, invisible characters removed). */
  text: string;
  reason?: RejectReason;
}

export function normaliseText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

function containsBlockedTerm(text: string): boolean {
  // Remove spacing and common separators so "f u c k" and "仆.街" are still caught.
  const squeezed = text.toLowerCase().replace(/[\s._\-*·]+/g, '');
  return BLOCKED_TERMS.some(term => squeezed.includes(term));
}

export function checkText(input: unknown, maxLength: number, { required }: { required: boolean }): TextCheck {
  const text = normaliseText(input);
  if (!text) return required ? { ok: false, text, reason: 'empty' } : { ok: true, text };
  if ([...text].length > maxLength) return { ok: false, text, reason: 'too-long' };
  if (containsBlockedTerm(text)) return { ok: false, text, reason: 'blocked-word' };
  if (URL_PATTERN.test(text)) return { ok: false, text, reason: 'link' };
  if (PHONE_PATTERN.test(text)) return { ok: false, text, reason: 'phone' };
  return { ok: true, text };
}

export const checkName = (input: unknown): TextCheck => checkText(input, NAME_MAX, { required: false });
export const checkMessage = (input: unknown): TextCheck => checkText(input, MESSAGE_MAX, { required: false });
export const checkChat = (input: unknown): TextCheck => checkText(input, CHAT_MAX, { required: true });

export function isFlowerKind(value: unknown): value is FlowerKind {
  return typeof value === 'string' && (FLOWER_KINDS as readonly string[]).includes(value);
}

export function insideMemorialGround(x: unknown, z: unknown): boolean {
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.hypot(x - MEMORIAL_CENTRE.x, z - MEMORIAL_CENTRE.z) <= MEMORIAL_RADIUS;
}

/** Chinese explanation shown to the visitor when text is refused. */
export function rejectReasonText(reason: RejectReason | undefined): string {
  switch (reason) {
    case 'empty': return '請先輸入內容。';
    case 'too-long': return '內容太長了。';
    case 'blocked-word': return '內容包含不適合在紀念場所出現的字詞。';
    case 'link': return '為保障大家，留言不可以包含網址。';
    case 'phone': return '為保障私隱，留言不可以包含電話號碼。';
    default: return '未能接受這段內容。';
  }
}
