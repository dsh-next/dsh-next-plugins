# Add dsh-next-cc-plugins: Claude Code plugin marketplace + runtime bridge

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins

Added `@dsh-next/dsh-next-cc-plugins`, one plugin that both adds Claude
Code plugin marketplaces (GitHub `owner/repo`, GitHub HTTPS/SSH URLs, or
local directories; `.grok-plugin/marketplace.json` accepted as a Grok Build
interop fallback) and runs the installed plugins' components inside DSH.
The design follows how grok-build made its plugin system wire-compatible
with the Claude Code format (same index file, same component layout). The
runtime was consolidated into this package instead of a separate
`dsh-next-cc-runtime` because it must read the install registry — the
plugin's own private state — so a second package would have needed an
awkward cross-plugin data dependency for no user-visible benefit.

Component mapping:

- `skills/*/SKILL.md` are copied verbatim into the DSH skills roots
  (`~/.agents/skills` globally, `<workspace>/.agents/skills` per workspace),
  the same roots `dsh-skill-filesystem` scans, so installs go live through
  its watcher. A `.dsh-next-cc-source.json` marker records the origin.
- `commands/*.md` register on `ctx.commands` through the built-in runtime
  (`src/host/runtime.ts`): a DSH-grammar name (plain when valid, else the
  qualified `cc-<plugin>-<command>` form), the frontmatter description, and
  a handler that expands `$ARGUMENTS` into the template and submits it as a
  model-visible user turn via `agent.followup(createUserMessage(...))` (the
  dsh-plan-mode producer pattern). Installs/uninstalls/updates notify the
  runtime (`onInstalledChanged`) so commands re-register without a reload.
- `.mcp.json` servers become managed `dsh-mcp-client` rows and `agents/*.md`
  become managed `dsh-tool-subagent` rows (one `cc-agent-<name>` delegation
  tool per agent; the agent markdown is the child persona, rendered as a
  YAML block scalar). Both live in one marker-delimited
  `# BEGIN/END dsh-next-cc-plugins` block inside `$DSH_HOME/cordis.patch.yml`;
  everything outside the markers is preserved byte-for-byte (the file is
  never parsed as YAML because the loader dialect includes `!!js`).
- `hooks/hooks.json` PreToolUse/PostToolUse entries run through the
  runtime's `tools/pre-execute` / `tools/post-execute` listeners while
  `runtime.hooks` is enabled (schemastery Config, default false — hooks
  execute third-party shell). The runner writes Claude-compatible JSON to
  stdin, sets `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` (the materialized
  plugin copy under `$DSH_HOME/cc-plugins/plugins/<key>`), enforces the
  hook's timeout, and maps exit code 2 or a JSON `permissionDecision:
  "deny"` to a `{ kind: 'deny' }` pre-execute decision. Other Claude hook
  events (Stop, UserPromptSubmit, ...) are reported unsupported.
- Config gating: `runtime.commands` (default true), `runtime.agents`
  (default true; rows apply on reload), `runtime.hooks` (default false).

Notable decisions:

- Install is atomic on skill-name collisions: already-copied skills roll
  back, no registry entry, managed rows, or plugin copy are written.
- Every install/update also freezes the plugin's full file map into the
  store cache and materializes it on disk: the runtime reads only that
  cache (activation never touches the network), and hook scripts get a real
  `$CLAUDE_PLUGIN_ROOT` directory, matching the Claude/grok contract.
- Uninstall moves skills into the root's `.trash` (recoverable, the same
  convention as dsh-next-skills), removes the managed rows and the plugin
  copy, and rebuilds the managed block from the remaining registry records
  alone (MCP defs and agent personas are persisted in the registry, so
  re-rendering never needs the network).
- MCP server names and agent tool names are sanitized to their registries'
  grammars, deduped across plugins, and kept stable across updates when the
  Claude-side key survives upstream.
- Marketplace snapshots cache under `$DSH_HOME/cc-plugins/cache/`; external
  GitHub plugin sources are fetched at install/update time via one codeload
  tarball request. npm, archive, and git-subdir plugin sources are surfaced
  in the UI as not installable rather than hidden.
- The browser half registers a Settings section ("Claude Plugins", order
  17, after Skills) with Marketplaces and Installed tabs and emits
  `connection/reset` after installs so the composer skill menu refetches.

Verification: 125 vitest tests across 11 suites (pure core: source specs,
index parsing, inventory, MCP/agent row rendering, hooks, command
translation; host service integration over an in-memory fs + codeload
double; the runtime bridge over a structural Cordis double including the
deny path; RPC contract envelopes; jsdom panel wiring), full repo
`pnpm typecheck && pnpm test && pnpm build`, and the real-mount e2e smoke
with a per-plugin DOM marker driving Settings -> Claude Plugins.
