# ADR-0015: Our own relay for the shared sky

Status: accepted (supersedes the transport part of ADR-0014)

## Context
Supabase Realtime counts every WebSocket message sent to or from a client as an event and allows
100 a second on the free plan (500 on Pro, 2,500 on Team). A room of n birds sending r poses a second
makes about n² × r events a second, so six birds flying together at 4 a second already exceed the
free plan, and the connection is cut. The anniversary needs well over 50 birds at once.

## Decision
- Poses, presence and lines said nearby go through `relay/`: a Cloudflare Worker with one Durable Object
  per zone room (`<zone>:<room>`), using the WebSocket Hibernation API. Zones, rooms of 24 and
  smoothing stay as in ADR-0014; rooms per zone rise from 6 to 12.
- Lines said nearby are still written through `/api/chat` (filter, rate limit, stored for moderators);
  the API then posts the filtered line to the relay with a shared secret. Clients cannot broadcast text.
- The browser uses the relay when `VITE_SKY_RELAY_URL` is set and falls back to Supabase Realtime otherwise.
- The relay checks the page's Origin, caps poses at 6 a second per bird and messages at 600 bytes.

## Consequences
- Load tested locally: 60 birds (rooms of 24/24/12) and 150 birds (six full rooms), every pose delivered.
- Cost: incoming messages are billed 20 to a request, outgoing ones are free; see relay/README.md.
- One more service to deploy (Cloudflare account, `wrangler deploy`, three Vercel variables).
