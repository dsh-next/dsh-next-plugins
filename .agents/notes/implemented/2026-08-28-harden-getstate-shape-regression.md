# Harden against the getState shape regression: unit contract + e2e DOM marker

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier, tests/e2e

Follow-up to the settings-card `getState` response-shape bug: add two layers so
that class of error ("mounts without crashing but renders nothing") is caught
repo-side instead of only by manual browser inspection.

## Why the mount smoke missed it

The e2e's contract was load shell + assert client.js 200 + assert no crash
markers/page errors. The shape mismatch produced none of those signals: the RPC
returned HTTP 200 with valid JSON, the card read `snap.config === undefined`
silently, and nothing threw. Confirmed the gap, then closed it two ways.

## 1. Host RPC contract unit test

`packages/dsh-next-notifier/tests/rpc-contract.spec.ts` constructs a minimal
`Notifier` (null scope/services) and pins `state()`:

- returns the envelope keys `{config, platform, webPermission, sounds}`, and
  NOT the raw config keys (`enabled`/`volume`) at the top level;
- `config` is normalized with group defaults;
- `sounds` is exactly the 17-catalog `{id, name, group}` shape;
- `platform`/`webPermission` default to null, and `reportWebPermission('granted')`
  is reflected.

This pins the payload shape at the source, type-checked and run by the existing
vitest suite (now 27 tests across 3 files).

## 2. Per-plugin DOM marker in the mount smoke

`tests/e2e/mount.e2e.ts` gained a `pluginMarkers` table keyed by bare slug,
invoked only when the plugin is present. The notifier marker drives
Settings -> Plugins, opens the card, and asserts the settings body
("Enable notifications", "Test browser notification") is visible — the exact
DOM evidence the crash-marker layer cannot see.

Found (and handled) a second real-world obstacle while wiring it: a fresh
scratch DSH home shows a sequential onboarding flow (Internal Testing Notice,
then an "Add an API key" dialog), each a modal whose mask intercepts pointer
events on the sidebar. Added `dismissOnboarding()` that clicks the known
dismissal buttons ("Continue", "Configure later", "Skip") before driving the UI.

Verified: `bash scripts/e2e-mount.sh` passes 1 test; `pnpm typecheck` clean;
notifier 27 tests green.
