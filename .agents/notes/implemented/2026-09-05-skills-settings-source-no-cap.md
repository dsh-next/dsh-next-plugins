# Skills: settings.yaml is the single source; provider skill cap removed

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-skills, scripts/skills-full-verify.mjs

## Change

**The 500-skills-per-provider cap is gone.** It existed as a runaway-repo
guard: a sync extracts the whole default-branch snapshot in memory and
groups every file under its nearest SKILL.md, so a repository exposing
thousands of skill directories would have ballooned the cache, the catalog
JSON, and the grid; the cap failed the provider fast with a readable error
(affaan-m/ecc at 898 skills was hitting it). The guard turned out to be
unnecessary: downloads are one CDN snapshot regardless of catalog size,
syncs are content-hash incremental, the grid paginates (30/page + Show
more), and an 898-skill provider is now honest content — it syncs and
browses fine. `MAX_SKILLS_PER_PROVIDER` and its throw are deleted. The
per-skill `MAX_FILES_PER_SKILL = 200` guard STAYS: it addresses a different
pathology (a repo-root SKILL.md hoovering every loose file into one bogus
skill) by skipping the oversized group instead of failing the provider.

**settings.yaml is now enforced as the single source of state.** The audit
found two real inversions, both fixed:

1. Provider rows were built from the catalog CACHE first, with
   settings-only providers appended — so a provider removed from settings
   but still in the cache kept rendering (its Remove then errored "not
   configured"). `providerRows` now derives rows from
   `config.providers` alone, enriched with cache metadata when a synced
   snapshot exists, and "never synced" until then. A cache entry without a
   settings record is invisible.
2. `managed` was `manifest || record`, and both update detection and
   `updateSkill`/`uninstallSkill` keyed off the manifest sidecar when
   present — files on disk could confer managed-ness. Now the settings
   RECORD is the only proof of a plugin install: `managed = record`,
   update detection compares `record.version` against the catalog,
   `updateSkill` resolves upstream via the record, and both mutations
   refuse unrecorded skills ("was not installed by the plugin"). The
   manifest is still WRITTEN at install/update/reconcile as an
   informational sidecar but is never read for decisions.

Already record-driven and unchanged: `addProvider`/`removeProvider`/
`refreshProvider(s)` validate against settings; `installSkill` writes the
record; scopes live only in settings; `reconcileInstalled` reinstalls
recorded-but-missing skills from the cache at boot; the one-time migration
adopts legacy state into settings.

**Verify script** (`scripts/skills-full-verify.mjs`): the update-flow check
tampered the manifest to fake a newer catalog version — meaningless under
record-driven semantics — so it now tampers the settings record's version
by line-based YAML editing (a first regex attempt ate the record's `name`
key; the line editor anchors on `- name:` records), and the clearing check
reads the record back. The environmental-error tolerance drops the
"exposes N skills (limit" clause (the error no longer exists).

## Tests

- `tests/skills-service.spec.ts`: a manifest without a settings record is
  custom (not managed, no provider label, no update flag); update/uninstall
  refuse manifest-only skills; provider rows derive from settings (a cache
  orphan is invisible; a configured-but-unsynced provider renders "never
  synced" next to a synced one). 210 tests / 17 files green, tsc, tsdown,
  i18n:check, docs:check (pair re-recorded), mount smoke green,
  skills-full-verify 24/24 on a fresh scratch.
- Live evidence on the persistent smoke server: `affaan-m/ecc` refreshes to
  898 skills with no error; `getState` rows equal the settings provider
  list.
