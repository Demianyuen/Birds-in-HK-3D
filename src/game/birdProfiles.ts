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
    id: 'eagle', modelPath: '/models/eagle.glb', loadingLabel: 'Black kite',
    cruiseSpeed: 34, minimumSpeed: 13, maximumSpeed: 84, turnRate: 0.82, flapLift: 7.6,
  },
});

export function getBirdProfile(id: string | null | undefined): BirdProfile {
  return BIRD_PROFILES[id as BirdProfileId] ?? BIRD_PROFILES.pigeon;
}

/** Feather colours a visitor can choose for their bird. 'natural' keeps the species' own colours. */
export type PlumageId = 'natural' | 'white' | 'silver' | 'cream' | 'brown' | 'charcoal';

export interface Plumage {
  id: PlumageId;
  label: string;
  /** Main feather colour and the darker colour of wing tips, bars and tail band (display sRGB). */
  main: string;
  dark: string;
}

export const PLUMAGES: readonly Plumage[] = Object.freeze([
  { id: 'natural', label: '原色', main: '', dark: '' },
  { id: 'white', label: '純白', main: '#f4f4ef', dark: '#d9dbd6' },
  { id: 'silver', label: '銀灰', main: '#b9bfc6', dark: '#59606a' },
  { id: 'cream', label: '米白', main: '#eadfc8', dark: '#b39f7e' },
  { id: 'brown', label: '啡褐', main: '#8a6a4f', dark: '#3e2e22' },
  { id: 'charcoal', label: '墨黑', main: '#4a4d52', dark: '#1d1f22' },
]);

export function getPlumage(id: string | null | undefined): Plumage {
  return PLUMAGES.find(plumage => plumage.id === id) ?? PLUMAGES[0];
}
