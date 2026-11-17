import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Two-step sign-in for the moderation page: the password plus a six-digit code from an
 * authenticator app (RFC 6238 TOTP: HMAC-SHA1, 30-second steps), then a signed session
 * that lasts a working day, so the code is asked once, not on every click.
 */
const STEP_SECONDS = 30;
export const SESSION_HOURS = 12;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not base32.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: Buffer, unixSeconds: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / STEP_SECONDS)));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/** The code now, or one step either side (a phone clock a little off). */
export function checkTotp(secretBase32: string, code: string, unixSeconds = Date.now() / 1_000): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  return [-1, 0, 1].some(step => safeEqual(totpAt(secret, unixSeconds + step * STEP_SECONDS), code));
}

function sessionKey(password: string, secretBase32: string): Buffer {
  return createHmac('sha256', password).update(`moderator-session:${secretBase32}`).digest();
}

export function issueSession(password: string, secretBase32: string, nowMs = Date.now()): string {
  const expires = String(nowMs + SESSION_HOURS * 3_600_000);
  const signature = createHmac('sha256', sessionKey(password, secretBase32)).update(expires).digest('base64url');
  return `s.${expires}.${signature}`;
}

/** Changing the password or the authenticator secret ends every session. */
export function checkSession(token: string, password: string, secretBase32: string, nowMs = Date.now()): boolean {
  const match = /^s\.(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!match || Number(match[1]) < nowMs) return false;
  const expected = createHmac('sha256', sessionKey(password, secretBase32)).update(match[1]).digest('base64url');
  return safeEqual(expected, match[2]);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
