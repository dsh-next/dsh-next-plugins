# Empty subscription catalog inherits built-in models

Date: 2026-09-08
Status: implemented
Package: `@dsh-next/dsh-next-oauth-providers`

Grok sign-in wrote `dsh-next-oauth-providers.providers.xai.models: []`. The adapter treated that as an explicit empty catalog, so `xai-oauth` registered with zero models. The picker still showed `grok-build` Grok 4.6 from `dsh-coding-subscription-oauth`. Codex was stored as `openai-codex: {}` (inherit) and should list GPT-5.x after hydrate; Apply on an untouched add card could still persist `[]` the same way as Grok.

Fix: same rule as stock Models — omitted or empty `models` means the pi-ai built-in catalog. Hydrate rewrites `models: []` to `{}`.
