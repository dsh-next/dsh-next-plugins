# Port the settings plugins to the DSH 0.1.7 config model

- date: 2026-09-22
- status: proposed
- scope: packages/dsh-next-oauth-providers, dsh-next-notifier, dsh-next-skills

DeepSeek Harness `0.1.7-alpha.1` replaced the plugin settings API. The old
`SettingsProvider.register(ns, schema, { applies: 'live' })` is gone from
`@deepseek-ai/dsh-settings`: the package now exposes `SettingsForms`, which
derives a form from each Loader entry's own config schema
(`describe()` walks `configEditor.configuration()` and projects the active
fiber's config) and writes edits through
`describe`/`update`/`replace`/`mutate` keyed by **profile entry id**. The
removed `settings.yaml` is imported once into the active profile; the profile
patch becomes the storage.

Three plugins call the removed method:

- [oauth-providers](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/index.ts#L24)
  and [skills](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/index.ts#L42)
  return early when `settings.register` is missing, so their RPC routes never
  register and every browser call falls through to the static fallback
  (405 on POST).
- [notifier](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-notifier/src/index.ts#L28)
  keeps running with a null scope, so configuration cannot persist and its e2e
  RPC assertion fails.

Evidence on `0.1.7-alpha.1`: `pnpm run test:e2e all` fails the git, skills,
cc-plugins, notifier, and oauth-providers suites; a direct POST to
`/dsh-next-oauth-providers/rpc` answers `405 Method Not Allowed` with no body
(the frontend-static fallback), while the plugin's own handler would have
answered `403`/`415`/`400` with a body.

The port defines each plugin's state as its own Cordis config — the shape
`dsh-llm-pi-ai` uses (`Config` export plus `apply(ctx, config)`) — and lets the
native settings surface edit it. For oauth-providers this combines with the
native provider directory: `llm.registerConfigurableProviders()` entries whose
`settingsNs` is the plugin entry id and whose `settingsPath` addresses the
per-route profile, plus the `settings.models.provider-card` seat for
subscription sign-in, replacing the bespoke footer list. The existing
`providers` block list needs a normalization step so stored sections keep
working.
