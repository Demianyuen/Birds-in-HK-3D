# ADR-0014: Shared sky in zones and rooms, with smoothed poses

Status: accepted (stage 2 of the shared-space plan)

## Context
Stage 1 put every bird in one Supabase Realtime channel, each sending its pose four times a second and everyone receiving everyone. That is fine for a few dozen visitors, but presence sync and fan-out grow with the square of the crowd, and a crowded sky over Wang Fuk Court is not the quiet place we want.

## Decision
- **Zones.** The sky is divided into a circle around Wang Fuk Court (420 m) and 800 m grid cells elsewhere (`src/openWorld/zones.ts`). A bird announces itself and sends its pose only in the zone it is over, and listens to the zones within 350 m, letting go beyond 500 m (so border flights do not flap).
- **Rooms.** Each zone is split into rooms of 24 birds. An arrival tries room 1, 2, ... until one has space (max 6). Birds already flying across a border may take a room slightly over the cap; arrivals never do. Birds in different rooms never see each other, by design.
- **Rates.** Moving birds send 4 poses a second when flying and 2 when walking; a still bird sends only a heartbeat every 4 s (turning on the spot counts as moving).
- **Smoothing.** `PoseBuffer` draws each bird about 1.5 message gaps in the past, interpolating positions and slerping headings, extrapolates for at most half a second if a message is late, and does not glide across jumps over 400 m.
- **No server of our own.** Still Supabase Realtime (presence + broadcast) per zone-room channel, named `birds-in-hk:z:<zone>:r<room>`. Chat stays on the database-insert path so the filter cannot be bypassed.
- **Flowers are never lost.** A flower laid while the service is unreachable stays where it was laid, is kept in this browser, and is sent on whenever the service answers. Only a clear refusal (4xx) takes it back.

## Consequences
- Cost scales with the number of rooms in use, not the total audience; hundreds of visitors spread over many rooms are cheap on Supabase.
- Presence counts are per zone-room ("宏福苑一帶此刻有 N 位同在"); there is no global count.
- Room choice is decided on the client by probing presence, so two arrivals at the same instant can both land in the last free place. The cap is a soft limit; the renderer draws the nearest 30 regardless.
- When one room per zone is no longer enough for the audience (thousands at once), move rooms to a Cloudflare Durable Object / Colyseus room server with the same zone and room names (stage 3); the client protocol (zone, room, pose message) does not change.
