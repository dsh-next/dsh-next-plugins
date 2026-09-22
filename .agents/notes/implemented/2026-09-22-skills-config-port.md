# Port skills to the DSH 0.1.7 config model

- date: 2026-09-22
- status: implemented
- scope: packages/dsh-next-skills

DeepSeek Harness `0.1.7-alpha.1` retired `SettingsProvider.register` and derives
plugin settings from the owning Loader entry's own config. Skills now exports a
`Config` whose `providers` and `installations` fields are volatile, so a ledger
write commits into the running fiber without a restart, and
[index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/index.ts)
builds the `ConfigScopeFace` the service already consumed over the volatile
config and `configEditor.edit`. Without a profile config editor the plugin stays
inert with a warning, which is its previous no-settings behavior.

The e2e fixture moved with the platform: plugin config now seeds the profile's
`cordis.patch.yml` as an id-targeted row instead of the retired `settings.yaml`,
for the shared runtime seed, the skills preview flow, and their tests.

Verified by `pnpm run test:e2e skills` against DSH `0.1.7-alpha.1`: all four
scenarios pass (source selection and deletion, folder opener states, global-only
rendering, immediate native-catalog refresh), and
`pnpm --filter @dsh-next/dsh-next-skills test` keeps its 324 tests green.
