---
name: dsh-next-local-testing
description: Test a dsh-next plugin locally — run the static gate, the automated real-mount smoke, and the manual live-install loop against a real DSH profile. Use when the user asks how to test, run, verify, or iterate on a `@dsh-next/dsh-next-*` package locally.
---

# dsh-next local testing

Three layers, from fastest to most complete. Every layer is non-optional before
merging behavior that touches mount/loading code.

The gate is a **completeness** gate, not a smoke: it must prove (a) every
functionality of the change is exercised and (b) nothing pre-existing broke.
A plugin change is not validated by "the tests I added pass" — map each
exported behavior (and its edge/error branches) to a test case, and confirm the
whole suite plus the mount smoke stay green. See `docs/plugins.md` →
"The completeness contract".

## 1. Static gate (no DSH needed)

```sh
mise run ci        # typecheck + test + build + runtime-deps + docs
```

Equivalent raw commands: `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm runtime-deps:check`, `pnpm docs:check`.

## 2. Automated real-mount smoke (real DSH, isolated)

```sh
pnpm exec playwright install chromium   # one-time
mise run e2e
```

`scripts/e2e-mount.sh` packs every plugin, mounts each into a scratch profile
via `dsh plugin --profile smoke add file:<tarball>`, boots a keyless `dsh web`,
and renders it headlessly (Playwright) asserting no crash markers. It uses a
temp `DSH_HOME`, so it never touches your real `~/.dsh`.

The smoke also runs the **per-plugin DOM markers** in `tests/e2e/mount.e2e.ts`:
a UI plugin registers a marker that drives into its UI and asserts real
behavior. This is what catches a plugin that mounts without crashing yet
renders nothing (e.g. a silent Host-RPC payload-shape mismatch), which the
crash-marker check cannot see. When adding UI to a plugin, add (or verify) its
marker and confirm the lane stays green. A fresh scratch home shows onboarding
dialogs, so markers use `dismissOnboarding()` first.

## 3. Manual live install (see it in the GUI)

Use **one dev profile per plugin**: `dev-<slug>` (e.g. `dev-git`). A profile is
a whole directory (its own `package.json`, `cordis.patch.yml`, `node_modules`),
so a single shared `dev` profile makes parallel sessions collide: every
concurrently tested plugin composes into one boot (no failure attribution — one
broken plugin takes down everyone's GUI), and concurrent `dsh plugin add` runs
race `pnpm` inside the same profile directory.

```sh
# build first (lib/index.js + lib/client.js)
pnpm build

# link a source checkout into the plugin's dev profile (no repack per iteration)
dsh plugin --profile dev-<slug> add link:$(pwd)/packages/dsh-next-<slug>

# or install from a packed tarball (what CI/consumers get)
(cd packages/dsh-next-<slug> && pnpm pack)
dsh plugin --profile dev-<slug> add file:$(pwd)/packages/dsh-next-<slug>/dsh-next-<slug>-0.1.0.tgz

# inspect the composed profile tree BEFORE booting (verify the row resolved)
dsh --profile dev-<slug> --dump-config

# boot the plugin's dev profile and look at the GUI (NOT `dsh web`, which is a
# hardcoded alias for --profile web and would boot the wrong profile)
dsh --profile dev-<slug> --no-open
```

Booting several dev profiles at once is fine, but a profile name does not
reserve a port: give each concurrently booted instance a distinct `--port`
(or `--port 0` and read the assigned URL from the output). Two sessions
iterating the *same* plugin still share its `dev-<slug>` — for that case use a
session-suffixed profile name or the scratch-home loop below.

`dsh plugin add` runs `pnpm add` in the profile dir, then reconciles packages
that declare `dsh.bundle.patch` into `dsh.profile.bundles` automatically — you
never hand-edit the profile's `package.json` or `cordis.patch.yml` for a normal
install.

## The iteration loop is build → restart (no dynamic path needed)

TypeScript packages iterate through the *permanent* path above: edit →
`pnpm build` → restart. That restart is the only cost, and boot is fast. Do
**not** add a separate JS "dynamic preview" per plugin for
`cordis_define`/`cordis_run` — that tool takes a self-contained raw JS function
body (no imports), which is a different shape from the compiled `lib/` output
and would duplicate the plugin's logic as a second source of truth. The dynamic
path is a prototype-only aid, not the TS-package testing loop.

## Verifying without restarting your own process (agentic loop)

An agent running *inside* DSH must never restart its own host process. Instead,
boot an **isolated second instance** and verify there:

```sh
TMP=$(mktemp -d); export DSH_HOME="$TMP/home"      # isolated home (never ~/.dsh)
# ...write a scratch profile package.json + cordis.patch.yml...
dsh plugin --profile smoke add link:$(pwd)/packages/dsh-next-<slug>
dsh --profile smoke --dump-config                    # composition resolved?
dsh --profile smoke --no-open --port 0 > log 2>&1 &  # boot, OS-assigned port
# ...grep the log for the URL + crash markers / plugin "ready" lines...
# ...Playwright render for DOM assertions...
kill %1                                             # tear down
```

Multiple `dsh web` instances coexist when they differ in **port** and
(preferably) **`DSH_HOME`**. Note `dsh web` is a hardcoded alias for
`--profile web`; a custom profile must be booted as `dsh --profile <name>`.
Headless verification means: `--dump-config` for composition, the boot log for
crash markers and the plugin's own log lines, and Playwright for real DOM
assertions — an agent cannot literally "see" the GUI.

## Rules

- Never `kill`/`pkill`/restart a running DSH service you do not own. Use a
  scratch `DSH_HOME` for destructive probes, or boot your own profile.
- `--dump-config` is the fastest way to confirm a row actually resolved before
  spending time booting the GUI.
- Changes to a permanent package need a rebuild + restart to take effect; there
  is no auto-reload for plugin authors.
