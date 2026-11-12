import { isFlowerKind } from '../../src/openWorld/contentRules.js';

/**
 * The flowers table was first made for four kinds, and its rule on `kind`
 * refuses any other. The white flowers added later are therefore stored as
 * a white chrysanthemum, with the real kind kept after the sender hash
 * ("<hash>~white-rose"), a column that is never shown to visitors. This
 * works whether or not migration 0003 has been run; 0004 tidies the rows
 * once the database can be changed.
 */
const FIRST_KINDS: readonly string[] = ['white-chrysanthemum', 'yellow-chrysanthemum', 'lily', 'lantern'];
const STAND_IN = 'white-chrysanthemum';
const MARK = '~';

/** What to write in the `kind` and `sender_hash` columns for a flower of this kind. */
export function storeKind(kind: string, sender: string): { kind: string; sender_hash: string } {
  return FIRST_KINDS.includes(kind) ? { kind, sender_hash: sender } : { kind: STAND_IN, sender_hash: `${sender}${MARK}${kind}` };
}

/** The kind a stored row really is. */
export function readKind(row: { kind?: unknown; sender_hash?: unknown }): string {
  const hash = typeof row.sender_hash === 'string' ? row.sender_hash : '';
  const kept = hash.includes(MARK) ? hash.slice(hash.indexOf(MARK) + 1) : '';
  if (kept && isFlowerKind(kept)) return kept;
  return typeof row.kind === 'string' ? row.kind : STAND_IN;
}

/** PostgREST filter matching every row from this sender, with or without a kept kind. */
export function senderFilter(sender: string): string {
  return `sender_hash=like.${sender}*`;
}
