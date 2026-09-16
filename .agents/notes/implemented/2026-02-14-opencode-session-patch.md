# Add dsh-next-opencode-session-patch plugin

- date: 2026-02-14
- status: implemented
- scope: packages/dsh-next-opencode-session-patch

New host-only plugin. OpenCode Go (https://opencode.ai/zen/go) rejects
requests without an `x-opencode-session` header (HTTP 400 MissingSessionID)
and no SDK layer exposes a per-request header seam, so the plugin patches the
host-process `globalThis.fetch` and stamps the header with the current dsh
session id. Session attribution reads the agent registry's initiator scope
(`ctx.agents.currentInitiator()`); calls outside any initiator boundary share
the stable fallback id `dsh`. Requests to other endpoints pass through
untouched. The patch is effect scoped: disposal restores the original fetch.
The browser half is a deliberate no-op, so the package ships no locale
dictionaries. Ported from the reference implementation in
haoliangwu/dsh-me (src/plugins/x-opencode-session-shim).

The package is marked "private": true and will never publish to npm; it is
installed locally from packed tarballs (pnpm plugin:pack / plugin:install), so
it carries no changeset. Distribution is the local tarball workflow only.
