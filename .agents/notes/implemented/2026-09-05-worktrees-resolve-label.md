# Worktrees conflict CTA: Resolve in this session

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Split the update verb by promise. A clean catch-up (worktree behind,
fast-forward) stays **Update from `{branch}`**. A merge that would
conflict uses **Resolve in this session** (ellipsis on the Merge modal
CTA that opens Update; none on the execute confirm). The conflict
blocker names that same step. Row menu is unchanged.
