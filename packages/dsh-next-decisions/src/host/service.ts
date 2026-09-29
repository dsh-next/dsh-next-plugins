import { createHash, randomUUID } from 'node:crypto'
import { DecisionError, type ChoiceRequest, type ChoiceResult, type DecisionProvider, type Decisions, type ProvidersState } from '../core/types.ts'
import { parseChoiceRequest, parseChoiceResponse, parseProvider, providerId, record } from '../core/validation.ts'
import type { ConfigStore } from './config.ts'
import type { DecisionKeys } from './credentials.ts'

export interface DecisionPorts {
  config: ConfigStore
  keys: DecisionKeys
  fetch: typeof fetch
  timeoutMs?: number
}
function aborted(signal: AbortSignal): never { throw signal.reason instanceof DecisionError ? signal.reason : new DecisionError('cancelled') }
/** Also bounds dependencies that ignore AbortSignal; their late results are discarded. */
async function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return aborted(signal)
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason instanceof DecisionError ? signal.reason : new DecisionError('cancelled'))
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}
async function responseBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw new DecisionError('http')
  }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new DecisionError('invalid-response')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await cancellable(reader.read(), signal)
      if (part.done) break
      size += part.value.byteLength
      if (size > 128_000) throw new DecisionError('invalid-response')
      chunks.push(part.value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new DecisionError('invalid-response') }
  } finally { void reader.cancel().catch(() => {}) }
}

