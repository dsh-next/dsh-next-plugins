# Worktree include README and repo setup file

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees, .worktrees.json, CONTRIBUTING.md

The worktrees README now says why and when to commit `.worktreeinclude`
(copy gitignored local files such as `.env` into new worktrees) versus
when to skip it (no local files; `node_modules` belongs in setup). Setup
example is `pnpm install` only so the two files do not both copy `.env`.

This monorepo now has `.worktrees.json` with `pnpm install` so a plugin
create is usable. No `.worktreeinclude`: tokens live in `~/.npmrc`, and
there is no project `.env` every tree must copy. CONTRIBUTING records that
split.
