# dsh-next-worktrees (idea one-pager)

- date: 2026-09-04
- status: isolate + nested sidebar + guarded merge shipped (2026-09-05);
  next milestone is agent-resolved landing, then public 0.1.0 — see
  [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md). M0 probes passed
  2026-09-04 (docs/archive/2026-09-04-worktrees-m0-probe.md).
- name: `dsh-next-worktrees` (no `git-` qualifier; discovery via package.json
  keywords: git, worktree, git-worktree, worktrees, deepseek-harness, dsh,
  plugin)
- product: one-sentence pitch — "Run parallel DSH agents on one repo without
  collisions; land the winner with one-click merge (agent-resolved when it
  conflicts)."
- ux pivot (2026-09-05): the composer toggle and header chip are replaced by
  a sidebar-first surface; see
  [dsh-next-worktrees-sidebar-ux.md](dsh-next-worktrees-sidebar-ux.md) —
  the design spec that owns the current UI.
- v1 pivot (2026-09-05): Foreground/Return (old M2) is parked. Public 0.1.0
  is isolate → run → conflict-complete merge → cleanup, not the Cursor
  shuttle. Contract in the 0.1 one-pager.

## Problem Statement

How might we let multiple DSH sessions work on the same repository
concurrently without colliding — by giving each new session its own git
worktree — with one-click UX instead of git ceremony?

Isolate is the painkiller. Shuttle is the differentiator. They are two jobs
on one golden path: M1 ships the first, v1 ships both.

## Recommended Direction

Session-per-worktree, Claude-Code-style, organized around one golden path:

```
ISOLATE -> RUN IN PARALLEL -> FOREGROUND -> TEST -+-> land (YOU merge/PR) -> CLEAN UP
                                                  +-> fail -> RETURN TO WORKTREE
                                                       (inverse shuttle; session
                                                        iterates with context)
```

The "Isolated" toggle on the New Session composer creates the worktree and
starts the session inside it (opt-in, default off). A session-header chip
carries status, sibling navigation, and the shuttle. Landing stays plain git
(merge, rebase, PR). Foreground is Cursor's gesture adapted to DSH: a
guarded `git switch` of the branch onto the user's main checkout **and**
focus (or create) of the session whose cwd is that checkout — because DSH
is not an IDE, and a branch shuttle without an attention shuttle leaves
TEST with no home. Return is the inverse, available from both ends.
Cleanup follows the user's merge, never precedes it.

This is the empty slot between the two incumbent DSH plugins
(clutch-dsh-worktree's environment-manager sidebar; wloops' task-bunker
landing state machine): we take only the multi-session attach affordance
from the former and the diff-surfacing instinct from the latter.

Locked decisions:

- Worktree path is `<primary>/.dsh/worktrees/<slug>`, where primary is the
  working tree that owns `git-common-dir` — never nested inside an existing
  worktree.
- Session cwd is that worktree path plus the original workspace's relative
  path from the git root (`repo/packages/foo` →
  `repo/.dsh/worktrees/<slug>/packages/foo`).
- Slug is generated; prompt words are the display title only (never the
  branch name — PII the moment someone pushes). Branch
  `dsh-worktrees/<slug>`, base `origin/HEAD` with local-HEAD fallback.
- Isolated sessions switch only the sandbox knob: the host half calls the
  public `setSandboxMode(session, 'danger-full-access')` export from
  `dsh-sandbox-policy` (the canonical setter the preset service itself
  drives) after one confirmation, leaving the approval knob at the
  deployment default. Linked worktrees store git metadata in the common
  `.git`, outside session cwd; DSH has one workspace-write root and no
  extra writable roots — proven end to end in a live scratch profile on
  2026-09-04: from a worktree-cwd session, `git add` dies on `index.lock`
  under `workspace-write` with full enforcement, and the one knob write
  makes the same add + commit succeed. The native Permissions selector
  reads the combination as `custom` (display-only) — acceptable; our
  settings card explains the state. A named preset row is not possible on
  `0.1.2-rc.1`: a profile patch cannot restate an existing row by id
  (`duplicate loader entry id` is a hard boot error), and the stock
  `danger-full-access` row bundles approval `never` — never select it.
- Merge-back: the guarded one-click Merge action in the worktree menu
  (user decision 2026-09-05; contract in the UX spec). The README keeps
  the manual `git merge` recipe as the fallback path.
