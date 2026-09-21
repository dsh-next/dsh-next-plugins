# Commit and Stash become two buttons with their own dialogs

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

The always-visible commit composer is gone. The panel shows two compact
**Commit** and **Stash** buttons in the **Changes section header**, just before
the existing stage-all `+` action, sized with the header's own controls
(`size="sm"`, ghost). Both are disabled until the index has staged work, so
neither can run against an empty index. A conflicted index disables them too,
because the staged count ignores unmerged entries while a commit and a stash
both require a resolvable index. The disabled tooltip names that reason
(`commit.nothingStaged*`, `commit.conflicts`, busy), which replaced the separate
hint line the old row needed; the header is visible while the section is folded,
so the writes stay reachable.

## Commit dialog

A small modal with **Summary** and **Description** (the same field grammar as
the history command dialogs), the sparkle that asks the agent for a draft, the
`Cmd`/`Ctrl` + `Enter` chord with its platform label, and Cancel plus a primary
**Commit**. The panel keeps one message string, so the fields edit their own
half and rejoin on every keystroke. The dialog stays open when the commit fails
(so the message survives) and closes only on success; a failing hook still lands
in the panel's hook banner with Retry.

**Commit (Amend)** and **Commit All Changes** are removed from the panel, per
the user's choice of a single commit action. The client store drops `commitAll`,
the `amend`/`all` arguments and the unused bulk path; the host keeps its own
`commitAll` RPC (still covered by host tests) since no host capability was
asked to change. `retryCommit` now repeats the plain commit.

## Stash dialog

A modal with a **Stash name** field and Cancel plus a primary **Stash**. It uses
the existing repository-actions pair: one preview, then the approved execution
with the host's version, untracked files left in place. The name is optional;
the dialog closes only after a confirmed save and the panel then re-reads itself.

## The unstage glyph

The icon set has no minus, so both unstage actions — the header's unstage-all
and a staged row's own button — now draw a local `MinusGlyph`. It reuses the
exact crossbar geometry of `IconPlusOutline16` in the same 16x16 filled-path
style, so `+` and `−` read as the stage/unstage pair they are; the chevron stays
only where it means "back" (the diff view). A panel test pins the path data and
the viewBox on both buttons.

## Verification

- 1,161 package tests pass (one pre-existing filesystem skip), plus typecheck,
  build, `pnpm i18n:check`, `pnpm docs:check` (pair re-recorded) and
  `git diff --check`.
- Panel tests cover: header placement and order (Commit, Stash, then stage-all),
  the disabled tooltip carrying the reason, disabled without staged work, both
  enabled with it, portal dialog rendering, summary/description split and
  rejoin, close on success, stay open with the message intact on failure, the
  chord and empty-summary refusal, the agent draft destination, stash
  preview→execute with the version, an unnamed stash, and a refused stash
  keeping the dialog open.
- Controller tests cover the plain commit contract, the conflicted refusal, the
  failed commit keeping the message, and the request-id uniqueness path.
- The packed-plugin Git E2E lane drives the real UI: both buttons enabled after
  staging, the commit dialog committing subject and body to disk, and the stash
  dialog producing `wip: e2e stash` in `git stash list`, after which both
  buttons are disabled again. Dialog screenshots captured from that run became
  `media/commit-dialog.webp` and `media/stash-dialog.webp`; the stale
  `media/commit-menu.webp` (the removed split menu) is deleted, `media/changes.webp`
  was re-cropped from the same run because it still showed the composer, and both
  README languages were updated together.
