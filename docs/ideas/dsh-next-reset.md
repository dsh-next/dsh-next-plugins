# dsh-next-reset

- date: 2026-09-06
- status: implemented — 0.1; e2e mount proves /reset, reclaim, sweeper keep
- name: `dsh-next-reset` (command `/reset`; not `/clear`)
- product: one-sentence pitch — "Start a blank session in this folder;
  archive the current one."

## Problem Statement

How might we throw away a polluted DSH conversation and land in a truly
blank chat **in the same folder** — including plugin worktrees and
manual `git worktree` checkouts — without minting a session the
worktree plugin will refuse to claim?

The job is worktree-bound DeepSeek Harness sessions, not Claude Code
muscle memory. Recreating a session drops the
`dsh-next-worktrees` registry claim (one writer per tree). The stock
workaround (New Session) is therefore a footgun for that plugin, and
it is unnecessary ceremony for ordinary folders and CLI worktrees.

Success: composer empty, Hero chrome of a blank session, same
workspace / cwd / git checkout. The sidebar row should still read as
this work (copied title).

## Recommended Direction

Ship `@dsh-next/dsh-next-reset` as a slash command `/reset` with a
**thin browser half**. It does not wipe the current session log (DSH
cannot re-blank a session: logs are append-only, `session.blank` is
monotone, and the Chat transcript is append-origin events). It
**replaces** the session.

Host command (`ctx.commands.register`):

1. If the agent is running, or `inbox.hasPending`, error — same
   posture as `/compact`. Do not silently cancel a live turn or drop
   a queued prompt.
2. Refuse subagent sessions (`header.origin === 'subagent'`).
3. Create a new session in the **same workspace** (same cwd, including
   nested `relPath` worktree workspaces). No workspace → create with
   `header.cwd`. No cwd → error.
4. Copy title (pins via `sessionTitle.rename`), model selection,
   agent preset, last `sandbox/mode`, and last `approval/policy`.
5. If `dsh-next-worktrees` is mounted **and** cwd sits under
   `/.dsh/worktrees/<slug>`, **reclaim** the registry row onto the new
   session id and re-apply `danger-full-access`. If the plugin is
   absent, or the cwd is a CLI worktree / ordinary folder, skip.
6. Append an **ignorable** log-only `reset/handoff` event on the
   **old** session: `{ nextSessionId }`. Do **not** archive on the
   host. `command/done` may still record a short English success
   line (ACP/logs); the web user will not see it.

Client (required for the golden path):

7. Watch the **current** session's `binding(id).eventSource` (the
   same follow window the transcript already has open).
8. On a live `reset/handoff` append: `sessions.open(nextSessionId)`
   **first**, then `workspaces.archiveSession(oldId)`.

That order is load-bearing. Archiving the current session from the
host (or before open) runs `uiWorkspace.clearArchivedCurrent()`, which
calls `sessions.clear()` and lands the GUI on the **no-session empty
state**. `sessions.open` is client-only; a host-only plugin cannot
switch the row.

Handoff rides the session follow stream, not a notifier-style poll
(2s is too slow for a slash command) and not parsed `command/done`
text. The event is `ignorable: true` so older DSH readers skip it
instead of refusing the log. Idempotent: if `next` is already
current, or `old` is already archived, no-op.

Fail closed: if a step after create fails, archive the **new** blank
session and leave the old one. Single-flight the command (like
`/compact`) so two `/reset`s cannot mint two blanks.

A CLI `git worktree add` checkout is just a workspace directory. A new
session in that workspace keeps the git checkout. The worktrees plugin
only owns `/.dsh/worktrees/<slug>` paths; it is not a dependency.
Collaborate through an optional Cordis service (`ctx.get('worktrees')`
or equivalent RPC), never a value import.

This is reincarnation, not `SessionStartSource 'clear'`. The new agent
gets a normal `startup`. Skills and SessionStart hooks run for real.
Do not fake `'clear'`.

Archive in DSH today has **no unarchive UI** (`dsh-client-ui-workspace`:
archived sessions have no viewing or restore surface). `/reset` is
"replace this chat." The JSONL remains on disk; the sidebar will not
offer it back. The README must say that.

### Why `/reset`, not `/clear`

DSH already reserved `SessionStartSource 'clear'` for an **in-place**
wipe of *this* session, and already ships `/compact` as
`dsh-command-compact`. A future `dsh-command-clear` registering
`/clear` would mean "forget in this log," not "mint a new session and
archive the old one." Occupying `/clear` would teach the wrong muscle
memory and become a behavior collision, not a polite rename. `/goal
clear` is a subcommand of `/goal` and is unrelated. Do not alias
`/clear` → `/reset` in 0.1.

## Key Assumptions to Validate

- [x] `session.create({ workspaceId })` yields a blank session whose
      `header.cwd` equals the old workspace path (including worktree
      `relPath` subfolders) — live profile, not a unit mock.
      E2E: `/reset` in workspace-b stays grouped under workspace-b
      (Hero chrome of a blank session).
- [x] After archive, the GUI shows one row: the new blank session, same
      workspace grouping — screenshot (`test-results/reset-after.png`
      from the mount smoke).
- [x] Plugin worktree: after `/reset`, `bind`/`status`/Merge see the
      **new** session id and git still works (`danger-full-access`) —
      live mount on a worktree session.
      E2E: registry `sessionId` changes and the checkout remains.
- [x] CLI worktree (no plugin): a `git worktree add` checkout does not
      touch `registry.json` (e2e disk assert). `/reset` in that folder
      is the ordinary-folder path (reclaim skips); covered by the
      workspace-b marker plus `reclaim` skip unit tests.
