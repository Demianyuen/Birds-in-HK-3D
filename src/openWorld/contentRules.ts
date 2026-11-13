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

/** Flowers of remembrance, mostly white. The database accepts exactly these (migration 0003). */
export type FlowerKind =
  | 'white-chrysanthemum' | 'lily' | 'white-rose' | 'white-carnation' | 'ginger-lily'
  | 'white-lotus' | 'white-orchid' | 'yellow-chrysanthemum' | 'lantern';
export const FLOWER_KINDS: readonly FlowerKind[] = [
  'white-chrysanthemum', 'lily', 'white-rose', 'white-carnation', 'ginger-lily',
  'white-lotus', 'white-orchid', 'yellow-chrysanthemum', 'lantern',
];

/**
 * Memorial ground: a circle around Wang Fuk Court in the Tai Po local frame
 * (metres; +x east, +z south; origin = the Tai Po region centre at the estate).
 * Flowers may be laid anywhere on the estate grounds and the streets around it.
 */
export const MEMORIAL_CENTRE = Object.freeze({ x: 18, z: 22 });
export const MEMORIAL_RADIUS = 190;

/**
 * The small level square in the open ground north of 宏建閣 (Block D), clear of
 * every tower, where birds are guided to land and lay their flowers.
 */
export const MEMORIAL_PLAZA = Object.freeze({ x: 28, z: -6, radius: 18 });

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

/**
 * Words this place is not for. The memorial is for grief, remembrance and thanks;
 * slogans and political demands are turned away gently, for everyone alike, so the
 * place stays quiet and the people who run it are not made to publish them.
 *
 * DRAFT for the project owner to review: slogans and demands that Hong Kong courts or
 * the government have said carry secessionist or seditious meaning, and the fire-related
 * "demands" wording that has led to arrests. Simplified forms and English are included.
 * Spacing and separators are ignored when matching (see containsTerm).
 */
const NOT_FOR_MEMORIAL_TERMS = [
  '光復香港', '光复香港', '時代革命', '时代革命', '光時', '光时',
  '香港獨立', '香港独立', '港獨', '港独',
  '五大訴求', '五大诉求', '四大訴求', '四大诉求', '缺一不可',
  '攬炒', '揽炒', '天滅中共', '天灭中共', '結束一黨專政', '结束一党专政',
  '榮光歸香港', '荣光归香港',
  'liberatehongkong', 'revolutionofourtimes', 'hongkongindependence', 'fivedemands', 'freehongkong', 'standwithhongkong',
];

/**
 * Words anyone can leave with one tap. They are about the people, not about blame,
 * so they are shared with everyone at once instead of waiting to be read first.
 */
export const PRESET_WORDS: readonly string[] = Object.freeze([
  '願你們安息',
  '我們會記得你們',
  '願天使們安好',
  '願家人平安',
  '一路好走',
  '多謝消防員和救援人員',
]);

/** The only lines said over the birds (Enter / 說話): the same gentle words, nothing typed freely. */
export const SPEECH_LINES: readonly string[] = PRESET_WORDS;

export function isSpeechLine(text: string): boolean {
  return SPEECH_LINES.includes(normaliseText(text));
}

export function isPresetWords(text: string): boolean {
  return PRESET_WORDS.includes(normaliseText(text));
}

const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|hk|io|cn|xyz|top|ly|me)\b)/i;
const PHONE_PATTERN = /(?:\+?852[\s-]?)?\b[2-9]\d{3}[\s-]?\d{4}\b/;
// Control characters and invisible formatting marks used to dodge filters.
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export type RejectReason = 'empty' | 'too-long' | 'blocked-word' | 'not-for-memorial' | 'link' | 'phone';

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

function containsTerm(text: string, terms: readonly string[]): boolean {
  // Remove spacing and common separators so "f u c k", "仆.街" and "光 復 香 港" are still caught.
  const squeezed = text.toLowerCase().replace(/[\s._\-*·,，、。!！?？'"「」『』()（）]+/g, '');
  return terms.some(term => squeezed.includes(term));
}

export function checkText(input: unknown, maxLength: number, { required }: { required: boolean }): TextCheck {
  const text = normaliseText(input);
  if (!text) return required ? { ok: false, text, reason: 'empty' } : { ok: true, text };
  if ([...text].length > maxLength) return { ok: false, text, reason: 'too-long' };
  if (containsTerm(text, BLOCKED_TERMS)) return { ok: false, text, reason: 'blocked-word' };
  if (containsTerm(text, NOT_FOR_MEMORIAL_TERMS)) return { ok: false, text, reason: 'not-for-memorial' };
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
    case 'not-for-memorial': return '這裡是悼念的地方，請不要寫口號或政治訴求。';
    case 'link': return '為保障大家，留言不可以包含網址。';
    case 'phone': return '為保障私隱，留言不可以包含電話號碼。';
    default: return '未能接受這段內容。';
  }
}
