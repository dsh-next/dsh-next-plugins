# Expand notifier test coverage and make completeness a gate

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier, tests/e2e, docs, .agents/skills, AGENTS.md

## Motivation

After the `getState` response-shape bug, review showed the notifier was
under-tested: the settings-chasing path ("does saving a setting actually
persist") had no test, and several modules were uncovered. Also, the repo's
skills/docs said only "add a vitest suite" and "run typecheck && test", which
let a silent UI bug through. 

## Test coverage expansion (notifier)

From 27 to 66 tests across 7 suites:

- `tests/schema.spec.ts` (new) — schema defaults, sound-name union rejects
  unknown ids, volume clamp.
- `tests/rpc-roundtrip.spec.ts` (new) — drives the real `registerRpc` HTTP wire
  path with a fake webServer capturing the raw handler: proves `setConfig`
  persists through the settings scope and a follow-up `getState` returns the
  updated envelope. This is the "settings chasing works" contract.
- `tests/presence.spec.ts` (new) — `currentSessionId` branches and the presence
  reporter's focus/blur/pagehide/timer/subscribe/dispose wiring under jsdom.
- `tests/drainer.spec.ts` (new) — `webPermission` branches, `showWebNotification`
  creating the whale-icon Notification only when granted, the drain filter
  (stale/non-object rows), and click-to-open.
- `tests/config-decision.spec.ts` — added missing `decide` branches
  (group-disabled, page-dead, subagent-enabled, goal-complete/blocked, sound
  off, viewingAtEvent).
- `tests/synth.spec.ts` — added waveform/envelope internals, base64 padding,
  and noise filter/tremolo boundedness.

## Hardened gate so this can't recur

- `docs/plugins.md` — "The completeness contract": map every exported behavior
  to a test, add a contract test for the RPC shape and persistence, cover
  client wiring under jsdom, and register a per-plugin DOM marker for UI.
- `AGENTS.md` — tests are a completeness gate, not a smoke; changed the
  "before merging" guidance accordingly.
- `.agents/skills/dsh-next-agent-coding` — step 5 now requires covering every
  exported behavior/edge, an RPC contract + persistence test, and a DOM marker;
  step 7 requires the full gate plus the mount smoke.
- `.agents/skills/dsh-next-code-review` — check 5 renamed to "Tests & coverage
  completeness" (flags any exported behavior with no test); new check 6
  "Non-regression" (existing tests must stay green).
- `.agents/skills/dsh-next-local-testing` — notes the gate is a completeness
  gate and the mount smoke runs the per-plugin DOM markers.

## Verification

`pnpm typecheck` clean; notifier 66 tests green; `pnpm build` succeeds;
`bash scripts/e2e-mount.sh` 1 passed (with the notifier DOM marker);
`pnpm docs:check` 10 READMEs.
