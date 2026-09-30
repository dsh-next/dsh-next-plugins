# Enforce 0.x release plans in validation and publishing entrypoints

- date: 2026-09-30
- status: implemented
- scope: release-plan checker, root scripts, Changesets configuration

Added a read-only [release-plan checker](<../../../scripts/verify-release-plan.mjs>)
to the ordered static gate and local publishing entrypoints. It rejects public
stable/major graduation, stale or invalid versions, unknown/private/repeated
release identities, and major/private intents. No versions or input change files
are modified; only an owned temporary status file is created and removed.

Review caught a real fresh-checkout dependency: Changesets status compares to its
default base even when writing JSON. SHA-pinned Actions checkouts have remote
`origin/main`, not necessarily a local `main` branch. The [configuration](<../../../.changeset/config.json>)
now names `origin/main` as that comparison base, without using `--since` to filter
away older pending intents. A real detached Git/Changesets fixture proves an
already-committed major intent is still rejected and a minor is accepted, with
no local main ref or HEAD/ref changes.

The [regressions](<../../../scripts/verify-release-plan.test.mjs>) also cover
malformed plans, private packages, normal/no-pending releases, command errors,
owned scratch cleanup, and symlinked ancestors/targets. Runtime behavior of
plugins is unchanged; publishing is not performed by these tests.
