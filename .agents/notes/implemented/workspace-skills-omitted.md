# Workspace skills are completely outside the skills manager

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-skills

Supersedes `workspace-skills-list-only.md` (the read-only listing lasted one
iteration): listing project skills at all produced incoherent affordances —
the presence badge ("Everywhere") is an enablement label, which read as
"global skill, globally enabled" on a project row, and Manage could write
enablement config for a hand-managed skill.

Project/workspace skills (`<ws>/.dsh/skills`, `<ws>/.agents/skills`) are now
entirely outside the plugin:

- `listInstalled`/`state` resolve the global roots only; the RPC no longer
  accepts `workspacePaths` (the panel still uses registered workspaces for
  the scope modal's enablement checklist).
- The `ctx.skills` provider re-publishes global-root candidates only; project
  skills keep their native filesystem-provider entries, untouched by the
  per-name enablement config.
- `updateSkill`/`deleteSkill` reject project-root directories at the RPC
  boundary (defense in depth; `isWithinProjectRoot` excludes the global roots
  first — the user agents root matches the `.agents/skills` segment scan).
- The panel defensively filters any workspace row out of a stale host
  envelope.

Trade-off accepted: a project skill can no longer be disabled via config —
if you do not want it, remove it from the project (it is hand-managed).
