# Birds in HK · shared-sky relay

A Cloudflare Worker with one Durable Object per zone room. It carries poses, who is here and
lines said nearby, so many birds can share the sky (Supabase Realtime's free plan allows only
100 messages a second for the whole project). Flowers and moderation stay on Supabase + Vercel.

## Deploy (once, from your computer)

```bash
cd relay
npm install
npx wrangler login                 # opens the browser; a free Cloudflare account is enough
npx wrangler deploy                # prints https://birds-in-hk-sky.<your-subdomain>.workers.dev
npx wrangler secret put RELAY_SECRET   # paste a long random string (keep it for Vercel below)
```

Then in Vercel → Settings → Environment Variables (Production **and** Preview), add:

| Name | Value |
| --- | --- |
| `VITE_SKY_RELAY_URL` | `wss://birds-in-hk-sky.<your-subdomain>.workers.dev` |
| `SKY_RELAY_HTTP_URL` | `https://birds-in-hk-sky.<your-subdomain>.workers.dev` |
| `SKY_RELAY_SECRET` | the same string as `RELAY_SECRET` |

Redeploy the site. Without `VITE_SKY_RELAY_URL` the site falls back to Supabase Realtime.

If the site is served from another address, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and deploy again.

## Cost

Durable Objects run on the Workers Free plan (SQLite-backed): 100,000 requests a day. Each socket
opened is a request, incoming messages count 20 to a request, and messages sent out are free. One bird
flying at 4 poses a second costs about 0.2 requests a second, so 50 birds flying together for three
hours is about 108,000 requests, a little over the free day. For the anniversary week, the Workers Paid
plan (1 million requests a month included) removes the worry. See Cloudflare's Durable Objects pricing page.

## Try it locally

```bash
npm run dev                          # http://127.0.0.1:8787, uses .dev.vars for RELAY_SECRET
node scripts/load-test.mjs 60 20     # 60 bots over Wang Fuk Court for 20 seconds
```

Measured locally: 60 birds fill rooms of 24, 24 and 12, and every pose arrives; 150 birds fill six rooms.
