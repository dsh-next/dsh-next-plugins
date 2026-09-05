# dsh-next-worktrees 0.1.0 — agent-resolved landing

- date: 2026-09-05
- status: implemented in packages/dsh-next-worktrees (package still private)
- companion: [dsh-next-worktrees.md](dsh-next-worktrees.md) (product
  one-pager; isolate / merge / sidebar already shipped),
  [dsh-next-worktrees-sidebar-ux.md](dsh-next-worktrees-sidebar-ux.md)
  (UI contract; this milestone rides the same row menu and merge modal)
- supersedes: the product one-pager's "M2 — Shuttle" and "v1 includes
  Foreground/Return". Cursor-style foreground is parked, not cancelled.

## Problem Statement

How might we let a DSH user land a worktree even when it conflicts with
main — without dumping them to the CLI, without a plugin-owned merge
editor, and without touching the primary checkout until the result is a
fast-forward?

## Recommended Direction

Spend the next milestone on **agent-resolved landing**, then un-private.
That is 0.1.0.

Cursor's Foreground exists because Cursor is an IDE: `/apply-worktree`
switches the winner onto the checkout the editor already has open. DSH
is a session runtime. The worktree session is already the test surface,
and Merge already brings a green tree home. The hole is the other half
of Merge: today a conflict is a disabled button and a copyable
`git merge` command. That is the moment a first-time installer decides
the plugin is a demo.

The move is the direction flip the UX spec already named and never
built. On conflict (and as a row action before conflict), merge the
primary's current branch **into the worktree**. Conflicts land in the
sandbox, in the session that did the work. The agent resolves and
commits. Then the existing one-click Merge is a fast-forward by
construction, and the primary is never left mid-merge.

One new host write, one new row verb, one new conflict-modal CTA. The
resolver is an agent, not a three-pane widget. Cursor does not have
this.

Foreground/Return stays parked. It was the old M2 because the
2026-09-04 one-pager copied Cursor's apply gesture. Merge replaced that
landing. Do not build the reservation in `newRequestId()` just because
it is sitting there.

## Key Assumptions to Validate

- [ ] **The bound worktree session is the right resolver.** Same
      session, same context. Test: pick a real conflicting pair, run
      update-from-main, let the existing session finish the merge. If
      the session is gone, there is no agent to hire — that case stays
      "abort to manual," not a new session.
- [ ] **We can put the job in front of the agent.** Proven today:
      `sessions.open`. Unproven: seeding a user message. Probe the
      session-controller / conversation send seam on `0.1.2-rc.1`
      before wiring UI. If it is missing, 0.1.0 degrades to **focus +
      short instruction in the modal** (user hits send). Do not invent
      agent tools.
- [ ] **Agents resolve conflicted files well enough to trust.** Five
      real conflicts, not fixtures. If the agent authors junk, stop
      automating the merge start — the canned-prompt fallback is then
      the product, not a stepping stone.
- [ ] **A worktree mid-merge is acceptable; a primary mid-merge is
      not.** Update execute may leave the worktree in `MERGING`. Status
      goes red. Abort is `git merge --abort` in that tree
      (plugin-offered if we detect it). The primary is untouched until
      Merge is green.
- [ ] **A first-time user can complete isolate → conflict → update →
      merge → cleanup from the README alone.** That is the public-0.1.0
      bar. If they cannot, we are not ready to drop `private`.

## MVP Scope

**In**

- Host RPCs `update/preflight` and `update/execute`: merge the
  primary's current branch into `dsh-worktrees/<slug>` with cwd = the
  worktree. Same blocker grammar as Merge (clean worktree, known slug,
  modern git, conflict dry-run via `merge-tree` in this direction). A
  running session is a blocker. No bound session is a blocker.
- Execute starts `git merge --no-edit <primary-branch>` inside the
  worktree. Clean result → topology refresh, Merge becomes FF.
  Conflicts → leave the worktree mid-merge, never touch the primary.
- Row menu: **Update from `<branch>`…** in the slot that was reserved
  for Foreground (between Refresh and Merge). Same preflight modal
  grammar as Merge.
- Merge modal: when the blocker is `conflict`, the primary button is
  **Update from `<target>`…** (opens the update modal). The blocker
  copy names that step; there is no CLI dump.
- Status: red icon for merge-in-progress / conflict (the token already
  reserved). Refresh notices it.
- Abort: if the worktree is mid-merge, the modal offers Abort
  (`git merge --abort` in the worktree) alongside the "resolve in this
  session" path.
- Handoff: focus the bound session. Seed a message if the seam exists;
  otherwise the modal tells the user to send. Plugin never authors
  commit content.
- README describes this loop. Idea docs stop advertising composer-toggle
  M1 and shuttle-as-v1.
- Drop `"private": true` and add a changeset only when the loop above
  is live and the README can stand alone.

**Out of this milestone, even if they fit in the same PR:** settings
card, gitignore hint as a product feature, rename-in-menu, base-ref
picker, setup-commands, push/PR.

## Not Doing (and Why)

- **Foreground / Return** — Cursor's apply-worktree is an IDE gesture.
  Merge already lands. Park until live use produces a pull ("I need the
  winner on my main checkout to run the app").
- **Always-update on every Merge** — extra git on the happy path for a
  problem that only exists when the tree drifted. The row action is how
  you keep current; Merge stays a land.
- **Plugin-owned three-way merge UI** — no editor primitives, duplicates
  `$EDITOR` / `git mergetool`, largest data-loss surface in the design
  space. Still never.
- **Plugin-authored conflict resolution commits** — invariant 1. The
  agent commits. We only start or abort the merge.
- **Auto-stash, rebase, cherry-pick** — silent stashes destroy trust;
  rebase rewrites; Merge/Update stay `merge --no-edit`.
- **Agent tools to create/enter worktrees** — user-only creation.
  Update is a user click that may seed one message, not a tool the
  agent can fire.
- **New session on update** — one session per worktree. If that session
  is gone, abort to manual. Do not spawn a blank resolver with no
  context.
- **Settings registry, worktree lock, silent merged-sweep,
  `worktrees.json`** — later / Cursor-setup. None of them is why
  someone bounces on first conflict.
- **One-click push/PR** — the loop ends at a fast-forward into the
  current branch. Push stays git / host.

## Open Questions

- Does the client session/conversation API on `0.1.2-rc.1` let us
  append a user turn to an existing session, or only create/open/focus?
- If the worktree is already `MERGING` (crash, kill, refresh), is the
  row action "Continue in session" / "Abort", and nothing else?
- First public version via the changeset pipeline in the same change as
  the feature, or feature-on-`dev` then a separate un-private PR?
