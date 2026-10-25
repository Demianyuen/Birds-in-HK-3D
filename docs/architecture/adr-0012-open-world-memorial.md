# ADR 0012: Open-World Memorial On Supabase And Vercel Functions

## Status

Accepted (2026-10-25)

## Context

The project owner wants a shared, open world rather than a single-player game
with an invitable server: visitors enter a name and a message on the landing
page, carry a flower to Wang Fuk Court, lay it on the estate grounds, see other
birds live, and talk. The standalone WebSocket world server (ADR-era protocol 2)
was never deployed and would need separate hosting.

Decisions taken with the owner (2026-10-25): flowers and names appear at once;
written messages are pre-moderated; use the existing Supabase project; include
live chat.

## Decision

- Storage in Supabase (`memorial_flowers`, `memorial_chat`) with row-level
  security; visitors read only a public view and recent visible chat.
- All writes through Vercel functions (`api/flowers.ts`, `api/chat.ts`,
  `api/moderate.ts`) holding the service-role key: shared content rules
  (`src/openWorld/contentRules.ts`), rate limits by salted IP hash.
- Presence and poses over a Supabase Realtime channel from the browser; chat
  delivered as Realtime database inserts so the server-side filter cannot be
  bypassed.
- On the ground the bird is life-size (ADR-less change in `BirdController`), so
  flowers are modelled at real size with a ground glow visible from the air.
- The realtime client is code-split and loaded only when joining.
- The legacy WebSocket panel remains for local development when Supabase is
  not configured.

## Consequences

- No game server to host; Supabase free-tier Realtime limits (connections,
  messages per second) cap concurrency — poses are throttled to 4 Hz and skipped
  while idle.
- Messages need a human moderator (`/moderate.html`).
- Presence names are filtered client-side only; abuse is limited by length and
  the filter, and names are not authenticated identities.
- Flower positions are trusted within the memorial radius; a determined user
  could place a flower anywhere on the estate grounds, which is the intent.
