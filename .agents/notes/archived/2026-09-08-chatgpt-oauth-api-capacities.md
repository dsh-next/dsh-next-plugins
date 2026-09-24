# ChatGPT OAuth context defaults follow official API cards

- date: 2026-09-08
- status: archived
- scope: packages/dsh-next-oauth-providers

pi-ai's `openai-codex` catalog lists 272K context for GPT-5.4+ (Codex default).
Stock `opencode-go` shows 1050K from its own JSON. This plugin still uses pi-ai
for ChatGPT models and auth, and overlays official API sizes: 1050K/128K for the
GPT-5.5+ ids, 128K/128K for spark, 1050K/128K for unknown ids. A
Customized-settings value still wins.

The overlay rule stands; the concrete id list moved with the pi-ai 0.87.1 bump.
See
[the 0.87.1 catalog note](../implemented/2026-09-24-oauth-providers-pi-ai-0871-catalog.md).
