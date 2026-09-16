# dsh-next-opencode-session-patch

English | [中文](README.zh.md)

Stamps the `x-opencode-session` header on every request the DSH host process sends to the OpenCode Go provider (`https://opencode.ai/zen/go`), using the current DSH session id.

## Why

OpenCode Go rejects requests without that header (HTTP 400 `MissingSessionID`), and neither pi-ai nor the DSH llm-pi-ai adapter exposes a per-request header seam. This plugin patches the host-process `globalThis.fetch` and adds the header where needed.

## How it works

- The patch is effect scoped: disposing the plugin restores the original `fetch`.
- Session attribution uses the DSH agent registry's initiator scope, so each request is stamped with the session id of the agent turn that issued it. Calls outside any agent turn share the stable fallback id `dsh`.
- Requests to every other endpoint pass through untouched.
- Host-only: the browser half does nothing.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-opencode-session-patch
```

`<name>` is your DSH profile (for example `web`).

## Good to know

- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
