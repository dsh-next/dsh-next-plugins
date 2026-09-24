# Workspace dependency refresh: latest compatible, SDK set held

- date: 2026-09-24
- status: implemented
- scope: workspace (root, shared, packages/*)

## What moved

66 specifiers across 9 manifests, all within the major each package already
declared:

- SDK-adjacent libraries: `@deepseek-ai/cordis` `^4.0.4` and
  `@deepseek-ai/schemastery` `^3.18.4` — the same ranges DSH core itself
  resolves.
- Tooling: `@changesets/cli` `^3.0.3`, `playwright` + `@playwright/test`
  `^1.63.0`, `tsdown` `^0.23.0`, `vitest` `^4.1.11`, `typescript` `~5.9.3`,
  `lightningcss` `^1.33.0`.
- Types: `@types/node` `^22.20.4` (stays on the Node 22 major `mise.toml`
  pins), `@types/react` `~18.3.31`, `@types/react-dom` `^18.3.7`, `react`
  `^18.3.1` (stays React 18 — the plugin peer range and the DSH web client are
  18).
- Published runtime deps: `js-yaml` `^4.3.2` (skills), `simple-icons` `16.32.0`
  (git).

Manifest churn carries no change file, per `.changeset/README.md`.

## What was deliberately not taken

Every npm `latest` that contradicts the pinned runtime or needs its own
migration: React 19, TypeScript 7, vitest 5, jsdom 30, `@types/node` 26,
`diff` 9 and `js-yaml` 5 (published runtime deps), `@types/diff` 8
(deprecated).

## What is blocked

The `@deepseek-ai/dsh-*` devDependencies sit on `0.1.5-rc.1` /
`0.1.6-alpha.2` while the runtime the repo tests against is `0.1.7-rc.1`, and
lifting them is not a dependency bump — `dsh-next-cc-plugins` still uses APIs
that 0.1.7 removed:

- `provider.register('cc-plugins', MirrorSettingsSchema)` (`src/index.ts`), gone
  from `SettingsForms`. The call is guarded at runtime
  (`typeof provider.register !== 'function'`), so under DSH `0.1.7-rc.1` the
  plugin silently runs without its settings mirror.
- `source: { kind: 'plugin', plugin }` (`src/host/runtime.ts`), no longer in the
  message-source union.
- `ctx.on('agent/session-start', …)` (`src/host/runtime.ts`), not in
  `keyof Events`.
- Moving the other packages alone also breaks it: TypeScript then compares
  `UserMessage` from its `@deepseek-ai/dsh-llm@0.1.6-alpha.2` against the same
  type from `0.1.7-rc.1`. The workspace type graph couples the versions, so the
  SDK set moves all at once or not at all.

The ported pattern for the settings API already exists in notifier and skills
(see [the 2026-09-22 port note](../archived/2026-09-22-port-plugins-to-dsh-017-config-model.md)).
Until cc-plugins is ported, the workspace keeps this deliberate SDK skew.

## Verification

- `pnpm install` exits 0; the repo gate (`typecheck`, `test`, `build`,
  `docs:check`, `i18n:check`, `runtime-deps:check`) exits 0.
- 3159 tests pass: git 1715 (+1 skipped), cc-plugins 390, skills 337,
  notifier 322, oauth-providers 241, checkpoints 141, opencode 13.
- The client bundle is byte-identical across the tsdown bump
  (`cedaf97517720ca6d1b70798` both ways), so the build change is inert.
- Mount smoke: smoke, checkpoints, git, skills, notifier and oauth-providers
  pass. `cc-plugins` is a pre-existing load-sensitive flake — it failed on the
  button-label assertion while two real marketplaces refreshed, failed the same
  way in the first full run of the day before any of these bumps, and passes
  when the lane runs alone (9.8s). The `git` lane needed the settle-aware
  assertion recorded in
  [the git e2e note](./2026-09-24-git-e2e-menu-bounds-settle.md).

## Handoff

Playwright 1.63 wants Chromium build 1243; the local cache still holds 1.62's
1234, so the next e2e run after pulling this needs one
`pnpm exec playwright install chromium`.
