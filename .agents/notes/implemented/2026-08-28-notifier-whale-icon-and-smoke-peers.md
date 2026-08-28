# Notifier whale icon; confirm smoke peers are already covered

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier, scripts/e2e-mount.sh

Two follow-ups from the notifier rebuild.

## Smoke-profile host peers (no-op, documented)

Investigated whether `scripts/e2e-mount.sh` must add the notifier's host peers
to the smoke profile so the mount smoke exercises the trigger listeners. The
answer is no: the current base bundles already cover every peer and event
source, so adding rows would be redundant noise, not coverage.

- `dsh-base` mounts `timer` (`cordis-plugin-timer`), `settings`
  (`dsh-settings-file`), `subprocess` (`dsh-subprocess-local`),
  `sandbox-policy`, and `goal` (`dsh-goal`) — the notifier's host reads
  `ctx.get('timer'|'settings'|'subprocess'|'sandboxPolicy'|'goals')`.
- `dsh-base` also mounts `agent`, `subagent`, `approval` (`dsh-user-approval`),
  and `tools` (`dsh-tools`) — the rows whose events the notifier listens to
  (`agent/status`, `subagent/end`, `approval/request`, `tools/execute`,
  `goal/changed`).
- `dsh-web-app` mounts the `webserver` row (`dsh-host-webserver`) backing the
  `webServer` service used by the notifier's `/dsh-next-notifier/rpc` route.

A comment in `scripts/e2e-mount.sh` now records this mapping so a future reader
knows the peers are covered, not omitted.

## Whale notification icon

The web Notification previously carried no icon. Added an inline 32x32 RGBA
whale PNG as a data URI (`src/client/whale-icon.ts`), so the browser
Notification shows the dsh-next mark with no binary asset or runtime fetch.
Generated programmatically (body + tail fluke + spout), no manual binary
extraction. Threaded through `showWebNotification` in `src/client/drainer.ts`
as the Notification `icon` option.

Verified: `pnpm typecheck`, `pnpm test`, `pnpm build` (icon inlined into
`lib/client.js`), and `bash scripts/e2e-mount.sh` (1 passed).
