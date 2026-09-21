# Make Git History read-only and remove the rewrite machinery

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

History is now three things: a list of recent commits for the current checkout,
a read-only details modal, and an explicit commit checkout. Everything else was
deleted, not hidden.

## What the UI does now

Each row shows the subject, short hash, author and refs, with two hover/focus
icons that stay visible on touch devices:

- `Details` opens a modal. The selected file's diff renders on the left with the
  shared `FileDiff` component (`src/client/ui/FileDiff.tsx`, the same `DiffBlock`
  path the Changes section uses); the commit's changed files are listed on the
  right, styled like a Changes group, and clicking one switches the diff. The
  first file opens by default, and a failed read offers a retry.
- `Check out commit` keeps its confirmation flow and stays disabled while the
  panel is busy or another git operation is in progress.

The section header, refresh icon, exclusive accordion behavior, 10px content
inset, and single-line rows are unchanged from the previous work.

## What was removed

- UI: commit selection (checkboxes, modifier clicks, selection toolbar, hint and
  count), the Inspect/Compare/Operation-plan workspace, and the
  `HistoryWorkspace` component plus its styles.
- Client: `historyQuery`/filter state, `HistoryAction` plumbing, the
  `historyPlan.*` and selection dictionary keys, `PanelStore.revert`/`cherryPick`
  and `expandedCommit`/`toggleCommit`, and the selected-commits agent payload.
- Host: `HistoryOperations` (journals, backup refs, preview/execute/status/recover),
  `GitService.revert`/`cherryPick`, and the `compareCommits`,
  `historyAgentContext`, `previewHistory`, `executeHistory`,
  `historyOperationStatus` and `recoverHistory` RPCs. Each now answers
  `no such method`.
- Modules deleted: `src/host/history-operations.ts`, `src/core/history-plan.ts`,
  `src/core/agent-history.ts`, the `HistoryWorkspace` component with its styles,
  and their specs.
- Dead chrome: the unreferenced `panel.module.css` classes the old History card
  and menu left behind (`commitRow`, `commitHash`, `commitSubject`, `commitMeta`,
  `menuItem`, `menuItemDanger`, `graph`, `nested`).

Preserved deliberately: `getHistory` with its immutable commit-anchor pagination,
`getCommitDetails`, `getCommitDiff`, `checkoutCommit`, every conflict/merge/rebase
continue-abort-skip path, and all Changes/Worktrees/Repository AI workflows.
`isHistoryOid` moved to `core/history-view.ts` because the anchor check still
needs it. No on-disk journals or `refs/dsh/history-backups/*` were touched, so
history written by the removed feature stays recoverable with plain git.

## Verification

`npx tsc --noEmit`, `pnpm --filter @dsh-next/dsh-next-git build`,
`pnpm i18n:check`, `pnpm docs:check`, `pnpm runtime-deps:check` and
`pnpm test:scripts` pass, and the full package suite is green at 974 tests across
42 files.

Two things are outstanding, both blocked outside this change:

- `mise run e2e -- smoke` aborts while packing the 8 runtime packages, before it
  reaches this plugin: `dsh-next-cc-plugins` fails typecheck because two
  `@deepseek-ai/dsh-llm` versions (0.1.2-rc.1 and 0.1.6-alpha.2) are installed
  and their branded `MessageId` types do not unify. The same failure hits
  `pnpm typecheck` on a clean tree, and the modified `pnpm-lock.yaml` predates
  this work.
- `media/history.webp` still shows the removed action menu. It needs a refresh
  from the E2E capture once the lane can run.

No GUI installation or server was changed. The package is private, so no
changeset is required.
