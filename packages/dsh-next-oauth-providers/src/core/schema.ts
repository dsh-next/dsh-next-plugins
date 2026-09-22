/**
 * Cordis Config for `dsh-next-oauth-providers`.
 *
 * DeepSeek Harness 0.1.7 derives a plugin's settings form from its Loader
 * entry config, so the provider section *is* this plugin's config. `providers`
 * is volatile, which is what lets `configEditor.edit` commit a new section into
 * the running fiber without a restart.
 *
 * The field declares its real shapes rather than `any`: the native Models page
 * resolves each directory entry's `providers.<nativeId>` address through this
 * schema, so an opaque field would leave every row "unresolvable". The union
 * keeps the legacy block list a pre-0.1.7 `settings.yaml` section carries
 * loadable, and `normalizeConfig` folds both forms into one.
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

/** Legacy row: the same profile plus the catalog id it was keyed by. */
const legacyRowSchema = Schema.object({
  id: Schema.string(),
  displayName: Schema.string(),
  models: Schema.array(modelSchema),
})

// Annotated so declaration emit stays portable: the union's inferred type
// reaches into @deepseek-ai/cosmokit generics without a nameable reference.
export const pluginConfigSchema: Schemastery<any, { providers: { get(): unknown } }> = Schema.object({
  providers: Schema.union([
    Schema.dict(profileSchema),
    Schema.array(legacyRowSchema),
  ]).default({}).volatile(),
})

export type PluginConfigShape = Schemastery.TypeT<typeof pluginConfigSchema>
