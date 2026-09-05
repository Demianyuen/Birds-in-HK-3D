# Multiplayer world implementation checkpoint

## Implemented locally

- Standalone Node WebSocket server: `npm run world:server`.
- `ws://127.0.0.1:8787/world`, with HTTP `/health`.
- Server-assigned guest identity, rooms, 10 Hz snapshots, validated pose updates.
- Room and 150 metre nearby text chat; 280 characters maximum and one accepted message per second.
- Same-world target and admission limit: 100 participants; connection limit 128. These are protective configuration limits, **not measured production capacity claims**.
- Disconnect cleanup, ping/pong heartbeat, bounded payload and output backpressure.
- Explicit browser origin allowlist; default only local development origins.
- Real socket tests: `npm run qa:multiplayer`.
- Browser client now connects from the game panel after CSDI flight entry.
- Remote white bird representations interpolate peer snapshots; self is excluded.
- Nickname/room inputs, online list, room/nearby text chat, per-session mute and manual rejoin.
- Chat is rendered as text, bounded to 60 local entries; chat input does not trigger flight keys.
- Local two-browser Playwright run passed real CSDI flight entry, two guests in one room, literal HTML-like chat text, leave/rejoin and 390x844 width check.
- Screenshots were inspected at 1280x800 and 390x844. Map detail and bird visual quality still need improvement; this was not historical reconstruction acceptance.

## Configuration

`PORT` defaults to 8787; `WORLD_HOST` defaults to loopback.
`WORLD_ORIGINS` is a comma-separated exact origin allowlist.
Public hosting needs TLS/WSS termination and an explicit allowed frontend origin.
No CSDI credential is needed by this server.

## Not yet implemented or verified

- Persistent blocking/moderation and world-space nickname labels.
- Durable cross-restart session recovery; the implemented short-lived guest resume is memory-only.
- Durable account login and identity verification; nicknames are not authenticated identities.
- Server-authoritative movement/collision simulation. Current server validates reported poses against bounds and displacement limits, but does not simulate terrain or building collision.
- Distributed room routing, long-duration/WAN load testing, production hosting and remote-device acceptance.
- Historical building reconstruction. The material-only preservation/reference switch is implemented and browser tested, not historical reconstruction completion.

The server is an in-memory single process; restarts lose guests and rooms.
Do not present the guest protocol as a completed online game or an anti-cheat system.
Existing Vercel HTTP map proxies remain separate from this server.

For local play start both `npm run dev` and `npm run world:server`.
The development frontend defaults to the loopback WebSocket address.
Set `VITE_WORLD_SERVER_URL` to an explicit WSS endpoint for production.
Without it, production shows that multiplayer is unconfigured; it does not connect to a player's localhost.

## Required final acceptance

100 simultaneous users must be supported in the same open world, not split into two-player rooms.
Two independent browsers are only the functional smoke test: enter the same world, see each other's birds
move, exchange room/nearby messages, and recover from disconnection.
Cross-room isolation, capacity under measured load, input focus while chatting,
mobile layout, building collision and layer switching must be verified.
Keep all public scenes free of fire assets/effects.

The capacity test uses 100 real loopback sockets to exercise simultaneous admission
and full-world snapshots, with guest 101 rejected. Sustained moving/chatting load,
WAN latency, authenticated login and rendering 99 peers remain separate required gates.

## 100-player sustained loopback benchmark (local date 2026-09-06)

Command: `npm run qa:world-load`. This creates an isolated loopback server
and 100 real sockets in the same Node process; it cannot target production.
Default duration is 30 seconds. `WORLD_LOAD_SECONDS` allows 10–300 seconds.
Each client submits movement at a nominal 10 Hz; the world receives about
10 room-chat messages per second, distributed across all participants.
The report records achieved delivery rates rather than assuming timer frequency.

Before shared snapshot serialization:
`runtime-evidence/world-load-2026-09-05T17-02-55-955Z.json`

After serializing once per room per tick:
`runtime-evidence/world-load-2026-09-05T17-04-30-228Z.json`

Both runs: 100 guests, 27,500 pose sends, 275 chats delivered to every client,
minimum 279 full-world snapshots per client, zero disconnections/protocol errors.
After-change run: snapshot age p95 30 ms, combined event-loop delay p95 28.77 ms,
aggregate payload receive traffic 94.93 Mbit/s, combined RSS 116.96 MiB.
File timestamps are UTC; the local run date was September 6.

This is a short loopback functionality/load baseline, not a public-host capacity claim.
The before/after snapshot p95 changed from 25 to 30 ms: do not claim a proven
latency gain from these two samples. The code removes redundant serialization,
but bandwidth is unchanged. Next work must reduce payload cost and verify browser
rendering, authenticated login, reconnect and public WSS hosting.

## Compact motion protocol (v2)

Full rosters are sent on membership changes and approximately once per second.
Other 10 Hz ticks carry ordered numeric absolute poses without repeated names,
IDs or object field names. Each frame has a roster revision; clients reject
frames for a different roster or malformed/truncated pose arrays atomically.
All 100 participants remain represented; there is no two-player-room split.
Frontend and world server must be updated together to protocol 2.

