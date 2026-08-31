# Replace the skills.sh market with GitHub providers in dsh-next-skills

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What

The skills.sh REST market never worked out of the box (skills.sh is a
Next.js SPA; the documented endpoints 404). This change removes the registry
client entirely and replaces it with a provider model the user designed:

1. **Providers tab** — add a GitHub repository (`https://github.com/owner/repo`
   or `owner/repo`). Every directory holding a `SKILL.md` counts as a skill,
   discovered recursively at any depth, so both `skills/<name>/SKILL.md`
   (vercel-labs/skills) and `native-skills/default/<group>/<name>/SKILL.md`
   (holistics/skills) work. `.git`, `.github`, `node_modules` are ignored.
2. **Cache** — adding a provider downloads all its skills into a plugin-owned
   cache at `$DSH_HOME/skills-market/` (deliberately outside
   `$DSH_HOME/skills`, which the DSH filesystem provider scans, so cached
   skills never activate). The Marketplace tab browses that cache offline.
3. **Marketplace tab** — cached skills with a text filter and an
   install-target selector (global or a specific workspace). Install copies
   from cache into the chosen root and writes a `.dsh-next-provider.json`
   manifest (provider + installed version).
4. **Update button** — a skill's version is an FNV-1a hash over its git blob
   SHAs. When the catalog version differs from the installed manifest, the
   Installed tab shows `via owner/repo` + Update; updating overwrites files,
   prunes files that disappeared upstream, refreshes the manifest, and
   re-applies the local enable/disable state (a disabled skill stays
   disabled).
5. **Refresh interval** (off / daily / weekly, default off) — an hourly
   background tick re-syncs providers when the interval elapsed since the
   last successful sync (branch cached after first sync; only changed blobs
   re-download). Refresh is detect-only, per the user's choice.
6. **GitHub token** (optional) — unlocks private providers and raises rate
   limits; stored in settings, masked in the UI (password field, "Saved —
   enter a new token to replace"), never echoed back (the state envelope
   exposes `githubTokenSet` only). Empty input means unchanged.

## Key decisions

- **Two GitHub calls per sync max** (repo default-branch resolution is cached
  in the catalog; file contents come from raw.githubusercontent.com, which is
  outside the 60 req/hr unauthenticated API budget).
- **Detect-only refresh** — nothing is installed or overwritten without a
  click (user's explicit choice over auto-update).
- **Update keeps the disabled state** by re-applying
  `disable-model-invocation`/`user-invocable` after the overwrite (user's
  choice).
- Provider specs are validated strictly: URL-shaped specs must be github.com;
  bare specs must be exactly `owner/repo`; SCP-style syntax is rejected.
- Soft limits guard runaway repos (500 skills/provider, 200 files/skill);
  truncated recursive trees are refused with a clear error.
- Legacy `registryBaseUrl`/`repositories` settings are ignored by the new
  config normalizer.

## Structure changes

- New: `src/core/provider.ts` (spec parsing, ids, version hash),
  `src/core/catalog.ts` (catalog views/parse), `src/host/github-client.ts`
  (repo/tree/raw), `src/host/provider-store.ts` (cache + incremental sync).
- Removed: `src/core/registry.ts`, `src/host/registry-client.ts` (skills.sh).
- Rewritten: `skills-service.ts` (providers/marketplace/install/update),
  `rpc.ts` (new methods: marketplace, addProvider, removeProvider,
  refreshProviders, installSkill, updateSkill), `index.ts` (refresh tick),
  `SkillsCard.tsx` (three tabs), config/schema/types.
- The `.trash` sibling directory is skipped during discovery (future-proofing
  for recoverable deletes, as inspired by dsh-skill-explorer).

## Tests

168 vitest cases across 14 suites: new `provider.spec.ts`, `catalog.spec.ts`,
`github-client.spec.ts`, `provider-store.spec.ts` (with an in-memory GitHub
fetch double asserting incremental downloads and call counts); rewritten
`skills-service.spec.ts` (provider add/remove/refresh, autoRefreshDue,
install global/workspace, update incl. disabled-state preservation and
pruning, token non-leak), `rpc-contract.spec.ts` (new envelope), `config.spec.ts`
(new shape), `card.spec.tsx` (three tabs, install target, update button,
token masking). The e2e marker in `tests/e2e/mount.e2e.ts` now asserts the
three tabs, the two-step remove, and the Providers empty state — offline, no
GitHub access needed in CI.

## Verification

- `pnpm typecheck`, `pnpm test` (168), `pnpm build` green; repo-wide
  typecheck/test green; `bash scripts/e2e-mount.sh` green.
- Live end-to-end against a real isolated `dsh web` (scratch home):
  added `https://github.com/vercel-labs/skills` through the RPC (real
  network), marketplace listed `find-skills (vercel-labs/skills)`, installed
  it globally (files + manifest verified in the scratch root), tampered the
  manifest version to simulate an upstream change (`updateAvailable: true`),
  disabled the skill, ran `updateSkill` (files restored, manifest refreshed,
  `updateAvailable: false`, `enabled: false` preserved), then removed it. No
  page errors. `scripts/skills-providers-verify.mjs` drives this probe.
