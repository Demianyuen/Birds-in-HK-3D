import type { Position, Rotation, WorldPlayer } from '../multiplayer/protocol';

export type LiveStatus = 'connecting' | 'online' | 'offline';

export interface ChatLine {
  id: number;
  name: string;
  body: string;
  x: number;
  z: number;
  /** Id of the bird that said it (empty on rows from before ids were stored). */
  speaker: string;
  createdAt: string;
}

/** The shared sky, whichever service carries it (our relay, or Supabase Realtime). */
export interface SkyLink {
  connect(): void;
  sendPose(position: Position, quaternion: Rotation, perched: boolean): void;
  snapshot(now?: number): WorldPlayer[];
  prune(now?: number): void;
  readonly nearbyCount: number;
  readonly homeZone: string;
  readonly homeLabel: string;
  readonly currentRoom: number;
  dispose(): void;
}

export interface SkyEvents {
  onStatus: (status: LiveStatus) => void;
  onChat: (line: ChatLine) => void;
}
