# Worktrees create: session row first, setup spinner on the identity icon

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees

Create no longer runs `.worktrees.json` before the session exists. Host
`create` returns `setupPending`; the client opens the bound session, then
calls `setup`. While that runs, `settingUp` overlays the nested row so
its branch icon (`data-dshx-state=setting-up`) replaces the glyph with
the same 12px spinner. Invalid setup JSON still fails create (no flash);
a failed command still rolls the worktree, session, and workspace back.
