# worktrees

English | [中文](README.zh.md)

Nested git worktrees in the DeepSeek Harness sidebar, with a guarded
one-click merge. Run parallel agent sessions on one repository without
collisions: each worktree is its own checkout and branch, and the sidebar
shows every worktree session inside its repository's group instead of as
a separate workspace.

## What you get

- **Create from the repo row.** One click on the branch-icon button
  beside the row's `+` creates the worktree with a generated name, opens
  a session inside it, and binds the session's sandbox so git works in
  the linked worktree. No prompt: the name is generated, and the hover
  card carries the details.
- **Nested rows.** Worktree sessions render under their repository's
  sidebar group, one indent deeper than the repo's own sessions. The
  branch icon IS the status: green merged, amber uncommitted changes,
  blue ahead of base (with the count), neutral clean — and a fresh
  worktree never reads as merged. The separate workspace row is hidden
  while the plugin is enabled.
- **Row menu.** The session row's `...` menu gains Refresh, Update from
  `<branch>`…, Merge…, and Delete worktree…. Delete states what survives
  (the branch and session logs stay; the working copy goes) and demands
  an extra confirm for dirty worktrees.
- **No orphan worktrees.** A never-started session is replaced by the
  platform when the next one begins; the worktree behind it is removed
  automatically (checkout, registry row, and workspace together). A
  worktree with uncommitted changes is never auto-removed.
- **Guarded merge.** Merge… preflights everything before it can run: a
  clean main checkout, a fully committed worktree, and a conflict
  dry-run (`git merge-tree`, git 2.38+). Any blocker names its fix. A
  green merge is a single `git merge --no-edit`; afterwards the modal
  offers to remove the merged worktree. Untracked `.dsh/` sidecar files
  (the plugin's own registry) do not count as uncommitted changes.
- **Agent-resolved conflicts.** When merging into the main checkout
  would conflict, Merge does not dump you to the CLI. The primary action
  becomes Update from `<branch>`…: the plugin merges the main branch
  *into the worktree*, leaves a mid-merge there if needed (red icon),
  and focuses the bound session so the agent can resolve and commit.
  After that, Merge is a fast-forward. Abort (`git merge --abort` in the
  worktree) is offered while the merge is in flight. The plugin never
  authors commit content and never leaves the main checkout mid-merge.

## Compatibility contract

- Requires DSH `0.1.2-rc.1`. The plugin derives the workspace browser
  from that exact official client build (version + SHA-256 gated at
  build time) and replaces the stock workspace UI while enabled: any DSH
  release needs a matching re-derivation release of this plugin.
- Incompatible with any other plugin that also replaces the workspace
  browser (for example `dsh-git-worktree`): both patch the same loader
  row.
- The plugin never authors commit content, never rebases, and never
  resolves conflicts (the bound session's agent does). Its only writes
  to your checkout are worktree add/remove, the preflighted merge into
  the current branch, and update-from-main (a merge into the worktree
  that may stay mid-merge until you abort or the agent commits).

## Install

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-worktrees
```

## Development

```sh
pnpm build        # derives the browser, type-emits, bundles both halves
pnpm test         # unit + contract suites
pnpm check:browser  # re-verify the derivation gate
```

Design spec: `docs/ideas/dsh-next-worktrees-sidebar-ux.md`.
