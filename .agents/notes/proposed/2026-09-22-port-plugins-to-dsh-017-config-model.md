# Port the notifier and skills plugins to the DSH 0.1.7 config model

- date: 2026-09-22
- status: proposed
- scope: packages/dsh-next-notifier, dsh-next-skills

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

The oauth-providers port landed first and is the reference implementation; see
[its note](../implemented/2026-09-22-oauth-providers-config-port.md).

Still broken:

- [skills](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/index.ts#L42)
  returns early when `settings.register` is missing, so its RPC routes never
  register and every browser call falls through to the static fallback (405 on
  POST).
- [notifier](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-notifier/src/index.ts#L28)
  keeps running with a null scope, so configuration cannot persist and its e2e
  RPC assertion fails.

Evidence on `0.1.7-alpha.1`: a direct POST to `/dsh-next-oauth-providers/rpc`
answered `405 Method Not Allowed` with no body (the frontend-static fallback)
before the oauth port, while the plugin's own handler answers `403`/`415`/`400`
with a body.

Each port exports a `Config` (volatile where the plugin writes its own state
live), reads it in `apply(ctx, config)`, and keeps its RPC surface. Skills
stores its config in its own entry section; the notifier's sound configuration
is small enough to be fully volatile so a volume change never restarts it.
