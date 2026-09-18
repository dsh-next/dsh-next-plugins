# Build dsh-next-git: the native Source control panel

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-git, tests/e2e, pnpm-workspace.yaml, docs

`@dsh-next/dsh-next-git` implements the v0.1.0 scope of
[docs/ideas/dsh-next-git.md](../../docs/ideas/dsh-next-git.md): one Git tab in
the right sidebar, opened from a **Source control** capsule on the Start guide,
with stacked **Changes** / **Worktrees** / **History** sections over one host
git service. The package is `"private": true` until release is intended.

## What shipped

- **Host service** (`src/host/`) — `GitRunner` spawns git with a bounded
  timeout and no interactive environment, serializes mutations per repository,
  retries `index.lock` collisions with backoff, and classifies every failure
  into a named state. `GitService` implements the reads (`getState`, `getDiff`,
  `getHistory`) and writes (stage, unstage, discard, commit, worktree
  add/remove/merge/update, branch create/switch/rename/delete, operation
  continue/abort, update, revert, cherry-pick, checkout) the panel drives.
- **RPC** — `POST /dsh-next-git/rpc`, every reply an envelope
  (`{ ok: true, value }` or `{ ok: false, failure, degraded }`), so a named
  failure survives the wire instead of collapsing into an HTTP status.
- **Pure core** (`src/core/`) — porcelain v2 parsing (renames, untracked,
  ignored, all seven unmerged codes), unified-diff splitting into per-hunk
  fragments for `DiffBlock` plus the size-cap fallback, history parsing with
  bounded graph lanes, the preflight decision model, operation-state detection,
  worktree/slug/setup/include/compose grammar, version gating, address building,
  the commit-message draft, and the agent-verb payload contract.
- **Browser half** (`src/client/`) — tab type plus keyed body and title
  registrations, the guide capsule, the accordion section stack, the diff
  pane, the danger confirmations, the hook-output section, and the refresh
  model (open, window focus, tab visibility, agent turn end, manual, after
  every write). The layout follows the reference surface users already know:
  the message box and its Commit action sit above the change list, each
  section is a sticky band with hairline borders, a count pill and its own
  bulk actions, and a file row is one line of type glyph, name, muted
  directory and a status letter colored by what the change means.
- **Tests** — one shared real-git fixture module
  (`tests/git-fixture.ts`, 18 scenarios, determinism self-test) used by both
  the vitest suites and the mount marker; 367 package tests; the RPC contract
  suite drives the real route handler and asserts exact envelopes; the jsdom
  suite renders the panel and drives its controls; the `git` DOM marker in
  [tests/e2e/mount.e2e.ts](../../tests/e2e/mount.e2e.ts) opens the capsule,
  stages, commits, creates a worktree, reads the merge banner and aborts —
  asserting host truth from disk with git after each step.

## Decisions worth recording

- **`.git/info/exclude`, never `.gitignore`.** The plugin hides `.worktrees/`
  locally, so `git status` stays clean without leaving a committed diff in
  someone else's repository.
- **Worktrees at `<repo>/.worktrees/<slug>` on `dsh-git/<slug>`.** The stock
  browser nests workspaces by registered-path containment only, so a sibling
  checkout would render as a top-level row.
- **`reclaim` under the retired `dsh-next-worktrees` key.** `dsh-next-reset`
  and `dsh-next-checkpoints` resolve that key structurally and call
  `reclaim(from, to)`; the host entry provides it on both `dsh-next-git` and
  `dsh-next-worktrees`, so the retirement needed no edit in either package.
  Worktrees are git-native here, not session-bound, so `reclaim` reports
  whether the new session's checkout is a linked worktree rather than moving a
  registry row.
- **`--branch` is required for porcelain v2 headers.** Without it git emits no
  `# branch.*` records, which silently leaves the branch, ahead/behind and
  unborn/detached state empty.
