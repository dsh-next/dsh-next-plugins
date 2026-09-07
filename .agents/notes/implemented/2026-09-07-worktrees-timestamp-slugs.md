# Timestamped worktree slugs

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-worktrees

Create was failing with `branch dsh-worktrees/sable-01 already exists`
after Delete (which keeps the git branch) because `nextSlug` only
avoided live registry rows and reused `[a-z]+-\d{2}`.

New slugs are `[a-z]+-YYYYMMDDHHmm` UTC (`willow-202606140222`). Create
also treats leftover `dsh-worktrees/*` refs as taken. Existing
`sable-01` rows keep working.

Create-error also dropped the host `hint` (setup stderr), so
`setup command failed: pnpm install` was all the dialog showed. The
modal now appends that hint.
