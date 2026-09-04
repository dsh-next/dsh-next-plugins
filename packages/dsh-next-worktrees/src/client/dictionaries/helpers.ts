/**
 * Standalone interpolation and the no-locale fallback translator (the
 * notifier-proven pattern): the platform locale service owns lookup and
 * interpolation at render time; these helpers only serve compositions
 * without the service so the UI renders English unchanged.
 */
import { en, type MessageKey } from './en.ts'

/** `{name}` substitution with the platform's semantics: unknown names stay. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** The no-locale fallback translator: English, with interpolation. */
export function englishTranslate(key: MessageKey, params?: Record<string, string | number>): string {
  return interpolate(en[key], params)
}
