# Remove the notifier auto-dismiss duration setting

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier, tests/e2e, scripts/e2e-mount.sh

The configurable "Notification duration" feature (see archived note
`2026-08-28-notifier-auto-dismiss-duration.md`) was removed. The setting did not
work reliably end-to-end, and the user chose to drop the logic and its tests
rather than keep it.

Reverted to the prior fixed-12s behavior: removed `notificationSeconds` from the
config type, schema, `normalizeConfig`/`cleanPatch`; reverted `showWebNotification`
to a hardcoded 12000ms close and dropped the `getTimeoutSeconds` supplier from
`createDrainer`; removed the card slider and the shared `configRef`/`onConfig`
plumbing; removed the Test-button timeout relay. Removed the related unit tests
(schema range, normalize/clamp, drainer custom-timeout + supplier) and the e2e
behavioral auto-dismiss assertion and Notification spy. Dropped the
`notificationSeconds: 12` line from the seeded scratch settings.

The onboarding-suppression seeding (env key `DSH_E2E_FAKE_KEY` + a seeded model
provider) was kept: it is what keeps the Playwright lane reliable, unrelated to
the duration feature.

Verified `pnpm typecheck` clean, notifier 66 tests green, `pnpm build` succeeds,
`bash scripts/e2e-mount.sh` 1 passed, `pnpm docs:check` 10 READMEs.
