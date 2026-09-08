# Subscriptions UI matches stock Models manager

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-oauth-providers

Replaced the always-visible four-family cards with the stock Models manager
copied from `@deepseek-ai/dsh-client-ui-settings-models` 0.1.3-alpha.2:
Add provider (dashed button, provider dropdown), listed rows with Edit/Delete
and credential dots, Customized settings model catalog, Fetch available
models picker modal (search, select/deselect all, Add selected), and the
delete confirmation modal. The API-key field is Sign in / Reconnect. CSS
values are copied from the stock ModelsSection module; the select chevron
data-URI keeps the stock hex stroke. Host `state()` now lists a family only
when it is connected or present in `dsh-next-oauth-providers.providers`
(empty profiles are stored so Apply keeps the row). New RPCs: `addProvider`,
`removeProvider`, `listModels` (discover without writing).
