# Worktrees review follow-up

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Code review of the owned-browser plugin found two production bugs, a
lifecycle gap, missing tests, and leftover copy. All landed in this
change.

## Bugs

- **Sweeper dirty-refusal matched the message, not the code.** Production
  `WorktreesRpcError` has `code: dirty-remove-refused` and message
  `worktree has uncommitted changes`. The regex on `.message` never
  matched, so a dirty abandoned worktree had its session archived and
  workspace deleted while the checkout stayed on disk. Matcher now uses
  `.code` (with a message fallback); the unit test throws a real
  `WorktreesRpcError`.
- **Ahead was always 0 without origin.** `aheadCount` ran inside the
  worktree, so a stored symbolic `HEAD` base resolved to the worktree
  branch itself. Counts now run at the primary.
- **`.dsh/` blocked every merge.** `git status --porcelain` on the
  primary saw the plugin's own untracked sidecar as dirt. Porcelain
  lines under `.dsh/` are ignored.
- **RPC route was not disposed.** `registerRpc` now captures the
  `webServer.register` disposer and wraps it in `ctx.effect`.
- **Bind ignored a failed sandbox knob.** A `false` from
  `applySandboxMode` now throws `sandbox-refused`.
- **Create was not transactional.** If the registry write failed after
  `git worktree add`, the checkout was left behind. Create now
  force-removes the new tree on mutate failure.

## Tests

- Client `rpc()` envelope + HTTP error + refresh event (jsdom).
- Sweeper: production error shape, overlap skip, windows separators.
- Host: ahead counted at primary, sandbox-refused bind, create rollback.
- `plugin.spec.ts` replaced the scaffold with inject + register/dispose.
- E2E marker now drives Refresh, a green fast-forward Merge (keep), then
  a dirty two-step Delete.

## Cleanup

Dropped unused locale keys (`row.facts.base` / `path`, `row.newSession.aria`,
`hint.gitignore`, `error.rpc`). Overlapping sweeps are skipped. Sweep
paths go through `toPosix`.
