# Extended minimalist Git command menu

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Extends the three-dot menu with the command families shown in the requested VS
Code screenshots. The bilingual README owns the command inventory and end-user
limitations. Menus reuse native SDK rows, colors and keyboard behavior. Native
submenus do not perform viewport collision handling; a scoped, disposable
placement hook fits fixed nested cards on either side and on short screens,
with scrollable cards. They touch the parent row edge to preserve pointer
travel while scrolling. Dialogs retain the minimal 400px layout: no repository
heading, Refresh or Cancel footer, and one action-specific form at a time.

## Contracts and safety

- Existing stage/unstage/discard, checkout, branch create/rename/delete, fetch,
  normal push and stash save/apply paths remain canonical.
- Commit variants use the existing commit transaction, preserving hook failures,
  cancellation ownership and index rollback. Sign-off is a strict boolean argv
  option; amend requires acknowledgement, loads the complete HEAD message, and
  pins the reviewed HEAD. External HEAD changes preserve the draft and refuse
  an amendment rather than silently replacing another commit.
- A full-suite hanging-hook timeout exposed an existing early-cancel race:
  registration happened after repository discovery. A deterministic regression
  proved immediate cancellation was lost; registration now precedes discovery
  and is cleaned up on every exit, preserving session ownership.
- New command requests have an explicit JSON union and strict parser. RPC input
  rejects extra/unknown fields and unapproved execution. Preview versions bind
  source checkout, request and relevant Git state; writes use the shared queue.
- Force push and remote deletion use an explicit advertised-OID lease, never
  unconditional force. Preview may contact the chosen remote. Normal pull/sync
  is fast-forward-only; rebase is a separate command.
- Pop keeps its stash on apply conflicts. Identity-based stash drop holds Git's
  files-backend stash ref/reflog/packed-ref locks rather than deleting a shifting
  ordinal. Reftable and packed stash refs are refused; ref/reflog replacement is
  not crash-atomic. External writers remain outside the plugin mutation queue.
- Clone creates only a new workspace-relative folder, never removes existing
  directories, does not initialize submodules, and does not switch sessions.
- Git output intentionally shows bounded safe command-result summaries rather
  than raw network output or credential-bearing URLs.
- Metadata-only commands do not run status/diff or inspect worktree contents;
  their approvals bind index/config/refs/HEAD/stashes, not unrelated file edits.
  This permits remote/tag operations with unrelated global LFS/helper settings.
  Checkout-affecting commands still conservatively refuse executable filter or
  custom merge-driver declarations. Normal Git credential helpers are retained;
  SCP-style SSH URLs are validated and supported, but live auth was not tested.
- Stash metadata ancestors/leaves and owned locks are validated with lstat,
  realpath, nofollow reads and inode rechecks. Foreign replaced locks are not
  removed. Portable revalidation is not atomic openat protection against hostile
  directory swaps. Staged-only stash supports disjoint staged/unstaged files;
  same-file overlap fails closed rather than risking the unstaged edits.

## Verification

Coverage includes each menu leaf, command mapping/form, request approval and
stale preview, cancellation, local path selection, RPC envelopes, and real Git
fixtures with local bare remotes. Git browser coverage drives every menu group,
asserts viewport containment, and creates a remote and tag only in the owned
fixture. Light/dark screenshots are inspected before final handoff. No live
GitHub push, user's remote mutation, or current GUI restart is performed.

Final results: Git typecheck/build pass; 1,554 Git tests pass with one existing
skip. The complete repository unit/script run passed after the early-cancel
fix; the final amend guard then passed the entire Git suite again. Docs, i18n,
runtime dependency checks and diff whitespace checks pass. Real Git E2E passes
(artifacts/testing/run-o7cicw), including group routing and actual fixture remote
and tag creation; dark menu and commit-variant screenshots were inspected.
The whole-repository static gate remains blocked by the pre-existing mixed
SDK MessageId brands in cc-plugins, also blocking the family mount build.
No dependency versions were changed to mask that unrelated failure.
