# Subscription OAuth plugin (Models footer)

- date: 2026-04-09
- status: archived
- scope: packages/dsh-next-providers-oauth (historical name)

Historical implementation snapshot, superseded by
[OAuth providers](../implemented/2026-09-09-oauth-providers.md). The package
name, footer layout, and route names below describe the earlier design.

Adds `@dsh-next/dsh-next-providers-oauth` as a private plugin. Models
`settings.models.footer` hosts four subscription cards (Kimi, Grok, ChatGPT,
Claude). Inference uses a private official `PiAiAdapter` instance on alias
routes (`subscription-*`) so API-key rows and `llm-pi-ai/*` grants stay
untouched. Catalog overrides persist in `settings.yaml` under
`dsh-next-providers-oauth:`; tokens persist as credential grants. Grok
inference is pointed at the coding proxy. Live provider sign-in remains a
release gate; the package stays `"private": true`.
