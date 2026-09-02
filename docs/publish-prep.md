# Publish preparation

This document records the release order and checks required before publishing.

## Per-package versioning

Each plugin under `packages/` versions independently. Every PR that touches a
publishable plugin adds a `.changeset/<id>.md` change file (run
`pnpm changeset`) naming the affected packages and their bump kinds. The
release pipeline (`changesets` in `.github/workflows/release.yml`) consumes
those files: on push to `main` it runs `changeset version`, which bumps only
the named packages, writes their `CHANGELOG.md`s, and opens or updates the
"Version Packages" PR. Merging that PR is the release — the next `main` push
runs `changeset publish`, which publishes exactly the packages whose version
is new to the registry and creates per-package GitHub Releases from the
changelog entries.

## Not-yet-released packages (private manifest)

A plugin under active development that must not publish yet is marked
`"private": true` in its own `package.json` — npm refuses to publish a private
package, and changesets skips it on version/publish, so the manifest is the
single source of truth for publishability. This is also the strongest
guardrail: even a raw `pnpm publish -r` cannot ship it. A private package:

- needs **no** change file for its changes (the CI gate checks this), and
- is **never** named in a change file — a changeset mixing a private with a
  released package makes `changeset version` fail, so the gate rejects it.

It keeps being built, tested, and mounted by the e2e smoke. When the package
is ready, remove `"private": true` from its manifest and the next change file
releases it. `shared/` and the root `package.json` are private and never
publish.

## Release order

Packages have no cross-package runtime dependencies, so each publishes
independently at its own version. `changeset publish` handles the order and
skips packages whose version is already on the registry.

## Pre-release checks

- `pnpm typecheck && pnpm test && pnpm build` is green (or `mise run ci`, which
  adds the runtime-deps and docs checks).
- `pnpm runtime-deps:check` passes (no published bundle imports a
  devDependencies-only package).
- `pnpm docs:check` passes.
- `pnpm changeset status` lists exactly the packages this release bumps
  (or is empty when nothing is pending).
- Plugin source changes have a change file: `node scripts/verify-changeset.mjs --base origin/main`
  is green (CI enforces this on pull requests).

## npm tokens

Publishing uses the repository secret `NPM_TOKEN` (an npm automation token for
the `@dsh-next` scope). The release action writes it into the runner's
`~/.npmrc`; never commit token configuration — keep it in the user `~/.npmrc`
or CI secrets.
