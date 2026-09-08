# ChatGPT OAuth context defaults follow official API cards

Date: 2026-09-08
Status: implemented
Package: `@dsh-next/dsh-next-oauth-providers`

pi-ai's `openai-codex` catalog lists 272K context for GPT-5.4+ (Codex default). Stock `opencode-go` shows 1050K from its own JSON. This plugin still uses pi-ai for ChatGPT models and auth, and overlays official API sizes: 1050K/128K for current 5.4+ ids, 400K/128K for `gpt-5.4-mini`, 128K/128K for spark, 1050K/128K for unknown ids. A Customized-settings value still wins.
