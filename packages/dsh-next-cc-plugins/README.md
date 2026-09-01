# cc-plugins

DeepSeek Harness plugin: add [Claude Code](https://code.claude.com/docs/en/plugins)
plugin marketplaces and run their plugins inside DSH — the same app-store
flow Claude Code (`/plugin marketplace add`) and Grok Build
(`grok plugin marketplace add`) offer, bridged onto DSH's native surfaces
with a built-in runtime for the components DSH activates in-process.

## What it does

- **Add marketplaces** — the official Anthropic marketplace
  (`anthropics/claude-plugins-official`, ~290 plugins) is **seeded on a
  fresh install**, so the Plugins tab lists plugins immediately; removals
  are final (the seed applies only before the registry file first exists).
  Add any other source yourself: GitHub repositories (owner/repo shorthand,
  GitHub HTTPS/SSH URLs) or local directories holding a
  `.claude-plugin/marketplace.json` index (`.grok-plugin/marketplace.json`
  is honored as a Grok Build interop fallback). Browse each marketplace's
  plugins with their component inventories, refresh, and remove. Snapshots
  older than 24 hours re-sync automatically whenever the panel opens
  (best-effort: a failed refresh keeps the cached catalog), each source shows
  its last-synced age, and Refresh all forces a re-sync now.
- **Browse and install plugins** — the Plugins tab lists every plugin across
  all marketplaces in a two-column card grid (installed plugins first, each
  group alphabetical by name) with search, a marketplace
  filter, and an installed-only toggle. Installed cards show their installed
  version and, whenever the marketplace carries a newer one, an Update
  button (update also re-syncs that marketplace first, so it always pulls
  the true latest). Each card's Add (or Manage) button
  opens a target picker: any combination of the global skills root and your
  workspaces, in one install. Targets already holding the plugin are locked
  with their own uninstall; Update refreshes every target. Skills land per
  selected target; MCP servers, agent rows, commands, and hooks are
  plugin-level and activate once regardless of target count (the modal says
  so). Clicking a plugin's name opens a **detail modal**: metadata, the
  full component listing (including the families this bridge does not
  install), declared dependencies, and the install notes persisted on the
  record. Pre-targets registry records migrate to the new shape on read.
- **Install plugins** — each plugin's components land on the DSH surface
  that natively consumes it:

  | Claude Code component | DSH destination | Activation |
  | --- | --- | --- |
  | `skills/*/SKILL.md` | DSH skills roots (`~/.agents/skills` globally, `<workspace>/.agents/skills` per workspace) | Immediate, through the filesystem provider's watcher |
  | `commands/*.md` | DSH command registry (`ctx.commands`) via the built-in runtime bridge | Immediate; re-registers after every install/update/uninstall. A command expands `$ARGUMENTS` into the plugin's template and submits it as a model-visible user turn |
  | `.mcp.json` servers | Managed `dsh-mcp-client` rows in `$DSH_HOME/cordis.patch.yml` | After a DSH restart or profile reload |
  | `agents/*.md` | Managed `dsh-tool-subagent` rows (one `cc-agent-<name>` delegation tool per agent, the agent markdown as the child persona; the `tools:` frontmatter becomes `toolFilter.allow` over translated DSH tool names — Claude built-ins through a well-known map, `mcp__` refs resolved through the plugin's installed MCP rows so server-name dedupe survives, and foreign `mcp__server__tool` refs passed through since DSH's MCP client uses Claude's exact naming; a mapped `model:` becomes `agentOptions.model`) | After a profile reload |
  | `hooks/hooks.json` | The runtime bridge runs each matching hook with Claude-compatible JSON stdin, `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` env, and per-hook timeouts. `PreToolUse`/`PostToolUse` ride `tools/pre-execute`/`tools/post-execute` (exit code 2 or a JSON deny blocks the call); `UserPromptSubmit` rides `agent/pre-step` (a block rejects the step, stdout becomes injected context); `SessionStart` rides `agent/session-start` (observe, stdout injected, matcher selects `startup`/`resume`/`clear`/`compact`); `Stop` rides `agent/turn-stopping` (a block steers the agent to continue, loop-guarded per turn); `SubagentStop` rides `subagent/end` (observe only) | While `runtime.hooks` is enabled |

- **Manage installs** — update an installed plugin from upstream (skills
  re-copied, removed skills recoverably trashed, managed rows re-rendered
  with stable server/tool names) and uninstall it (skills move to the
  root's `.trash`, managed rows and the materialized plugin copy drop out).
  The materialized plugin copy rewrites **preserving `node_modules`** (as
  Claude Code does across plugin versions), so a plugin whose MCP server or
  hooks installed dependencies keeps them working after an Update; a
  changed `package.json` is noted so the plugin's own dependency bootstrap
  can refresh them, and an uninstall wipes everything. Install and update
  notes (unbridged families, renamed servers, unresolved templates,
  dependency requirements, skill frontmatter differences) are persisted on
  the install record: the card carries an "install notes" chip with the
  list on hover, and the detail modal shows them in full.

Plugin sources inside a marketplace index follow the Claude Code schema:
relative paths (`"./plugins/foo"`, bare names under `metadata.pluginRoot`),
`{"source": "github", "repo": "owner/repo"}`, GitHub `url` sources, and
`git-subdir` sources (a subdirectory of a GitHub monorepo — the form the
official marketplace uses for most of its plugins). External sources
carrying a `sha` or `ref` pin install exactly that commit. npm, archive,
and `command` sources are listed as not installable.

Component and version fidelity follows Claude Code's current reference:

- **Manifest overrides** may be a directory path, a single file path, or an
  array mixing both, for every component (`skills`, `commands`, `agents`,
  `hooks`, `mcpServers`); multiple hooks or MCP files merge (first name
  wins, duplicates noted).
- **`argument-hint`** command frontmatter passes through as the DSH
  composer's input hint.
- **MCP template expansion** — `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
  and `${ENV_VAR}` references in server definitions are expanded at install
  time against the plugin's materialized root and the host environment
  (DSH's MCP client does no substitution). `${CLAUDE_PROJECT_DIR}` stays as
  written with a note (it has no single value across install targets), as do
  references to unset variables. stdio rows also carry the plugin root as
  their `cwd` — Claude Code runs plugin MCP servers from the plugin root,
  which relative command paths (`./cli/server.js`) rely on.
- **Version precedence** — the catalog side is the marketplace entry's
  `version`, then the plugin's own `plugin.json` version (resolvable for
  relative sources), then no version at all; version-less plugins get their
  Update signal from the marketplace snapshot digest (Claude resolves them
  to the source's commit SHA; the digest is this bridge's same-machine
  equivalent, and it also catches entry-only edits).
- **Recognized-but-unbridged families** — LSP servers (`.lsp.json` or
  manifest `lspServers`), background monitors, output styles, themes,
  workflows, `bin/` executables, and plugin `settings.json` are counted and
  reported ("not bridged") on the card and in the detail modal, and noted at
  install; nothing from them is executed or installed.
- **Plugin dependencies** (`dependencies` in `plugin.json`) are surfaced as
  `requires:` on the card and as an install note. This bridge never
  auto-installs them — Claude Code does — installs stay explicit here.
- **Skill frontmatter** — DSH's own skill runtime honors
  `disable-model-invocation` and `user-invocable` (same kebab-case names),
  so those pass through working. `allowed-tools`, `disallowed-tools`,
  `model`, `effort`, `context`, `agent`, `background`, and skill-level
  `hooks` have no DSH counterpart and install with a note naming them.
- **Non-command hook types** (`http`, `mcp_tool`, `prompt`, `agent`) are
  reported as unsupported by type, not as parse errors.

## Configuration

Declared with schemastery; the profile composition passes it as the row's
`config` (defaults shown):

```yaml
- id: dsh-next-cc-plugins
  name: '@dsh-next/dsh-next-cc-plugins'
  config:
    runtime:
      commands: true   # register slash commands from installed plugins
      agents: true     # emit agent delegation-tool rows on install
      hooks: false     # run hook commands (executes third-party shell)
      agentModelMap:   # Claude model id -> DSH model id for agents' model:
        sonnet: glm-4.7
```

`hooks` defaults to false deliberately: hooks execute arbitrary shell from
installed plugins, and the lifecycle events (`UserPromptSubmit`,
`SessionStart`) see every prompt you submit. Review what a plugin's
`hooks/hooks.json` runs before enabling it.

Agent frontmatter translation notes:

- `tools:` entries map through a built-in Claude-to-DSH name table
  (`Bash` -> `bash`, `WebSearch` -> `web_search`, `Task` -> `subagent`, ...).
  Permission patterns (`Bash(git log:*)`) allow the base tool only — the
  argument pattern is not enforced. `mcp__` refs resolve through the
  plugin's installed MCP rows (plugin-owned servers, so name dedupe
  survives) or pass through for user-configured servers; only names with
  genuinely no DSH counterpart (for example `NotebookEdit`) drop with an
  install note.
- `model:` values resolve through the effective model map:
  `runtime.agentModelMap` is the baseline, and the **Models tab** layers
  saved overrides on top (`$DSH_HOME/cc-plugins/model-map.json`). The tab
  discovers models live from the runtime's `llm` service — nothing is
  hardcoded — offers a picker for every Claude family, mapped alias, and
  model name your installed agents actually reference, and defaults every
  alias to inheriting the delegating session's model; choosing inherit
  explicitly (a saved `null`) suppresses a config-baseline value for that
  alias. Saving re-resolves installed agent rows without reinstalling
  (reload the profile to apply). `model: inherit` and unmapped values leave
  the child on the delegating parent's model — DSH's default — with an
  install note for unmapped names. Claude model ids are never passed
  through raw: an unknown id would fail every delegation at child creation.
- Claude's per-agent `description` / `when_to_use` (parent-side tool
  selection guidance) has no `dsh-tool-subagent` counterpart today; the
  parent picks the tool by its `cc-agent-<name>` name.
- `PreCompact`, `Notification`, and `SessionEnd` hook events have no
  faithful DSH event and remain reported as unsupported (post-compact is
  visible as a `SessionStart` with source `compact`).

## Marketplace fidelity notes

- The marketplace description is read from the top level or from
  `metadata.description` (the nested form some marketplaces, e.g.
  `holistics/skills`, use).
- Root-source plugins (`"source": "./"` — the marketplace repository IS
  the plugin, e.g. `ChromeDevTools/chrome-devtools-mcp`) install the
  whole snapshot as the plugin.
- MCP servers may be declared in a `.mcp.json` file or inline in
  `.claude-plugin/plugin.json` under `mcpServers` (the ChromeDevTools
  form); the file wins when both are present.
- Skills that reference **plugin-level directories** (`references/`,
  `assets/`, ... — files that sit beside `skills/`, not inside a skill)
  install with a note: Claude Code runs skills from the plugin root so
  those links resolve there, but DSH installs each skill standalone in the
  skills root and the referenced paths do not resolve. The full plugin
  copy stays materialized under `$DSH_HOME/cc-plugins/plugins/` for hook
  commands; skill bodies needing those files must be read from there.
- A skill may assume an MCP server the plugin itself does not ship (no
  `.mcp.json`, only prose like "set up the Holistics MCP"). Nothing
  auto-configures in that case — add the server yourself (this plugin's
  managed MCP rows or the profile composition).
- Plugins present in a marketplace repository but absent from its index
  (for example a shared `plugins/<name>-common` library) are correctly
  never offered.

## Security notes

- Skills and composition rows land in user-owned files; nothing executable
  runs unless you install a plugin whose MCP servers or hooks define
  commands — those are third-party code, same as in Claude Code or Grok.
- The managed block inside `cordis.patch.yml` is delimited by
  `# BEGIN/END dsh-next-cc-plugins` markers; all other content in that file
  is preserved untouched (the file is never parsed as YAML because the
  loader dialect includes `!!js`).
- Skill name collisions abort an install atomically; MCP server names and
  agent tool names are deduped across plugins and stay stable across updates.

## Shareable settings mirror

Marketplaces, installed plugins, and the model mappings are mirrored into
the DSH user-settings document (`$DSH_HOME/settings.yaml`, the same file
the Models page stores model providers in) under one `cc-plugins` section:

```yaml
cc-plugins:
  marketplaces:
    - holistics/skills
  installs:
    - marketplace: holistics/skills
      plugin: holistics-reporting
      targets:
        - workspace:web
  models:
    haiku: deepseek-v4-flash
    sonnet: inherit
```

Workspace targets carry only the folder name — absolute paths differ on
every machine. On import, each name is resolved against that machine's
workspace registry (registered workspaces whose folder matches; ambiguous
or unknown names skip with a log note), and absolute paths
(`workspace:/abs/path`) still work when hand-written and present locally.
A machine that cannot satisfy part of the file keeps everything else —
marketplaces and `global` targets still import — and the Plugins tab shows
which imports skipped and why (`cc-import-skipped`), so the missing pieces
are installed deliberately through the Add modal rather than guessed.

Every panel mutation writes the section through (installs record presence
only — versions follow upstream). At boot, and whenever the document
changes on disk (the settings provider hot-publishes external edits), the
plugin adopts what the document carries that the machine lacks: missing
marketplaces are added, missing plugins installed into their recorded
targets (workspace targets only when the path exists locally), and model
mappings adopted when none are saved locally. Removals are never inferred —
uninstalls stay explicit through the panel. Sharing one `settings.yaml`
therefore reproduces the whole setup on a fresh machine, best effort and
logged.

## Settings UI

The browser half registers a top-level Settings section ("Claude Plugins")
with three tabs: **Plugins** (every marketplace's plugins in a card grid with
search, marketplace filter, and installed-only toggle; installed version and
Update button per card; an install-notes chip when the record carries notes;
the plugin name opens a detail modal with metadata, the full component
listing, dependencies, and notes; Add/Manage opens the multi-target picker
modal), **Marketplaces** (add/refresh/remove sources with per-source
last-synced age; snapshots older than 24 hours re-sync when the panel
opens), and **Models** (map Claude model names onto the models this runtime
offers, live-discovered — unmapped names inherit the session's model).

The panel follows the DSH locale setting (English / Simplified Chinese)
through the platform `locale` service — dictionaries live in the client
bundle under the `cc-plugins` namespace, and the section label re-resolves
on language switches. Host-generated messages (install notes, errors) stay
English: they are persisted on install records and quoted in diagnostics.

## Install

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-cc-plugins
```

## Development

```sh
pnpm build
pnpm typecheck
pnpm test
```

See the repository root for the full contribution and pre-push gates.
