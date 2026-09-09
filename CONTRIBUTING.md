# Contributing

Welcome to `dsh-next-plugins`, the `@dsh-next` DeepSeek Harness plugin family.
This file is the contributor entry point; the repository's full rules and
mechanisms live in [AGENTS.md](AGENTS.md) (and its layered instructions), which
take precedence in case of conflict. Package README quality (first-run
guide, screenshots, install copy) lives in [docs/AGENTS.md](docs/AGENTS.md).

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

## Canonical checks

Root `package.json` scripts are the source of truth; mise tasks are thin aliases
that forward arguments. Use `--` before arguments to a mise task.

| Command | Scope |
| --- | --- |
| `pnpm run test:unit` | Every package's unit tests (`pnpm -r test`) |
| `pnpm run test:scripts` | Repository workflow/script tests |
| `pnpm test` / `mise run test` | Both unit and script tests |
| `pnpm run check` / `mise run check` | Ordered typecheck, test, build, runtime-deps, docs, i18n |
| `pnpm run test:e2e` / `mise run e2e` | All keyless browser suites |
| `pnpm run ci` / `mise run ci` | Static check followed by all keyless browser suites |

Install the tested CLI and browser prerequisites explicitly; the runner never
silently installs a CLI through npx. The runtime pin lives in
`scripts/workflow-config.json`:

```sh
npm install -g "@deepseek-ai/dsh@$(node -p "require('./scripts/workflow-config.json').dshVersion")"
pnpm exec playwright install --with-deps chromium
mise run doctor
mise run check
mise run e2e
# Focused browser suites (not a substitute for the full pre-push gate):
mise run e2e -- smoke
mise run e2e -- checkpoints
mise run e2e -- worktrees-sidebar
```

Each suite attempt owns a fresh DSH home, agents root, workspaces, and server;
Playwright runs with one worker and no in-process retries. The workflow owns
whole-suite retries (`--retries 0` by default), creating another fresh runtime
for each attempt rather than reusing polluted fixtures. Keyless runs always
use a fake model key, even if your shell has real credentials. They are **not
fully offline**: authentication failures and marketplace traffic may still
reach the network.

Results, logs, failure traces, and screenshots live under a unique run directory
in `artifacts/testing` by default. Read its results summary when a gate fails.
Treat retained homes and artifacts as private; inspect them before sharing.

## Isolated development and live checks

```sh
mise run dev -- checkpoints --port 0 --open
mise run dev -- checkpoints --live --env-file "$HOME/.config/dsh-next/testing.env"
mise run e2e-live -- checkpoints --env-file "$HOME/.config/dsh-next/testing.env"
mise run doctor -- --live --env-file "$HOME/.config/dsh-next/testing.env"
```

`dev <slug>` builds, packs, installs, validates configuration, and boots a
**fresh owned home and agents root every time**. The default profile is
`dev-<slug>`; `--profile dev-<name>` changes only that scratch profile name,
not an existing user profile. `--port 0` selects an available port. The
full token-bearing URL is written to a private URL file; `--open` opens it.
Stop your owned run before rebuilding and starting again. Keep scratch state
with `--keep failure` or `--keep always`; the default is `--keep never`.
Never kill or restart the DSH instance hosting your agent or another user's GUI.

Live-model calls are opt-in (`--live` for dev, `test:live` for browser tests).
Credentials come from the inherited environment, an explicit `--env-file PATH`
(or `DSH_TEST_ENV_FILE`), or the user file
`~/.config/dsh-next/testing.env` in live mode only. Keep that file private;
do not commit credentials or depend on automatic shell-startup-file sourcing.
Live checks can spend model credits; installing a plugin does not need a live key.
The CI workflow offers an opt-in `live_checkpoints` dispatch on `main` only.
Configure a protected GitHub environment named `live-tests` with its
`DEEPSEEK_API_KEY` secret and required reviewers before enabling that job.
No live secret is passed to pull-request checks.

The legacy skills-preview and worktrees-screenshot boot entrypoints use the
same owned-runtime primitives (`pnpm run preview:skills`,
`pnpm run capture:worktrees`). Screenshot capture is explicit; it may update
package media, whereas ordinary test screenshots remain in run artifacts.
`mise run npm-auth-test -- <slug>` uses normal npm user configuration for an
identity check and packed-package dry run; it neither reads repository `.env`
files nor proves permission to publish.

## Pack or install checkout plugins

```sh
mise run plugin-pack -- worktrees
mise run plugin-install -- worktrees --profile web --dry-run
mise run plugin-install -- worktrees --profile web
# Noninteractive explicit consent, optionally against a chosen existing home:
mise run plugin-install -- worktrees --profile web --home "/path/to/DSH home" --yes
```

These commands use `scripts/workflow-pack.mjs` to build and pack selected plugins
and their required local dependency/peer closure. Local devDependencies are
build-only; optional dependencies are excluded unless explicitly selected.
Version ranges and cycles are checked before installation, and source manifests
are not rewritten. Tarballs exercise consumer packaging instead of masking SDK
skew through `link:` installs.

Unlike `dev`, `plugin:install` targets the requested existing profile. Review
its dry run first: installation requires confirmation (`--yes` for non-TTY
use), does not wipe unrelated profile state, and never boots or restarts the
profile. Coordinate any later restart with its owner. `mise run install`
still means workspace dependency installation, not plugin installation.

A worktree created from this repo by the worktrees plugin runs
`.worktrees.json` (`pnpm install`) in the new folder. This repo has no
`.worktreeinclude`: there are no gitignored local files that every worktree
must copy. Tokens stay in `~/.npmrc` or the private user testing env file.
Run `mise trust` once in a new folder if you use mise.

Create a new plugin scaffold:

```sh
mise run plugin-new -- <slug>
# or: pnpm plugin:new <slug>
```

Package READMEs document npm installation only
(`dsh plugin --profile <name> add @dsh-next/dsh-next-<slug>`).
Checkout development belongs here, not as `link:` or `file:` README copy.

## Code of conduct

- Do not use emoji in code, comments, documentation, UI text, scripts, or
  commit messages.
- Keep changes focused and preserve existing work.
- Record non-trivial changes as Agent Notes under `.agents/notes/`.
