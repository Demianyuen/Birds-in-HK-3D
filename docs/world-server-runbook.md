# Multiplayer server deployment preparation

## Local verified release commands

Run from the repository root with Node 22 or newer:

```text
npm ci
npm run world:build
npm run qa:world-bundle
```

`dist-server/world.mjs` is a bundled ESM entry point. It runs with plain Node,
not the TypeScript development runner. `ws` remains an external runtime
dependency installed from the locked repository dependencies.
Keep the release's package files and production node_modules with the bundle.
The output contains no game assets or CSDI credential.

The bundle verification script starts an isolated loopback child process, checks
HTTP health, joins two actual sockets, sends a chat between them, then stops the
child and verifies the listener has gone. It does not touch the live dev server.

## Configuration

- `PORT`: listener port, default 8787.
- `WORLD_HOST`: default `127.0.0.1`; change only to suit the chosen host/proxy.
- `WORLD_ORIGINS`: comma-separated exact browser origins. Set explicitly on the host.
- Client `VITE_WORLD_SERVER_URL`: public `wss://.../world` URL, compiled into the frontend.

For a local test:

```powershell
$env:PORT = '8787'
$env:WORLD_HOST = '127.0.0.1'
$env:WORLD_ORIGINS = 'http://127.0.0.1:5173'
npm run world:start
```

Do not put the CSDI key in this service. It is needed only by the existing map
proxy. Guest resume credentials stay in server/client memory and must not be logged.

## Hosting decision still required

No public multiplayer host has been selected or provisioned. Before public use:

1. Choose the existing host or approve the host/bandwidth budget.
2. Configure a supervised Node process and TLS/WSS termination.
3. Allow only the intended frontend origins.
4. Verify `/health`, upgrade handling and two external-device guest connections.
5. Rerun the 100-participant test against an explicitly approved test environment.
6. Verify authenticated account login separately; guest nicknames are not accounts.

Current room state and resume sessions are memory-only. Restarts lose them.
No zero-downtime, multi-instance routing or persistent-session guarantee exists.

## Release and rollback

Keep each verified bundle with its matching package lock in a separate release
directory on the selected host. Keep the previous release until the new one
passes health, join, chat and reconnect checks. Stop the supervised process,
select the prior release directory and restart it to roll back; restore the
matching frontend build when changing protocol versions.

This procedure intentionally names no service manager command: no production
host or supervisor is configured yet. Do not run guessed stop/delete commands
against unrelated services. Local test processes are stopped by their known
child-process handle, not by killing every process on a port.
