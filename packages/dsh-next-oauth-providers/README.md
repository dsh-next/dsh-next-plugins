# oauth-providers

English | [中文](README.zh.md)

This DeepSeek Harness plugin adds coding-subscription sign-in to Settings →
Models. Sign in with a Kimi, Grok, ChatGPT, or Claude subscription, then manage
each one from its own row on the stock Models page. Connected models appear in
the existing model selector.

## How to use it

1. Open **Settings** → **Models**.
2. Below the provider rows, click **Add OAuth model provider**.
3. Pick Kimi Code, Grok, ChatGPT, or Claude, then **Sign in** and finish the
   browser or device-code flow. **Apply** saves the subscription.
4. The subscription now has its own row above, next to every other provider.
   The row's name opens the plugin's card: **Fetch available models** opens the
   stock picker so you can select or deselect ids, **Restore defaults** clears a
   custom catalog, and **Cancel** or **Apply** closes the card again.
5. **Delete** on that row removes the sign-in and the stored catalog.

## Features

### Sign in without an API key

The editor card keeps the stock layout. Where API-key rows have an API key
field, this card has **Sign in** / **Reconnect**. Tokens are stored in
`$DSH_HOME/.credentials.yaml` under `dsh-next-oauth-providers`, never in the
plugin's configuration.

### Model catalog

An omitted or empty models list uses the adapter defaults. A non-empty list
replaces the catalog. **Fetch available models** requires sign-in and does not
write until you add selected models and **Apply**. Kimi, ChatGPT, and Claude
use the bundled catalogs. Grok first asks its coding endpoint, falling back
to the bundled catalog on failure or after a 30-second request timeout.

### Grok coding endpoint

Grok traffic uses the Grok coding proxy, not the ordinary xAI API endpoint.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-oauth-providers
```

`<name>` is your DSH profile (for example `web`).

## Good to know

- Needs DeepSeek Harness `0.1.7-alpha.1` or newer (official `dsh-llm-pi-ai`).
- A signed-in subscription is also a row on the stock **Models** page: every
  configured family is declared to the provider directory, so it gets the same
  row, status dot, Edit, and Delete as any other provider.
- Catalog rows are this plugin's own configuration, keyed by official catalog
  ids (`xai`, `kimi-coding`, `openai-codex`, `anthropic`). DSH stores plugin
  configuration in the active profile, so the row lives in that profile's
  `cordis.patch.yml`:

  ```yaml
  - id: dsh-next-oauth-providers
    name: "@dsh-next/dsh-next-oauth-providers"
    config:
      providers:
        xai:
          displayName: Grok
          models:
            - id: grok-4.6
              name: Grok 4.6
              contextWindow: 500000
              maxTokens: 500000
  ```

  A pre-0.1.7 `settings.yaml` section is imported into the profile once, so an
  existing setup keeps its rows. Deleting the row there (or on the Models page)
  signs the family out.
- The model selector uses the same ids with an `-oauth` suffix (`xai-oauth`, …)
  so an API-key `anthropic` row can coexist with a Claude subscription. They
  cannot live under `llm-pi-ai:` — that section only accepts API-key
  `providers`.
- ChatGPT OAuth keeps the pi-ai model list but uses official API context /
  max-output sizes as defaults (1050K / 128K for the current GPT-5.5+ ids;
  128K / 128K for `gpt-5.3-codex-spark`). Customized settings still override a
  row.
- One account per family in this version. Reconnect replaces that grant.
- One unusable subscription does not take the others down. If a provider
  catalog cannot be prepared, only that provider's models fail to load — the
  model selector names it and offers **Retry** — while the remaining routes,
  and chat on them, keep working. The host logs one warning per provider.
- Closing an editor, switching provider editors, or leaving the Models page
  cancels its unfinished sign-in. Cancelling a login queued for credential
  storage preserves the previously saved grant.
- Subscription access is controlled by the provider. Signing in here does not
  grant a plan you do not already have.
- Claude and ChatGPT callback servers bind loopback ports `53692` and `1455`.
  ChatGPT sign-in fails if something else (often VS Code Codex) already owns
  `1455`.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
