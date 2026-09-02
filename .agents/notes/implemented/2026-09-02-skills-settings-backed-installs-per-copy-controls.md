# Skills: settings-backed installs with per-copy update and delete

- date: 2026-09-02
- status: implemented
- scope: packages/dsh-next-skills

The skills manager's install model moved fully onto the plugin's settings
namespace; the manifest/provenance file layer is gone.

- The settings section is the single ledger. `installations` holds one
  `{ name, providerId, providerSpec, skillPath }` record per installed name
  (the legacy `installed` key is accepted as a one-time compatibility read).
  No `.dsh-next-provider.json` sidecar is written anymore, and a leftover one
  confers no provenance; `migrateLegacy` and `uninstallSkill` are removed.
- `SkillsService.updateSkill({ name, directory, providerId, skillPath })`
  updates one copy in place: prunes files dropped upstream, overwrites from
  the provider cache, and adopts the name into the ledger. Works for
  hand-created copies in known roots too.
- `SkillsService.deleteSkill({ name, directory, kind, path })` recoverably
  moves one copy into its root's `.trash`; the ledger record and scope entry
  drop only when no other copy of the name remains. Directories outside a
  known `.dsh/skills` / `.agents/skills` root are rejected.
- `listInstalled` keeps every discovered copy (no name collapse). A bundle
  copy gets `updateAvailable`/`updateCandidates` when its content fingerprint
  (`fingerprintVersion`, the same recipe as a catalog `version`, skipping
  `.dsh-next-provider.json`/`.trash`) differs from a same-name catalog skill,
  which also drives the provider picker across same-name catalog skills.
- `state()` prunes orphan scopes: an enablement key with neither a discovered
  copy nor a catalog entry is dropped on read.
- Panel: one card per name with a copy row per discovered copy (source chip,
  per-copy Update driven by the first candidate, per-copy Delete); Update all
  iterates updatable copies; refresh-all surfaces the host reconcile warning
  instead of issuing its own `reconcileInstalled` pass.
- Removed exports: `parseManifest`, `filterCatalogSkills`, `lastRefreshEpoch`,
  `skillPathFromCacheDir`, `SHADOW_MARKER`/`isShadowSkill`/
  `stripDisabledFlags`, `workspaceSkillsRoot`, `CUSTOM_RANK`/`customSkillDirs`
  (and the `custom` bucket), `normalizePathForCompare`, `ProviderManifest`,
  `FsLike.stat`, `FetchResponse.text`, `ProviderCatalog.branch`.

Tests were migrated to the new contracts and extended to the completeness
contract: 16 spec files, 215 tests. New coverage includes fingerprintVersion
equal/changed, pruneOrphanScopes, multi-copy list plus per-copy delete/update
(service and panel), updateSkill adoption and upstream pruning, the same-name
provider picker, deleteSkill bookkeeping and root validation, the legacy
`installed` compat read, and the `SkillsState` RPC envelope without `config`.
The e2e `dsh-next-skills` marker drives the scope modal and per-copy delete
against a real mount.

Diagnostics hardened: `markProviderError` persist failures now log through an
optional `logWarn` sink (wired from `ctx.logger.warn`) instead of swallowing,
and the client RPC HTTP fallback now localizes through the `rpc.failed`
dictionary key.

Verified: package and monorepo `typecheck`/`test`, `build`, `docs:check`,
`i18n:check`, `runtime-deps:check`, and `scripts/e2e-mount.sh` all green.
