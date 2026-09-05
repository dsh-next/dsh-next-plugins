# Worktrees agent-resolved landing (0.1.0 milestone)

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Agent-resolved landing from docs/ideas/dsh-next-worktrees-0.1.md. When
Merge into the primary would conflict, the primary action is now Update
from the current branch: the plugin merges that branch into the worktree,
may leave the worktree mid-merge (red icon), focuses the bound session,
and seeds a prompt via `ISession.prompt` when the binding exists. Abort
is `git merge --abort` in the worktree. The primary checkout is never
left mid-merge. Foreground/Return stays parked.

The session-message seam exists on 0.1.2-rc.1 (`binding(id).session.prompt`);
a missing binding degrades to focus + modal instruction.

Package stays `"private": true` until a first-time README loop is proven
on a live profile.
