---
name: dsh-next-local-testing
description: Test a dsh-next plugin locally — run the static gate, the automated real-mount smoke, and the manual live-install loop against a real DSH profile. Use when the user asks how to test, run, verify, or iterate on a `@dsh-next/dsh-next-*` package locally.
---

# dsh-next local testing

Use the canonical commands in [CONTRIBUTING.md](../../../CONTRIBUTING.md).
Root package scripts own semantics; mise aliases only forward arguments.
Read AGENTS.md and docs/plugins.md before changing a plugin. Never modify DSH
source or restart a DSH process you do not own.

## 1. Static completeness gate

```sh
mise run check
# equivalent: pnpm run check
```

This runs typecheck, unit plus repository script tests, build, runtime dependency
checks, documentation checks, and i18n checks in order. Map every exported
behavior, including edge/error paths, to coverage; passing only newly added
tests is not sufficient. `mise run ci` additionally runs all keyless E2E suites,
so it is not a static-only alias.

## 2. Automated browser coverage

Install the CLI version from `scripts/workflow-config.json` and Playwright
Chromium explicitly (commands in CONTRIBUTING.md), then:

```sh
mise run doctor
mise run e2e
# Focused iteration; still run all suites before merging:
mise run e2e -- smoke
mise run e2e -- checkpoints
mise run e2e -- worktrees-sidebar
```

The workflow builds and packs checkout tarballs, validates the profile, and owns
a fresh DSH home, agents root, workspaces, and server for each suite attempt.
No existing profile is reset or reused. Keyless mode forces a fake key even
when real credentials exist in the shell. It is not fully offline: auth and
marketplace traffic can reach the network. Playwright workers remain one;
whole-suite `--retries N` are owned by the workflow, with a fresh runtime per
retry and zero retries by default.

A UI plugin needs a named DOM marker in `tests/e2e/mount.e2e.ts` that drives
real behavior and requires its tab/panel, not a conditional check that passes
when UI is absent. Guards check page errors, plugin console errors, and crash
strips after interactions. Do not weaken these guards to hide failures.
Fixtures expose canonical `DSH_E2E_WORKSPACE_A/B` paths; never hardcode machine
paths. Registry seeding is only safe while the owned scratch runtime is stopped;
atomic JSON replacement is not a concurrent-writer lock.

The workflow seeds first-run settings and a fake model route for editable
keyless composers. Keep `dismissOnboarding()` defensive: failed settings can
reveal a dialog. New runtime failures need evidence, not skipped assertions,
reordered suites, or changed registry counts to mask fixture pollution.

## 3. Manual development and opt-in live calls

```sh
mise run dev -- checkpoints --port 0 --open
mise run dev -- checkpoints --live --env-file "$HOME/.config/dsh-next/testing.env"
mise run e2e-live -- checkpoints --env-file "$HOME/.config/dsh-next/testing.env"
```

Dev always builds and installs tarballs into a new owned home and agents root.
The default profile is `dev-<slug>`; a profile override still refers to that
fresh home. Use the private token URL file or `--open` to view it; an unrelated
running GUI does not update. Iterate by editing, stopping the owned run, and
rerunning dev. Do not add duplicate dynamic-preview implementations or use
source links to mask consumer packaging/SDK failures.

Live credential sources and precedence are documented in CONTRIBUTING.md:
inherited environment, explicit `--env-file`/`DSH_TEST_ENV_FILE`, or the
private user testing env file in live mode only. No shell startup files are
sourced automatically. Live calls can spend credits. Check prerequisites with
`mise run doctor -- --live` before starting expensive work.

## 4. Existing-profile installation is separate

```sh
mise run plugin-pack -- worktrees
mise run plugin-install -- worktrees --profile web --dry-run
mise run plugin-install -- worktrees --profile web
```

The pack/install workflow resolves required local dependencies and peers,
validates ranges/cycles, builds local devDependencies without installing them,
and excludes optional dependencies unless selected. Source manifests are not
rewritten. Existing-profile installs need confirmation (`--yes` in non-TTY
use), target only the selected closure, and do not wipe, boot, or restart the
profile. They need no model key. See CONTRIBUTING.md for `--home` targeting.

## Evidence and ownership

- The per-run `artifacts/testing` directory holds the results summary, logs,
  screenshots, and failure traces. Inspect artifacts before sharing; retained
  scratch homes and token URLs are private.
- `--keep never|failure|always` controls scratch retention; default is never.
- Verify visible client UI, not only RPC success or host boot. User-visible
  changes need runtime evidence; visual changes need screenshots.
- Full pre-push gate: `mise run ci`. Live E2E is an explicit additional lane,
  not a requirement for keyless installation or ordinary static checks.
