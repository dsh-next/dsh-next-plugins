# Organize plugin changes and reconcile release intents

- date: 2026-09-29
- status: implemented
- scope: repository commit organization and .changeset

Split the accumulated work into plugin-owned source/test commits, separate
per-plugin first-run documentation commits, and shared tooling, packaging,
metadata, and agent-guidance commits. Isolated snapshot checks caught mixed SDK
declaration graphs in the initial partial-upgrade ordering. Regrouped the SDK
manifests, generated lock graph, and required source/test contract ports into one
atomic prerequisite with the native Notifier rewrite. Its fresh frozen install,
full typecheck/build, repository script tests, and Notifier/Checkpoints/Skills
tests passed before activating the corrected history. Git UI ownership and the
other plugin feature/refactor commits remain separate afterward.

Only this session's unpublished commits were regrouped; the final source,
manifest, and lockfile tree was verified identical. Generated desktop research
is ignored, not committed. No push, tag, publication, or manual package-version
change was made.

Reviewed older pending release entries as well as the new intents:

- [OAuth capabilities](<../../../.changeset/oauth-model-capabilities.md>) is a
  minor feature, not a patch. The independent image-prompt fix remains recorded.
- [Skills service retirement](<../../../.changeset/retire-unused-skills-bridge.md>)
  and [profile migration](<../../../.changeset/brave-llamas-sing.md>) are breaking
  changes. The global-only entry no longer promises the retired integration.
- [Native notifications](<../../../.changeset/silver-steaks-exist.md>) consolidates
  superseded settings/location entries and states the final SDK minimum and
  device-local playback. The delivery-fix entry no longer mentions removed
  host-side sound files.
- Removed the reverted pi-ai 0.87.1 catalog promise. The rollback restores the
  adapter-supported catalog without claiming live tool-call recovery was proven.
- Private Git, Decisions, and OpenCode packages have no release intents. The
  removed marketplace package was private and is not named by a changeset.

Under the maintainer's clarified [0.x release policy](<../../../.changeset/README.md#bump-kinds>),
`pnpm changeset status` previews a patch for Checkpoints and minors for
Notifications, OAuth providers, and Skills. Breaking-change warnings are retained. `node scripts/verify-changeset.mjs
--base eedab6a` confirms intent coverage for every releasable package touched by
this batch. All eight subsequent source boundaries passed isolated frozen
installation, full typecheck/build, repository scripts, docs/i18n, and the
unchanged exported runtime-import checker against their archived source lists.

The final sequential `pnpm run ci` passed all static checks and seven keyless
browser suites: 3,679 package tests, 206 repository-script tests, and 23 browser
tests passed, with one pre-existing Git test skipped. An overlapping repeat had
hit two Git fixture timeouts; the final rerun passed the unchanged tests with
no competing snapshot jobs and no increased timeouts or weakened assertions.

The final lockfile retains the reviewed 0.1.7-rc.1 graph instead of carrying
newly published rc.2 resolutions from intermediate lock generation. Package
versions and generated changelogs are still owned by the release pipeline.
