# dsh-next-worktrees idea refined and recorded

- date: 2026-09-04
- status: proposed
- scope: docs/ideas/dsh-next-worktrees.md (future packages/dsh-next-worktrees)

Refined concept for a worktrees plugin recorded at
docs/ideas/dsh-next-worktrees.md. Core model: session-per-worktree with a
loop-centric golden path (isolate, run in parallel, foreground, test,
return or land, clean up); plain-git landing; one active session per
worktree; name stays `dsh-next-worktrees`.

Locks folded in after review: isolate is M1 / shuttle is v1; planned
confinement is a clutch-shaped `danger-full-access` preset on the worktree
session (not extra writable roots); foreground is branch shuttle plus
attention shuttle (running agent is a blocker; Return from both ends);
generated slug with prompt-derived title; worktrees off `git-common-dir`'s
primary with relative cwd preserved; conservative sweep; M0 probes before
any UI. Implementation has not started.

First M0 probe round (same day, results in
docs/archive/2026-09-04-worktrees-m0-probe.md): the `permissionPresets`
seam exists on the installed `0.1.2-rc.1` and the worktree denial/success
geometry was proven live under `workspace-write`; client session-focus
confirmed via the incumbent's shipped call chain.

Second round, live end to end in a scratch `dsh --profile m0` boot with a
throwaway host plugin: all three M0 assumptions now pass — session
creation with `meta.cwd` at a linked worktree lands the shell there;
`git add` is denied with full enforcement under `workspace-write`; the
canonical `setSandboxMode(session, 'danger-full-access')` knob write makes
add + commit succeed with approval untouched. Two corrections folded into
the ideas doc: a profile patch cannot restate an existing row by id (hard
`duplicate loader entry id` boot error, so no named preset row — knob
write only, selector reads `custom`), and sandbox-exec cannot nest (probe
lanes must boot scratch dsh unconfined; production unaffected). M1 is
unblocked; implementation has not started.
