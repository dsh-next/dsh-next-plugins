# Retire the reset plugin

- date: 2026-09-22
- status: implemented
- scope: packages/dsh-next-reset, tests/e2e, scripts/workflow, CONTRIBUTING.md

`packages/dsh-next-reset` and its `reset` e2e suite are removed at the owner's
request, together with every reference: the suite registry in
[workflow.mjs](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow.mjs),
the family-smoke non-UI exemption in
[mount.e2e.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/tests/e2e/mount.e2e.ts),
the contributor suite table, the pending `fresh-session-reset` change file, and
the idea note under `docs/ideas/`.

The git plugin's retired `dsh-next-worktrees` reclaim seam stays, because
[dsh-next-checkpoints](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-checkpoints/src/index.ts)
still resolves it; the comments that named both consumers now name checkpoints
only. The guard unit test that used the reset package as a synthetic non-UI
plugin now uses the host-only `dsh-next-opencode-session-patch` id.

The package was published at `0.1.0` and is not private, so removing the
directory does not unpublish it: the promise "start a blank session and archive
this one" keeps working for profiles that already installed it, and the npm
entry needs a manual deprecation if installs should warn.
