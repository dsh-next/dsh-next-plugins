# Route PRs and reassign stale maintainers safely

- date: 2026-09-30
- status: implemented
- scope: PR review routing and stale assignments

The [review helper](<../../../scripts/github-review-routing.mjs>) implements
segment-aware `*` and `?`, recursive `**`, and zero-directory `**/` matching.
File retrieval is paginated without the former 300-file cap; a known mismatch
against the PR's changed-file count fails before any requests. Rename routing
includes both paths. Author self-review remains excluded, but self-assignment
is allowed. [Routes](<../../../.github/pr-review-routes.json>) explicitly cover
all seven plugins and retain sitegroove as the default.

The [privileged routing workflow](<../../../.github/workflows/auto-assign-pr-reviewers.yml>)
checks out the immutable PR base SHA, never the PR head. Both configuration and
helper imports use absolute trusted workspace paths.

The [stale helper](<../../../scripts/github-stale-assignment.mjs>) uses the first
configured default assignee, or sitegroove, never an implicit repository owner
that might be an organization. Before acting it validates user identity and
repository assignability. It paginates items, assignment events, comments, and
reviews; unknown history or failed retrieval preserves current assignments.
Unlike the earlier creation-date fallback, missing assignment history now means
unknown age and is skipped. Already-fallback PRs are skipped entirely.

A current-state refresh detects changed assignments/activity before adding the
fallback. The returned assignment list must confirm that addition and retain the
same non-fallback assignee set before only stale configured users are removed;
concurrent additions skip removals, while active and unrelated users remain.
Notification is posted only after successful reassignment. GitHub's separate
mutation endpoints are not an atomic transaction, but failed additions or
removals no longer blindly discard the original assignment.

Validation: [routing regressions](<../../../scripts/github-review-routing.test.mjs>)
and [stale regressions](<../../../scripts/github-stale-assignment.test.mjs>)
exercise late pages, malformed/unknown history, API failures, fallback
confirmation, and preservation of other users using mocked APIs. All four
focused GitHub automation suites pass. The current routes only assign the
fallback itself, so the scheduled sweep intentionally has no candidates.
