const MAX_CONTEXT = 1_000_000

/** Decimal K/M model-context notation. Invalid drafts return NaN, blank means unspecified. */
export function parseContextCapacity(value: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const match = /^(\d+)([KkMm])?$/.exec(text)
  if (!match) return Number.NaN
  const unit = match[2]?.toUpperCase()
  const count = Number(match[1]) * (unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1)
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_CONTEXT ? count : Number.NaN
}

/** Write the shortest decimal spelling that round-trips through parseContextCapacity. */
export function formatContextCapacity(value: number | undefined): string {
  if (value === undefined) return ''
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}
