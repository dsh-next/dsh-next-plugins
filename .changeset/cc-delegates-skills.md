---
"@dsh-next/dsh-next-skills": minor
---

Add an external-skill handoff service (`cc-external-skills`) so the cc-plugins bridge can delegate skill placement and per-workspace enablement to the skills manager. Skills install global-only with an ownership sidecar (`.dsh-next-skill-owner.json`) that marks them read-only in the Skills UI: `deleteSkill` and `setSkillScope` now reject externally-owned skills, and same-name collisions across owners are rejected while a plugin's own skills update in place.

Project/workspace skills are now completely outside the plugin: they are neither listed in the Skills panel nor re-published by its `ctx.skills` provider (the native filesystem provider serves them untouched), and `updateSkill`/`deleteSkill` reject copies inside project roots — they are managed by hand in the project. Per-name enablement config applies to globally installed skills only.

Update candidates are pinned to the recorded provider: same-name skills offered by other providers never show as updates (the Update button can no longer cycle between vendors), and externally-owned (cc-plugins) skills carry no provider-update affordance at all.

Every provider offering is now visible in the Skills grid: an installed skill shows an "N sources" chip, each other provider's same-name offering renders as its own card with a Replace action (one click rewrites the files and re-pins provenance to that provider), and the recorded source is marked "current source".

Installed skills sort first in the Skills grid, and same-name cards (the installed copy plus each provider offering) share one bordered group box; a provider filter narrows the group to the matching cards.
