---
"@dsh-next/dsh-next-skills": minor
---

Add an external-skill handoff service (`cc-external-skills`) so the cc-plugins bridge can delegate skill placement and per-workspace enablement to the skills manager. Skills install global-only with an ownership sidecar (`.dsh-next-skill-owner.json`) that marks them read-only in the Skills UI: `deleteSkill` and `setSkillScope` now reject externally-owned skills, and same-name collisions across owners are rejected while a plugin's own skills update in place.

Project/workspace skills are now completely outside the plugin: they are neither listed in the Skills panel nor re-published by its `ctx.skills` provider (the native filesystem provider serves them untouched), and `updateSkill`/`deleteSkill` reject copies inside project roots — they are managed by hand in the project. Per-name enablement config applies to globally installed skills only.

Update candidates are pinned to the recorded provider: same-name skills offered by other providers never show as updates (the Update button can no longer cycle between vendors), and externally-owned (cc-plugins) skills carry no provider-update affordance at all.

Installed skills sort first in the Skills grid, ahead of catalog names to add, and a provider filter narrows the grid to one provider's skills.
