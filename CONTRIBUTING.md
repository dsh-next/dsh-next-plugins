# Contributing

Welcome to `dsh-next-plugins`, the `@dsh-next` DeepSeek Harness plugin family.
This file is the contributor entry point; the repository's full rules and
mechanisms live in [AGENTS.md](AGENTS.md) (and its layered instructions), which
take precedence in case of conflict.

## Branching and merge flow

- `main` is the stable branch and receives tested changes through maintainer
  integration.
- `dev` is the integration branch for larger efforts; local development and
  remote PRs target `dev`.
- Use Conventional Commits and never include emoji in commit messages.

## Prerequisites

- Node.js >= 22 and pnpm 11, managed with [mise](https://mise.jdx.dev/):
  run `mise trust` once, then `mise install` to provision the pinned toolchain
  declared in `mise.toml`.
- Plugins are built only on the official NPM SDK (`@deepseek-ai/*`); never
  modify DSH source or point `tsconfig` at a DSH source checkout.
- Auth: keep tokens in the user-level `~/.npmrc`; the project `.npmrc` contains
  only scope mappings (see [docs/plugins.md](docs/plugins.md)).

## Quick start

```sh
git clone <this repo>
cd dsh-next-plugins
mise trust
mise install
mise run install
mise run build
```

Equivalent `pnpm` commands (identical semantics, same source of truth):

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Create a new plugin scaffold:

```sh
mise run plugin-new -- <slug>
# or: pnpm plugin:new <slug>
```

Run the full pre-push gate and the E2E mount smoke:

```sh
mise run ci       # typecheck + test + build + runtime-deps + docs
mise run e2e      # Playwright mount smoke against a scratch DSH (needs a dsh CLI + Chromium)
```

## Code of conduct

- Do not use emoji in code, comments, documentation, UI text, scripts, or
  commit messages.
- Keep changes focused and preserve existing work.
- Record non-trivial changes as Agent Notes under `.agents/notes/`.
