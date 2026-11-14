export type BirdProfileId = 'spotted' | 'pigeon' | 'dove' | 'sparrow' | 'magpie' | 'eagle';

export interface BirdProfile {
  id: BirdProfileId;
  /** Name shown to visitors, and a few words about the bird. */
  label: string;
  note: string;
  modelPath: string;
  loadingLabel: string;
  /** Main feather colour, used to tint this species when it is another visitor's bird. */
  colour: string;
  cruiseSpeed: number;
  minimumSpeed: number;
  maximumSpeed: number;
  turnRate: number;
  flapLift: number;
}

/** Birds seen every day in Hong Kong. Ids are plain lowercase letters (they travel between visitors). */
export const BIRD_PROFILES: Readonly<Record<BirdProfileId, BirdProfile>> = Object.freeze({
  spotted: {
    id: 'spotted', label: '珠頸斑鳩', note: '屋邨常見，性情溫馴', modelPath: '/models/pigeon.glb', loadingLabel: 'Spotted dove',
    colour: '#b79a8c', cruiseSpeed: 25, minimumSpeed: 8, maximumSpeed: 64, turnRate: 1.2, flapLift: 9,
  },
  pigeon: {
    id: 'pigeon', label: '灰鴿', note: '街頭的原鴿，拍翼與滑翔交替', modelPath: '/models/pigeon.glb', loadingLabel: 'Pigeon',
    colour: '#97a0ad', cruiseSpeed: 26, minimumSpeed: 9, maximumSpeed: 68, turnRate: 1.15, flapLift: 8.8,
  },
  dove: {
    id: 'dove', label: '白鴿', note: '和平白鴿，輕盈穩定', modelPath: '/models/dove.glb', loadingLabel: 'Dove',
    colour: '#f4f4ef', cruiseSpeed: 24, minimumSpeed: 8, maximumSpeed: 62, turnRate: 1.2, flapLift: 9.2,
  },
  sparrow: {
    id: 'sparrow', label: '麻雀', note: '細小靈活，成群出沒', modelPath: '/models/pigeon.glb', loadingLabel: 'Tree sparrow',
    colour: '#a47a52', cruiseSpeed: 22, minimumSpeed: 7, maximumSpeed: 56, turnRate: 1.45, flapLift: 10,
  },
  magpie: {
    id: 'magpie', label: '喜鵲', note: '黑白分明，長尾，報喜的鳥', modelPath: '/models/pigeon.glb', loadingLabel: 'Magpie',
    colour: '#3a3f4a', cruiseSpeed: 27, minimumSpeed: 9, maximumSpeed: 68, turnRate: 1.1, flapLift: 8.6,
  },
  eagle: {
    id: 'eagle', label: '麻鷹', note: '長翼，高空盤旋滑翔', modelPath: '/models/eagle.glb', loadingLabel: 'Black kite',
    colour: '#6a4e35', cruiseSpeed: 34, minimumSpeed: 13, maximumSpeed: 84, turnRate: 0.82, flapLift: 7.6,
  },
});

export const BIRD_ORDER: readonly BirdProfileId[] = ['spotted', 'pigeon', 'dove', 'sparrow', 'magpie', 'eagle'];

export function isBirdProfileId(id: unknown): id is BirdProfileId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BIRD_PROFILES, id);
}

export function getBirdProfile(id: string | null | undefined): BirdProfile {
  return isBirdProfileId(id) ? BIRD_PROFILES[id] : BIRD_PROFILES.spotted;
}

/** Feather tints (no longer offered to visitors: each species keeps its own colours). 'natural' keeps the species' own colours. */
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
