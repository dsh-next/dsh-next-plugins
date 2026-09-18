# dsh-next-git — native source control and worktrees

- date: 2026-09-18
- status: refined concept (idea-refine session). dsh-next-git itself is not
  implemented; the retirement and worktree migration it called for were executed
  2026-09-18 and are waiting to be committed — see
  [the Agent Note](../../.agents/notes/implemented/2026-09-18-retire-dsh-next-worktrees.md).
  Supersedes and retires [dsh-next-worktrees](dsh-next-worktrees.md), its
  [sidebar UX spec](dsh-next-worktrees-sidebar-ux.md), and the proposed
  [clusters grammar](dsh-next-worktrees-clusters.md).
- package: `@dsh-next/dsh-next-git` at `packages/dsh-next-git`
  (slug `git`; scaffold with `pnpm plugin:new git`, then add `"private": true`
  while it is under development)
- product: one-sentence pitch — "DeepSeek Harness gets a native Source Control
  panel: changes, diffs, history and git worktrees in one right-sidebar tab,
  with the agent as a first-class git collaborator."

## Problem Statement

How might we give DSH one native source-control surface — changes, diffs,
history, branches and worktrees — so users never leave the GUI for git, and so
the worktrees plugin can be retired instead of maintained?

## Recommended Direction

One Git tab in the right sidebar, opened from a Git capsule on the Start guide
page, with stacked sections: **Changes** / **Worktrees** / **History**. One
host git service behind it, complete feature set in v0.1.0, guardrails by
blast radius:

- Cheap writes (stage, unstage, commit) act directly.
- Destructive or checkout-changing writes (discard, delete worktree, branch
  switch, merge) go through a preflight that names the fix and never leaves a
  mid-operation state behind.
- Diffs render with the native `DiffBlock` primitive; "open file" hands off to
  the stock text viewer through its `dsh-resource://file/…` address.
- The agent is a first-class collaborator, not an afterthought: Review changes,
  Explain diff, Draft commit message, Resolve in this session.

Worktrees live at **`.worktrees/<slug>` in the repository root**, on branch
`dsh-git/<slug>`, replacing the retired plugin's
`<primary>/.dsh/worktrees/<slug>`. That is the project-local hidden convention
the agent-tool ecosystem defaults to: `.worktrees/` in the crucible and
superpowers skill packs, `.claude/worktrees/` in Claude Code (which also tells
you to ignore it). The global fallback those tools share,
`~/.config/<tool>/worktrees/<project>/`, was considered and rejected.

Why in-repo rather than a sibling of the repository: the stock browser nests
workspaces **by registered-path containment only** (`owningParentFolder` in
`dsh-client-ui-workspace`, consulted in the `workspace-tree` group-by mode,
verified on 0.1.6-alpha.2), and a workspace carries no parent field. The only
way a worktree nests under its repo in the sidebar is therefore for its
directory to sit inside the repo; a sibling has no registered ancestor and
renders as a top-level row. Nesting is the requirement that makes the sibling
shape a dead end, not hygiene — a linked worktree's git dir is
`<primary>/.git/worktrees/<slug>` either way.

Two rules keep the in-repo path from repeating the old plugin's mistakes:

- **Ignore it locally, never in the user's committed config.** The plugin writes
  `.worktrees/` to `.git/info/exclude`, not `.gitignore`, so `git status`
  stays clean without leaving a committed diff in someone else's repository.
  This repo commits the entry in its own `.gitignore` like any other artifact.
- **The directory is named `.worktrees/`**, not `.dsh/worktrees/`: the
  recognized convention, with no DSH brand on a generic concept.

Accepted trade: checkouts live inside the working tree, so repository watchers
and indexers can walk them, and surfaces that enumerate the workspace must keep
hiding them — the cost the clusters work already paid. The `registry.json`
inside the repository stays retired.

Retirement is a hard replace, but it is a migration, not a deletion.
`@dsh-next/dsh-next-worktrees` is published at 0.4.0 and not private, so
removing the directory does not unpublish it and installed profiles still name
it. The final release carries a deprecation note, the npm entry is marked
deprecated, and the README documents the profile swap to
`@dsh-next/dsh-next-git`. dsh-next-git exposes `reclaim(from, to)` under a key
dsh-next-reset and dsh-next-checkpoints resolve structurally.

