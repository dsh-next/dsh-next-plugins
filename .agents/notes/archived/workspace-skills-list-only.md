# Workspace skills are list-only in the skills manager

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-skills

Workspace (project-root) skills — `<ws>/.dsh/skills` and `<ws>/.agents/skills` —
are hand-created and version-controlled in the project. The skills manager now
treats them strictly as discovered facts:

- `updateSkill` and `deleteSkill` reject copies inside project roots with a
  "managed by hand in the project" error (the RPC is guarded, not just the
  panel). Global-root copies keep full update/delete.
- The Skills panel still lists workspace copies (scope/source chips included)
  but renders their Update and Delete buttons disabled; hovering shows the
  `card.workspaceManaged` tooltip. Manage (enablement scope) stays available
  because enablement is pure config, never file management.

Implementation note: `isWithinProjectRoot` must exclude the global roots first —
the user agents root (`<agentsHome>/skills` under a `.agents` home) matches the
`.agents/skills` segment scan and would otherwise misclassify every global copy
as a workspace one.