- [x] Sweeper: switching away from the new blank session does **not**
      delete a plugin worktree that still has an archived sibling in
      `workspace.sessionIds` — sweeper regression test plus a live
      switch-away. Archive keeps the old non-blank row in `byId`; no
      sweeper patch.
- [ ] Users accept one-way archive — ask someone who lives in worktree
      sessions before calling this 0.1.

## Must resolve before implementation

These are not polish. Scaffolding without them ships a command that
leaves the GUI on an empty workspace picker, or a worktree whose
Merge still points at the archived id.

1. **Client half is mandatory; handoff is `reset/handoff`.**
   `ISessions.open` lives on the browser sessions service. Host
   `archiveSession` of the current row does not open the
   replacement — it *clears* the selection. The host command
   appends an ignorable `reset/handoff { nextSessionId }` on the
   old session; the client watches `binding(current).eventSource`
   and then `open(next)` → `archive(old)`. Web-only in 0.1;
   ACP/headless should error rather than mint an orphan blank.
2. **Open, then archive.** Reverse that order and the stock
   `clearArchivedCurrent` wipes `current` to the no-session hero.
   Command `command/done` text lands on the *old* log and will not
   be seen; the switch *is* the acknowledgement.
3. **Copy sandbox + approval, not just model.** `sandbox/mode` and
   `approval/policy` are per-session log folds. A new session starts
   at the deployment default (`read-only` / `ask`). Without a copy,
   `/reset` silently strips permissions the user set on this row.
   Worktrees reclaim still writes `danger-full-access` on top.
4. **Reclaim is steal-only-from-self.** `rowForCwd` refuses a second
   claimant. The new worktrees API must retarget the row only when
   `sessionId === from` (the command's old id), in one mutate, then
   sandbox-write. Do not unclaim to `''` in between. Do not steal a
   row owned by some other session.
5. **Sweeper: prove, then patch.** Archived sessions keep their
   workspace `sessionIds` slot. The sweeper reads `sessions.list.byId`,
   which likely still holds the old non-blank row — in which case
   `some(!blank)` already prevents a delete. If archive drops the
   row from `byId`, switching away from the new blank session will
   delete a clean plugin worktree. Live-prove this before writing a
   sweeper change.
6. **Subagents, no cwd, pending inbox, already-blank.** Refuse
   subagent origin. Error when `header.cwd` is missing. Error when
   `inbox.hasPending` (queued prompts would vanish with the archive).
   Already-blank current session → success no-op (do not archive a
   blank and mint another; `connectWorkspace` already reuses blanks).
7. **Title copy pins.** `rename()` is a user-sourced title: automatic
   first-prompt naming will not run on the new session. That keeps
   the sidebar label stable; it also means the row keeps the *old*
   topic name after a reset. Accept for 0.1; do not also copy
   `/goal` (a new chat that immediately continues the old objective
   is worse).

## MVP Scope

**In**

- Host command `/reset` plus a thin client that opens the new id and
  archives the old one. No settings card, no transcript UI.
- Busy / pending inbox / subagent / missing cwd → error.
  Already-blank current session → success no-op.
- Create + copy title/model/preset/sandbox/approval + reclaim +
  client open + client archive. Single-flight.
- Optional worktrees seam. No package dependency on
  `@dsh-next/dsh-next-worktrees`.
- Worktrees reclaim/takeover (self only). Sweeper patch only if the
  live proof shows archive drops the old row from `byId`.
- Bilingual README: same folder, new session, old chat archived with
  no GUI restore, worktrees optional, `/reset` not `/clear`, web UI
  required, unsaved composer draft is discarded.
- Completeness tests: host handler branches, client handoff (jsdom),
  reclaim no-op when the plugin is absent, reclaim success when
  present, fail-closed rollback. Mount smoke; no DOM marker unless
  we ship visible UI.

**Out of 0.1:** client menu button, confirm modal, unarchive UI,
in-place log wipe, emitting `SessionStartSource 'clear'`, deleting
JSONL, copying `/goal`, ACP/headless, copying composer draft.

## Not Doing (and Why)

- **In-place surface replace** — does not blank the Chat UI;
  `session.blank` is monotone. Fails the success bar.
- **Command name `/clear` / package `dsh-next-clear`** — reserved DSH
  meaning is in-place wipe; our product is reincarnation. Rename after
  first publish is a breaking package id.
- **Fake `SessionStartSource 'clear'`** — reincarnation is `startup`.
  Using the reserved tag would mis-fire Claude matchers and collide
  with a future core command.
- **Hard dependency on dsh-next-worktrees** — most sessions (and all
  CLI worktrees) do not need it.
- **Unarchive / history drawer** — a DSH workspace-UI gap, not this
  plugin.
- **Silent cancel of a running turn** — too easy to lose in-flight
  tool work.
- **Session `...` menu in 0.1** — slash command is enough to test the
  job; a menu item is a follow-up if people never type `/reset`.
- **Putting `/reset` inside worktrees only** — the job is real for
  ordinary and CLI-worktree sessions too.

## Open Questions

- If DSH later ships an in-place `/clear`, `/reset` stays. No wrap,
  no alias, unless the core command is itself reincarnation — then
  this package can thin out.

Worktrees seam (resolved): `reclaim(from, to)` on the
`dsh-next-worktrees` Cordis service. `bind()` still refuses a second
claimant. Sandbox-write runs before the mutate so a refused knob leaves
the row on `from`.
