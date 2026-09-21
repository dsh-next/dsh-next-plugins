# Simplify history dialogs and preserve dirty work during tree-only rewrites

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Supersedes the [command-modal implementation note](../archived/2026-09-20-git-history-command-modals.md).

## Dialogs

Squash and Reword use Summary and Description fields, loaded from complete
commit messages before preview. Fixup, Reorder, Cherry-pick and Revert keep
compact commit subjects; only Reorder has move controls. Full hashes, duplicated
commit listings, routine engine warnings, backup paths and redundant Compare
statistics are removed from the default view. Technical failure details remain
available in a collapsed disclosure. Potentially shared history still requires
explicit acknowledgment, and stopped operations retain native recovery controls.
Edits invalidate the approved preview immediately, before the debounce. An
uncertain execution response offers a status read, never blind execution retry.

The sparkle uses the same icon as the sidebar commit box. It expands an inline
current/new-session choice. Nothing is sent until Start task, and the prompt
contains selected commit messages plus the draft, never staged changes. Result
admission uses a separate history-message verb and exact receipt/scope matching;
Use message is explicit and refuses to overwrite a draft edited during the task.
No model turn was submitted during verification.

## Dirty-checkout diagnosis and fix

Three new real-Git regressions initially failed with dirty-checkout for squash,
fixup and reword. The blanket cleanliness check rejected these operations even
though they preserve the final tree. Merely removing the guard would still leave
native rebase requiring clean tracked files, so these three commands now use
commit-object reconstruction instead of checking out historical trees.

The helper preserves original tree objects, author/committer metadata and dates,
and descendant message bytes; changed messages use UTF-8 and invalidated commit
signatures are removed. It validates the linear parent chain and identical final
tree before publication. A backup is retained, and an explicit bound-ref
compare-and-swap refuses competing commits. The index, worktree, untracked and
ignored files are never rewritten or stashed. Tests cover partially staged files,
hidden index flags, binary bytes, descendant metadata, hook isolation, failed
object/CAS writes, stale HEAD, and uncertain post-publication state.

Reorder/Cherry-pick/Revert retain their clean-tree and ignored-path guards.
Restore remains conservative: clean checkout and exact recorded result required;
for tree-only results it verifies tree equality and skips read-tree. External
processes do not join the plugin queue: explicit-ref CAS plus immediate HEAD/ref
checks cannot atomically prevent another process switching symbolic HEAD in the
final gap. No different branch is followed, and no files are touched by the new
path. Do not claim cross-process exclusion or run concurrent history edits.

## Design and verification

Native Modal chrome remains authoritative: 24px side padding, 16/24 title,
elevation without an added border. Fields follow the existing commit box:
8px radius, 0.5px token border, 6px/8px padding, with a full-width primary action.
No package colors or theme overrides were added.

- Full repository `pnpm test` passed: Git 1,161 passed / one filesystem skip;
  all other package suites and 185 repository-script tests passed.
- Git typecheck/build, docs pairing/check, locale parity, runtime dependency
  check and whitespace check passed.
- Independent scoped review approved; focused history suites passed.
- Chromium rendered the actual React components in light/dark representative
  token fixtures: 520x428 compact Squash dialog, no page errors; expanded AI
  controls and focus ring inspected. Screenshots and reproducible fixture are
  under `artifacts/testing/history-modals/`. These are component-level evidence,
  not mounted-GUI screenshots, and are deliberately not used as README media.
- Full CI and mount smoke stop in the existing Claude Plugins branded MessageId
  dependency mismatch (SDK 0.1.2-rc.1 vs 0.1.6-alpha.2). The E2E marker now checks
  compact fields and AI destination choice without submitting or applying.
- Existing GUI at port 3080 requires browser authentication not included in
  this session's DSH_WEB_URL. No replacement server or user-process restart was
  performed. Mounted verification/media refresh remain follow-up work.
- Rebuilt host code requires a DSH restart; browser refresh alone only updates
  the client. This package is private, so no changeset is required.