Evidence: `runtime-evidence/world-load-2026-09-05T17-09-48-613Z.json`
(UTC timestamp; local date September 6).
Same 100-guest 30-second workload: 27,500 poses, 275 chats per recipient,
minimum 278 decoded state frames per client, zero disconnects/protocol errors.
Aggregate payload traffic was 26.80 Mbit/s, snapshot age p95 25 ms,
combined event-loop p95 23.86 ms. Combined process RSS was 230.95 MiB,
higher than the previous short run: memory stability still needs a soak test.
These measurements include server and all simulated clients in one process.

The local two-browser flow was rerun against v2 and passed CSDI flight entry,
high-detail map readiness, reference/preservation switching, literal text chat,
leave/rejoin and mobile-width checks. Full test suite: 82 tests passed; build passed.

## Instanced remote flock

Remote birds now share 9 instanced draw batches and 5 geometry resources rather
than allocating a complete mesh/material hierarchy for each peer. Each peer
retains its own smoothed pose, wing phase and perched state. Remote birds do
not cast shadows; the local player's model and world shadows remain unchanged.

An isolated Chromium render probe with 99 birds at 1280x800 recorded:
9 draw calls, 87,120 triangles, 5 geometries, 0 textures; median frame interval
6.9 ms over 120 frames on this host. This is a synthetic flock-only probe,
not an FPS promise for the complete game or mobile devices.
Evidence is in the local temporary files `birds-flock-99.json` and
`birds-flock-99.png`. The screenshot was inspected.

The real CSDI two-browser smoke flow passed again after the renderer change.
83 unit/integration tests and build passed. The remaining capacity gate is
100 connected participants plus the complete map in a real browser, followed
by WAN and longer-duration tests on the intended server hardware.

## Combined CSDI + 100-participant browser probe

Local test: one headless Chromium browser at 1280x800 renders the actual CSDI
world and joins 99 real loopback bot sockets in `tai-po-load100`. Bots submit
movement around the observing player and send room chat. This is not 100 real
devices, not account login, and not WAN traffic.

The first 20-second run found an actual UI failure: the 99-person roster pushed
chat below the viewport. Player names now occupy a separately scrollable bounded
list. The same probe passed after the fix:

- 100 participants, zero page/protocol errors and zero unexpected disconnections.
- Browser chat reached the socket clients.
- Chat input remained visible before scrolling.
- Recorded HUD samples: minimum 37 FPS, median 41 FPS on this workstation.
- Evidence in local temporary files `birds-world-100.json` and `birds-world-100.png`;
  screenshot inspected against the actual CSDI scene.
- 83 tests and build passed after the UI fix.

Remaining gates include longer soak tests, varied network conditions, mobile
100-participant rendering, actual account login and a deployed WSS server.

## Two-minute loopback run

Evidence: `runtime-evidence/world-load-2026-09-05T17-32-27-726Z.json`
(local date September 6). 100 participants for 120.31 seconds:
109,900 pose sends, all 1,099 room messages delivered to every client,
minimum 1,102 decoded state frames per client, zero disconnects/protocol errors.
Snapshot age p95 23 ms; aggregate payload traffic 27.21 Mbit/s.

Combined client/server RSS samples increased from 203.55 MiB at 10 seconds
to 214.72 MiB at 120 seconds; final RSS was 217.59 MiB. Heap samples oscillated
with collection. This does not prove leak-free long-term behavior: the load
driver itself retains latency samples, and clients/server share one process.
Separate-process and longer production-host testing remain required.

The game now exposes the verified estate metadata and missing historical evidence
in a collapsible heritage panel. Browser checks opened it and confirmed the eight
published names, then completed the existing real-map/multiplayer smoke flow.
83 tests and build passed.

## Guest transport recovery

Unexpected transport loss retries at 1/2/4/8/8 second delays, then stops.
Disconnected guest sessions expire after two minutes and the server caps stored
sessions at 512. A successful resume restores identity, server-saved pose and
perched state; manual rejoin is a new guest session at the launch point.
Explicit leave revokes the resume credential and cancels client retries.
Credentials stay in memory, are not placed in local storage, and are stripped
from application/UI callbacks. Chat rate state survives a resume.

Tests deliberately terminated a real client socket, verified the same identity
and saved position after automatic reconnect, and verified explicit leave revoked
the credential. A two-browser run also closed the actual browser world socket,
observed resumed identity, and completed normal chat/leave/rejoin and map-layer
checks. 86 tests and build passed.

This is not verified account login. Server restarts discard sessions; full rooms
can reject re-entry; data missed while offline is not replayed. Longer outages
require explicit rejoin. Flight velocity is reset when restoring the saved pose.

## Mobile controls

Added on-screen turn, pitch, speed and flap controls for coarse pointers or
small viewports. Held controls release on pointer-up/cancel/lost capture;
opening chat hides the pad and releases its held inputs. Keyboard activation
of these buttons is supported without triggering global flight shortcuts.

A 390x844 browser probe entered the real CSDI world, held and released a turn,
tapped flap, opened/closed chat and verified pad visibility. The screenshot
`birds-touch-controls.png` in local temporary storage was inspected. This is
an emulated mobile browser, not a physical-device hundred-player acceptance.
86 tests and build passed.