Worktree awareness in the other two packages is **removed, not ported** (user
decision 2026-09-18). `dsh-next-skills` has none left in source: commit 8139302
`feat(skills)!: make skill management global-only` already dropped workspace
scopes, so the only ghost is a stale local `lib/` build output (untracked and
ignored; `pnpm build` clears it). `dsh-next-cc-plugins` still carries it, and
the removal is small: delete `WORKTREES_MARKER`, `isWorktreeWorkspacePath` and
`harborBasename` from `src/core/path.ts` (the last has no production caller —
tests only), drop the worktree filter in `src/client/workspaces.ts`, and remove
the two worktree blocks in `tests/path.spec.ts`.

Consequence to accept: until the retirement landed, that filter was what kept
`.dsh/worktrees/<slug>` rows out of the cc-plugins workspace checklist, so the
removal shipped inside the retirement change rather than early.
Scope inheritance for worktree sessions is deliberately deferred to a separate
follow-up designed around the in-repo `.worktrees/` layout; this release does
not re-implement it.

The existing worktrees are committed first, then migrated with
`git worktree move` and `git branch -m`. create-squads-plugin and
new-connectors-plugin are kept at `<repo>/.worktrees/<slug>` on
`dsh-git/<slug>`; create-url-preview-plugin and new-agent-browser-plugin were
migrated and then deleted on request (commits recorded in the retirement
note).

## Key Assumptions to Validate

- [ ] A third-party plugin can register a right-sidebar tab type and show a
      Start-guide capsule. Test: M0 mount probe plus a DOM marker in
      [tests/e2e/mount.e2e.ts](../../tests/e2e/mount.e2e.ts). No package in
      this repo has used this seat yet.
- [ ] `DiffBlock` renders whole-file diffs at panel scale (it was built for
      tool cards, with a 16-line default cap). Test: spike a multi-thousand
      line diff; fallback is git diff text in a monospace block.
- [ ] Host-side git writes are policy-clean the way host-side git reads are.
      Test: live probe against a scratch repository from the plugin host.
- [x] The existing worktrees migrate without loss: three were dirty and on a
      stale base (584e42c vs main e161294), and `git worktree move` refuses a
      dirty tree without `--force`, so committing first was required. Two
      (create-squads-plugin, new-connectors-plugin) are kept at
      `<repo>/.worktrees/<slug>`; the other two were deleted on request after
      migration.
- [ ] dsh-next-git can own `reclaim` so reset and checkpoints keep working
      without edits to their lookup keys.
- [ ] "Everything from day one" still allows the logically separate commits
      [AGENTS.md](../../AGENTS.md) requires.

## MVP Scope

v0.1.0 ships all of it, built in this internal order:

1. Host git service plus RPC contract, contract-tested: status, diff, log,
   stage/unstage, commit, worktree list/add/move/remove, merge preflight,
   reclaim.
2. M0 seat probe: Git tab type, Start capsule, empty panel.
3. Read panel: branch header, ahead/behind, staged and unstaged groups, native
   diffs, history.
4. Writes: stage/unstage, commit with a drafted message, discard behind
   preflight, update from branch, merge with preflight.
5. Worktree lifecycle: create with a name, open session, update, merge, delete;
   `.worktrees.json` setup and `.worktreeinclude` copying ported from the
   retired plugin.
6. Retirement: delete dsh-next-worktrees, move its service key to
   dsh-next-git, update [mount.e2e.ts](../../tests/e2e/mount.e2e.ts), reset,
   checkpoints, and the cc-plugins worktree helpers plus workspace filter;
   `dsh-next-skills` needs nothing but a rebuild; migrate the worktrees.
   Executed 2026-09-18: the package, the worktrees-sidebar e2e suite, the
   README capture script and its alias are gone; the shared e2e helpers moved
   to [git-helpers.ts](../../tests/e2e/git-helpers.ts) with the worktree-only
   helpers dropped; the reset and checkpoints `reclaim` lookups stay as the
   forward-compatibility seam for dsh-next-git.

### Added by the 2026-09-18 review (also v0.1.0)

