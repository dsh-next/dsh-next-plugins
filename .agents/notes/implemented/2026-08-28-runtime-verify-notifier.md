# Runtime-verify the notifier mount; fix E2E client-bundle path

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier, tests/e2e, scripts/e2e-mount.sh

Verified the rebuilt dsh-next-notifier actually mounts in a live isolated DSH
(scratch DSH_HOME, `dsh plugin --profile smoke add file:<tarball>`,
`--dump-config`, boot). Results:

- `dsh plugin add` reconciled `@dsh-next/dsh-next-notifier` into
  `dsh.profile.bundles` automatically.
- `--dump-config` resolved the insert row (`id: dsh-next-notifier` →
  `@dsh-next/dsh-next-notifier`) into the composition.
- Booted `dsh --profile smoke` with no crash markers.
- Host half live: `POST /dsh-next-notifier/rpc` `getState` returned the fully
  normalized config (proves schemastery settings schema + `settings.register`
  + the webServer route all work at runtime).
- Client bundle served (24 KB, correct `window.__ModuleLoader__.load` wrapper).

Bug found and fixed along the way: DSH serves the client bundle at
`/plugins/<package-name>/client.js` — the npm name (`@dsh-next/dsh-next-<slug>`),
NOT the cordis `id` field (`dsh-next-<slug>`). The existing
`tests/e2e/mount.e2e.ts` built the URL from the bare id, so its 200-status
assertion would have failed for any plugin with a real client bundle; it had
never been exercised because the 8 skeletons are bare. Fix:

- `scripts/e2e-mount.sh` now passes the package name in `DSH_E2E_PLUGINS`.
- `mount.e2e.ts` derives the bundle URL from the package name and the bare id
  for the crash-marker log-prefix regex.

Follow-up: add `@deepseek-ai/dsh-goal`/`dsh-subagent`/`dsh-user-approval`/
`dsh-tools`/`dsh-subprocess` host peers to the smoke profile base bundles if the
mount smoke should exercise the trigger events (the notifier's listeners no-op
when those services are absent, which is safe by design).

Second bug found in the same session: `playwright.config.ts` had no
`testMatch`, and Playwright's default matcher (`*.spec.ts` / `*.test.ts`) does
not match `mount.e2e.ts`, so the mount smoke lane discovered zero tests and
would have "passed" trivially. Added `testMatch: /.*\.e2e\.ts/` so the lane
actually runs.
