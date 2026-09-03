# cc-plugins delegates skill management to dsh-next-skills

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins, packages/dsh-next-skills

Claude Code plugin skills no longer install per-workspace by copying files into
`<workspace>/.agents/skills`. Skills now install global-only, matching the
skills manager model, and plugin-level relative references are still rewritten
by the cc plugin before handoff.

What changed:

- `dsh-next-skills` exposes a Cordis service `cc-external-skills`
  (`installExternalSkills`, `setExternalSkillScope`, `removeExternalSkills`)
  and writes an ownership sidecar `.dsh-next-skill-owner.json` beside each
  external skill.
- External skills are read-only in the Skills UI: `deleteSkill` and
  `setSkillScope` reject them; same-name collisions across owners are rejected
  while a plugin's own skills update in place (stale files pruned).
- `dsh-next-cc-plugins` resolves the service via `ctx.get` (graceful: a
  persisted note replaces skills when the skills plugin is absent) and declares
  `@dsh-next/dsh-next-skills` as a peer dependency.
- Install scope now means per-workspace enablement (config `scopes`), not file
  placement; uninstall and update drive the handoff for add/scope/remove.

Migration is intentionally not implemented: the plugin is unpublished, so
records still using the legacy `scope.kind === 'workspaces'` per-workspace
skill copies are left alone on disk, unmanaged.
