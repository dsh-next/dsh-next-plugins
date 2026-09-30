# Document guarded publishing and disposable snapshots

- date: 2026-09-30
- status: implemented
- scope: release documentation and release skill

Updated the [release model](<../../../docs/release-model.md>),
[publishing preparation](<../../../docs/publish-prep.md>),
[changeset guidance](<../../../.changeset/README.md>), and
[release skill](<../../skills/dsh-next-release/SKILL.md>) to describe same-SHA
keyless validation before publishing, allowed main-only prerelease tags, current
granular npm token requirements, and manual approval of bot-created PR checks.

Snapshot versioning in the current CLI modifies manifests/CHANGELOGs and removes
used changeset files in its working directory. The stable branch is protected
by an uncommitted disposable CI checkout, not by snapshots leaving inputs intact.
Local publishing aliases are real publishing operations, not dry runs; normal
working checkouts must not be used for destructive snapshot preparation.

Contributor updates use a bot PR, so they do not require bypassing protected main.
Paid tests remain an explicit direct-CI/manual/main opt-in with environment-scoped
key/reviewer protection. No GitHub protection, credential, branch, or publishing
setting was changed by this documentation update.

Final local validation: actionlint passes; full `pnpm run ci` passes 3,679 package
tests (one existing skip), 489 repository-script tests, and all 23 keyless browser
tests. The pending release preview remains minor/patch on 0.x. No paid/model,
workflow-dispatch, GitHub mutation, push, tag, or publication operation was run.
