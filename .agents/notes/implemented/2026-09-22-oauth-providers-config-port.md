# Port oauth-providers to the DSH 0.1.7 config model

- date: 2026-09-22
- status: implemented
- scope: packages/dsh-next-oauth-providers

DeepSeek Harness `0.1.7-alpha.1` derives a plugin's settings from its own
Loader entry config (`SettingsForms.describe()` projects `entry.fiber.config`)
and retired `SettingsProvider.register`. The plugin now exports a `Config`
whose `providers` field is **volatile**, so `configEditor.edit` commits a new
provider section into the running fiber without a restart.

What landed:

- [index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/index.ts)
  builds the same `ConfigScopeFace` the service already consumed over the
  volatile config instead of a settings scope, and edits through
  `configEditor`. A host without the editor keeps an in-memory section rather
  than bailing out, so login and routing still work in headless compositions.
- Each configured family is declared with
  `llm.registerConfigurableProviders()` as
  `{ provider: <alias route>, settingsNs: <entry id>, settingsPath: ['providers', <nativeId>] }`,
  which is what gives it a native Models row. The declaration is withdrawn when
  the last family leaves, and re-declared on every config change.
- [settings.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/core/settings.ts)
  stores the dict shape the native page addresses (`providers.<nativeId>`);
  `normalizeConfig` still accepts the legacy block list, and hydration rewrites
  it once.
- `SubscriptionsService.pruneUnlisted()` drops the grant of a family a user
  edit removed, which is what a native Models-page Delete leaves behind.

Verified by `pnpm run test:e2e oauth-providers` against DSH `0.1.7-alpha.1`: the
suite drives add, sign-in, catalog editing, Apply, restore-defaults, and delete,
asserts the config row in the profile's `cordis.patch.yml`, and asserts the
native `Edit Grok (xai-oauth)` row appears and disappears with it.

The client followed in the same change: the `settings.models.footer` seat now
renders only the Add entry, and a new `settings.models.provider-card` seat keyed
by the plugin's entry id renders the connection status, Sign out, and the
catalog editor inside the native card. The seats refresh on the forwarded
`settings/document-updated` event, and Apply always states the intended catalog
explicitly, because a card that mounted before a write landed must not decide
the write from a stale row.

Two platform details this port had to absorb: the native page resolves each
directory entry's `providers.<nativeId>` address through the plugin schema, so
that field declares its real dict/list shapes instead of `any`; and the native
card needs `Sign out` on its own surface, because the stock Delete removes the
configuration while credentials are owned elsewhere.
