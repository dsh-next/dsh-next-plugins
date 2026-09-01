# Skills: settings-backed state, global-only installs, cc-plugins-style page

- date: 2026-09-04
- status: implemented
- scope: packages/dsh-next-skills

## Change

The plugin's state model moved from ad-hoc files (providers.json, skill
frontmatter toggles, workspace shadow copies) to the harness settings
service: providers, installed records, and per-name enablement scopes now
persist under `dsh-next-skills:` in `$DSH_HOME/settings.yaml` (registered
through `settings.register`, the same seam `dsh-next-notifier` uses). The
section is readable, hand-editable, and shareable between developers; after
the provider caches sync, a recorded skill whose files are missing is
reinstalled from the cache (`reconcileInstalled`), so copying the settings
section to a teammate reproduces the same skill set.

Skills now install GLOBAL-ONLY, into `<agentsHome>/skills/<name>/`. The
plugin never writes skill files into a project; workspace `.agents/skills/`
roots are scanned read-only so hand-created, version-controlled project
skills still show in the panel (with a `project` chip) and still outrank
same-name global skills.

Enable/disable became pure configuration. Per skill name, a scope setting
(absent = Everywhere; a workspaces whitelist; an empty whitelist = off
everywhere) is resolved per lookup by a new `ctx.skills` provider
(`src/host/skills-provider.ts`) that re-publishes the filesystem provider's
candidates with each rank lowered by one — so the plugin wins every duplicate
name, applies the invocation flags (both off when the scope disables the
skill for the lookup's cwd, otherwise the author's frontmatter flags), and
preserves the exact precedence order. `settings` scope changes invalidate the
provider via `control.invalidate()`. `toggleInvocation`, `buildShadowSkill`,
and the whole shadow mechanism are gone; enablement never writes files.

The settings page was restyled after the cc-plugins page: two tabs (Skills /
Providers), a two-column card grid (discovered rows first, then catalog-only
entries, each group alphabetical), search + provider filter + installed-only,
Show more paging (30), presence badges (Everywhere / N workspaces / Off),
provider chips, the cc-plugins scope modal (radio + workspace checklist,
two-step remove, Update), a Providers tab with add / refresh all / remove,
and the markdown detail modal. The scope modal deliberately allows saving the
workspaces mode with zero checked boxes: an empty whitelist is the
off-everywhere master switch (the old Disable button's successor).

A one-time migration (`migrateLegacy`, planned by the pure
`src/core/migration.ts`) converts the previous state when the settings
section is empty: providers.json providers are adopted; managed global
skills become installed records; managed workspace copies move into the
global root (name collisions stay put with a note); shadow directories are
deleted; skills the old panel had disabled (both frontmatter toggle lines,
or a shadow anywhere) become an explicit "enabled nowhere" whitelist and
their toggle lines are stripped from SKILL.md so a later re-enable works.
Hand-created skills are never touched. A fresh install (no legacy file)
seeds the default providers into settings.

RPC changes: `getState` (envelope: config + installed + providers + catalog),
`setScope`, `installSkill` (global-only, optional initial scope), `updateSkill`
({name}), `remove` ({name}), provider methods unchanged in shape;
`setEnabled`, `updateAllCopies`, `getInstalledMap`, and the `marketplace`
payload are gone.

## Files

- New: `src/core/settings.ts` (config model + scope policy), `src/core/schema.ts`
  (schemastery namespace schema), `src/core/migration.ts` (pure migration
  planner), `src/host/skills-provider.ts` (ctx.skills provider override),
  `tests/helpers/config-face.ts` (settings scope double).
- Removed: `toggleInvocation`/`buildShadowSkill` from `src/core/frontmatter.ts`
  (`isShadowSkill`/`SHADOW_MARKER` stay for the migration;
  `stripDisabledFlags` is new), `marketplaceView` from `src/core/catalog.ts`,
  providers.json persistence from `src/host/provider-store.ts`
  (`readLegacyProviders`/`hasLegacyProvidersFile` replace it),
  `installedMap`/shadow handling from the service.
- Rewritten: `src/host/skills-service.ts`, `src/host/rpc.ts`, `src/index.ts`
  (settings registration, provider registration, boot sequence: migrate ->
  seed -> sync -> reconcile), `src/client/SkillsPanel.tsx` (cc-plugins-style
  page), `src/client/card.module.css`, dictionaries (en + zh).
- Tests: new `tests/settings.spec.ts`, `tests/migration.spec.ts`,
  `tests/skills-provider.spec.ts`; rewritten `tests/skills-service.spec.ts`,
  `tests/rpc-contract.spec.ts`, `tests/panel.spec.tsx`; updated frontmatter,
  provider-store, catalog, skill-list suites.
- Scripts: `scripts/e2e-mount.sh` seeds a settings record for the throwaway
  skill (managed => removable); `scripts/skills-e2e-boot.sh` seeds records +
  an off-everywhere scope for the throwaway skills; `skills-full-verify.mjs`
  rewritten for the new page (settings.yaml round-trips, scope modal,
  global-only assertion, composer staleness kept); `skills-screenshots.mjs`,
  `skills-remove-ab.mjs`, `skills-remove-repro.mjs` (now the scope/disable
  probe), `skills-providers-verify.mjs` updated to the new UI and RPC.
- `tests/e2e/mount.e2e.ts`: the dsh-next-skills marker drives the new tabs,
  the scope modal radios, and the two-step remove.

Two further defects surfaced only by the full functional e2e (all unit
tests were green against in-memory doubles):

- `setScope` persisted through `SettingsScope.update()`, whose patch merge is
  DEEP - a cleared scope key silently survived inside the scopes map. The
  service now replaces the whole section (only a wholesale replace can delete
  a key), and the MemConfigFace test double deep-merges like the real
  provider so this class cannot hide again.
- The panel re-read workspaces on every render into a fresh array; every
  callback and effect keyed on that identity re-ran each render, refetching
  state in a loop and resetting the detail modal to "Working..." forever.
  The workspacePaths memo is now keyed on the joined paths. A regression
  test renders with an unstable getWorkspaces and pins exactly one detail
  RPC per open.

Follow-up during live verification: the GitHub client now authenticates
metadata calls with `DSH_GITHUB_TOKEN` or `GITHUB_TOKEN` when set (5000
req/hr instead of the shared 60/hr unauthenticated budget) — the full
functional verify repeatedly tripped the shared unauthenticated quota.
Documented in both READMEs; covered by token header tests.

## Validation

- Package: 199 tests pass (17 files), `tsc --noEmit` clean, tsdown build ok.
- `pnpm i18n:check` and `pnpm docs:check` pass (README pair rewritten for the
  new model and re-recorded via `docs:write-pair skills`).
- Repo gates and the real-mount smoke re-run after the live-server migration;
  see the session summary for the exact commands (workspace-wide `pnpm test`
  is currently blocked by an unrelated in-progress edit in
  `packages/dsh-next-cc-plugins`, so gates run via direct
  `tsc/vitest/tsdown` invocations).
