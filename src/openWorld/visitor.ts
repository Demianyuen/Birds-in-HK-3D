import { checkMessage, checkName, isFlowerKind, rejectReasonText, type FlowerKind } from './contentRules';

/** What the visitor brings into the world from the landing page. */
export interface Visitor {
  /** Stable per-browser id for live presence (not an identity). */
  id: string;
  name: string;
  message: string;
  kind: FlowerKind;
  /** True once their flower is laid (one per visit). */
  placed: boolean;
}

const NAME_KEY = 'birds-in-hk:name';
const ID_KEY = 'birds-in-hk:visitor-id';

export const FLOWER_LABELS: Readonly<Record<FlowerKind, string>> = Object.freeze({
  'white-chrysanthemum': '白菊',
  'yellow-chrysanthemum': '黃菊',
  lily: '白百合',
  lantern: '紙燈',
});

/** Validates the landing-page form; returns the visitor or a message to show. */
export function readVisitorForm(name: unknown, message: unknown, kind: unknown): { visitor?: Visitor; error?: string } {
  const checkedName = checkName(name);
  if (!checkedName.ok) return { error: `名字：${rejectReasonText(checkedName.reason)}` };
  const checkedMessage = checkMessage(message);
  if (!checkedMessage.ok) return { error: `留言：${rejectReasonText(checkedMessage.reason)}` };
  if (!isFlowerKind(kind)) return { error: '請選擇一種花。' };
  remember(NAME_KEY, checkedName.text);
  return {
    visitor: {
      id: visitorId(),
      name: checkedName.text,
      message: checkedMessage.text,
      kind,
      placed: false,
    },
  };
}

export function rememberedName(): string {
  return recall(NAME_KEY) ?? '';
}

function visitorId(): string {
  const existing = recall(ID_KEY);
  if (existing && /^[a-z0-9-]{8,40}$/.test(existing)) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  remember(ID_KEY, id);
  return id;
}

// localStorage is a per-browser convenience only; it can be unavailable.
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode, blocked storage */ }
}

function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
