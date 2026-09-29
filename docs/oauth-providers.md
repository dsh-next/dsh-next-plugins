# OAuth provider settings and sign-in recovery

Use this guide to customize subscription model catalogs or recover a failed
sign-in. For installation and first use, see the
[OAuth providers README](<../packages/dsh-next-oauth-providers/README.md>).

## Check a custom profile's model support

This plugin relies on Harness's official `@deepseek-ai/dsh-llm-pi-ai` module,
which connects Harness to model providers. If you maintain a custom or minimal
profile, inspect its composed configuration:

```sh
dsh --profile <name> --dump-config
```

Replace `<name>` with the profile you will use. Check for an enabled
`@deepseek-ai/dsh-llm-pi-ai` entry. If it is missing or disabled, restore that
integration in the profile or use a profile that includes it before connecting
subscriptions. Reinstalling this OAuth plugin alone is not a substitute for the
host's model-provider integration. Treat the configuration output as private;
do not paste credentials into help requests.

## Manage a subscription

Each configured provider family gets a row on `Settings` → `Models`, with the
same status dot, `Edit`, and `Delete` controls as other providers. Click its
name to open the subscription editor. `Cancel` or `Apply` closes the card.

- `Sign in` connects an account; `Reconnect` replaces that family's saved grant.
  This version supports one account per family.
- `Delete` removes both the sign-in and the stored model catalog. Save any
  custom model settings you want to keep before deleting the row.
- Closing an editor, switching provider editors, or leaving `Models` cancels
  unfinished sign-in. Cancelling a login queued for credential storage
  preserves the previously saved grant.

## Choose or restore a model catalog

1. Sign in, then open the provider's editor.
2. Click `Fetch available models` to open the model picker.
3. Select the model IDs you want, click `Add selected`, then `Apply`.

Fetching alone does not save changes. An omitted or empty `models` list uses
the adapter defaults; a non-empty list replaces the catalog. `Restore defaults`
clears a custom catalog; click `Apply` to save that change.

- Kimi, ChatGPT, and Claude use bundled catalogs.
- Grok first asks its coding endpoint. It falls back to the bundled catalog
  if that request fails or exceeds 30 seconds.
- Grok traffic uses the Grok coding proxy, not the ordinary xAI API endpoint.
- ChatGPT OAuth keeps the pi-ai model list but uses official API context and
  maximum-output sizes as defaults: 1050K / 128K for current GPT-5.4+ IDs,
  and 400K / 128K for `gpt-5.4-mini`. Custom settings override individual rows.

## Set model capacities

Open `Capacities` on a model row to edit its limits and capabilities:

- `Context window` and `Max output tokens` accept positive counts, such as
  `131072`, `256K`, or `1M` in the editor. The configuration fields are numeric
  `contextWindow` and `maxTokens`.
- `Input types` controls whether the model accepts text, images, or both.
- `Reasoning mode` can inherit the provider default, declare a non-reasoning
  model, or let you choose supported thinking levels individually.

For configuration files, model rows support these fields:

| Field | Meaning |
| --- | --- |
| `id` | Provider model ID. Required and unique within the catalog. |
| `name` | Display name; uses the model ID when omitted. |
| `contextWindow` | Positive context-window token count; omit to use the default. |
| `maxTokens` | Positive maximum-output token count; omit to use the default. |
| `input` | A list containing `text`, `image`, or both. |
| `reasoningEfforts` | `false` for a non-reasoning model, or a map from thinking levels to provider values. |

Omitting `input` preserves a bundled model's own input types. An ID not in the
bundled catalog defaults to text-only.

Omitting `reasoningEfforts` preserves a bundled model's reasoning capability.
An ID not in the catalog defaults to non-reasoning. In a custom map:

- Supported keys are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Values are the strings the provider expects for each level.
- Use `off: null` when turning thinking off means sending no value.
- Unlisted levels are unsupported. A map with only `low`, `medium`, and `high`
  offers exactly those levels in the composer.
- Declare at least one level above `off`, or use `false`. Non-off levels need
  a non-empty provider value.

## Configure a profile

Catalog settings belong to this plugin's `providers` configuration in the
active profile's `cordis.patch.yml`. Keys use the official catalog IDs:

| Subscription | Configuration key | Model-selector provider ID |
| --- | --- | --- |
| Kimi Code | `kimi-coding` | `kimi-coding-oauth` |
| Grok | `xai` | `xai-oauth` |
| ChatGPT | `openai-codex` | `openai-codex-oauth` |
| Claude | `anthropic` | `anthropic-oauth` |

The model selector adds `-oauth` so a subscription can coexist with an API-key
provider, such as an `anthropic` API-key row alongside Claude. Do not put
subscription rows under `llm-pi-ai:`; that section only accepts API-key
`providers`.

Example plugin entry:

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
            input: [text, image]
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
```

A pre-0.1.7 `settings.yaml` section is imported into the profile once, preserving
existing rows. Deleting a provider row from the plugin configuration or the
`Models` page signs that family out.

## Protect credentials and account access

Tokens are stored in `$DSH_HOME/.credentials.yaml` under
`dsh-next-oauth-providers`, never in plugin configuration. Keep the credential
file private; do not paste its contents into bug reports or commit it.
Subscription authentication uses saved OAuth grants, not an ambient API-key
fallback.

Provider subscriptions control access, usage limits, and any charges. Signing
in here does not grant a plan you do not already have. Signing in is restricted
to the local Web GUI; use its `localhost` or `127.0.0.1` address rather than a
remote hostname.

## Recover sign-in or model loading

### A callback port is already in use

The browser sign-in callback servers bind loopback ports:

- Claude: `53692`.
- ChatGPT: `1455`.

If another application owns the port, sign-in fails. Close the application
using that port and retry `Sign in` or `Reconnect`. VS Code Codex commonly
occupies `1455`. Do not expose these callback ports to the network.

### Sign-in is cancelled or the service is unavailable

- Keep the provider editor open until sign-in completes. Closing it or switching
  editors cancels an unfinished attempt.
- If sign-in times out or the provider rejects it, retry and confirm that the
  account has the required subscription access.
- If the subscription service is not running, restart DeepSeek Harness and
  reload the page.

### One provider's models fail to load

A catalog preparation failure affects only that provider. The model selector
names the provider and offers `Retry`; other routes and their chats remain
available. The host logs one warning per affected provider, rather than taking
down all subscriptions.
