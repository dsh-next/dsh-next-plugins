# dsh-next-worktrees M1 isolate-and-run implemented

- date: 2026-09-04
- status: implemented
- scope: packages/dsh-next-worktrees

M1 of docs/ideas/dsh-next-worktrees.md: composer "Isolated" toggle
(conversation.input.left, blank sessions in git-passing workspaces only)
that creates a worktree at `<primary>/.dsh/worktrees/<slug>` on branch
`dsh-worktrees/<slug>` (base origin/HEAD with local-HEAD fallback,
`.worktreeinclude` copy, sub-path-preserving session cwd), registers the
workspace, creates the session, binds it (sandbox knob switched to
danger-full-access via the canonical setSandboxMode after cwd
verification, approval untouched), and focuses it. Session-header chip
(conversation.session.header.actions) with title/branch, ahead count,
status dot, and a dropdown carrying facts, sibling navigation, copy
branch/merge actions, new-session-here gated on idle, and remove with
dirty-refusal danger grammar. Registry sidecar reconciles against
`git worktree list` (git is truth); mutations serialized per repo.

Design decisions proven on the way: no named preset row (duplicate loader
entry ids hard-fail the boot), HEAD is contextual in a worktree so
ahead-count runs from the primary against the branch ref, and the composer
injects no owner props into input.left entries (standard props carry
sessionId/useSession/useInput).

Tests: 58 cases — exhaustive core logic, real-git host runner/service
flows, RPC envelope contract, jsdom client wiring. Gates: root typecheck,
test, build, docs:check, i18n:check green. Package stays private until v1.
Remaining before merge: the per-plugin e2e DOM marker (git-init a
DSH_E2E_WORKSPACE, drive toggle through confirm, assert the chip) and a
green `mise run e2e`.
