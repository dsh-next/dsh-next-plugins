# Give every History command its own small modal

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

The read-only History shipped earlier today was reworked on request: the six
commit commands are back, and the crowded tabbed workspace that used to carry
them was not restored. Multi-select and the plan/operations engine returned;
each command now opens a modal that contains only its own operation.

## What the sidebar does now

- Clicking a commit toggles it in the selection (no modifier keys, no
  checkboxes); the row shows `data-selected`, and selected rows are highlighted.
- The toolbar offers `Inspect`, `Compare`, `Squash`, `Fixup`, `Reorder`,
  `Reword`, `Cherry-pick`, `Revert` and `Clear selection`. A command that the
  current selection cannot satisfy is disabled and explains why on hover
  (`history.reason.*`), which is the same guard the host enforces again.
- `Details` was dropped from the row once `Inspect` existed: two ways into the
  same read-only view is one too many. The row keeps a single
  `Check out commit` icon that reveals on hover or keyboard focus, and stays
  visible on devices without hover.

A regression fixed here: when the row became a real `<button>`, `.commit` lost
its reset (`font: inherit; text-align: start; border: 0; background: transparent;
padding: 0`), so commit rows inherited the browser's centred button text and a
taller default line box. The reset is restored, which brings the row back to the
earlier 48px, left-aligned design.

## One modal per command

- `CommitDetailsModal` (Inspect) shows the changed files beside the selected
  file's diff and adds a commit picker when several are selected. It is the only
  route to a commit's details; the per-row `Details` icon and its
  `history.details*` strings are gone.
- `CompareModal` compares two commits file by file, with the endpoints seeded
  from the ends of the selection.
- `HistoryActionModal` serves all six write commands from one component
  parameterized by action. It asks the host for one preview as soon as it opens
  (and again after a `Reorder` move, or once a typed message settles), then
  shows only: the execution order, the message field when the command needs one
  (a reword starts from the commit's real message), a short consequence summary
  (rewritten commits, moved descendants, other checkouts, backup ref), the
  published-history acknowledgment when the host requires it, and the recovery
  controls for a stopped operation.

The old `HistoryWorkspace` — tabs, commit dropdown, patch dumps, phase
bookkeeping, AI buttons and a single component for every command — stays
deleted. `src/client/ui/FileDiff.tsx` remains the one diff renderer shared with
the Changes section.

## What came back

`src/core/history-plan.ts` (125 lines) and `src/host/history-operations.ts`
(406 lines) were restored verbatim from HEAD, with their specs, and the
`compareCommits`, `previewHistory`, `executeHistory`, `historyOperationStatus`
and `recoverHistory` RPCs were re-wired with their original validation. Nothing
safety-critical was re-implemented by hand. `CommitComparison` returned to
`core/history-view.ts`. `historyAgentContext`, `GitService.revert/cherryPick`
and `core/agent-history.ts` stay removed: nothing in the new UI needs them.

## Named refusals, not a generic failure

The engine throws `HistoryOperationError`, which is not a `GitError`, so
`envelopeFor` used to collapse every plan refusal into `git-failed`. The modal
could then only say "The history request failed", hiding the one thing the user
needed to change — the report that prompted this was a checkout that was simply
not clean. `envelopeFor` now maps the engine's reason to the failure the panel
already renders (dirty checkout and hidden index state to `dirty-tree`, an
active or incomplete operation to `operation-in-progress`, the twelve plan and
selection reasons to `invalid-name`), keeps the plan's own sentence as the
detail, and leaves anything unlisted generic rather than mislabelling it. The
modal names the reason and quotes that sentence under it, and a dirty checkout
gets its own string explaining that nothing is stashed for the user.

Diagnosis was grounded in a real repository rather than guessed: on a clean
fixture the same two-commit fixup preview is refused with `root-unsupported`,
and with a single untracked file it is refused with `dirty-checkout` — both now
reach the panel as named failures.

## Verification

`npx tsc --noEmit`, the plugin build, `pnpm i18n:check`, `pnpm docs:check` and
the full package suite (45 files, 1086 passed, one existing skip) are green,
including the restored engine specs and new section/modal specs. The row layout
was also measured in headless Chromium against the real module CSS and markup:
row height 48px, `text-align: start` on the subject, action opacity 0 at rest and
1 on the hovered row only.

The E2E marker in `tests/e2e/mount.e2e.ts` now drives selection, the hover
reveal, Inspect, Compare and one command modal without applying it; running that
lane is still blocked by the unrelated `dsh-next-cc-plugins` typecheck failure
reported in `2026-09-20-git-history-read-only.md`, so `media/history.webp` still
needs a refresh. The package is private, so no changeset is required.
