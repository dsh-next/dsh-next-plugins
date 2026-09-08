/**
 * Model capacity fields — same K/M spelling as the stock Models editor.
 */

const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

const CAPACITY_SCALE = {
  k: 1e3,
  m: 1e6,
} as const

/**
 * Read a typed capacity (`256K`, `1M`, or a raw count). Blank inherits.
 * Unreadable input is NaN.
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/** Shortest spelling that survives a round trip through {@link parseCapacity}. */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

export type ModelValidationKey =
  | 'modelIdRequired'
  | 'modelIdDuplicate'
  | 'modelNameInvalid'
  | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'

export interface ModelValidation {
  readonly index: number
  readonly key: ModelValidationKey
}

function positiveCount(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value > 0)
}

/** First invalid drafted row, matching the stock Models Apply gate. */
export function validateModels(models: readonly { id: string; name?: string; contextWindow?: number; maxTokens?: number }[]): ModelValidation | undefined {
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model.id.trim()
    if (id.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(id)) return { index, key: 'modelIdDuplicate' }
    seen.add(id)
    if (model.name !== undefined && model.name.trim() === '') return { index, key: 'modelNameInvalid' }
    if (!positiveCount(model.contextWindow) || (model.contextWindow !== undefined && Number.isNaN(model.contextWindow))) {
      return { index, key: 'modelContextInvalid' }
    }
    if (!positiveCount(model.maxTokens) || (model.maxTokens !== undefined && Number.isNaN(model.maxTokens))) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}
