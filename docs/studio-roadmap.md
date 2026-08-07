# Unified Art Studio

## Current implementation

`/studio.html` is a Three.js work surface for the current operating roles:

- 豆豆: CFO / Codex orchestration and delivery tracking
- 念念: CEO / Hermes direction and handoff boundary
- 地圖工坊: CSDI world pipeline subagent
- 驗收小屋: runtime evidence and QA subagent
- 模型工坊: pigeon, dove, and eagle asset subagent

The village is an original low-poly scene. It borrows the status-to-place interaction idea from agent dashboards, but it does not reuse third-party office art assets.

The first render uses a checked project snapshot. When `runtime-evidence/studio-state.json` exists and passes the public schema, `/api/studio-state` exposes its sanitized fields and the client refreshes them every 15 seconds.

## Local state feed

Update one visible role from the project root:

```powershell
npm run studio:state -- dou-dou working "驗證 dashboard" "Codex runtime"
```

Allowed agents:

`dou-dou`, `nian-nian`, `map-agent`, `qa-agent`, `asset-agent`

Allowed states:

`working`, `reviewing`, `handoff`, `done`, `waiting`, `blocked`, `offline`

The updater and server both reject unknown identities, oversized values, and credential-like text. The runtime file is ignored by Git.

## Hermes bridge boundary

A future Hermes adapter may write only this shape:

```json
{
  "source": "local-feed",
  "updatedAt": "2026-07-22T14:00:00.000Z",
  "agents": [
    {
      "id": "nian-nian",
      "state": "handoff",
      "task": "準備 Birds in HK 下一輪方向交接",
      "runtime": "Hermes runtime",
      "updatedAt": "2026-07-22T14:00:00.000Z"
    }
  ]
}
```

Never put credentials, private memories, raw prompts, full logs, unrestricted file contents, or generated model reasoning into the feed.

## Next integration phases

1. Add a local Codex lifecycle adapter that calls `studio:state` at task start, handoff, and completion.
2. Add the allow-listed Hermes adapter and verify stale-state fallback.
3. Add durable weekly rollups from project evidence, without scanning private memory.
4. Add links from a visible milestone to its project document or runtime capture.
