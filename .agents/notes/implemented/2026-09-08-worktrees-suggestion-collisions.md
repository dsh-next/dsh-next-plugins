# Collision-aware worktree name suggestions

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees, tests/e2e

Follow-up bug fix for the smoke failures recorded in
[the simplification note](2026-09-08-worktrees-simplification.md). Existing dirty
`main` work was preserved; no branch switches or commits.

- The browser sends the workspace cwd to `suggestName`; the host resolves its
  primary repository and checks the same reconciled registry slugs, folder
  basenames, and retained plugin branch refs used by creation. It also skips
  occupied checkout paths through the existing filesystem port.
- The deterministic adjective/noun picker keeps its existing base pairs and
  adds the first available numeric suffix from `-2` when a pair is occupied.
  Suggestions are not reservations: creation retains its collision check, and
  explicitly typed occupied names still fail rather than silently changing.
- Unrelated smoke creates use distinct scenario names. The dedicated browser
  regression creates real retained branches for all ten base suggestions,
  leaves the returned prefill untouched, and verifies the new registry row,
  bound session, checkout, branch, and sidebar row. No clock or RPC mocks.
- Updated the bilingual README's stale timestamp-based creation description
  and recorded patch intent in `.changeset/worktrees-available-suggestions.md`.

## Coverage and validation

- Pure picker: free names, occupied pairs/suffixes, gaps, duplicate inputs,
  input immutability, and 150 repeated collisions with valid folder names.
- Host: primary lookup from subdirectories, registry slugs and legacy folder
  basenames, retained short/qualified refs, disk-only occupancy, stale registry
  cleanup, errors, optional disk probe, injected clock, and a claim occurring
  between suggestion and create.
- RPC: cwd validation/forwarding and the direct string response contract.
  Browser store: suffixed prefill and cwd forwarding. Real Git: repeated
  creates, removal with retained branch, and explicit-name rejection.
- Root typecheck, all tests (368 worktrees tests), build, runtime dependency
  check, docs/i18n checks, and changeset status passed. An initial test-only
  missing `force: false` argument and a trailing blank line were corrected;
  whitespace checks then passed. Existing dependency/React test warnings remain.
- Independent read-only review approved the fix with no required findings.
  Its optional suggestion-lookup failure/manual-name fallback coverage was added.
- Full `bash scripts/e2e-mount.sh` passed twice consecutively (36.3 and 34.7
  seconds), including the forced retained-branch collision regression and all
  other plugin markers. Each run stopped its owned scratch server and removed
  its scratch home; the user's running GUI was not restarted or modified.
- Final coverage: all 369 worktrees tests passed, package TypeScript passed,
  and whitespace/docs/i18n checks passed. Branch remained `main`.
