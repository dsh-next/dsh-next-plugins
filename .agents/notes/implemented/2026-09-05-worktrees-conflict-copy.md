# Worktrees conflict-resolution copy and chrome

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Screenshot review of the conflict loop. The merge-conflict blocker no
longer dumps `git merge <worktree>` (the wrong direction). It names
Update from `{branch}` as the next step; the CTA still opens the update
modal (ellipsis kept — it opens a dialog). In-modal execute confirms
drop the ellipsis (`merge.confirm` / `update.confirm`).

In-flight update: Cancel is gone (Escape / mask dismiss still leaves
MERGE_HEAD; the handoff line says so). Abort is the outline danger
control; Open session stays primary. The would-conflict hint uses
`state-warn-label` at 13/20 instead of caption gray.

No token deviations. Package stays private.
