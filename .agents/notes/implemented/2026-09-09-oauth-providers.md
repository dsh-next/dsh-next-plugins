# Subscription OAuth plugin (Models footer)

- date: 2026-09-09
- status: implemented
- scope: packages/dsh-next-oauth-providers

Adds `@dsh-next/dsh-next-oauth-providers` as a private plugin. Models
`settings.models.footer` hosts a subscription provider manager for Kimi,
Grok, ChatGPT, and Claude. Inference uses a private official `PiAiAdapter`
instance on `*-oauth` alias routes so API-key rows and `llm-pi-ai/*` grants stay
untouched. Catalog overrides persist in `settings.yaml` under
`dsh-next-oauth-providers:`; tokens persist as credential grants. Grok
inference is pointed at the coding proxy. Live provider sign-in remains a
release gate; the package stays `"private": true`.
