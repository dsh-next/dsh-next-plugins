# cc-plugins: root-source plugins and inline plugin.json MCP servers

- date: 2026-09-02
- status: implemented
- scope: packages/dsh-next-cc-plugins

Live-testing the bridge against ChromeDevTools/chrome-devtools-mcp (a
real Claude Code marketplace whose single plugin IS the repository)
surfaced two gaps, both fixed and re-verified against the live repo:

- Root-source plugins: `"source": "./"` normalizes to the empty path,
  and `pluginSubMap` built a `/` prefix that matched nothing, so the
  plugin showed as "not installable: path "" is missing". `pluginSubMap`
  now maps an empty (or `.`) directory to the whole snapshot.
- Inline MCP servers: Claude Code also accepts `mcpServers` as an
  object inside `.claude-plugin/plugin.json` (the only form
  chrome-devtools-mcp ships — there is no `.mcp.json`). The inventory
  now falls back to that inline declaration when the `.mcp.json` file
  (or the manifest's `mcpServers` path override) is absent; a real file
  still wins when both exist.

Live verification, end to end against the real repository: add
`ChromeDevTools/chrome-devtools-mcp` -> install -> 6 skills in the
isolated skills root plus a managed dsh-mcp-client row
(`stdio: npx chrome-devtools-mcp@1.8.0`) -> restart -> the actual
chrome-devtools-mcp server process spawned and completed MCP capability
negotiation with the DSH client (its own log line about the roots
capability proves a live MCP session). The new plugin-level reference
notes also fired on real data (`.gemini/`, `docs/`).

## Verification

179 tests across 12 suites (was 174): root-source normalization,
pluginSubMap root handling via the service-level install test, inline
manifest MCP servers (inventoried, file-wins, malformed-quiet), plus
the live loop above and the full repo gates.
