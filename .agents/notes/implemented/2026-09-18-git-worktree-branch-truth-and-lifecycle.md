# Worktrees: branch truth, a visible base, and lifecycle

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-git, tests/e2e, docs

The Worktrees section was a slug list whose numbers meant "compared to whatever
the primary checkout happens to have out". This change makes the branch the
identity, the comparison base explicit, and the lifecycle visible, following
how VS Code, IntelliJ and the agent tools frame worktrees (see the research
summary in the conversation: VS Code's Worktrees section, IntelliJ's Worktrees
tab with Locked/Prunable and Prune, Cursor's worktree-per-task, Claude Code's
cleanup-on-exit).

## 1. The branch is the identity

- `WorktreeInfo` gained `lockedReason`, `prunable`, `detached` and `behind`;
  `parseWorktreeList` now reads `prunable` and `locked <reason>`.
- Rows are titled by the branch git reports (`dsh-git/x`, an existing branch, or
  `detached`), with the folder path under it — not by the directory slug.
- `worktreeMerge` merges the worktree's **actual** branch read from git instead
  of reconstructing `dsh-git/<slug>` from the path, so a hand-made worktree
  merges like one the panel created. `worktreeRemove` deletes a branch with the
  worktree only when that branch is one this plugin named.

## 2. One visible comparison base

- `resolveWorktreeBase` picks, in order: the branch the user picked in the
  panel, the repository's default branch (`origin/HEAD`, what a pull request
  compares against), then the primary checkout's branch as the last resort.
- Every row's ahead/behind/merged is measured against that one ref, and the
  panel shows it ("Compare with origin/main") with a menu of local branches.
- The old behaviour made the same worktree read "2 ahead" or "Merged" depending
  on where the root happened to be checked out; that is now impossible.

## 3. Create from a branch, a remote branch or a tag

- The create row gained a start-point menu: a fresh `dsh-git/<slug>` from the
  base, an existing local branch (checked out directly), a remote-tracking
  branch (a local tracking branch is created), or a tag (detached).
- `resolveWorktreeTarget` validates the ref and builds the git arguments;
  `WorktreePlan.branch` is now nullable for the detached case.

## 4. Lifecycle

- Rows show Locked (with git's reason) and Prunable; a section action runs
  `git worktree prune --expire now` when any folder is missing, and a locked
  row offers Unlock.
- Delete refuses the primary checkout and the checkout the session itself runs
  in (new `worktree-primary` / `worktree-current` failure codes with fixes).
  A locked worktree takes the second `--force` git requires.

## 5. Setup contract

The contract was already the Cursor shape (`setup-worktree`,
`setup-worktree-unix`, `setup-worktree-windows`, `ROOT_WORKTREE_PATH`,
unsafe-path refusal) plus `.worktreeinclude`. What was missing was the
guidance, now in the README: copy what a checkout needs rather than symlinking
dependencies, which is the failure mode Cursor calls out.

## 6. A session in the folder

- Rows offer "Open a session in this folder". The client entry resolves
  `ctx.get('workspaces')` and `ctx.get('uiWorkspace')` structurally at mount
  and registers the folder as a workspace before navigating to it
  (`packages/dsh-next-git/src/client/index.ts`).
- The services are optional: a host without workspace navigation simply omits
  the action, and a failure to navigate shows the panel's inline issue text
  rather than failing silently.

## Verification

- 417 package tests, including new core (base precedence, ref slugs, prunable
  parsing), host (default-branch base, hand-made merge, ref-mode create,
  delete guards, prune/unlock, chosen-base update), RPC, controller, panel and
  client-entry suites.
- The `git` mount marker asserts the row carries `dsh-git/<slug>`, that the
  meta names the base, and that both pickers render.
- `pnpm run check` green; `media/worktrees.webp` re-captured from the real
  shell.

## Found on the way

`dsh-next-checkpoints` and `dsh-next-reset` call `sessions.open(...)` from the
browser; the live 0.1.6-alpha.2 `ISessions` has no such method (only
`create`), so those paths are likely already inert on this host. Out of scope
here, but worth its own change.
