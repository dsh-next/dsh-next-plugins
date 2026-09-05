# worktrees

English | [中文](README.zh.md)

Nested git worktrees in the DeepSeek Harness sidebar, with a guarded
one-click merge. Run parallel agent sessions on one repository without
collisions: each worktree is its own checkout and branch, and the sidebar
shows every worktree session inside its repository's group instead of as
a separate workspace.

## What you get

- **Create from the repo row.** A branch-icon button beside the row's `+`
  opens a modal that asks for a worktree Name (prefilled with a generated
  suggestion; the name is the display title only — the branch name stays
  generated). Confirming creates the worktree, opens a session inside it,
  and binds the session's sandbox so git works in the linked worktree.
- **Nested rows.** Worktree sessions render under their repository's
  sidebar group with a branch identity (title, dirty/ahead/merged
  status), one indent deeper than the repo's own sessions. The separate
  workspace row is hidden while the plugin is enabled.
- **Row menu.** The session row's `...` menu gains Refresh, Merge…, and
  Delete worktree…. Delete states what survives (the branch and session
  logs stay; the working copy goes) and demands an extra confirm for
  dirty worktrees.
- **Guarded merge.** Merge… preflights everything before it can run: a
  clean main checkout, a fully committed worktree, no running session,
  and a conflict dry-run (`git merge-tree`, git 2.38+). Any blocker names
  its fix; conflicts and old git fall back to the exact manual command.
  A green merge is a single `git merge --no-edit`; afterwards the modal
  offers to remove the merged worktree.

## Compatibility contract

- Requires DSH `0.1.2-rc.1`. The plugin derives the workspace browser
  from that exact official client build (version + SHA-256 gated at
  build time) and replaces the stock workspace UI while enabled: any DSH
  release needs a matching re-derivation release of this plugin.
- Incompatible with any other plugin that also replaces the workspace
  browser (for example `dsh-git-worktree`): both patch the same loader
  row.
- The plugin never authors commit content, never rebases, and never
  resolves conflicts. Its only writes to your checkout are worktree
  add/remove and the preflighted merge.

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
