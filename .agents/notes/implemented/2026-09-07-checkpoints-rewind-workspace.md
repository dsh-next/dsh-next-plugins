# checkpoints rewind keeps the workspace group

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

Rewind forks through Host `sessions.fork`, which copies cwd and lineage
but never calls `workspace.attachSession`. The web client's own Fork
action goes through session-controller, which attaches the child to the
workspace that already accounts the parent. Without that attach, the
rewound session appeared under Ungrouped instead of Web.

After a successful fork, checkpoints now finds that workspace on
`ctx.workspaceRegistry` and attaches the child. Attach failure is
swallowed the same way as worktree reclaim: files and Chat fork still
stand.
