# dsh-next-reset (reincarnate /reset)

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-reset, packages/dsh-next-worktrees (reclaim)

`@dsh-next/dsh-next-reset` registers `/reset`. Host creates a blank
session in the same folder, copies title/model/preset/sandbox/approval,
optionally `reclaim`s a plugin worktree, appends `reset/handoff`. Client
watches the current event window and `open`s next then archives old.
Worktrees seam is `reclaim(from, to)` on Cordis key `dsh-next-worktrees`
(self-only; sandbox-write before mutate).

Live mount (`bash scripts/e2e-mount.sh`): ordinary-folder `/reset` stays
in workspace-b; plugin worktree registry `sessionId` moves; switch-away
does not sweep (archived sibling still a non-blank `byId` row — no
sweeper patch); `git worktree add` does not touch `registry.json`.
Owning one-pager: `docs/ideas/dsh-next-reset.md`.
