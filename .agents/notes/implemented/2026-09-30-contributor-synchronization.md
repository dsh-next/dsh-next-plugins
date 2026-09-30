# Contributor synchronization

- date: 2026-09-30
- status: implemented
- scope: contributor maintenance script, workflow, and root README

The [maintenance script](<../../../scripts/update-contributors.mjs>) now has
import-safe pure rendering/update seams and a separately invoked CLI. It
validates normal GitHub environment metadata, bounds pagination to ten pages
of 100 records and each request/body read to ten seconds by default, and fails
rather than publishing a truncated or malformed list. Only validated,
case-normalized logins become GitHub profile links; duplicates use their maximum
contribution count, with descending count and ASCII-login ordering. Bot types
and conventional bot suffixes are excluded explicitly.

The [root README](<../../../README.md#contributors>) gains an English Contributors
section with an intentional first-sync placeholder. Synchronization preserves
all content outside its exact marker pair and skips unchanged writes. Partial,
duplicate, reversed, and inline markers fail safely. Initial section insertion
ignores fenced examples and preserves existing acknowledgments.

The [workflow](<../../../.github/workflows/contributors.yml>) serializes the actual
`main` PR target even for `dev` events. It reads trusted main, stages only the root
README, and updates the dedicated `automation/contributors` branch with a lease.
It creates a bot PR when none is open rather than bypassing protected main.
Checkout credentials are persisted only for this trusted writer; repository and
pull-request write permissions use the standard token, with no additional secret.
Bot PR checks may require manual approval. No protection settings are changed.

## Verification and privacy

- `node --test --experimental-test-coverage --test-coverage-include=scripts/update-contributors.mjs scripts/update-contributors.test.mjs`
  — initial rendering/fetch coverage run: exit 0, 23 focused tests passed.
  Script coverage: 99.18% lines, 98.58% branches, 100% functions. Added a real
  proposal-shell test under mocked git/gh commands for no-op, new/existing PRs,
  lease push failure, and no direct main push. The direct CLI launch guard is
  intentionally not executed; exported CLI behavior uses injected fixtures.
- Syntax checks for both scripts (`node --check`) and scoped
  `git diff --check` — exit 0.
- The [focused tests](<../../../scripts/update-contributors.test.mjs>) use mocked
  API responses and in-memory file reads/writes, plus read-only workflow/README
  assertions using the already installed YAML parser. They cover empty and
  bot-only lists, schema/login errors, status/JSON/transport failures, request
  and body timeouts, pagination bounds, exact content preservation, no-op
  writes, main-target workflow behavior, and credential-safe diagnostics.
- No actual GitHub API calls, dependency installs, full CI/unit/E2E suites,
  commits, refs/index mutations, pushes, publishing, or live GitHub writes were
  performed. CLI diagnostics contain only controlled messages and counts,
  never environment values, response bodies, or raw exception messages.
