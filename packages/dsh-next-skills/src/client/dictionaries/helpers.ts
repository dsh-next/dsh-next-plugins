/**
 * Standalone interpolation and the no-locale fallback translator.
 *
 * The platform locale service owns lookup and interpolation at render time
 * (active -> en -> common -> key, `{name}` substitution); these helpers only
 * serve compositions without the service — tests and degraded bundles — so
 * the panel renders English unchanged instead of crashing.
 */
import { en, type MessageKey } from './en.ts'

/** `{name}` substitution with the platform's semantics: unknown names stay. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/**
 * The no-locale fallback translator: English, with the same interpolation.
 * Keeps the panel fully functional in compositions without the service.
 */
export function englishTranslate(key: MessageKey, params?: Record<string, string | number>): string {
  return interpolate(en[key], params)
}
