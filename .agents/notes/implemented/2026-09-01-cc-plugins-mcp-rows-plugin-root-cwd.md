# cc-plugins: stdio MCP rows run with the plugin root as cwd

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins

Live-testing an update through the preview panel (Update everywhere on
`episodic-memory` from obra/superpowers-marketplace) exposed the root cause
of a long-standing failure: the plugin's MCP definition is
`command: node, args: ["./cli/mcp-server-wrapper.js"]` — a relative path.
Claude Code runs plugin MCP servers with the plugin's install root as the
working directory, so the path resolves there; this bridge rendered the row
verbatim and dsh-mcp-client spawned the process with the DSH process's own
cwd, so node looked for `./cli/mcp-server-wrapper.js` under the wrong tree
and the server died at every boot.

Fix: managed stdio MCP rows now carry `cwd: <materialized plugin root>`
(rendered in `writeManagedRows` from the plugin key, so rows installed
before the change pick it up on their next rewrite; remote rows never
carry it). dsh-mcp-client already supports the `cwd` config key.

End-to-end proof on the real preview: update rewritten row -> wrapper
resolves inside the plugin root -> the plugin's own first-run bootstrap
(`npm install` of its dependencies, which Claude also performs for copied
plugins) -> episodic-memory MCP server attached cleanly ("Episodic Memory
MCP server running via stdio", no spawn errors), enabling the
`mcp__episodic-memory__*` tools the installed agent row filters on.

Known follow-up (not implemented): the plugin's dependency install lands
in the materialized plugin root, which every update wipes and rewrites
from the file map — Claude Code instead persists installed node_modules
across plugin versions. Until the bridge keeps node_modules across
updates (or runs the install itself), a plugin update may need its
dependency bootstrap rerun. On this machine `npm install --ignore-scripts`
sufficed (sharp ships prebuilt darwin-arm64 binaries needing no scripts).
