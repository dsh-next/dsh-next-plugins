# Documentation rules

This file governs the documentation in this repository.

## Conventions

- Documentation is written in English only. Package READMEs are the one
  exception: they are maintained as bilingual English/Chinese pairs under the
  contract in `docs/i18n.md`.
- Keep each fact in its owning document; do not duplicate facts across files.
- Update documentation in the same change that changes behavior.
- Put temporary handoffs, decisions, and validation snapshots in
  `docs/archive/`.

## Required files

- Every package has a bilingual README pair (`README.md`, `README.zh.md`, and
  the `README.i18n.yaml` pairing record). Pairing, switchers, and GitHub vs
  npm links live in `docs/i18n.md`. What the README must contain is below.
- Repository-level rules live in `AGENTS.md`; contributor guidance in
  `CONTRIBUTING.md`.

## Package READMEs

A package README is a first-run guide for someone who is not a contributor
and is not a git expert. Local development belongs in
[CONTRIBUTING.md](../CONTRIBUTING.md), not in the package README.

Reference implementation: `packages/dsh-next-worktrees/README.md`.

### Audience and tone

- Lead with what the plugin does and what to click. Internals (`merge-tree`,
  SHA-256, sandbox knobs, architecture) stay in `docs/` or idea notes.
- On-screen UI strings stay in their shipped English form inside inline code
  (`Merge…`, `Resolve in this session`).
- Write so a first-time DeepSeek Harness user can finish the golden path from
  the README alone.

### Shape

1. One-sentence pitch (this is a DeepSeek Harness plugin that …).
2. How to use it (numbered steps).
3. Features, each a short paragraph. UI plugins include screenshots here.
4. Install.
5. A short "Good to know" list (version, incompatibilities, where
   contributors go).

Do not ship a Development `pnpm build` / `pnpm test` block. Point
contributors at [CONTRIBUTING.md](../CONTRIBUTING.md) with a GitHub blob
URL so the link works on npm as well as GitHub (see `docs/i18n.md`).

### Install

Always the npm package name. Never `link:`, `file:`, or a checkout path —
those belong in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
`dsh-next-local-testing` skill, not the package README. A package that is
still `"private": true` still uses this form; first-run readers install
from npm.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-<slug>
```

Explain that `<name>` is the DSH profile (for example `web`).

### Screenshots

A plugin that ships browser UI includes screenshots of the real GUI:

- Dark theme, cropped to the control, looking like a real project (not
  `workspace-a` / `cobalt-01` fixtures, not a failed API-key turn).
- Store files in `packages/dsh-next-<slug>/media/`.
- Encode as WebP at **1x the width they display at** in the README
  (GitHub's reading column is about 888px; a sidebar crop is ~360px, a
  modal ~400px, a full-column diagram ~720px). Do not ship 2x retina
  copies.
- Relative markdown: `![alt](media/loop.webp)`.
- Add `media` to that package's `package.json` `files` list.
- Set `repository.directory` to `packages/dsh-next-<slug>` so npmjs.com
  rewrites those relative images (see `docs/i18n.md`).
- Prefer a WebP diagram over Mermaid: GitHub renders Mermaid, npmjs.com
  does not.

Composite related states (icon colors, a merge flow) into one image when
that is clearer than a gallery.

## Validation

Run `pnpm docs:check` before merging to verify the documentation contract.
