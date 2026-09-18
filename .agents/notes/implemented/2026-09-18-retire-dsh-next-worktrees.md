# Retire dsh-next-worktrees and migrate its checkouts

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-worktrees, packages/dsh-next-cc-plugins, packages/dsh-next-reset, tests/e2e, scripts, docs

`@dsh-next/dsh-next-worktrees` is removed from the repository. It stays
published on npm at 0.4.0 — deleting the directory unpublishes nothing — so
existing profiles keep resolving until their owner swaps it for the planned
`@dsh-next/dsh-next-git` ([docs/ideas/dsh-next-git.md](../../docs/ideas/dsh-next-git.md)).
Marking the npm entry deprecated is still outstanding.

## Worktree migration

Two live worktrees are kept at the repository-local `.worktrees/<slug>`:
`<repo>/.dsh/worktrees/<slug>` -> `<repo>/.worktrees/<slug>`, branches renamed
`dsh-worktrees/<slug>` -> `dsh-git/<slug>`: create-squads-plugin (`ffea17f`,
design notes) and new-connectors-plugin (`f64339f`, `588cb45`, the
dsh-next-connectors plugin). They moved twice — first to siblings of the repo,
then into `.worktrees/` — after confirming that nested sidebar rendering needs
path containment (a workspace has no parent field; the stock browser nests with
`owningParentFolder` only in `workspace-tree` mode).

Two more were migrated and then deleted on request: create-url-preview-plugin
(`9d7cd1b`, `3e292d9`, the dsh-next-url-preview plugin) and
new-agent-browser-plugin (`b3d2c86`, `59371c8`, the dsh-next-browse plugin).
Their checkouts and branches are gone; those commits are the only copy of that
work and survive in the object database until it is pruned, so the hashes above
are the pointer of record.

In-flight work was committed before any move (three trees were dirty, and
`git worktree move` refuses a dirty checkout); each carried a complete
uncommitted plugin package plus notes.

The sidecar registry (`.dsh/worktrees/registry.json`, four session bindings) was
deleted with the plugin; `git worktree list` is the source of truth.

Location convention going forward: `<repo>/.worktrees/<slug>`, ignored through
`.git/info/exclude` in user repositories so nothing committed changes there.
This repository ignores `.worktrees/` in its own `.gitignore`.

Host quirks worth keeping: on this macOS checkout `git worktree move` fails with
EPERM when the target is given as a relative `../` path (an absolute target
works), and it fails with ENOENT when the destination's parent directory does
not exist — create `.worktrees/` first.

## Coupling removed

- `packages/dsh-next-cc-plugins`: `WORKTREES_MARKER`,
  `isWorktreeWorkspacePath` and `harborBasename` deleted from
  `src/core/path.ts`; the worktree filter dropped from
  `src/client/workspaces.ts`; `tests/path.spec.ts` rewritten around the
  remaining behavior. Dropping the filter is why this ships with the
  retirement: on its own it would surface `.dsh/worktrees/<slug>` rows in the
  cc-plugins workspace checklist while the old plugin still existed. The
  cc-plugins package is private, so no change file is required.
- `tests/e2e/worktrees-helpers.ts` renamed to `tests/e2e/git-helpers.ts`,
  keeping the generic git and composer helpers (checkpoints, notifier and mount
  markers import them) and dropping the worktree-plugin helpers.
- `tests/e2e/worktrees-sidebar.e2e.ts`, `scripts/capture-worktrees-readme.mjs`
  and its `.sh` alias deleted; the mount marker and its 480-line block removed;
  `scripts/workflow-preview.mjs` is skills-only; `scripts/workflow.mjs` loses
  the `worktrees-sidebar` group and its tests move to the two-suite arithmetic.
- `docs/AGENTS.md` reference implementation repointed to
  `packages/dsh-next-skills/README.md`.

## Retained on purpose

`packages/dsh-next-reset` and `packages/dsh-next-checkpoints` still resolve the
`dsh-next-worktrees` service key structurally and call `reclaim(from, to)` when
a provider exists. The lookup is inert today and is the seam the successor
plugin fills; do not delete it without replacing the key. Their help text no
longer documents plugin worktrees, because there are none.
