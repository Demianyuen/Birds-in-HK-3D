import { describe, expect, it } from 'vitest';
import {
  checkChat,
  checkMessage,
  checkName,
  insideMemorialGround,
  isFlowerKind,
  MEMORIAL_CENTRE,
  MEMORIAL_RADIUS,
  MESSAGE_MAX,
} from '../src/openWorld/contentRules';
import { WANG_FUK_ADDRESS_POINTS, wangFukLocalMarkers } from '../src/game/wangFukLocations';
import { getFlightRegion } from '../src/game/regions';

describe('memorial content rules', () => {
  it('accepts ordinary words of remembrance in Chinese and English', () => {
    expect(checkMessage('願逝者安息，生者堅強。').ok).toBe(true);
    expect(checkMessage('We remember you, Tai Po.').ok).toBe(true);
    expect(checkName('陳太').ok).toBe(true);
    expect(checkName('').ok).toBe(true);
  });

  it('normalises whitespace and strips invisible characters', () => {
    expect(checkMessage('  安息​   \n 平安 ').text).toBe('安息 平安');
  });

  it('refuses profanity even when spaced out or disguised', () => {
    expect(checkMessage('仆 街').reason).toBe('blocked-word');
    expect(checkMessage('f.u.c.k this').reason).toBe('blocked-word');
    expect(checkName('ＦＵＣＫ').reason).toBe('blocked-word');
  });

  it('refuses links and phone numbers', () => {
    expect(checkMessage('see www.example.com').reason).toBe('link');
    expect(checkMessage('https://x.y/z').reason).toBe('link');
    expect(checkMessage('call 9123 4567').reason).toBe('phone');
    expect(checkChat('+852 6123-4567').reason).toBe('phone');
  });

  it('enforces lengths in characters, not bytes', () => {
    expect(checkMessage('念'.repeat(MESSAGE_MAX)).ok).toBe(true);
    expect(checkMessage('念'.repeat(MESSAGE_MAX + 1)).reason).toBe('too-long');
    expect(checkChat('   ').reason).toBe('empty');
  });

  it('knows the flower kinds', () => {
    expect(isFlowerKind('white-chrysanthemum')).toBe(true);
    expect(isFlowerKind('rose')).toBe(false);
  });

  it('places the memorial ground over all eight Wang Fuk Court blocks', () => {
    const region = getFlightRegion('tai-po');
    const markers = wangFukLocalMarkers(region.latitude, region.longitude);
    expect(markers).toHaveLength(WANG_FUK_ADDRESS_POINTS.length);
    for (const marker of markers) {
      expect(insideMemorialGround(marker.position.x, marker.position.z)).toBe(true);
      // Comfortably inside, so the grounds around each block are included too.
      expect(Math.hypot(marker.position.x - MEMORIAL_CENTRE.x, marker.position.z - MEMORIAL_CENTRE.z)).toBeLessThan(MEMORIAL_RADIUS - 80);
    }
    expect(insideMemorialGround(MEMORIAL_CENTRE.x + MEMORIAL_RADIUS + 1, MEMORIAL_CENTRE.z)).toBe(false);
    expect(insideMemorialGround(Number.NaN, 0)).toBe(false);
    expect(insideMemorialGround('0', 0)).toBe(false);
  });
});
