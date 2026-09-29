# OpenCode Go session header patch

See the [plugin README](<../packages/dsh-next-opencode-session-patch/README.md>)
for availability, requirements, and usage.

## Why the patch exists

OpenCode Go rejects requests missing `x-opencode-session` with HTTP 400
`MissingSessionID`. The supported pi-ai / Harness llm-pi-ai integration does not
expose a per-request header hook for this session information.

The plugin wraps `globalThis.fetch` in the **Harness host process** and adds the
header to matching OpenCode Go requests at `https://opencode.ai/zen/go`.
Requests to other endpoints pass through unchanged. The browser entry is empty;
there is no configuration UI.

## Which session ID is sent

The host agent registry's initiator scope identifies the agent turn making the
request. The header uses that turn's Harness session ID. Calls outside an agent
turn use the stable fallback ID `dsh`.

This patch does not configure a provider, grant account access, or fix unrelated
authentication, billing, or network errors.

## Lifetime

The wrapper is registered with the plugin's effect lifecycle. Disposing the
plugin restores the original `fetch`. It is a process-wide compatibility patch,
not a replacement chat adapter.

For development and tests, see [Contributing](<../CONTRIBUTING.md>).
