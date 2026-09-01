/**
 * Panel dictionaries for the DSH `locale` service — public barrel.
 *
 * Layout (the repo's standard per-locale split, `docs/i18n.md`):
 * - `dictionaries/en.ts` — the key source (English is the platform fallback
 *   locale and this repo's language) plus the `MessageKey` union;
 * - `dictionaries/zh.ts` — the Simplified Chinese mirror, compile-checked
 *   against the same key union;
 * - `dictionaries/helpers.ts` — standalone interpolation and the no-locale
 *   English fallback for compositions without the service.
 *
 * Registration itself goes through the platform's typed
 * `ctx.locale.register(NS, { en, zh })` in `index.ts`, which checks both
 * dictionaries against this namespace's `LocaleNamespaceMap` entry and
 * requires every shipped locale in one call.
 */
export { en, NS, type MessageKey } from './dictionaries/en.ts'
export { zh } from './dictionaries/zh.ts'
export { englishTranslate, interpolate } from './dictionaries/helpers.ts'
