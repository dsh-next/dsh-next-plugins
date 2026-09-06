---
"@dsh-next/dsh-next-worktrees": patch
---

Merge lists uncommitted files as a warning (naming the branch they sit on) and still lets you Merge. Git will refuse if the main folder's files would be overwritten. Uncommitted worktree files are not included. Update still blocks on a dirty worktree.
