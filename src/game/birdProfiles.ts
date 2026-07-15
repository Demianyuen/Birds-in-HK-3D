export type BirdProfileId = 'pigeon' | 'black-kite' | 'sparrow';

export interface BirdProfile {
  id: BirdProfileId;
  cruiseSpeed: number;
  minimumSpeed: number;
  maximumSpeed: number;
  turnRate: number;
  flapLift: number;
}

export const BIRD_PROFILES: Readonly<Record<BirdProfileId, BirdProfile>> = Object.freeze({
  pigeon: { id: 'pigeon', cruiseSpeed: 26, minimumSpeed: 9, maximumSpeed: 68, turnRate: 1.15, flapLift: 8.8 },
  'black-kite': { id: 'black-kite', cruiseSpeed: 31, minimumSpeed: 12, maximumSpeed: 78, turnRate: 0.9, flapLift: 7.2 },
  sparrow: { id: 'sparrow', cruiseSpeed: 22, minimumSpeed: 8, maximumSpeed: 58, turnRate: 1.35, flapLift: 9.6 },
});

export function getBirdProfile(id: string | null | undefined): BirdProfile {
  return BIRD_PROFILES[id as BirdProfileId] ?? BIRD_PROFILES.pigeon;
}
