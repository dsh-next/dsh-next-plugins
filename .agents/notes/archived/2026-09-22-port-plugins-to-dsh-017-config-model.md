# Record the DSH 0.1.7 settings-API break (all three ports landed)

- date: 2026-09-22
- status: archived
- scope: packages/dsh-next-skills

DeepSeek Harness `0.1.7-alpha.1` replaced the plugin settings API. The old
`SettingsProvider.register(ns, schema, { applies: 'live' })` is gone from
`@deepseek-ai/dsh-settings`: the package now exposes `SettingsForms`, which
derives a form from each Loader entry's own config schema
(`describe()` walks `configEditor.configuration()` and projects the active
fiber's config) and writes edits through
`describe`/`update`/`replace`/`mutate` keyed by **profile entry id**. The
removed `settings.yaml` is imported once into the active profile; the profile
patch becomes the storage. A `Config` field marked `volatile()` commits into
the running fiber through `configEditor.edit` without a restart.

The oauth-providers and notifier ports landed first and are the reference
implementations; see
[the oauth note](../implemented/2026-09-22-oauth-providers-config-port.md) and
[the notifier note](../implemented/2026-09-22-notifier-config-port.md).

All three plugins were broken this way; each port landed with its own note:

- [skills](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/index.ts)
  returned early when `settings.register` was missing, so its RPC routes never
  registered and every browser call fell through to the static fallback (405 on
  POST). See [the skills port note](../implemented/2026-09-22-skills-config-port.md).

Evidence on `0.1.7-alpha.1`: a direct POST to `/dsh-next-oauth-providers/rpc`
answered `405 Method Not Allowed` with no body (the frontend-static fallback)
before the oauth port, while the plugin's own handler answers `403`/`415`/`400`
with a body.

The skills port follows the same shape: export a `Config` (volatile where the
plugin writes its own state live), read it in `apply(ctx, config)`, keep the RPC
surface, and build the scope face the skills service already consumes.
