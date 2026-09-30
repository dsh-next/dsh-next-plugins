# @dsh-next/dsh-next-skills

## 0.4.0

### Minor Changes

- **Breaking:** Skills requires DeepSeek Harness 0.1.7-alpha.1 or newer and stores provider and installation records in the plugin's profile configuration rather than the legacy settings section. Harness imports existing records into the active profile; installed skill files are preserved.
- Open an installed skill’s folder from its detail dialog using DSH’s detected applications and native launch support. The control is hidden when no supported applications are available or the skill is not installed.
- **Breaking:** Removed the `cc-external-skills` service and its exported integration interface. Plugins that used this service must stop calling it. Existing skill files and ownership safeguards are preserved; ordinary skill browsing, installation, and updates remain available.
- **Breaking:** Skills management is global-only. Legacy workspace restrictions, disabled entries, scope settings, and skill-scope methods no longer apply. Installs ignore scope fields; native skill discovery and each skill's invocation settings control availability. Existing files, providers, and installation records are preserved.

### Patch Changes

- Show readable English and Chinese plugin names, concise descriptions, and distinct icons in the Harness plugin manager.
- Fixed rendering of OAuth provider controls and the Skills folder menu on the current Harness interface.
- The Skills panel now reports a failed host request with a readable message, such
  as `Skills request "getState" failed (HTTP 405)`, instead of showing the
  browser's raw JSON parser error when the response carried no JSON body. A
  response whose body parses but is not a skills payload is reported the same way
  rather than leaving the page blank.

## 0.3.0

### Minor Changes

- Skills scoped to a workspace now also apply in that repo's worktree sessions. Worktree folders no longer appear in the scope checklist.

### Patch Changes

- Removed `openclaw/openclaw` and `affaan-m/ecc` from the providers seeded for new installations.

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
