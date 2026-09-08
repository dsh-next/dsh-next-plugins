# Synchronize worktrees sidebar with the stock browser

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees, tests/e2e, scripts/e2e-mount.sh

## Change

Pinned the derived official workspace browser to `0.1.3-alpha.2`, matching
its exact SHA-256 in `scripts/derive-workspace-browser.mjs`. All three stock
CSS payloads remain byte-identical to the previous `0.1.2-rc.1` baseline;
this is a navigation/loading synchronization, not a redesign.

The 15 guarded derivation seams retain upstream search-close, selected-row
scrolling/acknowledgement, workspace phase/stream guards, and deferred blank
session account promotion. Nested search additionally forces the harbor and
worktree open, locates overflow inside child groups, and forwards the reveal
callback to nested session rows. Ordinary navigation still respects explicit
stored collapse choices. The wrapper already forwards the complete workspace
snapshot, so it needs no new readiness adapter.

The npm dependency and lock entry are pinned exactly. pnpm added a
version-specific release-age exception, consistent with the existing SDK
exceptions. No package version, DSH checkout, active GUI, or branch was changed.
The existing engine lower bound remains: SDK review found no new loader,
primitive, inject, or RPC contract; the workspace stream field already exists
in the rc.1 controller. Runtime verification uses alpha.2, not an old DSH binary.

User instructions are in the bilingual README's **Find a session** section;
the patch release intent is `.changeset/worktrees-sidebar-search-reveal.md`.

## Coverage and verification

- 11 real-React/jsdom tests evaluate the freshly derived, hash-gated stock
  Browser, tree, row effects, and store actions. Coverage includes ordinary
  groups, flat lists, nested visible/overflow results, explicit collapse,
  acknowledgement without repeated scrolling, phase and stream readiness,
  and pending empty-workspace to ready populated-workspace blank promotion.
- Worktrees typecheck and all 380 tests passed, including the recovered agent
  tests after adapting their state vocabulary to the actual SDK types.
- Final original-six-plugin gate passed: typecheck, 1,307 unit tests, build,
  runtime dependency check, global docs/i18n checks, 39 script tests, and
  whitespace check. The explicit pnpm exclusion leaves the unfinished OAuth
  package outside typecheck/test/build; global docs/i18n still scan it.
  Derived-browser contract check: 15 seams passed.
- Independent read-only review approved the scoped implementation; its E2E
  row-count finding and optional SDK fixture/membership suggestions were fixed.
- Sidebar E2E passed (19.8s): nested overflow, ordinary grouped reveal, flat
  navigation, stock session menus, selected row in viewport, and no page errors.
  Inspected dark/light captures in ignored `docs/screenshots/`
  (`worktrees-search-reveal-dark.png`, `worktrees-search-reveal-light.png`).
  Screenshots disable animations to capture settled stock row visibility;
  these keyless fixture captures are validation evidence, not README artwork.
- All four E2E spec files were invoked in isolated fixtures:
  - `worktrees-sidebar.e2e.ts`: 1 passed (19.8s), original six plugins mounted.
  - `checkpoints.e2e.ts`: 6 passed (52.2s), original six plugins mounted.
  - `checkpoints-chat.e2e.ts`: 1 explicitly skipped (no live key).
  - `mount.e2e.ts`: original six-plugin run failed twice at the Claude Plugins
    marketplace assertion. A separate five-plugin run, excluding Claude
    Plugins as well as OAuth, passed (24.9s), including the existing full
    worktrees create/update/merge/reset/collision marker.
  These results are not an all-E2E-green claim.

## Concurrent-work limitations

`providers-oauth` appeared during verification and was not modified here. Its
empty English dictionary initially failed global i18n (later corrected by
concurrent work; the final global i18n check passes). Subsequent manifest
edits requested an unavailable runtime SDK version and its packed dependency
install required unapproved build scripts. These are not sidebar failures.
pnpm also reconciled that package's importer/slot dependency into the shared
lockfile; those entries are not attributable to the sidebar upgrade.

The E2E mount script now supports an explicitly logged
`E2E_EXCLUDE_PLUGINS=providers-oauth` (default still mounts everything), allowing
the original six-plugin family to be tested without mutating unfinished work.
Playwright uses installed tooling rather than implicitly installing the whole
workspace. This does not permit dependency build scripts or relax install
policy. All smoke servers use owned scratch homes and are cleaned on exit.

The retained failing mount fixture had the official Claude marketplace on disk,
so its seed did succeed. Independent review found that existing `getState`
waits for catalog refresh (up to a 120-second request) before exposing even
registry-only rows, while the marker expects that row within five seconds.
The observed empty panel fits that pre-existing network dependency; pending
versus failed RPC was not measured. Claude Plugins was left unchanged. The
retained diagnostic scratch directory was removed after inspection.

Global docs/i18n passed in the completed static gate. A later final docs check
caught concurrently edited OAuth READMEs with stale pairing hashes; the
worktrees pair remained valid, and the final i18n check still passed. Resolve
OAuth install and pairing issues before claiming a current whole-workspace
gate is green.

Live checkpoint chat requires a real API key; the environment has none. Any
successful keyless runs do not establish live model-call coverage.
