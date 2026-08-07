export type BirdProfileId = 'pigeon' | 'dove' | 'eagle';

export interface BirdProfile {
  id: BirdProfileId;
  modelPath: string;
  loadingLabel: string;
  cruiseSpeed: number;
  minimumSpeed: number;
  maximumSpeed: number;
  turnRate: number;
  flapLift: number;
}

export const BIRD_PROFILES: Readonly<Record<BirdProfileId, BirdProfile>> = Object.freeze({
  pigeon: {
    id: 'pigeon', modelPath: '/models/pigeon.glb', loadingLabel: 'Pigeon',
    cruiseSpeed: 26, minimumSpeed: 9, maximumSpeed: 68, turnRate: 1.15, flapLift: 8.8,
  },
  dove: {
    id: 'dove', modelPath: '/models/dove.glb', loadingLabel: 'Dove',
    cruiseSpeed: 24, minimumSpeed: 8, maximumSpeed: 62, turnRate: 1.2, flapLift: 9.2,
  },
  eagle: {
    id: 'eagle', modelPath: '/models/eagle.glb', loadingLabel: 'Eagle',
    cruiseSpeed: 34, minimumSpeed: 13, maximumSpeed: 84, turnRate: 0.82, flapLift: 7.6,
  },
});

export function getBirdProfile(id: string | null | undefined): BirdProfile {
  return BIRD_PROFILES[id as BirdProfileId] ?? BIRD_PROFILES.pigeon;
}
