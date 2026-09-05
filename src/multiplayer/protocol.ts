export type Position = [number, number, number];
// Product target and admission boundary; not a claim of tested WAN/render capacity.
export const WORLD_PLAYER_LIMIT = 100;
export type Rotation = [number, number, number, number];
export interface WorldPlayer {
  id: string;
  name: string;
  position: Position;
  quaternion: Rotation;
  perched: boolean;
}
export type ServerMessage =
  | { type: 'welcome'; id: string; room: string; protocol: 2; resumeToken?: string; resumed?: boolean; player?: WorldPlayer }
  | { type: 'snapshot'; players: WorldPlayer[]; time: number; revision: number }
  | { type: 'motion'; poses: number[][]; time: number; revision: number }
  | { type: 'chat'; senderId: string; name: string; text: string; scope: 'room' | 'nearby'; time: number }
  | { type: 'error'; code: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteTuple(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

export function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return text.length > 0 && text.length <= maximum ? text : null;
}
