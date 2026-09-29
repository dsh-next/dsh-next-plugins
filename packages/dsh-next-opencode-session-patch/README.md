# OpenCode Go session fix

English | [中文](README.zh.md)

Fix the OpenCode Go `MissingSessionID` error by adding the session identifier its requests require.

## Install

**Private and unreleased.** Requires DeepSeek Harness `0.1.1-rc.1` or newer. Once published, install with:

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-opencode-session-patch
```

Replace `<name>` with your DSH profile, for example `web`. You still need to configure OpenCode Go in Harness; this plugin does not add an account or model.

## Quick start

1. Open Harness with the profile containing the plugin and select your configured OpenCode Go model.
2. Send a message. The plugin adds the required session header automatically; requests should no longer fail because the header is missing.

## What it does

- **Adds session information:** includes the current session ID in requests to `https://opencode.ai/zen/go`.
- **Leaves other providers alone:** requests to other endpoints are unchanged.
- **Works in the background:** there is no settings page or extra button.

## Good to know

- This addresses missing session IDs, not authentication, billing, or other provider errors.
- It patches network requests in the Harness host process, not the browser. Requests outside an agent turn use the fallback ID `dsh`.

[Technical details](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/opencode-session-patch.md>) · [Get help](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [Contributing](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
