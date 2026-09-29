import { DecisionError, type ChoiceAnswer, type ChoiceRequest, type DecisionModel, type DecisionProvider } from './types.ts'

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
}
export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new DecisionError('invalid-provider')
  return value
}
/** HTTPS, or explicitly local HTTP. No URL credentials, queries, fragments, or redirects. */
export function baseUrl(value: unknown): string {
  if (!text(value, 2048) || value.includes('?') || value.includes('#')) throw new DecisionError('invalid-provider')
  let url: URL
  try { url = new URL(value) } catch { throw new DecisionError('invalid-provider') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new DecisionError('invalid-provider')
  return url.href.replace(/\/+$/, '')
}
function parseModel(value: unknown): DecisionModel {
  if (!record(value) || Object.keys(value).some(key => !['id', 'name', 'contextWindow'].includes(key)) || !text(value.id, 256) || value.id !== value.id.trim()) throw new DecisionError('invalid-models')
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 120 || /[\x00-\x1f\x7f]/.test(value.name))) throw new DecisionError('invalid-models')
  if (value.contextWindow !== undefined && (typeof value.contextWindow !== 'number' || !Number.isSafeInteger(value.contextWindow) || value.contextWindow < 1 || value.contextWindow > 1_000_000)) throw new DecisionError('invalid-models')
  return {
    id: value.id,
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
  }
}
export function parseProvider(value: unknown): DecisionProvider {
  if (!record(value) || Object.keys(value).some(key => !['id', 'name', 'baseUrl', 'models', 'modelIds'].includes(key)) || !text(value.name, 120)) throw new DecisionError('invalid-provider')
  if ((value.models !== undefined && !Array.isArray(value.models)) || (value.modelIds !== undefined && !Array.isArray(value.modelIds))) throw new DecisionError('invalid-models')
  const rawModels = value.models as unknown[] | undefined
  const legacyIds = value.modelIds as unknown[] | undefined
  if (rawModels?.length && legacyIds?.length && (rawModels.length !== legacyIds.length || rawModels.some((row, index) => !record(row) || row.id !== legacyIds[index]))) throw new DecisionError('invalid-models')
  const selected = rawModels?.length ? rawModels : legacyIds?.length ? legacyIds.map(id => ({ id })) : rawModels ?? legacyIds ?? []
  if (selected.length < 1 || selected.length > 100) throw new DecisionError('invalid-models')
  const models = Array.from(selected, parseModel)
  if (new Set(models.map(model => model.id)).size !== models.length) throw new DecisionError('invalid-models')
  return { id: providerId(value.id), name: value.name.trim(), baseUrl: baseUrl(value.baseUrl), models }
}
export function parseProviders(value: unknown): DecisionProvider[] {
  if (!Array.isArray(value) || value.length > 50) throw new DecisionError('configuration')
  const providers = Array.from(value, parseProvider)
  if (new Set(providers.map(item => item.id)).size !== providers.length) throw new DecisionError('configuration')
  return providers
}
/** Reject values JSON would silently omit/coerce, accessors, cycles, and excessive nesting. */
function jsonValue(value: unknown, ancestors = new Set<object>(), depth = 0, budget = { nodes: 0 }): boolean {
  if (++budget.nodes > 32_000 || depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  ancestors.add(value)
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'))
  const valid = (!Array.isArray(value) || (keys.length === value.length && keys.every((key, index) => key === String(index)))) && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    return typeof key === 'string' && descriptor.enumerable && 'value' in descriptor && jsonValue(descriptor.value, ancestors, depth + 1, budget)
  })
  ancestors.delete(value)
  return valid
}
/** Copy JSON inputs before any asynchronous work so later caller edits cannot alter a request. */
export function parseChoiceRequest(value: unknown): ChoiceRequest {
  let copied: unknown
  try {
    if (!jsonValue(value)) throw new Error()
    const json = JSON.stringify(value)
    if (json.length > 64_000) throw new Error()
    copied = JSON.parse(json)
  } catch { throw new DecisionError('invalid-request') }
  if (!record(copied) || Object.keys(copied).some(key => !['providerId', 'modelId', 'state', 'questions'].includes(key)) || !text(copied.modelId, 256) || !(typeof copied.state === 'string' || record(copied.state) || Array.isArray(copied.state)) || !record(copied.questions)) throw new DecisionError('invalid-request')
  const entries = Object.entries(copied.questions)
  if (!entries.length || entries.length > 16) throw new DecisionError('invalid-request')
  for (const [id, question] of entries) {
    if (!text(id, 100) || !record(question) || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key)) || question.type !== 'choice' || typeof question.instructions !== 'string' || !question.instructions.trim() || question.instructions.length > 8000 || !record(question.criteria)) throw new DecisionError('invalid-request')
    const criteria = Object.entries(question.criteria)
    if (criteria.length < 2 || criteria.length > 255 || criteria.some(([key, description]) => !text(key, 256) || !(description === null || (typeof description === 'string' && description.length <= 8000)))) throw new DecisionError('invalid-request')
  }
  providerId(copied.providerId)
  return copied as unknown as ChoiceRequest
}
function probability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
export function parseChoiceResponse(value: unknown, request: ChoiceRequest): { model: string; answers: Record<string, ChoiceAnswer>; usage: { input_tokens?: number; output_tokens?: number } } {
  const bad = (): never => { throw new DecisionError('invalid-response') }
  if (!record(value) || !text(value.model, 256) || !record(value.answers) || !record(value.usage)) return bad()
  const ids = Object.keys(request.questions)
  if (Object.keys(value.answers).length !== ids.length) return bad()
  const answers: Record<string, ChoiceAnswer> = Object.create(null)
  for (const id of ids) {
    const answer = Object.hasOwn(value.answers, id) ? value.answers[id] : undefined
    if (!record(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string' || !record(answer.probabilities) || !probability(answer.confidence)) return bad()
    const keys = Object.keys(request.questions[id].criteria)
    if (!keys.includes(answer.choice) || Object.keys(answer.probabilities).length !== keys.length || keys.some(key => !Object.hasOwn(answer.probabilities as object, key) || !probability((answer.probabilities as Record<string, unknown>)[key]))) return bad()
    const probabilities = answer.probabilities as Record<string, number>
    if (Math.abs(keys.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 0.01 + Number.EPSILON || probabilities[answer.choice] + 1e-6 < Math.max(...keys.map(key => probabilities[key]))) return bad()
    answers[id] = { type: 'choice', choice: answer.choice, probabilities: { ...probabilities }, confidence: answer.confidence }
  }
  const usage: { input_tokens?: number; output_tokens?: number } = {}
  for (const key of ['input_tokens', 'output_tokens'] as const) {
    const count = value.usage[key]
    if (count !== undefined) {
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return bad()
      usage[key] = count
    }
  }
  return { model: value.model, answers, usage }
}
