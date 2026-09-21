/**
 * Relative age text for one ref row.
 *
 * The bucketing comes from the platform's `relativeTime` helper so the picker
 * agrees with every other dated surface; the words come from this package's
 * dictionary, per locale-owned copy (docs/i18n.md). A row whose commit time
 * git did not report simply shows no age.
 */

import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageKey } from '../dictionaries.ts'
import type { Translate } from '../GitPanel.tsx'

/** Singular dictionary key per `relativeTime` bucket. */
const SINGULAR: Record<string, MessageKey> = {
  minutes: 'time.minute',
  hours: 'time.hour',
  days: 'time.day',
  months: 'time.month',
  years: 'time.year',
}

/**
 * The trailing age of a ref's tip commit (`12 minutes ago`).
 *
 * @param committedAt - epoch seconds; 0 when git reported none.
 * @param t - this package's translator.
 * @param now - current epoch ms, injected so tests are not clock-bound.
 * @returns the age text, or null when there is no usable time.
 */
export function refAge(committedAt: number, t: Translate, now: number = Date.now()): string | null {
  if (committedAt <= 0) return null
  const { unit, n } = relativeTime(committedAt * 1000, now)
  if (unit === 'now') return t('time.now')
  const key = n === 1 ? SINGULAR[unit] : (`time.${unit}` as MessageKey)
  return key === undefined ? null : t(key, { count: n })
}
