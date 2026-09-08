# OAuth discovery simplification and quality review

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-oauth-providers

Simplified model-discovery payload selection and flattened discovery guards,
without changing catalogs, credential reads, fallback behavior or RPC contracts.
Added 15 characterization tests, verified on the original implementation and
after each incremental refactor; existing tests remain unchanged. Independent
review approved the focused refactor. No dead-code deletion was needed.

The broader plugin review requests changes; behavior-changing bug fixes were
intentionally not mixed into the refactor. Findings, reproduction evidence,
coverage gaps and validation details are recorded in
[the review report](../../../docs/archive/2026-09-08-oauth-review.md).

Full repository typecheck, tests, build, runtime dependency check, README pairing
check and i18n check passed using installed dependencies. The packed-plugin mount
smoke failed at OAuth dependency installation before browser startup; see the
report for the exact build-policy blocker. No live OAuth login was performed.

The package is private, so no changeset was added. Unrelated working-tree source
changes were left untouched; no commits or DSH checkout changes were made.
