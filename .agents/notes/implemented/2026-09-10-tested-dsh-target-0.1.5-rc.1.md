# Test against the DSH version users actually run

- date: 2026-09-10
- status: implemented
- scope: scripts/ and .github/

`scripts/workflow-config.json` pinned the tested DSH CLI at `0.1.3-alpha.2`.
That file is not documentation: `.github/workflows/ci.yml` installs exactly
`npm install -g "@deepseek-ai/dsh@$(node -p "require('./scripts/workflow-config.json').dshVersion")"`
in both the `plugin-mount` and `live-checkpoints` jobs. CI therefore mounted
and drove every plugin against a CLI older than the `0.1.5-rc.1` users run.

The pin moves to `0.1.5-rc.1`, the version the installed CLI reports. The
`dsh-next-oauth-providers` runtime-skew bug (a hand-built
`ResolvedPiAiProviderProfile` missing a field the `0.1.5` adapter reads) stayed
invisible precisely because CI never executed the newer adapter; see
[the oauth note](2026-09-10-oauth-runtime-profile-modelerrors.md).

`scripts/workflow.test.mjs` now derives its fake CLI version from
`testedDshVersion` instead of hardcoding the old pin, and the doctor test
asserts the run reports that value, so the fixture cannot drift from the config
again.

The `preflight` step already compares the installed CLI against every selected
package's `dsh.engines.dsh` floor, so a pin below a declared floor fails the
run loudly rather than silently testing the wrong runtime.

Evidence: the full keyless e2e lane was run locally against `dsh 0.1.5-rc.1`
(`smoke`, `checkpoints`, `worktrees-sidebar`) and passed, and
`pnpm test:scripts` is green with the new fixture wiring.

Not changed: the per-package `dsh.engines.dsh` floors stay where they are.
They are minimums the plugins still honour, not the tested target. The derived
workspace browser pin in `dsh-next-worktrees` is a client-UI package version,
a separate concern.
