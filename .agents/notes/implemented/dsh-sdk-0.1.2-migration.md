# DSH SDK 0.1.2-rc.1 migration (host + client)

## Problem

The repo pinned the `@deepseek-ai/*` SDK at `0.1.1-rc.2` (cordis `^4.0.1`,
schemastery `^3.18.1`) while the installed `dsh` CLI and the upstream
`dsh-web` reference are on `0.1.2-rc.1` (cordis `^4.0.2`, schemastery
`^3.18.2`). A `link:` dev-profile install masked the skew by resolving SDK
deps from the repo's stale `node_modules`; a real `file:` tarball install (what
`pnpm pack` + `dsh plugin add file:` give CI and consumers) surfaced two
breaking changes.

## Host: `settingsNamespace()` removed

`@deepseek-ai/dsh-settings@0.1.2-rc.1` dropped the `settingsNamespace()` helper
function; `register()` now takes the raw namespace string. Verified against the
DSH codebase's own registrations (`settings.register("ui-theme", schema)`, etc.).

- `settings.register(settingsNamespace(X), schema)` -> `settings.register(X, schema)`
  in notifier, skills, and cc host entries.

## SDK dependency bump

Bumped devDeps across notifier, skills, cc, and `shared`:
`@deepseek-ai/*` `0.1.1-rc.2` -> `^0.1.2-rc.1`, cordis `^4.0.2`, schemastery
`^3.18.2`. `@deepseek-ai/dsh-client-runtime` stays `^0.1.1-rc.2` (no 0.1.2-rc.1
release exists; its npm `next` tag is 0.1.1-rc.2).

Also fixed cc-plugins `peerDependencies` `"@dsh-next/dsh-next-skills":
"workspace:*"` -> `"^0.1.0"` (a workspace-protocol peer breaks `pnpm pack`).

## Client: slot registration must wait on the declaration

In 0.1.2 the renderer owns the slot registry and slots are declared lazily; an
entry that registers before the declaration is rejected with "slot ... is not
declared (a parent entry's children table must declare it)". DSH's own settings
pages wrap registration in `ctx.slots.inject(slotKey, () => slots.register(...))`.

- `slots.register({...}, component)` -> `slots.inject(slotKey, () => slots.register({...}, component))`
  in all three client entries.
- Declared `inject = ['slots', 'locale']` (plus `workspaces` for skills/cc and
  `sessions` for notifier) so the services are available before apply.
- Slot names unchanged and still valid: `settings.section` (skills, cc) and
  `settings.plugin.item` (notifier, keyed by namespace).

## e2e mount smoke

- `scripts/e2e-mount.sh` now extracts the full boot URL including `?token=...`
  (0.1.2 boots token-protected; the old grep dropped the token).
- The client-bundle check now asserts the plugin id is in `__DSH_BOOT__.entries`
  (0.1.2 serves bundles via the rev-hashed combo route, not a stable singular URL).

## Status

All gates green: typecheck, 694 unit tests, build, runtime-deps, docs, i18n,
and the e2e mount smoke (all three plugin DOM markers pass).

Live-verified: Skills and Claude Plugins sections render; installed-first
ordering, group boxes, Replace/current-source/sources chips, provider-filter
narrowing, and installed-only all work; workspaces/sessions available at apply.

Also fixed the cc e2e marker and copy that still described workspace-scoped
*physical* skill placement: skills are global-only with enablement scoping, so
the marker now asserts the copy lands in the global root (no workspace copy),
and the modal hint / README / code comments now say "skills install globally;
the scope is enablement".

