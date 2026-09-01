/**
 * English dictionary — the key source for this plugin's locale namespace.
 *
 * Repo contract: docs/i18n.md ("Plugin UI strings"). Every user-facing string
 * in the browser half is added here as a dotted key (English is the platform
 * fallback locale and this repo's language); zh.ts mirrors the key set and
 * the compiler enforces parity. Reference implementation:
 * packages/dsh-next-cc-plugins/src/client/dictionaries/.
 */

/** Locale namespace this plugin owns (also the slot label's namespace). */
export const NS = '__NAME__'

/** User-facing strings; add keys here as UI lands. */
export const en = {}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
