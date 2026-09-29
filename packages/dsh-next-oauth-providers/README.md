# OAuth providers

English | [中文](README.zh.md)

Use your Kimi Code, Grok, ChatGPT, or Claude coding subscription in DeepSeek
Harness without entering an API key.

## Install

- Requires DeepSeek Harness `0.1.7-alpha.1` or newer with its official model-provider integration enabled. Using a custom profile? [Check the prerequisite](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/oauth-providers.md#check-a-custom-profiles-model-support>).
- Use the local Web GUI and an account with access to the provider's coding plan.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-oauth-providers
```

Replace `<name>` with your DSH profile, for example `web`. Open Harness with
that profile.

## Quick start

1. Open `Settings` → `Models` in the local Web GUI.
2. Click `Add OAuth model provider` below the provider rows.
3. Choose your provider, click `Sign in`, and complete the browser or device-code flow.
4. Click `Apply`. Your subscription gets its own provider row, and its models
   appear in the existing model selector.

## What you can do

- Use subscription models alongside your API-key providers.
- Choose which models appear with `Fetch available models`, then `Add selected`
  and `Apply`.
- Adjust model limits and supported inputs under `Capacities`, or use
  `Restore defaults` to clear a custom model catalog.
- Manage each subscription from its row on the `Models` page.

![OAuth provider sign-in before connecting a Kimi Code account](<media/provider.webp>)

## Good to know

- Access, usage limits, and any charges depend on your provider's plan. Signing
  in does not give you a subscription you do not already have.
- One account per provider family is supported. `Reconnect` replaces its saved
  authorization; `Delete` removes its sign-in and stored model catalog.
- Tokens stay in the DSH credential store, not plugin settings. Protect your
  DSH home and do not share credentials. Closing the editor cancels unfinished
  sign-in, not a previously saved authorization.
- If one provider's models fail to load, use `Retry`; other subscriptions can
  keep working.

See [Model settings and sign-in recovery](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/oauth-providers.md>)
for custom catalogs, credentials, and callback-port conflicts.
For development, see the [contributor guide](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>).
