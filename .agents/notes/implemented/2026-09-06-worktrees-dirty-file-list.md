# Merge dialog lists dirty files and still runs

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees

Dirty-primary / dirty-worktree are Merge *warnings*, not hard stops. The
dialog lists the uncommitted paths (sidecar `.dsh/` omitted) and names
the branch they sit on (`main` vs `dsh-worktrees/<slug>`). Merge stays
enabled; `git merge` of the branch ref into the primary is the last gate
(it refuses when those primary files would be overwritten). Uncommitted
worktree files are not part of that merge. Update still blocks on a dirty
worktree because that write lands in the worktree.

The list is 12/18 `label-secondary`, max-height six caption lines,
`overflow-y: auto`, no extra border. A long list is tabbable.

Design: surface = merge/update modal; tokens = `state-warn-label` for the
Merge warning, `label-error` for hard blockers; geometry = 108px cap
(6 x 18); controls = Merge remains the primary; keys =
`merge.blocker.dirtyPrimary` / `dirtyWorktree` / `blocker.dirtyFiles`.
