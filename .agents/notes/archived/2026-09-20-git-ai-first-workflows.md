# Git panel AI-first workflows and safety

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

Implements the approved [AI-first follow-up plan](../../../docs/ideas/dsh-next-git-ai-first.md)
after the [UX audit](../../../docs/archive/2026-09-19-git-ux-audit.md). The package is
still `private` and unversioned; nothing here is released.

## What changed

- **Repository identity.** Panel reads resolve the active checkout, root-relative
  paths use the real `toplevel`, and mutations serialize on the shared
  `commonDir` so a linked worktree cannot be edited as if it were the primary
  one. Pathspecs are literal; commit ids are immutable.
- **Write safety.** `commitAll` is one host transaction (reject unmerged index,
  stage, commit) instead of a client add-then-commit; cancellations use unique
  attempt ids in a session-scoped registry; index rollback captures and restores
  an opaque snapshot under `index.lock` instead of compare-then-read-tree.
- **Process lifecycle.** Git runs in a managed POSIX process group with a bounded
  TERM/KILL escalation; an unconfirmed shutdown quarantines the repository queue,
  including when a shutdown error is converted to a `GitError`. Windows
  production execution is refused before spawn (see limits).
- **Conflicts.** A real conflict editor (base/current/incoming/result, per-hunk
  choices, save-then-mark) with versioned writes, durable backups, Git's
  `conflict-marker-size` honored, and explicit refusal for workflows raw text
  cannot represent (custom working-tree-encoding, Git filters, submodules,
  oversized blobs).
- **History.** Multi-select with squash, fixup, reorder, reword, cherry-pick and
  revert, planned and previewed; fsynced journals plus
  `refs/dsh/history-backups/*`; continue/skip/abort/restore through
  `historyOperations.recover`. Rewrites refuse merges, roots, non-contiguous
  selections and other unreplayable topologies, and require an explicit
  acknowledgment for published history.
- **AI destination.** Every AI action opens one mandatory chooser: this session
  or a new session, with scope, file selection, sensitive-file defaults and a
  stale-preview recheck. Accepted tasks are tracked by exact request id and turn
  boundary, and a finished answer is offered as a commit message only while the
  repository has not moved.
- **Repository and hunk actions.** Fetch/prune, fixed-oid push, stash save/apply
  and branch create/rename/delete behind previews and explicit approvals; hunk
  staging with host-derived exact patches and whole-file fallback.
- **Worktree setup trust.** Creation is gated on a preview of the resolved
  `.worktrees.json` commands and `.worktreeinclude` paths, fingerprinted with
  the primary checkout, chosen base commit and platform. Nothing runs and nothing
  is copied without the matching explicit consent, an approval for another
  definition is refused, and copies never follow a symbolic link or replace an
  existing file.

## Limits kept explicit

- Conflict backups are manual; there is no one-click restore of a backup.
- An uncertain history completion stays interrupted rather than auto-restoring.
- Only POSIX managed Git execution is supported in production; Windows is
  refused before spawn.
- Fake-key browser tests prove the AI handoff, not a model's answer quality.
- Plugin mutations serialize per common dir; arbitrary external Git or editor
  processes do not join that queue.

## Verification

Package floor at the time of writing: 40 spec files plus the added component
suites (repository, hunks, agent results, worktree create) and the conflict
attribute regressions, all green under
`pnpm --filter @dsh-next/dsh-next-git test`, with `tsc --noEmit`,
`pnpm docs:check` and `pnpm i18n:check` clean. Runtime evidence and the
bilingual README pair are part of the same change.
