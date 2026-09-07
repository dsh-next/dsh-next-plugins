# checkpoints rail resize and file preview

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-checkpoints

The Changes pane lists files only; DiffBlock / kind notes open when a file
row is clicked (click again closes). The right checkpoint rail is
drag-resizable (180–420px, AppFrame handle chrome) and auto-collapses to a
56px numbered-icon rail when the Changes view is under 720px, matching the
harness sidebar compact rail.

Rewind also `sessions.fork`s at the checkpoint seq and the client opens
the child then archives the parent, so Chat no longer shows later turns.
The log is append-only; Chat will not hide bubbles in-place. If the
parent was a plugin worktree session, rewind calls worktrees `reclaim`
so the child keeps the slug, badge, and danger-full-access sandbox.