- Sidecar registry is derived from `git worktree list` plus plugin marks;
  git is the source of truth; reconcile on startup.

Invariants:

1. No patch apply, no rebase, no conflict resolution — the plugin never
   applies deltas and never resolves conflicts. Creating
   `dsh-worktrees/<slug>` refs and worktrees is in-scope. Writes to the
   user's checkout are exactly two, both guarded and preflighted: the
   `git switch` of the shuttle, and (pivot 2026-09-05, UX spec) the
   one-click Merge — a `git merge --no-edit` of a worktree branch into
   the primary checkout's current branch, conflict-dry-run via
   `git merge-tree`, aborting to the manual command on any blocker. The
   plugin never authors commit content of its own.
2. One session per worktree (1:1) — every worktree-icon click creates a
   new worktree session; "new session here" and folder-grammar sub-rows
   are dropped (user decision 2026-09-05). Parallel work means parallel
   trees; a fresh context means a new tree.
3. Foreground detaches the worktree (the worktree session keeps its cwd);
   cleanup is offered after landing.

## Key Assumptions to Validate

M0 — probe before any UI, before treating M1 as unblocked. First-round
results (2026-09-04) recorded in
[docs/archive/2026-09-04-worktrees-m0-probe.md](../archive/2026-09-04-worktrees-m0-probe.md):

