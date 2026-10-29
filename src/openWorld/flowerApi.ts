import { isFlowerKind, type FlowerKind } from './contentRules';

export interface MemorialFlower {
  id: string;
  createdAt: string;
  name: string;
  /** Empty unless a moderator approved it. */
  message: string;
  kind: FlowerKind;
  x: number;
  y: number;
  z: number;
}

/** The service answered "no" (4xx: not allowed, too many) rather than being unreachable or broken. */
export class FlowerRefused extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'FlowerRefused';
  }
}

export interface PlacedFlower {
  flower: MemorialFlower;
  messageStatus: 'none' | 'pending';
}

function parseFlower(value: unknown): MemorialFlower | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !isFlowerKind(row.kind)) return null;
  const x = Number(row.x);
  const y = Number(row.y ?? 0);
  const z = Number(row.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return {
    id: row.id,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    name: typeof row.name === 'string' ? row.name : '',
    message: typeof row.message === 'string' ? row.message : '',
    kind: row.kind,
    x,
    y,
    z,
  };
}

export async function fetchFlowers(signal?: AbortSignal): Promise<MemorialFlower[]> {
  const response = await fetch('/api/flowers', { signal });
  if (!response.ok) throw new Error(`Flowers unavailable (HTTP ${response.status}).`);
  const data = (await response.json()) as { flowers?: unknown[] };
  return (data.flowers ?? []).map(parseFlower).filter((flower): flower is MemorialFlower => flower !== null);
}

export async function placeFlower(input: {
  name: string;
  message: string;
  kind: FlowerKind;
  x: number;
  y: number;
  z: number;
}): Promise<PlacedFlower> {
  const response = await fetch('/api/flowers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const reason = typeof data.error === 'string' ? data.error : '未能放下花，請稍後再試。';
    // Only a clear refusal discards the flower; a broken or unreachable service keeps it to try again.
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 404) {
      throw new FlowerRefused(reason, response.status);
    }
    throw new Error(reason);
  }
  const flower = parseFlower(data.flower);
  if (!flower) throw new Error('未能放下花，請稍後再試。');
  return { flower: { ...flower, name: input.name }, messageStatus: data.messageStatus === 'pending' ? 'pending' : 'none' };
}

export async function sendChat(input: { name: string; body: string; x: number; z: number }): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(typeof data.error === 'string' ? data.error : '訊息未能送出。');
  }
}
