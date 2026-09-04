/**
 * Simplified Chinese mirror of this plugin's locale namespace.
 *
 * Same key set as en.ts — `Record<MessageKey, string>` makes a missing or
 * extra key a compile error. Add the Chinese copy alongside every new en key
 * in the same change (`pnpm i18n:check` enforces it repo-wide).
 */
import type { MessageKey } from './en.ts'

/** The zh mirror: same keys, Simplified Chinese copy. */
export const zh: Record<MessageKey, string> = {}
