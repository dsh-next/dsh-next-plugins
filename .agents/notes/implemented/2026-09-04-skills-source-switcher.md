# 2026-09-04 — Skills source switcher: one card per installed skill

## Why

The Skills grid rendered one card per on-disk copy AND one card per provider
offering of the same name. For the common case (one copy, one provider) that
meant two near-identical cards — and a Replace button whose meaning ("adopt
this provider's managed copy") was the least obvious action on the page. The
user flagged it as apparent duplication; after a grilling round the settled
design is:

- The managed card gains a **Providers** button (ghost style, actions row,
  label `Providers (N)` counting external providers only). It replaces the
  old `N sources` badge chip.
- The button opens a **source switcher modal**: Local (hand-managed) plus
  every provider offering the name, spec-sorted, current source marked
  `Current`, each provider row showing content parity (`matches your copy` /
  `differs from your copy`) from a host-side fingerprint compare.
- The footer action is `Replace` (provider target) or `Detach` (Local
  target); disabled while the draft equals the current source.
- A provider target opens an **in-place confirm phase** in the same overlay
  stating the real updateSkill semantics: files rewritten in place, files
  outside the provider copy removed permanently (not into `.trash`), scopes
  kept. Confirm button is danger-styled. Detach applies directly
  (config-only, instantly reversible).
- Provider offerings no longer render as grid cards for installed names.
  Uninstalled names keep the Use card; owned (cc-bridged) names keep hiding
  everything.
- **Update is provenance-pinned client-side**: it fires only for a copy's
  recorded provider. The old `updateCandidates[0]` silent pick for
  hand-managed copies is gone — they route through the switcher.

## Host changes (`packages/dsh-next-skills`)

- `InstalledSkill.sources: SkillSourceOption[]` replaces
  `updateAvailable`/`updateCandidates` (`CatalogSkillMatch` survives as the
  index type; `SkillSourceOption = CatalogSkillMatch & { matches: boolean }`).
  Built for non-owned bundle copies with at least one same-name catalog
  entry, spec-sorted, fingerprint-compared per offering.
- New `detachSkill({ name, directory })` RPC: drops the installations record,
  keeps files; refuses unknown roots, owned copies, and unrecorded names.
- `updateSkill` now refuses a **flat copy** (directory without SKILL.md): a
  flat skill's `directory` is its root itself, and the prune step would have
  deleted every other skill in that root — a latent data-loss bug the old
  per-offering Replace card could reach. Also fixed the stale
  "keeps the caller's own extras" comment (prune removes everything outside
  the provider file set).
- `dsh-next-skills` settings schema resolves `installations`; the legacy
  `installed` compat read can never trigger through the harness settings
  scope (the schema defaults the current key first). The e2e seed now writes
  `installations`.

## Client changes

- `buildGridEntries`: offerings filtered by installed name (not just owned
  names); `GridEntry.installed`/`sourceCount` removed.
- `renderCard`: Update button derived from `row.sources` + `row.provider`;
  Providers button from `row.sources`; offering branch renders Use only.
- `sourcesDialog` (`skills-sources-modal`, in-place confirm phase), Escape
  wired into the shared modal effect. New dictionary keys `card.providers*`
  and `sources.*`; removed `card.replaceTitle`, `card.currentSource`,
  `card.sources.one/many` (en + zh mirrors).
- `.optionHint` added to the skills extensions section of `card.module.css`
  (shared chrome untouched).

## Validation

- Unit: `skills-service.spec` (sources parity, detach, flat-copy refusal),
  `rpc-contract.spec` (detachSkill round-trip), `panel.spec` (switcher
  modal flows, collapse, Update pinning, provider-filter empty state).
  260 skills + 385 cc + 103 notifier green.
- e2e: the skills marker drives the real switcher against a seeded same-name
  provider (`e2e/local` + market cache catalog) — detach drops the Update
  button and provider chip, re-adopt goes through the overwrite confirm and
  re-pins; delete then flips the offering to a Use card. `e2e-mount.sh` pass.
- i18n parity, docs check, bilingual README pair re-recorded.