7. **Operation state.** Detect an in-progress merge, rebase, cherry-pick or
   revert (`MERGE_HEAD`, `rebase-merge`, `CHERRY_PICK_HEAD`), a detached HEAD,
   and the unmerged file list, with Continue and Abort. This is the state users
   get stuck in, and Merge stays blocked until it clears.
8. **Full status vocabulary.** Parse `status --porcelain=v2 -z` for renames
   (resolving the rename source for the old text), untracked, ignored and
   unmerged entries. Discard on an untracked file deletes the file, so it takes
   the danger grammar and names the path.
9. **Hook output.** A commit can fail or hang in a pre-commit hook; stream the
   hook's output into a panel section with Cancel and Retry. Never pass
   `--no-verify` silently.
10. **Index contention with the session's own agent.** The agent runs git in the
    same repository, so mutations serialize per repository, `index.lock`
    collisions retry with backoff, and the panel shows a named "another git
    process is running" state instead of a raw failure.
11. **Refresh model.** Re-read on open, on window focus, after an agent turn
    ends, and on a manual Refresh carried over from the worktrees plugin; a
    filesystem watcher only if polling proves too slow.
12. **Branch operations.** Create, switch, rename and delete, plus checkout of a
    remote branch, with a dirty-tree block and a detached-HEAD warning.
13. **History with commit actions.** Bounded-depth graph lanes in a narrow
    column, and per-commit actions: open files changed, copy hash, and the
    non-rewriting set (checkout, revert, cherry-pick) behind preflight.
14. **Degraded states.** No git binary, git below the required version, not a
    repository, bare repository, permission denied, and no `user.name`/    `user.email` configured each get a named state with the fix. The retired
    plugin's degraded read-only mode must not be lost.
15. **Large-repository budget.** Status and diffs are cancellable, file lists
    render through the existing chunked-list primitive, and a diff above the
    size cap falls back to counts plus a copyable patch.

### Improvements worth taking (not blockers)

- A command-palette entry and shortcut ("Git: Open") so the panel is reachable
  without the Start guide, using `dsh-client-ui-commands`.
- A live chip title via `sidebar.right.pane.tab.title` (branch or change
  count), matching how VSCode badges the activity bar.
- Stash support, which pairs naturally with the dirty-tree merge guardrails.
- Agent verbs need a payload contract: exactly what is sent (file list, diff
  text, draft message), the truncation rule for large diffs, and where the
  result lands.

## Registration and native styling (verified)

### Registration is the same path the core tab types use

