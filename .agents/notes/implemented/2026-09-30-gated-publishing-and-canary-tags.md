# Gate publishing on same-SHA CI and constrain Canary tags

- date: 2026-09-30
- status: implemented
- scope: .github/workflows publishing

## Changes

[Release](<../../../.github/workflows/release.yml>) and
[Canary](<../../../.github/workflows/canary.yml>) now reuse
[CI](<../../../.github/workflows/ci.yml>) on the triggering SHA before their
publishing job can run. Validation receives only `contents: read`, with no
inherited secrets or reusable input/secret interface. The stable publishing job
alone retains repository/PR write permissions and the existing default bot token.
The canonical ordered check and all keyless mount suites remain the gates; the
post-publish smoke remains explicitly a checkout-tarball check, not registry
artifact verification.

Reusable CI concurrency uses the caller name and run ID under a separate `ci-`
prefix, so it cannot cancel the publishing caller or another publishing run.
Direct CI retains ref/PR-based cancellation. The live-model job still requires
manual CI, `main`, explicit opt-in (default false), and the `live-tests`
environment. Checking the caller workflow name prevents Canary's dispatch event
from activating that job.

Canary runs only on `main`, with a `canary`/`beta`/`rc` choice and a shell
allowlist before dependency installation, auth, or snapshot mutation. Dispatch
input enters shell only through `TAG`; quoted arguments and `--no-git-tag` remain
mandatory. Canary uses a read-only token and does not persist checkout credentials.
Workflow comments now acknowledge that snapshots mutate manifests/CHANGELOGs and
consume runner-local change files without committing those mutations.

## Verification

[Publishing regression tests](<../../../scripts/workflow-publishing.test.mjs>)
parse actual YAML with the root `yaml` dependency, exercise branch/live/concurrency
contexts and failed validation, and execute the actual tag/auth/publish shell
blocks behind local command mocks. Probes use only ignored `artifacts/testing/`
subdirectories and synthetic credentials; no real pnpm version/publish, git tag,
GitHub mutation, workflow dispatch, or model call occurs.

- `node --check scripts/workflow-publishing.test.mjs`: exit 0.
- `node --test scripts/workflow-publishing.test.mjs`: 15 passed, exit 0.
- `git diff --check`: exit 0.
- `command -v actionlint`: exit 1; executable unavailable, no installation attempted.

Five-axis self-review covered correctness, simplicity, workflow reuse,
input/secret/permission boundaries, and bounded probe cost. The pinned action's
[version branch selection](<https://raw.githubusercontent.com/changesets/action/v2.1.1/src/run.ts>)
and [SHA-based API commits](<https://raw.githubusercontent.com/changesets/action/v2.1.1/src/github.ts>)
were inspected to confirm explicit SHA checkout preserves release PR semantics.
Action versions were not changed. Full CI, hosted Actions execution, actual
publishing, and protected-environment configuration were intentionally not tested
locally; repository policy/dependency/docs changes remain the lead's ownership.