- **A rename needs both paths in the diff pathspec.** Limiting `git diff` to
  the new path defeats rename detection, so the panel passes the status entry's
  source path too.
- **Conflicted paths are listed once**, under Conflicts: staging or discarding
  them is not what resolves a conflict.
- **The retired plugin's `--no-verify` behavior is not carried over.** A
  failing pre-commit hook becomes a named state with its output and Retry /
  Cancel; nothing bypasses a hook silently.
- **A conflicted worktree update is named, not silent.** The merge happens in
  another working tree, which this panel is not showing, so a conflict there
  raises `operation-in-progress` naming that path.

## UI decisions

- **Sections are independent accordions, not a single-open one.** Opening
  History does not close Changes: a commit needs the change list and the
  message together. The header is a real button with `aria-expanded` and
  `aria-controls`, its actions sit beside it (a button cannot nest in a
  button), and a collapsed History section does not read the log until it is
  expanded.
- **Bulk actions moved into the section header** as icon buttons (stage all,
  unstage all, discard all) so the list keeps the width; discard all still runs
  through the danger confirmation naming every affected path.
- **Status marks are git's own letters, colored** (`M` amber, `A`/`U` green,
  `D` and conflicts red) rather than pill badges, so a row scans in one line.
- **The commit box takes the branch and the platform chord**
  (`Message (Cmd/Ctrl+Enter to commit on "main")`), and the chord commits from
  the message box. The platform is read from `navigator.platform`, which jsdom
  leaves empty, so the fallback is `Ctrl` in tests.

### Layout contract

The panel keeps one grid, stated at the top of `panel.module.css` and guarded
by the mount marker: the body insets its content 8px from each panel edge,
every box in that flow (row, section band, commit card, group header, diff
header) spans that content width exactly, and controls inside a box are inset a
further 10px so they land on an 18px line on both sides. Two consequences are
easy to regress and are therefore asserted:

- `box-sizing: border-box` on anything sized `100%` with padding — a
  content-box row overflows the panel by its own padding, which is what made
  the right edge look ragged (rows and their hover actions ran 10px past the
  section bands);
- a change row's hover actions float over its status letter instead of
  reserving space, so the letter sits on the same trailing line as the section
  count pill and the commit row's menu button.

## Deviations and follow-ups

- **Committed-diff handoff.** "Open file" hands the path to the stock viewer
  through its `dsh-resource://file/...` address; the panel does not draw a
  second diff viewer.
- **Per-commit "open files changed" is not in v0.1.0.** History offers copy
  hash, checkout, revert and cherry-pick; listing a commit's changed files
  needs its own RPC round trip and is a follow-up.
- **No command-palette entry, stash support, or live chip title from a
  background read.** The chip title renders the branch when the body has
  already read the state, and the tab's own title otherwise.
- **`pnpm-workspace.yaml` gained `virtualStoreType: project`.** Without it
  `pnpm install` records one value for `enableGlobalVirtualStore` and the
  `verifyDepsBeforeRun` check resolves another, so every script failed with
  "the value of the enableGlobalVirtualStore setting has changed".
- **`@deepseek-ai/dsh-session` is deliberately not a devDependency.** Its
  0.1.6-alpha.2 release pulls `dsh-llm`/`dsh-brand` 0.1.6 into the workspace
  peer graph, which gives `dsh-next-cc-plugins` two branded `MessageId` types
  and breaks its build; nothing in this package imports it.
- **`tsconfig.json` pins `@deepseek-ai/dsh-client-ui-slots`.** The
  sidebar-right augmentation otherwise resolves through pnpm's hoist to an
  older slots copy, leaving `SlotMap` unmerged.
- **The native-app skills marker fails in this environment** (`VS Code` absent
  from the folder-opener menu) with or without this plugin mounted; it is
  unrelated to this change and is left as observed.
- `@dsh-next/dsh-next-worktrees` is still marked deprecated on npm, and the
  README swap note for installed profiles is outstanding.
