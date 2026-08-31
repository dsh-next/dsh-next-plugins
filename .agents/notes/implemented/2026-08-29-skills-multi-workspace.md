# dsh-next-skills: full multi-workspace support (install, disable, delete)

- date: 2026-08-29
- status: implemented
- scope: packages/dsh-next-skills

## What the user asked

Whether the same skill can be installed into multiple workspaces, disabled per
workspace, and deleted per workspace — and how that is managed.

## Audit result before the change

- Install into multiple workspaces: supported by the service
  (`installSkill` takes a `workspacePath`) but blocked by the UI — once a name
  appeared in the merged list, the Marketplace row showed "installed" and hid
  the Install button.
- Disable per workspace: supported by the service (the shadow mechanism) but
  unreachable from the UI — the panel always sent the skill's own scope, so
  toggling off a global skill disabled it globally.
- Delete per workspace: already worked (select the workspace, Remove trashes
  that copy only).

## Changes

1. **Per-target presence.** New `getInstalledMap` RPC +
   `SkillsService.installedMap(workspacePaths)` returning the global list plus
   each requested workspace's list. The panel keeps a `Presence` map
   (`global: Set<name>`, `byPath: Map<path, Set<name>>`), refreshed on mount
   and after every mutation.
2. **Marketplace per-target install.** Each row shows where the name already
   lives (`in global`, `in 2 workspaces`, `in global + 1 workspace`) and an
   `installed here` badge for the chosen target; the Install button is offered
   per target, so the same skill installs into several workspaces
   independently.
3. **Shadow-aware toggle.** Disabling a global skill while a workspace is
   selected now sends `scope: 'workspace'`, which makes the service drop a
   workspace shadow (per-workspace disable); re-enabling removes the shadow
   (the shadow row wins the merge with `scope: 'workspace'`, so its own-scope
   toggle removes it). "Global only" keeps toggling the global copy. The
   workspace selector hint documents the semantics.
4. **Shadow visibility.** `InstalledSkill.shadow` (set in `discoverRoot`
   through `isShadowSkill`) renders as a `shadow` badge so a shadowed global
   skill is distinguishable from a real workspace install.

A UI bug was caught by the new panel test along the way: the first version of
the toggle fix had `disabling` inverted (`!skill.enabled` instead of
`skill.enabled`), which the multi-workspace dispatch test exposed.

## Tests

178 vitest cases across 14 suites. Service: shadow flag (shadow visible with
the workspace in scope, absent from the global view), `installedMap` (global
plus every workspace independently, dedupe/empty-path filtering), and the same
skill installed into two workspaces with a per-workspace trash remove leaving
the other copy intact. Panel: workspace-selected toggle dispatches
`scope: 'workspace'`, no-workspace toggle stays `scope: 'global'`, shadow
badge, and the per-target marketplace flow (occupied target blocked, free
target installable, dispatch with the chosen workspacePath). RPC contract
covers `installedMap`. Package typecheck/test/build, repo-wide typecheck/test,
docs/runtime-deps checks, and the mount smoke all green; multi-workspace RPC
flow verified live on the isolated `dsh web`.

## Follow-up resolution

The open "Update all copies" step landed the same day (Search tab rename,
provider filter, `updateAllCopies`); see
`2026-08-29-skills-search-tab-and-update-all.md` in this directory. The
inverted-toggle bug described above was fixed within this change and is
guarded by the multi-workspace dispatch test; the full Playwright pass
re-verified the shadow and real-copy toggle flows live.
