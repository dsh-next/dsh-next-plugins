# Make browser notification auto-dismiss duration configurable

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

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
