# cc-plugins: two-tab panel with multi-target install modal

- date: 2026-09-02
- status: implemented
- scope: packages/dsh-next-cc-plugins

Panel redesign modeled on the dsh-next-skills package's proven patterns
(its Add modal, presence badges, provider filter, Providers tab), per the
user's design:

- Two tabs replace Marketplaces/Installed. **Plugins** lists every plugin
  across all marketplaces in a two-column card grid
  (`repeat(auto-fill, minmax(300px, 1fr))`, collapses when narrow) with a
  search box, a marketplace filter, and an installed-only toggle. Cards
  carry name/version, description, inventory summary, a marketplace chip,
  a presence badge ("in global + Project One"), and one button: Add (not
  installed anywhere) or Manage (installed somewhere).
- **Marketplaces** is pure source management (add/refresh/remove), like
  the skills Providers tab.
- The Add/Manage modal is the skills pattern: Global plus every workspace
  as checkbox rows; targets already holding the plugin are locked with an
  "added" badge and their own two-step Uninstall; the footer reads
  Add / Add to N targets and, when installed anywhere, offers Update
  everywhere. The modal states the scoping truth: skills install per
  target; MCP servers, agents, commands, and hooks activate globally
  once. (For skills, DSH's runtime already resolves duplicate names with
  the workspace copy shadowing the global one — "workspace takes
  precedence" is a runtime fact, not a plugin decision.)

Registry model: `InstalledPlugin` gains `targets:
InstalledTarget[]{scope, workspacePath?, skills[]}` replacing the single
scope/skills triple. `core/targets.ts` holds the pure logic — target
identity, RPC arg validation (`parseTargets`), and migration
(`normalizeInstalledRecord/File`, wired into `Store.readInstalled` so
legacy records wrap into one target on read). Install accepts multiple
targets (or merges fresh targets into an existing record, with the
plugin's own rows excluded from name dedupe so merges never rename);
uninstall takes an optional target (per-target trash, rows drop only
with the last target); update refreshes skills in every target. The RPC
keeps the legacy single-scope install shape as a one-target fallback.

## Verification

194 tests across 13 suites (was 179): new tests/targets.spec.ts
(identity, parse validation, migration), multi-target install/merge/
per-target uninstall/update-everywhere service tests, legacy migration
through a real installed.json, and the rewritten panel spec (filters,
modal multi-select with locked targets, per-target uninstall, update
everywhere). The e2e marker asserts the new tabs and controls.
