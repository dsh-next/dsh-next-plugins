# cc-plugins: preserve installed node_modules across plugin updates

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins

Follow-up to the MCP-row cwd fix: `materializePlugin` wiped and rewrote the
materialized plugin root on every install/update, so a plugin whose MCP
server or hooks had installed dependencies (episodic-memory's
`npm install` bootstrap) lost them on the next Update and had to re-bootstrap
— up to 60 seconds, and failing for native modules like sharp that need
manual help. This repeats in production exactly as in the preview: the wipe
lives in the shipped service, not in the dev loop.

Fix: the rewrite now clears the plugin root **preserving `node_modules`**
(`readdir` + selective `rm` over the injected FsLike) and then writes the
new file map on top — an incoming file always wins over preserved content,
so plugins that vendor `node_modules/**` in their tarball still overwrite
installed state. Claude Code's model (dependencies live in the plugin copy
and survive version changes) is thereby matched for the single-root layout
this bridge uses; per-version cache directories stay out of scope until
version pinning exists. Uninstall remains a full wipe.

Drift detection: the previous `package.json` is read before the rewrite and
compared with the incoming one. Unchanged manifest + existing node_modules
-> preserved silently (the common case). Changed manifest -> preserved with
an install note ("dependencies were preserved ... but package.json
changed"), which rides the existing note pipeline: toast, persisted
`record.notes`, the card's install-notes chip, and the detail modal.

The bridge still never runs `npm install` itself — executing third-party
install scripts stays the plugin's own bootstrap's job; an opt-in
`runtime.npmDeps` is deferred to the npm-sources tranche where it belongs.

Evidence: 321 tests across 15 suites (five new memfs cases: preserve +
silent, preserve + drift note, incoming files win, uninstall wipes, fresh
install notes nothing), typecheck/build/docs:check green, and a live
re-proof — Update on `episodic-memory` in the preview keeps the server's
installed dependencies, so the MCP server boots straight to "running via
stdio" with no bootstrap pass.
