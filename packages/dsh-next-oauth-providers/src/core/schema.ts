/**
 * Schemastery section for `dsh-next-oauth-providers`. Hand-editable; host
 * `normalizeConfig` accepts a block list of provider rows (current) or the
 * older dict shape. `any` is the portable union of those two wire shapes.
 */
import Schema from '@deepseek-ai/schemastery'
import { SETTINGS_NS } from './ids.ts'

export { SETTINGS_NS }

export const pluginConfigSchema = Schema.object({
  providers: Schema.any().default([]),
})

export type PluginConfigShape = Schemastery.TypeT<typeof pluginConfigSchema>
