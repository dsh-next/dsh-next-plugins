/**
 * Cordis Config for `dsh-next-oauth-providers`.
 *
 * DeepSeek Harness 0.1.7 derives a plugin's settings form from its Loader
 * entry config, so the provider section *is* this plugin's config. `providers`
 * is volatile, which is what lets `configEditor.edit` commit a new section into
 * the running fiber without a restart.
 *
 * The field is a plain `dict`, and has to be: the native Models page addresses
 * every declared row as `providers.<nativeId>` and resolves that path against
 * the serialized schema with a traversal that descends object `dict` nodes,
 * dict/array `inner` nodes, and nothing else — a `union` (the shape a
 * pre-0.1.7 row array would need) ends the walk, and the row falls back to
 * `"<provider>: unresolvable settings path"` with no editor and no Cancel.
 *
 * `loose` is the bridge for the one shape a dict cannot carry: a pre-0.1.7
 * `settings.yaml` section stores `providers` as an array of rows, and the
 * import writes it into this entry verbatim. Instead of failing the whole
 * entry — which would leave the profile patch permanently unloadable — the
 * rejected value resolves to the empty default, the plugin reads the raw
 * section (src/index.ts `readProviders`), normalizes it, and `hydrate()`
 * rewrites the stored section into the dict shape once.
 */
import Schema from '@deepseek-ai/schemastery'
import { SETTINGS_NS } from './ids.ts'

export { SETTINGS_NS }

const modelSchema = Schema.object({
  id: Schema.string(),
  name: Schema.string(),
  contextWindow: Schema.number(),
  maxTokens: Schema.number(),
})

const profileSchema = Schema.object({
  displayName: Schema.string(),
  models: Schema.array(modelSchema),
})

// Annotated so declaration emit stays portable: the field's inferred type
// reaches into @deepseek-ai/cosmokit generics without a nameable reference.
export const pluginConfigSchema: Schemastery<any, { providers: { get(): unknown } }> = Schema.object({
  providers: Schema.dict(profileSchema).default({}).loose(true).volatile(),
})

export type PluginConfigShape = Schemastery.TypeT<typeof pluginConfigSchema>
