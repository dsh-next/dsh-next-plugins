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

Runtime contract corrections discovered while driving the real GUI: the
lifecycle SessionSnapshot exposes `blank` (not composerPhase) and carries
no cwd — the session cwd comes from the sessions list projection
(`sessions.list.getSnapshot().byId[id].cwd`); HEAD is contextual inside a
linked worktree, so ahead-count runs from the primary against the branch
ref; and blank sessions render the hero state, which mounts no session
header, so the chip appears only after a first message.

Tests: 58 cases — exhaustive core logic, real-git host runner/service
flows, RPC envelope contract, jsdom client wiring. Gates: root typecheck,
test, build, docs:check, i18n:check, and the real-mount smoke green,
including the e2e marker that drives the full loop through the GUI
(workspace picker -> blank session in a git workspace -> toggle -> confirm
-> worktree workspace row, composer picker flip, Access-mode Custom from
the knob bind, registry + `git worktree list` on disk). Package stays
private until v1.
