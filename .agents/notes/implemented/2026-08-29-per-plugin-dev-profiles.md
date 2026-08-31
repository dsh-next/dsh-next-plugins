# Per-plugin dev profiles for local testing

- date: 2026-08-29
- status: implemented
- scope: .agents/skills/dsh-next-local-testing, AGENTS.md

The manual live-install loop now uses one dev profile per plugin,
`dev-<slug>` (e.g. `dev-git`), instead of a single shared `dev` profile.

Why: a DSH profile is a whole directory under `$DSH_HOME/profiles/<name>`
(own `package.json`, `cordis.patch.yml`, `node_modules`), so a shared `dev`
profile made parallel sessions collide in three ways:

1. All concurrently tested plugins composed into one boot — no failure
   attribution, and one broken plugin took down every session's GUI.
2. Concurrent `dsh plugin add` runs raced `pnpm add` in the same profile
   directory (lockfile/node_modules contention, possible corruption).
3. Booted instances fought over the default port.

Conventions now documented in the skill:

- `dev-<slug>` for manual iteration; stable across sessions so `link:`
  installs persist and the build → restart loop stays cheap.
- Distinct `--port` (or `--port 0`) per concurrently booted instance; a
  profile name does not reserve a port.
- Two sessions iterating the same plugin use a session-suffixed name or the
  scratch-`DSH_HOME` loop.
- `smoke` remains the profile name for the automated scratch-home lanes;
  cross-plugin composition stays covered by `mise run e2e`, which mounts the
  whole family into one profile.

AGENTS.md's local-testing summary was updated to match and its final step
corrected from `dsh web` (a hardcoded alias for `--profile web`, which boots
the wrong profile) to `dsh --profile dev-<slug> --no-open`.