- [x] Session creation with an absolute `cwd` puts the session shell there
      — proven live in a scratch profile on 2026-09-04 (scripted
      `ctx.sessions.create` with `meta.cwd`; the resolved policy root and
      the run's `pwd` both land in the worktree). Client-flow
      corroboration: the incumbent's `sessions.create` binds to a
      workspace path and validates the projected cwd.
- [x] `git commit` from a session whose cwd is a linked worktree is denied
      under `workspace-write` and succeeds after the session's sandbox knob
      switches to `danger-full-access` — proven live end to end (denial
      with `enforcement: full` on `index.lock`; knob write via
      `setSandboxMode`; add + commit succeed; approval stays `ask`).
- [x] The client can focus another session (sibling nav, attention shuttle,
      "new session here" takeover) — confirmed: `workspaces.create`,
      `sessions.create`, `sessions.open(sessionId)` on this client line,
      shipped by the wloops incumbent.

Then:

- [ ] `conversation.input.left` and `conversation.session.header.actions`
      behave on the pinned SDK `0.1.2-rc.1` line.
- [ ] Branch-name collision suffix logic keeps creation one-click.
- [ ] Users can land work via plain git with the README + copy-command
      recipe.

## Scope

M1 done: two isolated sessions run on one repo without colliding.

v1 ship (superseded 2026-09-05): a user completes one full unaided loop —
spawn two isolated sessions, run concurrently, land via guarded Merge
(agent-resolved update-from-main on conflict), clean up. Foreground/Return
is parked; see [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md).

Do not promise the family mount smoke drives that loop.
`tests/e2e/mount.e2e.ts` asserts the Isolated toggle and the header chip
mount. Preflight, shuttle, and sweep are host-side git fixture tests. The
golden path is a manual pass on a scratch profile.

Milestones (each independently shippable, ordered by the loop):

- M0 — Probes: the three M0 assumptions above. No composer toggle, no chip,
  until they pass. `pnpm plugin:new worktrees` may land an empty private
  package to host further probes; it does not unblock UI. (Passed
  2026-09-04; M1 is unblocked.)
- M1 — Isolate + Run: composer toggle (blank sessions in git-passing
  workspaces only; default off), generated slug and prompt-derived title,
  branch/base/placement/cwd rules above, `.worktreeinclude` copy, git
  preflight with copyable setup hints, degraded read-only mode when git is
  unavailable, one-time gitignore hint for `.dsh/`, sandbox knob switched
  on create after confirmation, header chip (title, branch, ahead
  count, status dot: clean/dirty/foregrounded/error) with dropdown
  (worktree facts, sibling list with running/idle dots, "new session here"
  gated on idle, remove with danger grammar stating what survives).
- M2 — Shuttle: **parked 2026-09-05.** Replaced as the next milestone by
  agent-resolved landing (update-from-main, then Merge is a fast-forward).
  Foreground/Return stays a fast-follow if live use produces a pull.
  Contract: [dsh-next-worktrees-0.1.md](dsh-next-worktrees-0.1.md).
- M3 — Hygiene + management: silent startup sweep that removes only
  plugin-marked, fast-forward-merged, clean worktrees (squash-merge will
  not look merged; user-initiated remove is the real hygiene — do not
  over-invest in merge detection), `git worktree lock` while a session
  runs, settings card ("remember isolation per workspace" toggle with
  reset list, base-ref and branch-prefix defaults, full worktree registry
  with per-row cleanup).

Cross-cutting:

- Host half: git via subprocess, sidecar registry reconciled from
  `git worktree list`, mutations serialized per repository.
- Design contract: `--dsw-*` tokens only; 13/20 and 12/18 type pairs; 0.5px
  neutral vs 1px state borders; elevation-not-border modals; exactly one
  animated element (spinner); en/zh dictionaries (`pnpm i18n:check` clean);
  dropdown capped at about five actions with overflow graduating to the
  settings registry.
- Package stays `"private": true` until v1 is ready to release; keywords
  as in the header.
- Forward-compat insurance (zero behavior change in v1):
  - The create RPC accepts an optional `baseRef` parameter from day one
    (settings default fills it), keeping the base-ref picker, Ghost
    Checkout, and fleet launcher forever additive.
  - Registry bindings carry a `role` field, always `owner` in v1, making
    the future read-only inspector a new enum value instead of a schema
    migration.

## Not Doing (and Why)

- Review/preview/landing machinery (wloops-style) — duplicates
  merge/rebase; the largest data-loss surface in the design space.
- Agent tools to create/enter worktrees mid-session — user-only creation
  keeps the permission story simple; if ever built, wloops-shaped handoff
  (new session, context carried), never live cwd migration.
- Auto-stash on shuttle blockers — silent stashes destroy trust; blockers
  name the fix and the user acts.
- Environment-manager sidebar (clutch-style) — heaviest UI and state
  investment; the chip covers most navigation need at a fraction of the
  cost.
- Concurrent sessions per worktree — read-only inspector is the sanctioned
  post-v1 loosening.
- One-click push/PR — the loop ends at the guarded Merge (one-click
  landing added by user decision 2026-09-05, see the UX spec); pushing
  and PR creation remain manual git / fast-follow.
- Extra writable sandbox roots, or any DSH source change — the public
  permission-preset seam is the confinement story; we will not invent roots.
- Cross-project/global manager, non-git VCS hooks, subagent-level isolation
  config, LFS special-casing — out of v1 reach and demand.

Fast-follow backlog (all additive by design, see insurance notes): base-ref
picker in the create popover; agent-resolved merge conflicts via the
direction flip ("update the worktree from main" inside the worktree
session, after which the primary merge is a fast-forward — contract in
the UX spec's conflict ladder); diff action on the worktree row menu
(verify whether a details-column seat or a plugin-owned modal renders it,
before building); Ghost Checkout (branch/PR-based isolation); committed
project presets with setup commands (Cursor `worktrees.json` pattern,
including file shape and precedence); fleet launcher (tiled status grid
with per-worktree cost visibility from day one); one-click push/PR;
read-only inspector attach. Sidebar integration ceiling, verified against
the installed 0.1.2-rc.1 client on 2026-09-05 (evidence and full
inventory in the UX spec): the workspace browser tree is flat with
hardcoded row controls and no per-row action slot, so per-row glyphs,
row-menu items, and true nesting all require an upstream per-row channel
in ui-workspace; until then the sidebar-foot `sidebar.footer.action` slot
plus `rename`/`insertBefore` pinning is the entire sanctioned surface.

## Open Questions

- Whether client session creation can bind a cwd below the registered
  workspace root (the relative-path-preservation rule), or whether the
  workspace must be registered at the sub-path itself.
- Form of the main session's passive "on foregrounded branch" affordance
  once the chip is gone (UX pivot, 2026-09-05): a popover-row state, a
  one-line banner, or toast-only. Return must be reachable from main either
  way; this is only the chrome, and the UX spec owns the decision.

## Research Provenance

Direction validated against: Claude Code worktrees (`--worktree`,
`.worktreeinclude`, cleanup sweeps, one session per worktree), Cursor 3.0 to
3.2 (Agents Window, empty-state branch selection, one-click foreground,
`.cursor/worktrees.json`), the two incumbent DSH plugins (seat inventory,
sidecar lessons, delivery-state-machine caution), clutch's
`worktree-full-access` preset (`danger-full-access` on worktree sessions
because `git-common-dir` sits outside cwd), and Codex CLI's lack of native
worktrees (the gap this plugin fills).
