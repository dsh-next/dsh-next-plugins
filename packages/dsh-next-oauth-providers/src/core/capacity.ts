/**
 * Model capacity fields — same K/M spelling as the stock Models editor — plus
 * the declared capability fields (`input`, `reasoningEfforts`).
 */
import { THINKING_LEVELS, type ModelDraft, type ReasoningEfforts } from './settings.ts'

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
  | 'modelReasoningEmpty'
  | 'modelReasoningWireEmpty'
  | 'modelReasoningWireMissing'
  | 'modelReasoningOffOnly'

export interface ModelValidation {
  readonly index: number
  readonly key: ModelValidationKey
}

function positiveCount(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value > 0)
}

/** The declared levels a dict names, in escalation order. */
function declaredLevels(efforts: ReasoningEfforts): string[] {
  const source = efforts as Record<string, unknown>
  return THINKING_LEVELS.filter((level) => source[level] !== undefined)
}

/**
 * First semantic mistake in a declared `reasoningEfforts`, in the order the
 * official resolver reports them: an empty declaration, then a level with no
 * usable wire spelling, then a declaration that offers nothing above `off`.
 * `undefined` (inherit) and `false` (not a reasoning model) are decisions, not
 * mistakes. Only `off` may leave its wire empty, and an empty `off` stays out
 * of the map, which pi-ai reads as "supported, send nothing".
 */
function reasoningFailure(efforts: ReasoningEfforts): ModelValidationKey | undefined {
  const levels = declaredLevels(efforts)
  if (levels.length === 0) return 'modelReasoningEmpty'
  const source = efforts as Record<string, string | null | undefined>
  for (const level of levels) {
    const wire = source[level]
    if (wire === null) {
      if (level !== 'off') return 'modelReasoningWireMissing'
    } else if (wire === '') return 'modelReasoningWireEmpty'
  }
  if (!levels.some((level) => level !== 'off')) return 'modelReasoningOffOnly'
  return undefined
}

/** First invalid drafted row, matching the stock Models Apply gate. */
export function validateModels(models: readonly ModelDraft[]): ModelValidation | undefined {
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
    if (model.reasoningEfforts !== undefined && model.reasoningEfforts !== false) {
      const key = reasoningFailure(model.reasoningEfforts)
      if (key !== undefined) return { index, key }
    }
  }
  return undefined
}
