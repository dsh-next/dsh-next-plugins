# dsh-next-plugins Repository Instructions

This repository is a monorepo of DeepSeek Harness plugins published under the
`@dsh-next` npm scope. Each plugin is an independent Cordis bundle mounted
through `cordis.patch.yml` and DSH profiles. Never modify a DSH source checkout.

Before changing `packages/`, read the [package conventions](#packages). Before
editing documentation, read `docs/AGENTS.md`.

## Repository Layout

- `packages/` — the `dsh-next-*` plugin family: one package per plugin.
- `shared/` — cross-package runtime source and the single build preset
  (`shared/tsdown.client.ts`). Generated copies must not be edited manually.
  It is the DRY home for the build preset and the test loader shim — not a
  published package.
- `scripts/` — repository maintenance tools; `scripts/plugin-template/` is the
  scaffold used by `pnpm plugin:new`; `scripts/e2e-mount.sh` drives the
  Playwright mount smoke.
- `tests/e2e/` — Playwright end-to-end mount smoke (`mount.e2e.ts`): proves the
  packed plugins actually load inside a real DSH shell with no crash markers.
- `docs/` — long-lived documentation and archives.
- `.agents/` — agent skills (under `.agents/skills/`) and Agent Notes (under
  `.agents/notes/`). This is the single home for all repository skills.
- `mise.toml` — tool version pins (Node 22, pnpm 11) for `mise.jdx.dev`.
- `.mise/tasks/` — mise file tasks (extensionless executables with `#MISE`
  frontmatter) that delegate to the `pnpm` scripts below; `package.json`
  `scripts` remain the single source of truth, the tasks are thin aliases.

## Common Commands

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm plugin:new <slug>   # scaffold a new packages/dsh-next-<slug>
pnpm runtime-deps:check
pnpm docs:check
```

Before merging, run at least `pnpm typecheck && pnpm test && pnpm docs:check && pnpm i18n:check`.

Tests are a **completeness** gate, not a smoke: they must cover every exported
behavior (including edge/error branches) and prove nothing pre-existing broke.
A plugin change is not validated by "the tests I added pass" — map each public
behavior to a test case (pure `core/` logic exhaustively, the Host RPC response
shape via a contract test, browser client wiring under jsdom), add a per-plugin
DOM marker to `tests/e2e/mount.e2e.ts` when the plugin ships UI, and confirm the
mount smoke stays green in addition to `pnpm test`. See
`docs/plugins.md` → "The completeness contract".

Toolchain is managed with [mise](https://mise.jdx.dev/). On a fresh checkout:

```sh
mise trust        # one-time: trust this repo's mise.toml
mise install      # provision the pinned Node 22 + pnpm 11 via `[tools]`
```

`mise.toml` pins tools; `.mise/tasks/*` are file tasks (thin aliases over the
`pnpm` scripts). List them with `mise tasks ls`; run with `mise run <task>`
(e.g. `mise run ci` for the full pre-push gate, `mise run e2e` for the mount
smoke). The `package.json` `scripts` block is the single source of truth —
mise tasks delegate to it, never re-implement commands.

## Repository Rules

- Mount plugins only through `cordis.patch.yml` and profiles. TypeScript
  configuration must not reference a DSH checkout; use official
  `@deepseek-ai/*` SDK packages from `node_modules`.
- New packages use the `dsh-next-` prefix and the `@dsh-next/dsh-next-*` npm
  scope. Client UI packages keep the same scope.
- Use `shared/tsdown.client.ts`; do not copy the build preset into a package.
- Keep `NPM_TOKEN` in the environment. Store token configuration in the user
  `~/.npmrc`; the project `.npmrc` holds only scope mappings.
- Do not use emoji in source code or code comments (including `.ts`/`.tsx`/
  `.js`/`.mjs` files, embedded UI text in code, and shell scripts), in commit
  messages, or in CHANGELOG / change-file entries. Documentation prose, Agent
  Notes (`.agents/notes/`), READMEs, and quoted product-output strings (emoji a
  plugin itself emits, e.g. "⚠️ Approval needed") are exempt.
- Keep each fact in its owning document. Update documentation when behavior
  changes; put temporary handoffs or validation snapshots in `docs/archive/`.
- Package READMEs are bilingual English/Chinese pairs (`README.md` +
  `README.zh.md` + a `README.i18n.yaml` pairing record); the contract and
  maintenance flow live in `docs/i18n.md`. All other documentation is English
  only.
- Every user-facing string in a plugin's browser half comes from the
  package's locale dictionaries (`src/client/dictionaries/en.ts` key source +
  `zh.ts` Simplified Chinese mirror), translated through the platform `locale`
  service. `pnpm i18n:check` enforces dictionary parity and leak-free client
  code; host-side strings stay English. See `docs/i18n.md`.

## Development Workflow

- For implementation and maintenance tasks, load the focused skill under
  `.agents/skills/`.
- To test a plugin locally, load `dsh-next-local-testing` (static gate →
  `mise run e2e` → manual `dsh plugin --profile dev-<slug> add` →
  `--dump-config` → `dsh --profile dev-<slug> --no-open`); one dev profile per
  plugin keeps parallel plugin sessions from colliding.
- Record every non-trivial change as an Agent Note under `.agents/notes/` in
  the same change. Lifecycle, classes, and format rules live in
  `.agents/notes/README.md`.
- Keep changes focused, preserve existing work, and verify real behavior.
  User-visible changes require runtime evidence; visual changes require
  screenshots.

## Branches, Commits, and PRs

- `main` is the stable branch. `dev` is the integration branch for larger
  efforts; rebase on `origin/dev` before submitting a PR.
- Use Conventional Commits: `type(scope): subject` (feat, fix, docs, test,
  refactor, chore). Do not include emoji.
- Commit **logically**, one concern per commit: split a change into multiple
  commits when it crosses distinct concerns (e.g. a feature, its tests, and a
  docs/process update are three commits), and group related files that must
  land together into the same commit. Never bundle unrelated fixes into one
  "misc" commit, and never leave a commit whose message does not match its
  contents. Each commit must stand alone (build and tests keep passing at that
  point) so `git bisect` and review-by-commit stay meaningful.

## Release

Releases are changeset-driven by `.github/workflows/release.yml`. Each plugin
versions independently: a PR that changes a publishable plugin's source adds a
`.changeset/<id>.md` change file (run `pnpm changeset`); the pipeline bumps
only named packages and publishes them when the "Version Packages" PR merges.
Do not edit package versions by hand — `changeset version` owns bumps. See
`docs/publish-prep.md`.

A plugin under active development that must not be released yet is marked
`"private": true` in its own `package.json`: its changes merge without a
change file and never publish (npm refuses a private publish, and changesets
skips it — the manifest is the single source of truth). Never name a private
package in a change file — a mixed changeset breaks `changeset version`; the
CI gate (`verify-changeset.mjs`) rejects it. Remove the `"private": true`
flag when the package is ready to release.

Change entries become the package `CHANGELOG.md` (generated, never
hand-edited) and the GitHub Release notes, so write them for end users — a
user-visible summary, `**Breaking**` for breaking changes, no PR numbers or
plumbing noise, no emoji. The formatter appends a linked author attribution
(`[@user](profile)`) from the PR that introduced the change file
automatically — never hand-write it. See `.changeset/README.md` and the
`dsh-next-release` skill for the authoring rules.

Releases push a per-package git tag (`<npm-name>@<version>`, e.g.
`@dsh-next/dsh-next-notifier@0.1.0`) automatically; these are additive metadata
for the GitHub Release diff UI, not the release source of truth (that is the
npm registry version). Never run `git tag`, `changeset tag`, or a bare
`changeset publish` by hand — tags come only from the pipeline. Snapshot
prereleases (`pnpm release:canary`) push no tags.

## Instruction Layers

- `AGENTS.md` (this file) — repository-wide rules.
- `docs/AGENTS.md` — documentation rules.
- `.agents/notes/README.md` — Agent Note lifecycle and format.
- `.agents/skills/*/SKILL.md` — task-specific procedures (including release).

