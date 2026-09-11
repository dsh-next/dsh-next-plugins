# Skills: global-only management without enablement policy

- date: 2026-09-10
- status: implemented
- scope: packages/dsh-next-skills, packages/dsh-next-cc-plugins, skills verification scripts

## Decision

Keep installation and source management in Skills; leave enablement policy to
a future central plugin rather than building its interface speculatively.
The scope modal, settings policy, workspace wiring, and native-discovery
override are removed. The external Claude bridge now uses install/remove
only and warns that workspace-scoped plugins do not restrict their skills.

User-facing behavior and upgrade cautions live in the
[Skills README](../../../packages/dsh-next-skills/README.md) and
[Claude Plugins README](../../../packages/dsh-next-cc-plugins/README.md).
The old [scope design](../archived/2026-09-04-skills-settings-backed-global-only.md)
is archived. No existing skill files are moved or rewritten on upgrade.

Independent review caught a catalog-cache race: the browser refetches immediately
after a mutation, while the native filesystem watcher invalidates asynchronously.
The host therefore retains an empty-candidate registration solely to borrow the
SDK’s supported invalidation control. It never publishes or overrides a skill.
File mutations invalidate before returning, including external handoffs and
partial failures; there is no settings watcher or enablement policy.

At the user’s request, the alpha interface now makes a clean break: transitional
stale-scope parsing/rejection and its compatibility matrix/probes are removed.
Install RPC forwards only provider and skill identifiers; external installation
uses the same global-only interface. Immediate catalog invalidation remains
necessary installation behavior, not scope compatibility.

## Integration with main

The rebase preserves main’s released Skills version and reduced default-provider
list. Its now-obsolete worktree scope inheritance helpers and checklist are
removed with the rest of Skills policy, without changing Claude plugin scopes.
The canonical test-runner wrappers remain in place; legacy-scope regression
seeding moves to the shared workflow fixture rather than reviving old runners.
The supplementary global-install assertion checks both canonical workspaces and
requires them to exist before ruling out project-local copies.

## Verification

Host/core regressions cover global roots, settings replacement without legacy
scopes, unchanged install/update/delete/provenance behavior, catalog-identifier-only
RPC dispatch, and the install/remove external contract. Browser
tests cover direct install payloads and removal of workspace dependencies.
The real-mount marker exercises global installation, source switching,
recoverable deletion, and the Claude bridge warning; supplementary skills
verification scripts are updated for the same interface.

Static validation: `pnpm typecheck`, `pnpm test` (1,210 tests across six plugins after removing obsolete compatibility cases),
`pnpm build`, `pnpm docs:check`, and `pnpm i18n:check` passed. The runtime-dependency
gate also passed with an isolated temporary Git index representing this working
tree: its tracked-file scan otherwise tries to read unstaged deleted files.
The real staging area was left untouched. Supplementary scripts passed syntax
checks; their network-dependent standalone flows were not run. Independent
review found no remaining required changes after the cache invalidation fix.

Final `bash scripts/e2e-mount.sh` passed all three tests: family
UI markers, the real-repository-skills screenshot, and immediate native
`/api/skills/list` freshness after delete/reinstall with a warmed session catalog
(no waits or retries). Screenshot: [skills.webp](../../../packages/dsh-next-skills/media/skills.webp),
dark theme at its native 564px display width. The test process and its scratch
server exited cleanly; the running user GUI was not restarted or modified.