Core right-sidebar tab types (`dsh-client-ui-sidebar-files`, `-terminal`,
`-browser`, `-documentpreview`) are ordinary packages with four parts: a host
half at `lib/index.js` (files' is literally an empty `apply() {}`), a
`./client` export, a `dsh.client` block of `{ inject: [<package names>],
platform: "web" }`, and a client bundle that opens with
`window.__ModuleLoader__.load({ id, factory: (require) => … })`.

dsh-next packages already satisfy that shape. Our bundle opens with the
identical `window.__ModuleLoader__.load({ id: "@dsh-next/…", factory })`, and
`packages/dsh-next-worktrees/package.json` already declares
`dsh.client = { inject: […], platform: "web" }` plus the dsh-next-only
`dsh.bundle.patch = ./cordis.patch.yml` mounting seam.

Deltas for dsh-next-git:

1. Add `@deepseek-ai/dsh-client-ui-sidebar-right` to the client `inject` list
   (ours currently injects the left `dsh-client-ui-sidebar` only).
2. Register in the same two stages the files type uses:
   `ctx.sidebarRightTabs.register(definition)` for the type, and
   `ctx.slots.inject("sidebar.right.pane.tab", …)` (plus `.title` when the chip
   title is live) for the body, with `priority: "extension"` so any builtin
   viewer of the same address defers to us.
3. The Start capsule needs no CSS at all: a `guide[]` entry carrying `id`,
   `order`, `title()`, `description()` and `icon` is drawn by the platform.

### Tab-body chrome to copy

The Files tab is the closest list-centered precedent; copy its values exactly.

| Element | Verified value |
| --- | --- |
| root | column flex, `height:100%`, `color:var(--dsw-alias-label-primary)`, `font-size:var(--dsh-content-font-size-secondary,13px)`, `line-height:1.5` |
| header | 38px, `padding:0 6px 0 16px`, `gap:4px`, `border-bottom:.5px solid var(--dsw-alias-border-l3)` |
| body | `padding:8px 0 8px 8px`, `margin-right:2px`, `scrollbar-gutter:stable`, `overflow:auto` |
| row | `border-radius:10px`, `padding:5px 10px`, `gap:6px`, hover `var(--dsw-alias-interactive-bg-hover)` |
| nested level | `padding-left:18px` |
| caption / hint | 12px, `var(--dsw-alias-label-tertiary)` |
| status line | `var(--dsw-alias-label-secondary)` |

Colors come only from verified tokens: `label-primary/secondary/tertiary/
quaternary`, `border-l2` / `border-l3`, `interactive-bg-hover`, `bg-base` /
`bg-layer-1` / `bg-layer-2`, and the state set. Spelling that matters:
`--dsw-alias-state-warn-primary` and `--dsw-alias-state-warn-label` are the
real names — `state-warning-primary` appears in one shipped bundle as an
artifact and does not exist in the theme sheet. Control grammar:
`button-primary-fill` with `label-primary-foreground`, hover
`button-primary-hover`, danger hover `interactive-bg-hover-danger`, modals at
`border:0` plus `--dsw-elevation-prominent`, focus ring 2px
`state-business-primary`. Type pairs 13/20 for rows and controls, 12/18 for
captions; weights 400/500/600; radii from the chrome's 4/8/10/12/999.

Reuse primitives instead of drawing: `DiffBlock` plus `diffTotals`,
`FileTypeIcon` / `CodeFileIcon`, `HoverCard`, `Menu`, `Modal`, `Button`,
`StateDot`, `Tag`, `Checkbox`, `Tooltip`. Every user-facing string lives in
`src/client/dictionaries/en.ts` with the `zh.ts` mirror; `pnpm i18n:check`
enforces parity. The local token law is in the `dsh-next-design` skill.

## Testing, docs, and release deliverables

The completeness contract in `docs/plugins.md` applies to every step, not only
at the end:

- Contract tests pin every RPC envelope the panel consumes. Pure `core/`
  parsing is exhaustive: porcelain v2, rename resolution, graph lanes,
  preflight decisions, version and degraded-state detection.
- Browser wiring is tested under jsdom (store, refresh triggers, dictionary
  binding, RPC error rendering).
- A per-plugin DOM marker keyed `git` in
  [mount.e2e.ts](../../tests/e2e/mount.e2e.ts) opens the Start capsule and
  asserts the panel body renders; it runs in addition to `pnpm test`.
- Bilingual README pair with real dark-theme screenshots in `media/`, added to
  the package `files` list; `pnpm docs:check` and `pnpm i18n:check` green.
- An Agent Note for the change, and `"private": true` until release is
  intended.

### Git fixture: one sample repository, both lanes

Every operation is tested against a real git repository built by a single fixture
module, shared by the vitest suite and the Playwright lane — not mocked, and not
duplicated per lane. The retired plugin kept a host fixture in
`packages/dsh-next-worktrees/tests/git-fixture.ts` and a hand-mirrored copy in
`tests/e2e/worktrees-helpers.ts`; keeping those in step was a standing tax, and
the same state asserted at unit level has to be the state the browser marker
drives. So one module, dependency-free (`node:fs` plus `execFile('git')` only)
so the self-contained e2e lane can import it, with a scenario factory and a
`dispose` per test.

Determinism is part of the fixture, not the test: isolated git environment
(`GIT_CONFIG_GLOBAL=/dev/null`, `core.hooksPath` to an empty directory,
`commit.gpgsign=false`, `init.defaultBranch=main`), fixed author, committer and
dates, and a temp directory per test. A fixture self-test asserts two builds
produce identical object ids, so a flake traces to the plugin rather than to
setup.

Scenarios the factory must offer, because an operation without one is untested:

- Working tree states: clean; staged; unstaged; untracked; renamed; ignored;
  binary; a diff large enough to cross the size cap.
- Operation states: conflicted merge with unmerged entries; merge, rebase and
  cherry-pick in progress; detached HEAD; an empty repository with no commits;
  a directory that is not a repository.
- History and branches: commits to open, ancestors to compare, several branches
  to switch, rename and delete, and ahead/behind measured against a local bare
  "remote" so no network is involved.
- Worktrees: a clean, a dirty, an ahead and an already-merged worktree under
  `.worktrees/`, plus one to create and one to delete.
- Hooks: a pre-commit hook that fails, and one that hangs, for the Cancel and
  Retry path.
- Degraded: git unavailable on PATH, and git below the required version.

Unit use is the contract suite driving the host service against a scenario and
pinning the exact RPC envelope per operation. E2E use is the mount marker: the
scratch profile registers the fixture repository as a workspace, the marker
drives the real panel, and host truth is asserted back from disk with git — the
same disk-first discipline the worktrees marker used, so a DOM-only assertion
can never pass while operations silently do nothing.

## Not Doing (and Why)

- A plugin-owned merge editor or three-pane diff — the largest data-loss
  surface in the space, and the agent is the better resolver.
- Cloning, `git init`, and publish-to-remote — VSCode has them, but DSH has no
  hosting integration; these stay terminal work with a recipe.
- Blame and per-file timeline — useful, but not the loop this release proves.
- A side-by-side diff view — `DiffBlock` is inline only; splitting panes on a
  phone-width column would cost more than it returns.
- `--no-verify` as a default anywhere — bypassing a hook is always an explicit
  user choice.
- Per-hunk staging — `DiffBlock` is display-only; a real index model is a
  different product. Whole files are the staging unit.
- Rebase, cherry-pick, interactive history rewrite, force push — never
  one-click; recipe only.
- Deriving or wrapping the stock workspace browser (the retired Strategy B) —
  the worktree surface lives in the Git tab instead, which deletes the
  version-and-hash-gated seam script permanently.
- Git LFS and submodule editing — out of reach and out of demand.
- Keeping the retired `.dsh/worktrees` path, or writing ignore rules into a
  user's committed `.gitignore` — the plugin uses `.git/info/exclude`.
- Re-implementing worktree scope inheritance for skills or cc-plugins — the
  existing code is removed with the retirement and redesigned separately around
  the in-repo `.worktrees/` layout; this release does not carry it forward.

## Open Questions

- Session-scoped or workspace-scoped: does the panel read the repository the
  session runs in, or every repository in the workspace? The reference
  screenshot shows two repositories (app and holistics) in one view.
- How far does "everything" reach past local git: fetch, pull, push, publish
  branch, and where do credentials come from? "Everything from day one" implies
  yes, but credentials (SSH agent, credential helper) and network failure
  handling are the real cost. This decision blocks scope sign-off.
- Does the panel write back to the terminal's world at all, or is it strictly
  read-only over `git`'s own state (no ref log edits, no reflog)?
- Where do agent-verb results land: a new chat turn, or inline in the panel?
- Commit identity and signing: inherit git config, or surface it?

## Research Provenance

Verified against the installed DSH client line (0.1.6-alpha.2):
`dsh-client-ui-sidebar-right` two-stage tab registration and Start-guide
capsules; `dsh-client-ui-sidebar-files` as the reference tab type;
`dsh-client-ui-primitives` `DiffBlock`; `dsh-client-ui-sidebar-documentpreview`
file-address handoff. Worktree-location conventions from git's own
`git worktree add` requirement of an explicit path, Claude Code's
`.claude/worktrees/` plus `.worktreeinclude`, and Cursor's
`.cursor/worktrees.json` setup contract.

Retirement coupling inventory found by reading this repository:
`packages/dsh-next-reset/src/core/handoff.ts` (service key),
`packages/dsh-next-checkpoints/src/index.ts` (structural reclaim lookup),
`packages/dsh-next-cc-plugins/src/core/path.ts` (worktree marker, filter
caller and tests — to be deleted), `packages/dsh-next-skills` (already clean
since 8139302; stale local `lib/` only),
`tests/e2e/mount.e2e.ts` (per-plugin DOM marker and family fixture),
`tests/e2e/worktrees-helpers.ts` (refresh event and disk helpers). Publish
state: `@dsh-next/dsh-next-worktrees` is at 0.4.0, not private.
