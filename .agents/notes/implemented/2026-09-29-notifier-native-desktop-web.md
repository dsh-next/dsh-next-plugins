# Native desktop and web notifier rewrite

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-notifier, tests/e2e/notifier-marker.ts, tests/e2e/settings-helpers.ts

Rebuilt notifications around current Harness primitives and public contracts.
Settings are directly on the installed Notifications bundle page through
`plugins.bundle.config`, above Components. The shared `configForms` service
owns Host reads, schema validation, revision fencing and persistence. A
useSyncExternalStore subscriber projects its values; acquiring the shared
form happens in apply, not during render.

Per the user's follow-up requests, there is no separate component settings
page and no Save button. Switches and selectors autosave; rapid volume edits
coalesce for 250ms. Pending edits stay optimistic while a single write is in
flight, queued leaf edits preserve other preferences, and failures roll back
to accepted Host values with a localized inline error. Navigating away flushes
an already-requested volume change rather than discarding it. The selected
sound previews without another settings write.

Native Toast replaces the custom floating surface and owns its complete
hold/fade lifetime. Background notifications use the standard renderer
Notification API on desktop and web. Web Audio plays on the receiving device;
the host subprocess sound backend and its platform dependency were retired.
Host receipt acceptance rechecks cancellation, lease expiry, enablement and
current sound settings before authorizing client audio. Retry receipts never
replay the sound.

Current session identity follows the session controller's mainView retention;
clicks use uiWorkspace navigation. Foreground suppression reads the official
usePanelInfo hook on commit, so a conversation hidden by Plugins is not
mistaken for an actively viewed session. The 0.1.7 layout service does NOT
expose panelInfo; only the public hook works across that SDK and desktop 0.2.

## Platform evidence

Read the installed desktop 0.2.0-rc.2 archive without modifying DSH. Its public
preload bridge has no notification/audio methods; renderer APIs are the
supported route. The same-origin custom protocol forwards plugin RPC paths
to the owned authenticated host. Current bundle/form, native control, Toast,
retention, and navigation contracts were compared with official 0.1.7-rc.1
SDK declarations. No private Electron IPC or SDK-checkout imports were added.

## Review and tests

The original 322-test notifier baseline passed. Independent tests cover
settings, permission states, current bundle ownership, rendering and Strict
Mode lifetimes, abandoned renders, late async results, keyboard actions,
receipt authorization and native fade timing. Independent review found and
helped fix sound before acknowledgment and a timer cutting off the toast fade.
Additional regressions cover Host configuration/policy changes during render,
unsupported audio, retries, and localized main/child failure titles.

The full repository static gate and all eight family smoke tests passed.
Checkpoints, Skills, OAuth providers and Decisions E2E passed. The full CI run
also exposed an unrelated pre-existing Git E2E selector at git.e2e.ts:732
(`View @dsh-next/dsh-next-git`) that no longer matches installed metadata.
That unrelated source was left unchanged. The notifier's first focused E2E
runs proved real failed-turn alerts and settings persistence, and exposed the
row selector and layout-service differences corrected above.

Final validation after the user's inline/autosave follow-ups:

- Notifier typecheck and build pass; 349 tests across 18 suites pass.
- Both notifier real-mount tests pass in `artifacts/testing/run-PXgEAd`:
  settings directly on the bundle page, no Save button, automatic persistence
  after reload, separate clients, panel presence masking, keyboard dismissal,
  and a real failed-turn notification with navigation.
- Final eight-test packed-family smoke passes in `artifacts/testing/run-gKCzvK`.
- Repository documentation, locale parity, dependency scanning and diff checks
  pass; bilingual pairing is current.
- Inspected real light/dark settings and native toast screenshots under the
  notifier run. Replaced `packages/dsh-next-notifier/media/settings.webp` with
  the verified dark-theme view at 888px display width.

The Git selector limitation above was resolved in the subsequent repository
validation pass by selecting the Git package card and its current `View Git`
button. Full `pnpm run ci` then passed all seven keyless suites, including the
Git scenario, again during the pre-commit audit. No notifier assertion or
browser error guard was weakened to obtain a pass.

## Design deviation and limits

The user explicitly requested automatic persistence instead of the native
SettingsForm's Save footer; the switches, buttons, field geometry and theme
tokens remain Harness-native. No component colors or theme overrides.
Browser autoplay may require a Preview gesture. Automated tests and browser
acceptance do not prove audible speaker output or OS banner presentation.
Do Not Disturb and system permission can suppress banners; closed renderers
cannot receive alerts. No existing user profile was restarted or reset.
