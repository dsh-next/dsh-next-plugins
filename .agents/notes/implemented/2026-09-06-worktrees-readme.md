# worktrees README rewrite (user-first, WebP)

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees

Package README is now a first-run guide (how it works, features, optional
`.worktreeinclude`, install) instead of a git-internals dump. Local-dev
`pnpm` commands point at the repo `CONTRIBUTING.md`. Dark-theme shots live
in `media/*.webp` at README display width (WebP q80); regenerate with
`scripts/capture-worktrees-readme.sh`. `package.json` `files` includes
`media` so npm can serve the images.
