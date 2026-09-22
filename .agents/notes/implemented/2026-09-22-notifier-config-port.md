# Port the notifier to the DSH 0.1.7 config model

- date: 2026-09-22
- status: implemented
- scope: packages/dsh-next-notifier

DeepSeek Harness `0.1.7-alpha.1` retired `SettingsProvider.register` and derives
plugin settings from the owning Loader entry's own config. The notifier now
exports a `Config` whose six top-level fields are volatile, so a settings write
commits into the running fiber without a restart and the card's existing RPC
surface is unchanged.

[index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-notifier/src/index.ts)
builds the `SettingsScope` face the notifier and its RPC already consumed over
the volatile config and `configEditor.edit`, and notifies its own watchers after
a write so the sound set re-synthesizes exactly as it did with the old live
scope. Without a profile config editor the scope stays null: the card renders
read-only and the notifier keeps in-memory defaults, which is the previous
no-settings behavior.

The stored section keeps its flat shape, so the one-time import of the retired
`settings.yaml` into the active profile lands on matching fields.

Verified by `pnpm run test:e2e notifier` against DSH `0.1.7-alpha.1`; both the
settings/client-identity/keyboard suite and the failed-turn marker pass, and
`pnpm --filter @dsh-next/dsh-next-notifier test` keeps its 322 tests green.
