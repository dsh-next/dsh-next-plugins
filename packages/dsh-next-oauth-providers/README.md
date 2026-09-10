# oauth-providers

English | [中文](README.zh.md)

This DeepSeek Harness plugin adds **Subscriptions** under Settings → Models.
Sign in with a Kimi, Grok, ChatGPT, or Claude coding subscription using the
same Add provider / Edit / Delete flow as API-key rows. Connected models
appear in the existing model selector.

## How to use it

1. Open **Settings** → **Models**.
2. Scroll to **Subscriptions**.
3. Click **Add provider**, pick Kimi Code, Grok, ChatGPT, or Claude, then
   **Sign in** and finish the browser or device-code flow. **Apply** saves
   the row.
4. **Edit** opens the same card later. **Fetch available models** opens the
   stock picker so you can select or deselect ids. **Restore defaults**
   clears a custom catalog.
5. **Delete** removes the sign-in and the catalog stored on this page.

## Features

### Sign in without an API key

The editor card keeps the stock layout. Where API-key rows have an API key
field, this card has **Sign in** / **Reconnect**. Tokens are stored in
`$DSH_HOME/.credentials.yaml` under `dsh-next-oauth-providers`, not in
`settings.yaml`.

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

- Needs DeepSeek Harness `0.1.3-alpha.2` or newer (official `dsh-llm-pi-ai`).
- Catalog rows persist under `dsh-next-oauth-providers.providers` as a block
  list keyed by official catalog ids (`xai`, `kimi-coding`, `openai-codex`,
  `anthropic`):

  ```yaml
  dsh-next-oauth-providers:
    providers:
      - id: xai
        displayName: Grok
        models:
          - id: grok-4.6
            name: Grok 4.6
            contextWindow: 500000
            maxTokens: 500000
  ```

  The model selector uses the same ids with an `-oauth` suffix (`xai-oauth`, …)
  so an API-key `anthropic` row can coexist with a Claude subscription. They
  cannot live under `llm-pi-ai:` — that section only accepts API-key
  `providers`.
- ChatGPT OAuth keeps the pi-ai model list but uses official API context /
  max-output sizes as defaults (1050K / 128K for current GPT-5.4+ ids; 400K /
  128K for `gpt-5.4-mini`). Customized settings still override a row.
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
- This package is currently private while live provider sign-in is verified.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
