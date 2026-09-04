# @dsh-next/dsh-next-skills

## 0.2.0

### Minor Changes

- Add an external-skill handoff service (`cc-external-skills`) so the cc-plugins bridge can delegate skill placement and per-workspace enablement to the skills manager. Skills install global-only with an ownership sidecar (`.dsh-next-skill-owner.json`) that marks them read-only in the Skills UI: `deleteSkill` and `setSkillScope` now reject externally-owned skills, and same-name collisions across owners are rejected while a plugin's own skills update in place.
  
  Project/workspace skills are now completely outside the plugin: they are neither listed in the Skills panel nor re-published by its `ctx.skills` provider (the native filesystem provider serves them untouched), and `updateSkill`/`deleteSkill` reject copies inside project roots — they are managed by hand in the project. Per-name enablement config applies to globally installed skills only.
  
  Update candidates are pinned to the recorded provider: same-name skills offered by other providers never show as updates (the Update button can no longer cycle between vendors), and externally-owned (cc-plugins) skills carry no provider-update affordance at all.
  
  Installed skills sort first in the Skills grid, ahead of catalog names to add, and a provider filter narrows the grid to one provider's skills.
- The Skills settings page now renders the harness page scaffold: a title and
  description above the tab strip, the shell's underline tab strip with full
  keyboard support (Arrow/Home/End, roving focus), theme-token button and input
  styling that tracks light and dark mode, and localized status and
  refresh-failure messages. Card actions are relabeled for clarity — Add is now
  Use, Manage is now Scopes — sit right-aligned at natural width, and Delete
  carries a constant dark-red label. Removing a provider now confirms through a
  modal that states installed skills are kept, and the workspace checklist
  indents under its radio.
- Collapse provider offerings into a per-copy source switcher. An installed
  skill now renders a single card with a "Providers" button (counting how many
  providers offer the name) instead of one card per provider offering. The
  switcher lists Local plus every provider with its content parity
  ("matches your copy" / "differs from your copy"), marks the current source,
  and requires an explicit overwrite confirm before switching: the copy's files
  are rewritten in place, files outside the provider copy are removed
  permanently (not moved to trash), and visibility scopes are kept. Choosing
  Local detaches the copy from its provider (files stay, updates stop) and
  applies directly. The Update button is now strictly provenance-pinned: it
  fires only for a copy's recorded provider, so hand-managed copies pick a
  source explicitly instead of an implicit first match.

### Patch Changes

- Rank Skills search results by relevance: exact name matches come first, then
  name prefixes, then names containing the query, and only afterwards skills
  whose description or provider merely mentions it. Previously every substring
  hit ranked equally in alphabetical order, so searching a skill's name could
  bury it behind unrelated description matches. Changing the search also
  returns to the first page instead of keeping a deep-scrolled page size.
