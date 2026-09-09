# Unify testing and local plugin installation

- date: 2026-09-09
- status: implemented
- scope: repository test tooling, mise, and profile installation

Implements the approved [workflow review](../../../docs/archive/2026-09-09-testing-workflow-review.md).
Contributor commands and credential setup are owned by
[CONTRIBUTING](../../../CONTRIBUTING.md); the testing skills mirror that interface.

## Implementation

- `scripts/workflow-pack.mjs`: manifest-backed runtime/build dependency graphs,
  semver/cycle validation, optional local edges only when selected, immutable
  hashed tarballs, archive/exports validation, and default-web install planning.
  Installation uses the official CLI with local artifact overrides, exact
  profile metadata checks, dependency-first selected bundle ordering, a
  cooperative profile lock, lossless private override reads distinct from
  redacted reports, confirmation, and no dependency-tree purge,
  settings seed, server boot, or restart. Partial failures are reported honestly.
- `scripts/workflow-runtime.mjs`: explicit keyless/live credential resolution,
  no shell startup, private owned home/agents/workspaces, fixture Git isolation,
  authenticated readiness, redacted logs, and bounded process-group cleanup.
  Unexpected leader exit triggers immediate memoized disposal.
- `scripts/workflow.mjs`: pack once per run; fresh state for every suite attempt;
  all keyless groups by default; opt-in live checkpoint test; safe doctor and
  isolated dev modes. Build/install and CLI cancellation share AbortSignal.
- Shared profile/skill seeding, strict browser guards, deleted/untracked source
  discovery, failure artifacts, and baseline-aware checkpoint ordering checks.
- Ordered pnpm check/ci gates and thin mise aliases include repository-script
  tests and full keyless E2E. Explicit dependency setup replaces implicit pnpm
  reinstall. Runtime CI pin has one data source.
- Legacy preview/screenshot boot recipes reuse the shared primitives; npm auth
  uses normal npm user config rather than reading repository .env files.
- Manual main-only live CI dispatch uses the protected live-tests environment;
  maintainers must configure its reviewers and DEEPSEEK_API_KEY secret.

## Verification

Final `pnpm run ci` passed (exit 0): 1,637 package tests in 134 files,
186 repository-script tests, typecheck/build/runtime-deps/docs/i18n, and all
eight keyless E2E tests across three fresh runtime groups. Evidence:
`artifacts/testing/validation-final-2026-09-09.log` and
`artifacts/testing/run-YjNU4i/summary.json`.

The opt-in live checkpoint capture/rewind test also passed using an explicit
interactive-zsh invocation to inherit the existing global key; the runner has
no implicit shell fallback. Evidence: `artifacts/testing/run-aoObj4/summary.json`; the public mise task also passed
with `artifacts/testing/run-4byWbm/summary.json`.
Live validation exposed stale assertions for modal copy and conversation tabs
after Session-start rewind. The corrected test verifies the exact rewind RPC,
file deletion, empty child composer, and child baseline checkpoints rather than
expecting tabs on an intentionally empty chat. Production checkpoint code was
not changed to accommodate those tests.

Mise default-web install and focused E2E dry runs passed; the actual cc-plugins
plan resolves skills before cc-plugins. A real CLI installation of this closure
into a disposable new profile also passed (`artifacts/testing/install-verification.log`);
that home was removed afterward. Independent review found and prompted
regressions for signal forwarding, CLI signal cleanup, signaled dev exits,
missing dev slug, JSON secret redaction, and delayed descendant disposal.

CI YAML parses and the live secret reference was checked; actionlint is not
installed locally, so remote GitHub Actions execution is not claimed. Existing
SDK sourcemap/React warnings remain non-failing. Keyless mode is not fully offline
(provider auth and marketplace traffic may still use the network).

No real web profile was installed, cleaned, or restarted. No model credential
was copied into the repository. All automated runtimes used owned scratch state
and were stopped; explicitly retained failure homes are private debugging data.
