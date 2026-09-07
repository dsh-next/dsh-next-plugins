# dsh-next-checkpoints

- date: 2026-09-06
- status: private MVP in packages/dsh-next-checkpoints (2026-09-06).
  M0 probe passed: in-place surface replace is plugin-legal; Chat keeps
  append-origin bubbles so v1 is the banner; file restore leaves HEAD
  untouched
- name: `dsh-next-checkpoints` (`@dsh-next/dsh-next-checkpoints`)
- product: one-sentence pitch — "Restore a DSH session to a known-good
  moment: files and model history as one checkpoint, reviewed as a
  Changes tab."
- tab label: `Changes` (file-centric; sits beside Chat and Trajectory)
- command: `/rewind` (not `/checkpoint` — DSH already uses that word for
  compaction and session-projection cache)
- diff surface (2026-09-06): native `DiffBlock` hunks, not Monaco; host
  runs `structuredPatch` before the client ever sees text
- git (2026-09-06): checkpoints are not git. Commits during the session
  stay in history; rewind restores files only and warns when HEAD moved
- ux (2026-09-06): click a checkpoint to inspect; rewind is a separate
  control plus confirm modal — selecting a row never restores
- probe (2026-09-06): M0 is an in-place surface-replace spike, before
  `pnpm plugin:new`

## Problem Statement

How might we let a DSH user jump a session back to a known-good moment —
working-tree files and model-visible history as one unit — without
leaving the conversation, and without treating Trajectory as a fake
source-control view?

## Recommended Direction

