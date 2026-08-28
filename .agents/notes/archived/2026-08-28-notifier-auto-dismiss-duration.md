# Make browser notification auto-dismiss duration configurable

- date: 2026-08-28
- status: archived
- scope: packages/dsh-next-notifier

This feature was reverted (the duration setting did not work reliably at
runtime, and the user chose to remove the logic rather than keep it). The
duration slider, the `notificationSeconds` config field/schema, the
`showWebNotification`/`createDrainer` timeout plumbing, and the related
unit/e2e tests were removed. The auto-dismiss is a fixed 12s again.

The web Notification auto-dismiss was hardcoded to 12s in the drainer. Made it a
setting the user can adjust from the settings card.

- Added `notificationSeconds` to the config (`types.ts`), the Schemastery schema
  (`schema.ts`, `min(3).max(60).default(12)`), `normalizeConfig` and `cleanPatch`
  (clamped 3..60, default 12 -> the single source of defaults).
- `drainer.ts`: `showWebNotification` now takes a `timeoutMs` (default 12000) and
  `createDrainer` takes a `getTimeoutSeconds` supplier, so each drained
  notification uses the current configured value.
- `client/index.ts`: keeps a shared `configRef` and passes `onConfig` to the card
  plus `getTimeoutSeconds` to the drainer, so a slider change is honored by the
  next drained notification without an extra round-trip. The card's
  `applySnapshot` centralizes config updates and notifies the ref.
- `card.tsx`: added a "Notification duration" range slider (3-60s, default 12s)
  that persists on release, mirroring the volume slider.

Tests: schema/defaults/range, normalizeConfig default + clamp, cleanPatch clamp,
showWebNotification custom timeout, createDrainer honoring the supplier, and the
mount-smoke DOM marker now asserts "Notification duration" renders. 71 tests
across 7 suites. Verified `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`bash scripts/e2e-mount.sh` all green; `getState` returns `notificationSeconds`.

## Second bug: Test button dropped the configured duration

After wiring the setting, a live probe showed the "Test browser notification"
button still closed at the hardcoded 12s. Root cause: `client/index.ts` passed
`showWebNotification` to the card as a `(e) => showWebNotification(e, sessions)`
wrapper that dropped the timeout argument, so the card's `testWeb()` timeout was
never forwarded. Fixed by forwarding the third argument:
`(e, timeoutMs) => showWebNotification(e, sessions, timeoutMs)`. Verified by a
Playwright behavioral probe: setting 6s closes at 6002ms (was 12s before).

## Behavioral e2e + onboarding finding

Added a real behavioral check to the mount smoke (not just the label): it spies
on Notification, sets the duration to a distinct value, clicks Test, and asserts
the close fires near the configured value (not 12s). It runs inside the mount
test after the marker opens the card, avoiding a fresh context that re-shows the
onboarding modal.

Onboarding: DSH has no env var to disable onboarding. The "Add an API key to get
started" modal is suppressed by seeding the scratch `settings.yaml` with a
provider whose `apiKeyEnv` resolves via env (`DSH_E2E_FAKE_KEY`); the
"Internal Testing Notice" is dismissed with its "Continue" button. Env alone
(`DSH_E2E_FAKE_KEY`) closes the provider-readiness gate; there is no dedicated
`DSH_*` onboarding toggle.
