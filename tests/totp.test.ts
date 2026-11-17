import { describe, expect, it } from 'vitest';
import { base32Decode, checkSession, checkTotp, issueSession, totpAt } from '../api/_lib/totp';

// RFC 6238 test secret "12345678901234567890" (ASCII), base32.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('moderator two-step sign-in', () => {
  it('matches the RFC 6238 test vectors', () => {
    const key = base32Decode(SECRET);
    expect(key.toString('ascii')).toBe('12345678901234567890');
    expect(totpAt(key, 59, 8)).toBe('94287082');
    expect(totpAt(key, 1111111109, 8)).toBe('07081804');
    expect(totpAt(key, 59)).toBe('287082');
  });

  it('accepts the code a step either side, nothing further', () => {
    expect(checkTotp(SECRET, '287082', 59)).toBe(true);
    expect(checkTotp(SECRET, '287082', 59 + 30)).toBe(true);
    expect(checkTotp(SECRET, '287082', 59 + 90)).toBe(false);
    expect(checkTotp(SECRET, '28708', 59)).toBe(false);
  });

  it('issues a session that expires and ends when the password or secret changes', () => {
    const now = 1_800_000_000_000;
    const session = issueSession('a-long-password-123', SECRET, now);
    expect(checkSession(session, 'a-long-password-123', SECRET, now + 3_600_000)).toBe(true);
    expect(checkSession(session, 'a-long-password-123', SECRET, now + 13 * 3_600_000)).toBe(false);
    expect(checkSession(session, 'another-password-456', SECRET, now)).toBe(false);
    expect(checkSession(session, 'a-long-password-123', 'JBSWY3DPEHPK3PXP', now)).toBe(false);
    expect(checkSession('a-long-password-123', 'a-long-password-123', SECRET, now)).toBe(false);
  });
});
