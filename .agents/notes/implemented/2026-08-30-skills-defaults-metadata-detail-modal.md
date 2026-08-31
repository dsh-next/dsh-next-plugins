# dsh-next-skills: default providers, repo metadata on provider rows, skill detail modal

- date: 2026-08-30
- status: implemented
- scope: packages/dsh-next-skills

## What the user asked

Replace the previous example provider with a shipped set of default providers
(anthropics/skills, openclaw/openclaw, mattpocock/skills,
muratcankoylan/Agent-Skills-for-Context-Engineering, affaan-m/ecc,
nextlevelbuilder/ui-ux-pro-max-skill, addyosmani/agent-skills,
Leonxlnx/taste-skill); show each provider's repository description, star
count, and number of skills; and make clicking a skill open a modal with its
whole configuration (name, description, and the actual SKILL.md body).

## Changes

1. **Default providers.** `core/defaults.ts` holds the eight default specs.
   On the first launch (no `providers.json` yet) the host seeds them
   (`SkillsService.ensureDefaultProviders`) and, shortly after boot, runs one
   full sync so descriptions, stars, and skill counts fill in without any
   click. Removals persist — seeding never runs again once a provider list
   exists. The host entry gained this one-shot seed+sync effect; the hourly
   background tick stays removed (refresh is manual afterwards).
2. **Repo metadata on provider rows.** `fetchRepoInfo` captures the
   repository `description` and `stargazers_count` (one API call). The values
   persist in the catalog (`ProviderCatalog.description` / `.stars`), flow
   through `providerViews`, and render in the Providers tab rows as a
   description line plus `N skills . <stars> . refreshed ...`.
3. **Snapshot sync (performance rework, per user follow-up).** The first
   implementation walked the git tree and downloaded every file separately —
   the large default providers took minutes (one hung request stalled the
   whole sync; there was no timeout). A sync now downloads the
   default-branch snapshot once (`codeload.github.com/.../tar.gz/HEAD`, CDN,
   outside the API budget, 120 s timeout) and extracts it locally
   (`host/tarball.ts`: gzip + ustar/pax headers, long-path support). Skill
   versions are content hashes (`core/provider.ts#hashContent`) instead of
   blob SHAs — same change-detection semantics, recomputed once after this
   change. Per sync: one API call + one snapshot download; total API calls
   for the eight defaults: eight.
5. **Infinite scroll on the Search tab (user follow-up).** With the defaults
   synced the catalog holds hundreds of skills, so the Search tab renders 30
   results per page and loads more as a sentinel button scrolls into view
   (IntersectionObserver, with the button as the keyboard/fallback path and a
   "Showing X of Y skills" counter). Paging resets whenever the search text
   or provider filter changes. jsdom has no IntersectionObserver — the panel
   guards for it and tests drive the Load-more button.
4. **Oversized groups and swallowed errors (found live).** `affaan-m/ecc`
   really contains 898 SKILL.md directories — over the 500-skill provider
   cap — and its sync error was invisible because `markProviderError` skipped
   providers with no catalog row yet. Now: a skill group over the
   200-files-per-skill cap is skipped instead of failing the whole provider
   (repo-root SKILL.md files that hoover loose docs no longer break syncs),
   and `markProviderError` writes a stub catalog row for never-synced
   providers so the real error surfaces on the row (affaan-m/ecc shows
   "exposes 898 skills (limit 500)").
3. **Skill detail modal.** New `SkillsService.getCatalogSkillDetail`
   (provider cache) and `getInstalledSkillDetail` (skill roots) RPCs return a
   `SkillDetail` payload: name, description, `whenToUse`, the frontmatter
   invocation flags, and the markdown body. Clicking a skill row (title,
   provider chip, or description; Installed and Search tabs) opens a modal
   with the invocation-flag chips, the description, and a scrollable
   monospace body. Escape, scrim click, and Close all dismiss it.

## Tests and evidence

- 176 vitest cases across 13 suites: gh double serves repo metadata; new
  tests for description/stars parsing and persistence, default seeding
  (specs list, removal persistence, seed-once), detail RPCs (catalog,
  installed, missing), and panel detail-modal rendering from both tabs.
  Package + repo typecheck, tests, build, docs:check, runtime-deps:check,
  and the mount smoke green.
- Live Playwright pass updated and green: defaults seeded + auto-synced
  after boot (every default synced or visibly errored), provider rows show
  stars and the repo description, the vercel-labs/skills add still works
  over the defaults, the detail modal renders real SKILL.md bodies, and
  removing a user provider keeps the defaults.
