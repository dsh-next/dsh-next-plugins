# dsh-next-skills: Search tab (rename + search bar + provider filter) and Update all copies

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What the user asked

Rename the Marketplace tab to Search (with a search bar and a provider filter
dropdown) since the plugin has no true marketplace; implement the follow-up
left open by the multi-workspace change (`.agents/notes/implemented/2026-08-29-skills-multi-workspace.md`):
one action to update a skill installed in several places at once; and a full
Playwright pass (screenshots + UX) that also proves both provider spec forms
(`https://github.com/vercel-labs/skills` and bare `vercel-labs/skills`) work
with GitHub as the default host. The inverted-toggle bug mentioned in the
multi-workspace note was already fixed when that note was written; this pass
re-verified it through the dispatch tests.

## Changes

1. **Marketplace tab renamed to Search.** Same RPC (`marketplace`) and types —
   only the surface changed: tab label, search input (`type="search"`,
   placeholder "Search skills..."), and empty-state copy.
2. **Provider filter dropdown.** The Search tab has a `Provider` select
   ("All providers" + one option per configured provider, by spec) that
   narrows the catalog list in combination with the text search.
3. **Update all copies.** New `SkillsService.updateAllCopies({ name,
   workspacePaths })` plus the `updateAllCopies` RPC: updates the global copy
   and one copy per requested workspace in a single call. The per-copy update
   logic was extracted into a private `updateCopy` shared with `updateSkill`
   (same behavior: prune upstream-deleted files, refresh the manifest, re-apply
   each copy's own enable/disable state). Shadows and non-provider copies are
   skipped and reported; per-copy failures are collected so one broken target
   does not block the rest. `MutationOk` gained an optional `warning` string,
   rendered in the panel footer, for partial outcomes. The Installed tab shows
   "Update all copies" next to "Update" only when the panel's presence map
   knows more than one copy of the name.

## Verification

- 192 vitest cases across 14 suites: new service tests (update-all across two
  workspaces, per-copy disabled state, skip + warning for non-provider copies,
  skip shadows, all-fail envelope, not-found, invalid name, disabled manager),
  panel tests (Search tab, provider filter dispatch, update-all-copies button
  visibility + dispatch, warning rendering), and an RPC-contract test pinning
  the `updateAllCopies` envelope. Repo typecheck/test, docs:check,
  runtime-deps:check, and the mount smoke (marker updated to `Search`) green.
- Live Playwright pass (`scripts/skills-full-verify.mjs`, kept for re-runs)
  against the isolated smoke: 30/30 checks, no page errors, 12 screenshots in
  `test-results/skills/`. Confirmed live: URL-form provider add + per-row
  Refresh; search bar and provider filter; install with presence badges;
  tampered manifest -> Update -> flag cleared; two-step remove -> `.trash`;
  provider remove; bare `vercel-labs/skills` re-add with canonical
  `vercel-labs/skills` row and refilled catalog; workspace RPC flows including
  `updateAllCopies` refreshing global + both workspace copies (manifests
  rewritten to the catalog version); config interval persistence; master
  switch gating; token saved masked (`githubTokenSet`).

## UX findings from the live pass

- Positive: two-step remove and the `Confirm remove?` state are clear; the
  `via owner/repo`, `installed here`, and `in global` badges answer "where is
  this skill?" without extra clicks; error messages surface in the footer with
  no duplicated `Error:` prefixes; the bare-spec add shows the canonical
  `owner/repo` row so the normalization is visible.
- Watch items: after Add/Refresh the sync takes a few seconds with only the
  generic `Working...` indicator; "Update all copies" appears only when the
  workspace list is known (no workspaces -> plain "Update"); a removed
  provider's cached skills disappear from Search immediately, while installed
  copies stay (by design).
