/**
 * Cordis Config for `dsh-next-oauth-providers`.
 *
 * DeepSeek Harness 0.1.7 derives a plugin's settings form from its Loader
 * entry config, so the provider section *is* this plugin's config. `providers`
 * is volatile, which is what lets `configEditor.edit` commit a new section into
 * the running fiber without a restart; `normalizeConfig` accepts both the dict
 * shape the native Models page addresses (`providers.<nativeId>`) and the
 * legacy block list a pre-0.1.7 `settings.yaml` section carries.
 */
import Schema from '@deepseek-ai/schemastery'
import { SETTINGS_NS } from './ids.ts'

export { SETTINGS_NS }

export const pluginConfigSchema = Schema.object({
  providers: Schema.any().default([]).volatile(),
})

export type PluginConfigShape = Schemastery.TypeT<typeof pluginConfigSchema>
