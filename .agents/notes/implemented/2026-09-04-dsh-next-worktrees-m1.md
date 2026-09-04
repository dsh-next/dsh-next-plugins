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

Live dev-profile validation (Playwright against `mise run dev worktrees`,
22 scripted checks, screenshots in /tmp/dsh-worktrees-manual/shots)
surfaced one behavior fix: the chip dropdown's sibling list included the
session's own worktree, so the "No other worktrees" empty state was
unreachable and the dropdown carried a redundant self row. Siblings now
exclude the session's own binding (host service filter, unit-covered).
Everything else held: preflight gating (non-git and unborn workspaces
hide the toggle entirely), the one-time ignore hint persisting through
reload via localStorage, draft-derived registry titles, `.worktreeinclude`
copies, the first message un-blanking the session (the keyless model
failure still lands the user turn) and mounting the chip with title and
clean dot, panel facts, real clipboard copy actions, the ahead badge
after a commit, new-session-here rebinding the registry owner, sibling
creation from inside a worktree, sibling navigation, orphan reconcile
after a manual `git worktree remove`, and the dirty remove flow whose
forced removal keeps the branch and its commits.

Two GUI facts worth remembering for future rounds: blank sessions vanish
from the sidebar once focus moves (only the current session and titled
sessions get rows), so the chip flow must run while the created session
is still focused; and the keyless-send "Add an API key" nudge appears
mid-flow with a full-screen mask whose input overlays the composer bar —
any scripted driver must dismiss dialogs between steps.

Tests: 59 cases — exhaustive core logic, real-git host runner/service
flows (including the sibling self-exclusion contract), RPC envelope
contract, jsdom client wiring. The mount smoke's worktrees marker now
drives the full loop plus the edge matrix through the GUI (preflight
negatives, hint persistence across reload, modal cancel, create with
registry/include-copy assertions, chip facts + clipboard + ahead badge,
dirty force removal with branch survival). Gates: root typecheck, test,
build, docs:check, i18n:check, and the real-mount smoke green. Package
stays private until v1.
