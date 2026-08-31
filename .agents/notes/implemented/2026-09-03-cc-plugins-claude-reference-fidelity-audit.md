# cc-plugins: fidelity audit against the current Claude Code plugin reference

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins

A gap audit of this bridge against the current official Claude Code docs
(plugins-reference, hooks, skills, plugin-marketplaces) and the installed
DSH runtime surfaces produced ten changes in two tiers: five correctness
fixes for things we claimed to support but did not, and five fidelity
additions for things Claude Code gained that we silently ignored.

Correctness tier:

- `argument-hint` command frontmatter is now passed through as the DSH
  `CommandDefinition.input.hint` (it was parsed and discarded; the runtime
  also ignored manifest command overrides, both fixed together).
- MCP `${...}` templates expand at row-build time: `${CLAUDE_PLUGIN_ROOT}`
  and `${CLAUDE_PLUGIN_DATA}` against the materialized plugin paths,
  `${NAME}` against the host environment (dsh-mcp-client expands nothing,
  so a literal `${CLAUDE_PLUGIN_ROOT}/server.js` row was simply broken).
  `${CLAUDE_PROJECT_DIR}` and unset names stay as written with notes.
- Manifest component overrides accept Claude's full grammar: a directory,
  a single file, or an array mixing both, for every component; hooks and
  MCP documents merge with first-name-wins. This also fixed a latent bug
  where a flat skill whose frontmatter name differed from its file name
  installed an empty skill.
- Non-command hook types (http, mcp_tool, prompt, agent) report as
  unsupported by type instead of the misleading "no command hook" note.
- Version precedence follows Claude's: marketplace entry `version`, then
  the plugin's `plugin.json` version, then no version — and version-less
  plugins get their Update signal from a sha256 digest of the marketplace
  snapshot (Claude uses the resolved commit SHA; the digest is the closest
  same-machine signal, stored on both the snapshot and the install record).

Fidelity tier:

- LSP servers, monitors, output styles, themes, workflows, `bin/`
  executables, and plugin `settings.json` are counted as
  recognized-but-unbridged: "not bridged" on the card, full counts in the
  detail modal, notes at install. An LSP-only plugin previously showed
  "no components" and installed nothing.
- Plugin `dependencies` surface as "requires:" on the card plus an install
  note; never auto-installed (Claude auto-installs; installs here stay
  explicit by design).
- Skill frontmatter keys DSH does not act on (`allowed-tools`,
  `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`,
  skill-level `hooks`) install with a per-skill note.
  `disable-model-invocation` and `user-invocable` pass through working —
  DSH's skill filesystem provider reads those exact kebab-case keys.
- Install/update notes persist on the install record (`notes`), shown as
  an "install notes" chip on the card (hover for the list).
- A plugin detail modal (click the card name) shows metadata, the full
  component listing, dependencies, and the persisted notes. The e2e mount
  smoke now drives the whole flow offline through a committed local
  fixture marketplace (`tests/e2e/fixtures/tiny-marketplace`): add ->
  card -> detail -> remove, with dialog-scoped tab locators (the app's
  own Settings sidebar also has "Plugins"/"Models" pages).

Deliberately not done (backlog): npm/archive/git-subdir plugin sources,
`SessionEnd`->`session/disposed` and `SubagentStart`->`subagent/start`
hook mappings, marketplace `renames`, `GITHUB_TOKEN` for private repos,
Update All, auto-update. Claude's remaining ~30 hook events have no DSH
twin and stay reported as unsupported.

Evidence: 314 tests across 15 suites, typecheck/build/docs:check, and the
real-mount e2e green (now including the fixture detail-modal flow).
