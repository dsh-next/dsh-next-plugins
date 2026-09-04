/**
 * Plugin dictionaries for the DSH `locale` service — public barrel.
 *
 * Layout (docs/i18n.md): en.ts is the key source, zh.ts the compile-checked
 * mirror, and this file re-exports both plus the no-locale fallback helpers
 * (which live in dictionaries/helpers.ts). Register through the platform's
 * typed `ctx.locale.register(NS, { en, zh })` inside `ctx.effect`, and
 * translate through `ctx.locale.bind(NS)`.
 */
export { en, NS, type MessageKey } from './dictionaries/en.ts'
export { zh } from './dictionaries/zh.ts'
export { englishTranslate, interpolate } from './dictionaries/helpers.ts'
