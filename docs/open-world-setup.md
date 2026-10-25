# Open-world memorial: setup

Flowers, written messages, the shared sky (seeing other birds) and live chat
run on Supabase plus three Vercel functions. Without this configuration the
game still works as a single-player flight, and says so in the panel.

## 1. Database (once)

Supabase Dashboard → SQL Editor → New query → paste
`supabase/migrations/0001_open_world_memorial.sql` → Run.

It creates `memorial_flowers` and `memorial_chat`, turns on row-level
security, exposes only `memorial_flowers_public` (approved messages only) and
recent visible chat to visitors, and adds chat to Realtime.

## 2. Environment variables

Vercel → Project → Settings → Environment Variables (Production and Preview),
and the same names in `.env.local` for `npm run dev`:

| Name | Where it is used | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | Project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | anon / publishable key |
| `SUPABASE_URL` | server | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | service-role key — never expose |
| `MODERATOR_TOKEN` | server only | a long random password for `/moderate.html` |
| `RATE_LIMIT_SALT` | server only (optional) | any random string |

Redeploy after adding them (Vite embeds `VITE_*` at build time).

## 3. Moderation

Open `/moderate.html`, enter `MODERATOR_TOKEN`. Approve or reject written
messages (the flower stays unless you hide it), and review or hide the last
day of chat. Names and flowers appear immediately after the automatic filter;
messages appear only after approval.

## How it fits together

- `POST /api/flowers` — filter → rate limit (3 per visitor per 10 min) →
  insert with the service key. The visitor's IP is stored only as a salted hash.
- `GET /api/flowers` — reads the public view (cached 10 s at the edge).
- `POST /api/chat` — filter → rate limit (1 per 3 s, 20 per 10 min) → insert;
  everyone receives it through Realtime database changes, so the filter cannot
  be bypassed by a client.
- Presence and bird poses use a Realtime channel (`birds-in-hk:tai-po`)
  directly from the browser with the anon key; names are length-limited and
  filtered when shown.
