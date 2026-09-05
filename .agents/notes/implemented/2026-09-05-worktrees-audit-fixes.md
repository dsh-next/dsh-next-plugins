# Worktrees audit: bugs, edges, performance

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

Second-pass audit after the review follow-up. Production bugs, untested
edges, and one topology-cost issue.

## Bugs

- **Subdirectory workspaces were undecorated and unswept.** Creating from
  `packages/foo` registers the workspace at
  `<primary>/.dsh/worktrees/<slug>/packages/foo`. Projection looked up the
  topology by that full path (miss), so the row nested without the branch
  icon or merge/delete menu. The sweeper required the slug to have no `/`,
  so abandoned nested workspaces were never removed. Both now parse the
  first segment after `/.dsh/worktrees/`.
- **Merged badge died on local-only repos.** After a fast-forward, a stored
  symbolic `HEAD` base equals the branch tip, so `tipEqualsBase` hid the
  merged state. Create now pins `baseSha`; status/merge resolve that pin
  (legacy rows still resolve the symbolic base at the primary, not inside
  the worktree).
- **A failed `git worktree list` wiped the sidecar.** Non-zero git was
  parsed as an empty list, reconcile dropped every row, and `replaceAll`
  persisted it. List now throws; topology answers `ok: false` and leaves
  the registry alone.
- **A failed `git status` looked clean.** Merge preflight and unforced
  remove could proceed. `dirtyCount` throws on non-zero.
- **Half-created worktrees leaked.** If workspace/session/bind failed after
  the create RPC, the error modal said nothing changed while the git
  worktree (and maybe a workspace) stayed. The client now force-removes
  and deletes on the failure path.
- **Three merge blockers rendered as machine codes** (`unknown-slug`,
  `already-merged`, `no-target-branch`). Copy is in the dictionaries; the
  unused `running` blocker (host never emits it) is gone.
- **`.worktreeinclude` accepted `..` and absolute paths.** Those entries
  are skipped.
- **Missing git looked like "not a repository".** `ENOENT` is now
  `git-unavailable`.

## Performance

Session switch no longer refetches topology (one git fan-out per
worktree). Membership changes still pull; switching the open session only
re-runs the cheap sweeper against live store refs.

## Tests

- Path parser, GitRunner dirty/list/placement, blocker-key completeness.
- Projection + sweeper subdirectory paths; registry Windows separators.
- Create-time `baseSha`, merged-after-FF, list-failure does not wipe,
  unsafe include skip, client create rollback.
- E2E asserts `data-dshx-state=merged` after Keep on a no-origin repo.
