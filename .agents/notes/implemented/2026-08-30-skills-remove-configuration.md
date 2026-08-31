# dsh-next-skills: Configuration settings removed; provider persistence moved into the cache

- date: 2026-08-30
- status: implemented
- scope: packages/dsh-next-skills

## What the user asked

Remove the Configuration block (master switch, refresh interval, GitHub
token) from both frontend and backend, and clean up / reorganize the
codebase accordingly.

## Removal and reorganization

1. **Frontend.** The Installed/Search/Providers tabs keep everything; the
   Configuration block, its state (`tokenInput`), and the three mutation
   helpers (`setManagerEnabled`, `setRefreshInterval`, `saveToken`) are gone.
   The empty-state message no longer mentions a disabled manager. Unused CSS
   (`.config`, `.check`) removed.
2. **Backend.** The manager is always on: `SkillsService` lost
   `disabledResult()` and every `enabled` gate, plus `setConfig` and
   `autoRefreshDue`. The RPC surface dropped `setConfig`; the state envelope
   is now `{ installed }` (no `config` view). The hourly background refresh
   tick is gone — provider refresh is manual (per-row Refresh / Refresh all).
3. **Provider persistence reorganized.** The settings namespace, Schemastery
   schema, and `core/config.ts` (`normalizeConfig`, `cleanPatch`,
   `refreshIntervalMs`) are deleted, along with the `settings` injection.
   Providers now live in `providers.json` inside the plugin cache root
   (`$DSH_HOME/skills-market/`), owned by `ProviderStore`
   (`listProviders` / `saveProviders`, corrupt-file tolerant, entry
   validated). `githubToken` and all `Authorization` plumbing were removed
   from the GitHub client; 401/403/429 messages no longer mention tokens.

## Tests and evidence

- 172 vitest cases across 13 suites: the config suite is deleted; the
  provider-store suite gained `providers.json` persistence/normalization
  tests; service, contract, and panel suites updated for the `{ installed }`
  envelope and the always-on manager. Package + repo typecheck, tests,
  build, docs:check, runtime-deps:check, and the mount smoke all green.
- Full live Playwright pass (`scripts/skills-full-verify.mjs`) updated: the
  three Config checks are gone (no more fake-token cleanup either), 27
  checks over tabs, providers, search, install, update, popup removal,
  workspace RPC flows. The e2e boot script no longer seeds a
  `dsh-next-skills` settings stanza.
