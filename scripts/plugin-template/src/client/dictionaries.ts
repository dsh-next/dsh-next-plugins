/**
 * Plugin dictionaries for the DSH `locale` service — public barrel.
 *
 * Layout (docs/i18n.md): en.ts is the key source, zh.ts the compile-checked
 * mirror, and this file re-exports both plus the no-locale fallback helpers.
 * Register through the platform's typed `ctx.locale.register(NS, { en, zh })`
 * inside `ctx.effect`, and translate through `ctx.locale.bind(NS)`.
 * Reference implementation: packages/dsh-next-cc-plugins/src/client/.
 */
import { en, type MessageKey } from './dictionaries/en.ts'
import { zh } from './dictionaries/zh.ts'

export { en, NS, type MessageKey } from './dictionaries/en.ts'
export { zh } from './dictionaries/zh.ts'

/** `{name}` substitution with the platform's semantics: unknown names stay. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** The no-locale fallback translator: English, with the same interpolation. */
export function englishTranslate(key: MessageKey, params?: Record<string, string | number>): string {
  return interpolate(en[key], params)
}