export class DecisionService implements Decisions {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly identity = randomUUID()
  private generation = 0
  private disposed = false
  private readonly active = new Map<AbortController, string>()
  constructor(private readonly ports: DecisionPorts) {}
  private ensure(): void { if (this.disposed) throw new DecisionError('disposed') }
  private revision(providers: DecisionProvider[]): string {
    return createHash('sha256').update(this.identity + this.generation + JSON.stringify(providers)).digest('hex')
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => { this.ensure(); return run() })
    this.queue = next.catch(() => {})
    return next
  }
  async state(): Promise<ProvidersState> {
    return this.serial(async () => {
      const providers = this.ports.config.read()
      const views = await Promise.all(providers.map(async provider => ({ ...provider, models: provider.models.map(model => ({ ...model })), keyConfigured: Boolean(await this.ports.keys.read(provider.id)) })))
      this.ensure()
      if (JSON.stringify(providers) !== JSON.stringify(this.ports.config.read())) throw new DecisionError('conflict')
      return { providers: views, writable: this.ports.config.writable, revision: this.revision(providers) }
    })
  }
  async listModels(): Promise<Array<{ providerId: string; providerName: string; modelId: string; modelName?: string; contextWindow?: number }>> {
    this.ensure()
    return this.ports.config.read().flatMap(provider => provider.models.map(model => ({
      providerId: provider.id, providerName: provider.name, modelId: model.id,
      ...(model.name === undefined ? {} : { modelName: model.name }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
    })))
  }
  async save(raw: unknown): Promise<ProvidersState> {
    if (!record(raw)
      || Object.keys(raw).some(key => !['provider', 'revision', 'mode', 'apiKey', 'clearKey'].includes(key))
      || typeof raw.revision !== 'string'
      || !['create', 'edit'].includes(raw.mode as string)) {
      throw new DecisionError('invalid-request')
    }
    const provider = parseProvider(raw.provider)
    const { revision, mode, clearKey } = raw
    const apiKey = raw.apiKey
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim() || apiKey !== apiKey.trim() || apiKey.length > 8192 || /[\x00-\x20\x7f]/.test(apiKey))) throw new DecisionError('credentials')
    if ((clearKey !== undefined && typeof clearKey !== 'boolean') || (apiKey !== undefined && clearKey === true)) throw new DecisionError('invalid-request')
    await this.serial(async () => {
      if (!this.ports.config.writable) throw new DecisionError('read-only')
      const current = this.ports.config.read()
      if (revision !== this.revision(current)) throw new DecisionError('conflict')
      const previous = current.find(item => item.id === provider.id)
      if (previous && mode === 'create') throw new DecisionError('conflict')
      if (!previous && mode === 'edit') throw new DecisionError('not-found')
      if (!previous && current.length >= 50) throw new DecisionError('invalid-provider')
      const oldKey = await this.ports.keys.read(provider.id)
      if (previous && previous.baseUrl !== provider.baseUrl && oldKey && apiKey === undefined && clearKey !== true) throw new DecisionError('credentials')
      const nextKey = clearKey === true ? undefined : apiKey as string | undefined ?? oldKey
      this.ensure()
      if (JSON.stringify(current) !== JSON.stringify(this.ports.config.read())) throw new DecisionError('conflict')
      this.cancelProvider(provider.id)
      try {
        if (nextKey !== oldKey) await this.ports.keys.write(provider.id, nextKey)
        await this.ports.config.write(previous ? current.map(item => item.id === provider.id ? provider : item) : [...current, provider], current)
      } catch (error) {
        // Restore credentials if persisting the corresponding provider failed.
        if (nextKey !== oldKey) {
          try { await this.ports.keys.write(provider.id, oldKey) } catch { throw new DecisionError('credentials') }
        }
        if (error instanceof DecisionError && error.code === 'conflict') throw error
        throw new DecisionError('configuration')
      } finally { this.generation += 1 }
    })
    return this.state()
  }
  async remove(raw: unknown): Promise<ProvidersState> {
    if (!record(raw) || Object.keys(raw).some(key => !['id', 'revision'].includes(key)) || typeof raw.revision !== 'string') throw new DecisionError('invalid-request')
    const id = providerId(raw.id)
    const { revision } = raw
    await this.serial(async () => {
      if (!this.ports.config.writable) throw new DecisionError('read-only')
      const current = this.ports.config.read()
      if (revision !== this.revision(current)) throw new DecisionError('conflict')
      if (!current.some(item => item.id === id)) throw new DecisionError('not-found')
      const oldKey = await this.ports.keys.read(id)
      this.ensure()
      if (JSON.stringify(current) !== JSON.stringify(this.ports.config.read())) throw new DecisionError('conflict')
      this.cancelProvider(id)
      try {
        await this.ports.keys.write(id, undefined)
        await this.ports.config.write(current.filter(item => item.id !== id), current)
      } catch (error) {
        try { await this.ports.keys.write(id, oldKey) } catch { throw new DecisionError('credentials') }
        if (error instanceof DecisionError && error.code === 'conflict') throw error
        throw new DecisionError('configuration')
      } finally { this.generation += 1 }
    })
    return this.state()
  }
  /** One request, no discovery, automatic retries, redirects, fallback, or transcript logging. */
  async evaluate(raw: ChoiceRequest, signal?: AbortSignal): Promise<ChoiceResult> {
    this.ensure()
    const request = parseChoiceRequest(raw)
    if (this.active.size >= 4 || [...this.active.values()].filter(id => id === request.providerId).length >= 2) throw new DecisionError('busy')
    const controller = new AbortController()
    const cancel = () => controller.abort(new DecisionError('cancelled'))
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    this.active.set(controller, request.providerId)
    const timer = setTimeout(() => controller.abort(new DecisionError('timeout')), this.ports.timeoutMs ?? 15_000)
    const started = Date.now()
    try {
      const connection = await cancellable(this.serial(async () => {
        if (controller.signal.aborted) return aborted(controller.signal)
        const providers = this.ports.config.read()
        const provider = providers.find(item => item.id === request.providerId)
        if (!provider || !provider.models.some(model => model.id === request.modelId)) throw new DecisionError('not-found')
        const key = await cancellable(this.ports.keys.read(provider.id), controller.signal)
        if (JSON.stringify(providers) !== JSON.stringify(this.ports.config.read())) throw new DecisionError('conflict')
        return { provider, key }
      }), controller.signal)
      if (controller.signal.aborted) return aborted(controller.signal)
      const response = await cancellable(this.ports.fetch(`${connection.provider.baseUrl}/systemone`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(connection.key ? { authorization: `Bearer ${connection.key}` } : {}) },
        body: JSON.stringify({ model: request.modelId, state: request.state, questions: request.questions }),
      }), controller.signal)
      const parsed = parseChoiceResponse(await responseBody(response, controller.signal), request)
      if (controller.signal.aborted) return aborted(controller.signal)
      return { providerId: request.providerId, requestedModel: request.modelId, ...parsed, elapsedMs: Math.max(0, Date.now() - started) }
    } catch (error) {
      if (controller.signal.aborted) return aborted(controller.signal)
      if (error instanceof DecisionError) throw error
      throw new DecisionError('network')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      this.active.delete(controller)
    }
  }
  async test(raw: unknown, signal?: AbortSignal): Promise<ChoiceResult> {
    if (!record(raw) || Object.keys(raw).some(key => !['providerId', 'modelId'].includes(key))) throw new DecisionError('invalid-request')
    return this.evaluate({ providerId: raw.providerId as string, modelId: raw.modelId as string, state: 'The sky is blue.', questions: { color: { type: 'choice', instructions: 'Which color is explicitly stated in the text?', criteria: { blue: 'Blue is stated.', green: 'Green is stated.' } } } }, signal)
  }
  private cancelProvider(id: string): void {
    for (const [controller, provider] of this.active) if (provider === id) controller.abort(new DecisionError('cancelled'))
  }
  dispose(): void {
    this.disposed = true
    for (const controller of this.active.keys()) controller.abort(new DecisionError('disposed'))
  }
}
