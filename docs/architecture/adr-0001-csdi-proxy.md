# ADR-0001: Server-side CSDI Proxy

## Status

Accepted — 2026-07-14

## Decision

The browser requests same-origin `/csdi-3d/*`; Vite rewrites requests to the official WGS84 API and appends the API key from `.env.local` server-side.

## Rationale

CSDI responses do not provide localhost CORS headers. The key must not be committed or entered through the game UI.

## Validation

- Root JSON, nested JSON, and B3DM requests return 200 through the proxy.
- Source and distribution bundles contain no key.
- `.env.local` is ignored by Git.