Build **in-place checkpoints**. One plugin, one session. Restore points
are **user-turn boundaries**, not individual `edit` / `write` calls. The
conversation gets a third `conversation.view` tab named `Changes`. That
tab's primary objects are checkpoints: selecting a row shows every file
change made **up to that checkpoint** (net tree from session baseline to
that moment, rendered with the shell's own `DiffBlock`). Each row has a
rewind control; rewind is a confirmed, destructive action that restores
this session's cwd and shadows later **model** history so the agent no
longer sees the undone turns.

This is Cursor-style file checkpoints plus a review tab, not git, not a
fork, and not a Trajectory filter. Chat already renders per-call diff
cards; the painkiller is **time travel with a review surface**, not
another ledger of tool calls.

File truth is a **tree snapshot of touched paths** at each turn
(content-addressed blobs). The touched set is the union of `ctx.fs`
mutations and, in a git repo, names from `git diff --name-only` against
the **session-start HEAD** plus untracked — not `git status` alone, which
goes clean after a commit and would drop Bash-touched files. Chat truth
is a session `surfaceOp: { op: 'replace' }` against the live `Session`.
`ctx.sessions.fork` is the fallback only if that replace is not
plugin-legal.

**Must be true for v1:** after rewind, the next model request does not
include post-checkpoint turns. **Should be true:** the Chat tab hides or
dims those turns. If Chat keeps the bubbles, v1 is files + model replace
+ a banner (`Rewound to this checkpoint. Later messages are not sent to
the model.`), which is what current Cursor documents for restore
(files only; fork chat separately) plus an honest model cut. Do not wrap
ChatView to fake disappearing messages.

Stay on the primary checkout (user decision 2026-09-06). The confirm
modal must say what later turns and files will be restored, warn when
the cwd is not a worktree, warn when non-agent dirty files would be
clobbered, and warn when **HEAD has moved** since the checkpoint.
Worktrees remain a recommended pairing, not a hard dependency.

## Diff surface

Do not bring Monaco, `react-diff-view`, or `diff2html`. Render with
`DiffBlock` from `@deepseek-ai/dsh-client-ui-primitives` (already a
frozen platform module; Chat's `edit` / `write` cards use it).

`DiffBlock` is not a diff engine. It dumps `oldText` lines as red then
`newText` lines as green. Chat looks sane because `dsh-tool-fs`
pre-hunks via `structuredPatch` (`diff` package, `context: 3`). Passing
whole files would paint an entire 400-line file as deleted then added.

Pipeline:

```
baseline text ──LF-normalize──┐
checkpoint text ─LF-normalize─┴─ structuredPatch (timeout)
  ─ FileDiff[] (one net pair per path, grouped) ─ DiffBlock
```

- Hunk on the **host**. Send `FileDiff[]` over RPC. Do not put `diff` in
  the client bundle. Reimplement the small `computeHunkDiffs` loop in
  `src/core/` (tool-fs does not export it).
- One **net** before/after per path (session baseline → selected
  checkpoint). Do not stack every edit's hunks.
- LF-normalize like `fs-local` (`\r\n` → `\n`) before patch. `DiffBlock`
  splits on `\n` only; mixed endings otherwise look like every line
  changed.
- `maxLines={Infinity}` on this tab (the primitive **defaults to 16**).
  Still cap rendered rows / file bytes (reuse 10 MiB). Above the cap:
  a `too large` row, never a fake create.
- Validate every hunk (`path` string, `oldText` string or `null`,
  `newText` string) before render. Empty `diffs` → our empty state, not
  `DiffBlock`'s `null`.
- File-list `+A -R` badges are **our** counts (strip context). The
  primitive's footer inflates both sides with the three context lines;
  do not copy those numbers into the rail.
- Layout: checkpoint rail + file list + `DiffBlock` for the selected
  file (stack when few files). Trajectory's ledger + inspector is the
  analog, not Settings' 760px column.

Keep native quirks so we look like Chat: context lines on both sides, no
syntax highlight, no split view, no `\ No newline at end of file`
marker. Do **not** copy Chat's large-overwrite fallback (`before: null`
presented as a create).

Row kinds that must not enter `DiffBlock`: binary (NUL), invalid UTF-8,
images, directories, unrestorable symlinks, timeout from
`structuredPatch`, over the byte/row cap. Deletes are
`oldText: contents, newText: ""`. Creates are `oldText: null`.

## Commits during the session

Checkpoints are **not git**. Cursor's own docs say the same: snapshots
are local and separate from git; restore reverts files; git is for
permanent history.

If the agent or the user commits (or amends, rebases, tags) during the
session:

- The blob store still has file bytes. File restore still works.
- Rewind **does not** `git reset`, `git revert`, `git checkout`, amend,
  or delete refs. HEAD and the reflog stay where they are.
- After rewind, the working tree matches the checkpoint and HEAD may
  still point at a later commit. `git status` then looks like those
  commits were un-done as unstaged changes. That is the honest state,
  not a bug — unless we hide it.
- Record `HEAD` (sha, short, branch) on each checkpoint when cwd is a
  repo. The confirm modal **must** warn when current HEAD ≠ checkpoint
  HEAD: files will match the checkpoint; commits after that point
  remain; the user can reset themselves if they want git to match.
- Discovery after a commit cannot use dirty `git status` alone (it is
  clean). Name collection is: fs-touched paths ∪ `git diff --name-only
  <baselineHEAD>` ∪ untracked ∪ current status. Baseline HEAD is the
  sha at session start (or first observation).
- A commit of only already-snapshotted paths does not drop them from
  the Changes tab. The tab is baseline-tree vs checkpoint-tree, not
  vs HEAD.

Refuse rewind only when we cannot restore a path we would have to
write (missing blob, binary we never snapshotted, sandbox denial). A
moved HEAD is a warning, not a blocker.

## UX contract

The Changes tab is a review surface. Selecting a checkpoint never
restores.

```
Changes                                          [/rewind]
+----------------------+------------------------------------------+
| 14:02  turn 3    ↩   |  src/host/rpc.ts            +24  -8      |
| 13:58  turn 2    ↩   |  src/core/store.ts          +3   -1      |
| 13:51  turn 1    ↩   |  packages/.../en.ts         +12  -0      |
|                      |                                          |
| (selected = turn 2)  |  src/host/rpc.ts                         |
|                      |  -  const path = RPC_PATH                |
|                      |  +  const path = rpcPath(session)        |
|                      |  └ +24 -8 · 3 files                      |
+----------------------+------------------------------------------+
```

- Left rail: one row per **turn-boundary** checkpoint, newest at the
  top or bottom matching Trajectory's "open at the tail" habit. Each
  row has a rewind control. Click the row = select. Click rewind =
  modal, then restore.
- Right pane: files changed **up to** the selected checkpoint (net vs
  session baseline). File list with our `+A -R` badges; `DiffBlock` for
  the selected file. Stack DiffBlocks when there are few files.
- Modal lists: files that will be written or deleted, turns the model
  will stop seeing, worktree vs primary, non-agent dirty paths, HEAD
  moved. Primary action is destructive (outline danger after a neutral
  first step, per dsh-next-design). Escape cancels.
- `/rewind` is the same restore. v1 with no argument opens the tab or
  a picker — not a silent restore of "previous."
- After rewind, later checkpoints drop off the current generation.
  New work appends new checkpoints on the restored tail.

## Extension points

- Client tab: `conversation.view` list slot, id `changes`, order after
  Trajectory (`id: 'trajectory'`, order 10). Official example is a
  fresh id beside Chat/Trajectory; do not reuse those ids.
- Slash command: `ctx.commands.register({ name: 'rewind', ... })`.
  Handler runs against the agent, no model message.
- File capture: observe `fs/write-intent` / `fs/edit-intent` /
  `tools/execute` (must `return next()`) plus git-name discovery.
- Chat rewind: `Session.append` with `surfaceOp: { op: 'replace',
  start, end }` on the live session. Compaction is the precedent.
  `ctx.sessions.fork` is fallback, not the product.
- Diff render: `DiffBlock` from `@deepseek-ai/dsh-client-ui-primitives`
  (platform external in `shared/tsdown.client.ts`).

## Diff edge cases

Crash or blank — validate before render; never let a bad hunk reach
`DiffBlock`:

- Empty / identical texts → our empty state (`DiffBlock` returns
  `null`).
- Missing `oldText`/`newText` → drop the row (`Ki(undefined)` throws).
- Delete → `oldText: contents`, `newText: ""` (required string).

Looks like a lie — do not pass whole files; hunk first:

- CRLF → LF-normalize before patch.
- Large overwrite with `before: null` → `too large` row, not a fake
  create.
- Footer inflation → our badges strip context.
- Path spellings → key by `targetKey` / realpath; show `displayPath`.
- Same path's hunks must be consecutive or the header repeats.
- Cumulative net only; stacking per-edit hunks shows churn the tree
  no longer has.

Freeze — cap what we mount:

- `maxLines={Infinity}` plus 10 MiB / ~2000 rendered rows.
- `structuredPatch` timeout; on timeout skip the body.
- Cap displayed line length (ReadBlock truncates; DiffBlock does not).

Do not feed `DiffBlock`: binary (NUL; note fs-local read samples 8 KiB
and edit scans the whole file), invalid UTF-8, images, directories,
unrestorable symlinks. Late NULs can "read" and then fail edit — treat
as binary.

Outside the primitive, still the product: Bash/`rm` via tree snapshot;
same-cwd subagent writes join the parent; other cwds are skipped;
human edits between turns belong in the net diff; the pane is
historical (as of checkpoint), not live `git diff`.

## First probe (M0)

Do this in a throwaway host plugin, **before** `pnpm plugin:new`.

1. Two user turns that each edit a file.
2. Append a surface `replace` shadowing turn 2.
3. Assert `deriveMessages()` omits turn 2.
4. Look at Chat: hidden, dimmed, or still current?
5. Restore the file bytes from a hand-built snapshot; confirm disk
   matches; leave git HEAD untouched.

Pass on (3) unblocks scaffolding. Fail on (3) → files-only restore +
new-session/fork for chat, and the product copy must not claim
"files + chat together." (4) only chooses banner vs hidden bubbles.

## Key Assumptions to Validate

- [x] **In-place model rewind is plugin-legal.** Append a surface
      `replace` that shadows later turns. `deriveMessages()` must omit
      them. **Probed 2026-09-06** (docs/archive/2026-09-06-checkpoints-m0-probe.md).
      Chat-tab disappearance is a should, not a must (banner is v1).
- [ ] **File restore round-trips the tree the user thinks they have**
      for `write` / `edit` plus Bash-touched tracked files, including
      after a `git commit` in the same session. Test: edit, commit,
      edit, rewind to pre-commit checkpoint; disk matches the snapshot;
      HEAD is unchanged; modal warned.
- [ ] **Users will rewind from the Changes tab, not only from Chat.**
- [ ] **Turn-boundary checkpoints stay scannable.**
- [ ] **Restoring the primary checkout is acceptable with a modal.**
- [ ] **Hunk-then-DiffBlock is readable for a typical agent turn.**
      Spot-check a 1-line edit in a 400-line file (must not paint the
      whole file) and a 10-file refactor.

## MVP Scope

The smallest version that tests the core bet: **select a checkpoint, see
the work as of that moment, confirm rewind, land in a session whose
files and model history match that moment.**

**In**

- Package `dsh-next-checkpoints`, `"private": true` until the rewind
  probe passes.
- Host: checkpoint at `turn/end` (refuse rewind while a turn is open).
- Host: snapshot touched-path tree (fs mutations ∪ git-name discovery
  against session-start HEAD, not dirty-status alone). Baseline is
  first-seen content of each path. Record HEAD sha when in a repo.
- Host: hunk via `structuredPatch` (timeout + LF-normalize) into
  `FileDiff[]` for the selected checkpoint's cumulative net.
- Host RPC: list checkpoints, get cumulative diffs, rewind.
- Client: `conversation.view` id `changes` (label `Changes`, order
  after Trajectory).
- Client: checkpoint list; **click selects, rewind control + modal
  restores** (files, turns, worktree, dirty files, **HEAD moved**).
  Selecting a row never restores.
- Client: `DiffBlock` with `maxLines={Infinity}`, validated hunks,
  empty/binary/too-large row kinds, our own `+A -R` badges.
- Slash command `/rewind` — same restore, same confirmation.
- After rewind: later checkpoints drop off the current generation.
- Locales `en` / `zh`, mount-smoke DOM marker, completeness tests for
  the checkpoint fold, hunk projection (create/delete/empty/CRLF/
  identical/timeout/binary), rewind refusal, and HEAD-moved warning.

**Out of this MVP, still this plugin later**

- Per-file or hunk restore without moving the chat.
- `/rewind` targeting a seq with no modal.
- Dimmed "undone generation" history in the rail.
- Rename detection (same hash, different path).
- Optional "also reset git to checkpoint HEAD" checkbox.

## Not Doing (and Why)

- **Per-edit restore points** — a single turn is tens of mutations.
- **Fork-as-rewind** — fallback only if in-place surface replace fails.
- **Requiring `dsh-next-worktrees`** — warn when cwd is the primary.
- **Reconstructing files only from `edit` / `write` payloads.**
- **Git commits / tags as the snapshot store** — collides with
  worktrees, pollutes history, fails on non-git cwd. Blobs live in
  plugin data keyed by session.
- **`git reset` / `git revert` / `git checkout` as part of rewind** —
  checkpoints are not version control. A moved HEAD is a modal warning.
  Silently resetting the primary is how we destroy someone else's
  afternoon.
- **Monaco / split DiffEditor / third-party diff UIs** — `DiffBlock` is
  the house atom. Passing whole files into it is also not doing.
- **OverlayFS / full cwd copy-on-write.**
- **Hunk accept/reject review** — that is a `review` plugin.
- **Wrapping or replacing ChatView.**
- **Undo-of-rewind / redo stack.**
- **Chasing subagent cwds other than the parent's.**

## Open Questions

- Does appending a surface `replace` from a third-party plugin survive
  session invariants, and does ui-chat fold it as `origin: 'rewind'`
  or keep later bubbles as the human transcript?
- Banner vs hidden Chat turns: ship the banner if the assembler will
  not hide them?
- Subagents that share cwd: one parent stream, or a checkpoint per
  child turn as well?
- Should `/rewind` with no argument restore the previous checkpoint, or
  always open the Changes tab?
- Package remains private until which probe is green: model-history
  only, or Chat-tab disappearance too?
- Symlinks and hardlinks: snapshot the target bytes, refuse, or record
  the link and restore it as a link?
- `structuredPatch` timeout / row cap numbers: start at jsdiff's
  default timeout and 2000 rendered rows / 10 MiB, tune after a real
  refactor turn?
