# cc-plugins: mcp__ agent tool-ref translation and agent model mapping

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

Live install of obra/superpowers-marketplace's `episodic-memory` surfaced
two notes: its agent's `tools:` frontmatter references
`mcp__plugin_episodic-memory_episodic-memory__search`/`__read` (dropped as
"no DSH counterpart"), and `model: haiku` had no `agentModelMap` entry.

- **Root cause (tool refs):** DSH's `dsh-mcp-client` registers MCP tools
  under `mcp__<serverName>__<rawName>` — Claude's exact naming contract —
  but Claude Code prefixes plugin-owned servers with
  `plugin_<pluginName>_`, and our translation only knew the built-in map.
  `core/agents.ts` now resolves `mcp__` refs: refs naming one of the
  plugin's installed MCP rows map to that row's resolved serverName (so
  cross-plugin name dedupe survives), foreign plain `mcp__server__tool`
  refs pass through (identical naming for user-configured servers), and
  only unattributable `plugin_` refs still drop with a note. The new
  `dshMcpToolName` mirrors the client's `publicToolName` — verbatim name
  for clean names, else normalize + 12-hex sha256 suffix — with the digest
  injected by the host (`node:crypto`); lossy names without a digest drop
  with a note instead of guessing.
- **Root cause (model):** `model:` translation is config, not code — the
  deployment's model ids are unknown to the plugin. The user's
  `~/.dsh/cordis.patch.yml` now patches the plugin row with
  `runtime.agentModelMap` (haiku -> deepseek-v4-flash, sonnet/opus ->
  deepseek-v4-pro), verified through `dsh --profile dev-cc-plugins
  --dump-config` (patch rows merge by id, config deep-merges).
- **Adjacent fix:** `applyManagedBlockText` appending the first managed
  block to the `[]` placeholder would concatenate rows after the array's
  end (invalid YAML). The placeholder is now replaced, keeping the
  removal/append round trip canonical.
- Registry records keep their stable agent tool names; re-running an
  install/update rewrites `toolFilter` with the resolved names.

## Verification

227 tests across 14 suites: `translateTools mcp__ refs` (plugin-prefixed
resolution, deduped serverName, bare row refs, foreign passthrough,
unattributable drop, malformed refs, exotic names with and without a
digest), `dshMcpToolName` (verbatim, normalized+hash, 64-char truncation,
undefined without digest), a service test installing an
episodic-memory-shaped plugin proving `toolFilter` carries
`mcp__episodic-memory__search`/`__read` with no drop notes while the
unmapped-model note stays, and the `[]`-placeholder block-append
round-trip. Repo gates and the mount smoke green.
