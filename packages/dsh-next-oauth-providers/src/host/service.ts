/**
 * Subscription lifecycle: grants, login attempts, settings catalogs, and
 * which alias routes are registered on ctx.llm.
 */
import { createModels, type AuthEvent, type AuthPrompt, type CredentialStore } from '@earendil-works/pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { FAMILIES, familyByAlias, familyById, isNativeId, type AliasRoute, type Family } from '../core/catalog.ts'
import { classifyLoginError, RpcError } from '../core/errors.ts'
import { LOGIN_TIMEOUT_MS, OWNER_LEASE_MS } from '../core/ids.ts'
import { grantAccountLabel, isOauthGrant } from '../core/records.ts'
import {
  configForStorage,
  normalizeConfig,
  normalizeModelDraft,
  profileOf,
  withModels,
  withProvider,
  withoutProvider,
  type ModelDraft,
  type PluginConfig,
} from '../core/settings.ts'
import type { AttemptPrompt, AttemptView, ModelView, PluginState, ProviderState } from '../core/types.ts'
import { denyAmbientAuthContext } from './credentials.ts'
import { discoverModels, type FetchLike } from './discover.ts'
import { assertLoopbackPortFree, isUnsafeOauthHost, OAUTH_CALLBACK_PORTS } from './http-guard.ts'
import { loginFactory, nativeFactory } from './providers.ts'
import { buildProfile } from './profiles.ts'

export interface ConfigScopeFace {
  get(): unknown
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
  watch(callback: (next: unknown, prev: unknown) => void): () => void
}

interface PromptWaiter {
  readonly prompt: AttemptPrompt
  resolve: (value: string) => void
  reject: (error: Error) => void
}

interface Attempt {
  readonly id: string
  readonly family: Family
  readonly startedAt: number
  readonly expiresAt: number
  status: AttemptView['status']
  notice?: AttemptView['notice']
  error?: AttemptView['error']
  promptWaiter?: PromptWaiter
  lastSeenAt: number
  readonly controller: AbortController
  timer?: ReturnType<typeof setTimeout>
}

export interface LoginInteraction {
  signal: AbortSignal
  notify: (event: AuthEvent) => void
  prompt: (prompt: AuthPrompt) => Promise<string>
}

export interface SubscriptionsServiceOptions {
  store: CredentialStore
  config: ConfigScopeFace
  fetch: FetchLike
  now?: () => number
  randomId?: () => string
  logWarn?: (message: string) => void
  onRoutesChanged?: (aliases: readonly AliasRoute[]) => void
  login?: (nativeId: string, interaction: LoginInteraction) => Promise<void>
}

function envBlocked(): string | undefined {
  for (const name of ['PI_OAUTH_CALLBACK_HOST', 'KIMI_CODE_OAUTH_HOST', 'KIMI_OAUTH_HOST']) {
    if (isUnsafeOauthHost(process.env[name])) return name
  }
  return undefined
}

export class SubscriptionsService {
  private readonly store: CredentialStore
  private readonly config: ConfigScopeFace
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly logWarn: (message: string) => void
  private readonly onRoutesChanged: (aliases: readonly AliasRoute[]) => void
  private readonly login: (nativeId: string, interaction: LoginInteraction) => Promise<void>
  private readonly lifetime = new AbortController()
  private readonly profileFailures = new Map<Family['family'], string>()
  private attempt: Attempt | undefined
  private connected = new Set<AliasRoute>()

  constructor(options: SubscriptionsServiceOptions) {
    this.store = options.store
    this.config = options.config
    this.fetchImpl = options.fetch
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? (() => crypto.randomUUID())
    this.logWarn = options.logWarn ?? (() => {})
    this.onRoutesChanged = options.onRoutesChanged ?? (() => {})
    this.login = options.login ?? (async (nativeId, interaction) => {
      const models = createModels({
        credentials: this.store,
        authContext: denyAmbientAuthContext(),
      })
      if (!isNativeId(nativeId)) throw new RpcError('not-found', `unknown native provider "${nativeId}"`)
      models.setProvider(loginFactory(nativeId))
      await models.login(nativeId, 'oauth', interaction)
    })
  }

  dispose(): void {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort()
    if (this.attempt !== undefined) this.cancelAttempt(this.attempt)
    this.connected.clear()
  }

  configValue(): PluginConfig {
    return normalizeConfig(this.config.get())
  }

  /**
   * Provider profiles for every connected family.
   *
   * The adapter reads this map on every operation, so a family whose profile
   * cannot be built is dropped from the answer instead of thrown out of it:
   * one unusable subscription must not take down the routes still serving.
   * The route stays registered, so the model picker still names it as the one
   * provider that failed instead of silently losing it.
   */
  profiles(): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
    const stored = this.configValue()
    const map = new Map<string, ResolvedPiAiProviderProfile>()
    for (const family of FAMILIES) {
      if (!this.connected.has(family.alias)) continue
      try {
        map.set(family.nativeId, buildProfile(family, profileOf(stored, family.nativeId)))
        this.clearProfileFailure(family)
      } catch (error) {
        this.reportProfileFailure(family, error)
      }
    }
    return map
  }

  /** Warn once per distinct failure so a per-request read cannot flood the log. */
  private reportProfileFailure(family: Family, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.profileFailures.get(family.family) === message) return
    this.profileFailures.set(family.family, message)
    this.logWarn(`dsh-next-oauth-providers profile ${family.family}: ${message}`)
  }

  private clearProfileFailure(family: Family): void {
    if (this.profileFailures.delete(family.family)) {
      this.logWarn(`dsh-next-oauth-providers profile ${family.family}: rebuilt`)
    }
  }

  async hydrate(): Promise<void> {
    if (this.lifetime.signal.aborted) return
    const next = new Set<AliasRoute>()
    for (const family of FAMILIES) {
      const credential = await this.store.read(family.nativeId, { signal: this.lifetime.signal })
      if (this.lifetime.signal.aborted) return
      if (credential !== undefined && isOauthGrant(credential)) next.add(family.alias)
    }
    this.connected = next
    this.onRoutesChanged([...next])
    const raw = this.config.get()
    const rawProviders = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      && 'providers' in raw
      ? (raw as { providers: unknown }).providers
      : undefined
    const dictForm = rawProviders !== null && typeof rawProviders === 'object' && !Array.isArray(rawProviders)
    const stored = this.configValue()
    const serialized = configForStorage(stored)
    const needsRewrite = dictForm
      || (Array.isArray(rawProviders) && JSON.stringify(rawProviders) !== JSON.stringify(serialized.providers))
    if (needsRewrite) await this.replaceConfig(stored)
  }

  async state(): Promise<PluginState> {
    const stored = this.configValue()
    const providers: ProviderState[] = []
    for (const family of FAMILIES) {
      const listed = stored.providers[family.nativeId] !== undefined || this.connected.has(family.alias)
      if (!listed) continue
      const profile = profileOf(stored, family.nativeId)
      const connecting = this.attempt?.family.family === family.family && this.attempt.status === 'running'
      const credential = await this.store.read(family.nativeId)
      const connected = credential !== undefined && isOauthGrant(credential)
      const defaults = nativeModels(family).map(modelView)
      const storedModels = profile.models
      const overridden = storedModels !== undefined && storedModels.length > 0
      const catalog = overridden
        ? storedModels.map(modelView)
        : connected ? defaults : []
      providers.push({
        family: family.family,
        alias: family.alias,
        nativeId: family.nativeId,
        displayName: profile.displayName ?? family.displayName,
        status: connecting ? 'connecting' : connected ? 'connected' : 'disconnected',
        ...connected && isOauthGrant(credential) && grantAccountLabel(credential) !== undefined
          ? { accountLabel: grantAccountLabel(credential) }
          : {},
        models: catalog,
        defaultModels: defaults,
        modelsOverridden: overridden,
        usingDefaults: !overridden,
      })
    }
    return { providers, writable: true }
  }

  async addProvider(familyId: string): Promise<PluginState> {
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    await this.replaceConfig(withProvider(this.configValue(), family.nativeId))
    return this.state()
  }

  async removeProvider(familyId: string): Promise<PluginState> {
    await this.disconnect(familyId)
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    await this.replaceConfig(withoutProvider(this.configValue(), family.nativeId))
    return this.state()
  }

  async listModels(familyId: string): Promise<ModelDraft[]> {
    this.assertActive()
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    if (!this.connected.has(family.alias)) throw new RpcError('auth', 'sign in before fetching models')
    const timeout = new AbortController()
    // Discovery is interactive; do not leave the picker waiting on a hung backend.
    const timer = setTimeout(() => timeout.abort(), 30_000)
    const clearTimer = (): void => clearTimeout(timer)
    this.lifetime.signal.addEventListener('abort', clearTimer, { once: true })
    const signal = AbortSignal.any([this.lifetime.signal, timeout.signal])
    try {
      const models = await discoverModels(family, this.store, this.fetchImpl, signal)
      this.assertActive()
      return models
    } finally {
      clearTimer()
      this.lifetime.signal.removeEventListener('abort', clearTimer)
    }
  }

  async startLogin(familyId: string): Promise<AttemptView> {
    this.assertActive()
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    const blocked = envBlocked()
    if (blocked !== undefined) {
      throw new RpcError('unsupported', `refusing unsafe ${blocked} override`)
    }
    if (this.attempt !== undefined && this.attempt.status === 'running') {
      throw new RpcError('busy', 'a sign-in is already in progress')
    }
    const now = this.now()
    const attempt: Attempt = {
      id: this.randomId(),
      family,
      startedAt: now,
      expiresAt: now + LOGIN_TIMEOUT_MS,
      status: 'running',
      lastSeenAt: now,
      controller: new AbortController(),
    }
    // Reserve the single owner before the asynchronous callback-port probe.
    this.attempt = attempt
    attempt.timer = setTimeout(() => this.cancelAttempt(attempt), LOGIN_TIMEOUT_MS)
    try {
      const callbackPort = OAUTH_CALLBACK_PORTS[family.nativeId]
      if (callbackPort !== undefined) await assertLoopbackPortFree(callbackPort)
      if (!this.isCurrent(attempt)) throw new RpcError('cancelled', 'sign-in ended')
    } catch (error) {
      if (this.isCurrent(attempt)) {
        const classified = classifyLoginError(error)
        attempt.status = 'failed'
        attempt.error = { code: classified.code, ...classified.params === undefined ? {} : { params: classified.params } }
      }
      this.clearAttemptResources(attempt)
      throw error
    }
    void this.runLogin(attempt)
    return this.attemptView(attempt)
  }

  async getAttempt(attemptId: string): Promise<AttemptView> {
    const attempt = this.requireAttempt(attemptId)
    this.expireStale(attempt)
    if (attempt.status === 'running') attempt.lastSeenAt = this.now()
    return this.attemptView(attempt)
  }

  async submitPrompt(attemptId: string, promptId: string, value: string): Promise<AttemptView> {
    const attempt = this.requireAttempt(attemptId)
    if (attempt.status !== 'running') throw new RpcError('not-found', 'this sign-in is no longer waiting')
    const waiter = attempt.promptWaiter
    if (waiter === undefined || waiter.prompt.id !== promptId) {
      throw new RpcError('not-found', 'that prompt is no longer active')
    }
    if (value.trim() === '') throw new RpcError('bad-request', 'a prompt value is required')
    attempt.promptWaiter = undefined
    waiter.resolve(value)
    return this.attemptView(attempt)
  }

  async cancelLogin(attemptId: string): Promise<AttemptView> {
    const attempt = this.requireAttempt(attemptId)
    this.cancelAttempt(attempt)
    return this.attemptView(attempt)
  }

  async disconnect(familyId: string): Promise<PluginState> {
    this.assertActive()
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    if (this.attempt?.family.family === family.family) this.cancelAttempt(this.attempt)
    await this.store.delete(family.nativeId, { signal: this.lifetime.signal })
    this.assertActive()
    this.connected.delete(family.alias)
    this.onRoutesChanged([...this.connected])
    return this.state()
  }

  async refreshModels(familyId: string): Promise<PluginState> {
    const family = familyById(familyId)
    if (family === undefined) throw new RpcError('not-found', `unknown family "${familyId}"`)
    const drafts = await this.listModels(familyId)
    await this.replaceConfig(withModels(this.configValue(), family.nativeId, drafts))
    this.assertActive()
    this.onRoutesChanged([...this.connected])
    return this.state()
  }

  async setModels(alias: string, models: unknown): Promise<PluginState> {
    const family = familyByAlias(alias)
    if (family === undefined) throw new RpcError('not-found', `unknown route "${alias}"`)
    const drafts = Array.isArray(models)
      ? models.map(normalizeModelDraft).filter((row): row is ModelDraft => row !== undefined)
      : undefined
    await this.replaceConfig(withModels(this.configValue(), family.nativeId, drafts))
    if (this.connected.has(family.alias)) this.onRoutesChanged([...this.connected])
    return this.state()
  }

  async addModel(alias: string, draft: unknown): Promise<PluginState> {
    const family = familyByAlias(alias)
    if (family === undefined) throw new RpcError('not-found', `unknown route "${alias}"`)
    const next = normalizeModelDraft(draft)
    if (next === undefined) throw new RpcError('bad-request', 'model id is required')
    const current = profileOf(this.configValue(), family.nativeId).models ?? nativeModels(family)
    if (current.some((row) => row.id === next.id)) return this.state()
    await this.replaceConfig(withModels(this.configValue(), family.nativeId, [...current, next]))
    if (this.connected.has(family.alias)) this.onRoutesChanged([...this.connected])
    return this.state()
  }

  async restoreModels(alias: string): Promise<PluginState> {
    return this.setModels(alias, undefined)
  }

  private assertActive(): void {
    if (this.lifetime.signal.aborted) throw new RpcError('cancelled', 'subscription service disposed')
  }

  private async replaceConfig(next: PluginConfig): Promise<void> {
    this.assertActive()
    await this.config.replace(configForStorage(next))
    this.assertActive()
  }

  private isCurrent(attempt: Attempt): boolean {
    return !this.lifetime.signal.aborted && this.attempt === attempt
      && attempt.status === 'running' && !attempt.controller.signal.aborted
  }

  private clearAttemptResources(attempt: Attempt): void {
    clearTimeout(attempt.timer)
    attempt.timer = undefined
    const waiter = attempt.promptWaiter
    attempt.promptWaiter = undefined
    waiter?.reject(new RpcError('cancelled', 'sign-in ended'))
  }

  private cancelAttempt(attempt: Attempt): void {
    if (attempt.status !== 'running') return
    attempt.status = 'cancelled'
    attempt.error = { code: 'cancelled' }
    this.clearAttemptResources(attempt)
    attempt.controller.abort()
  }

  private expireStale(attempt: Attempt): void {
    if (attempt.status !== 'running') return
    const now = this.now()
    if (now >= attempt.expiresAt || now - attempt.lastSeenAt > OWNER_LEASE_MS) {
      this.cancelAttempt(attempt)
    }
  }

  private requireAttempt(attemptId: string): Attempt {
    if (this.attempt === undefined || this.attempt.id !== attemptId) {
      throw new RpcError('not-found', 'unknown sign-in attempt')
    }
    this.expireStale(this.attempt)
    return this.attempt
  }

  private attemptView(attempt: Attempt): AttemptView {
    return {
      id: attempt.id,
      family: attempt.family.family,
      status: attempt.status,
      ...attempt.notice === undefined ? {} : { notice: attempt.notice },
      ...attempt.promptWaiter === undefined ? {} : { prompt: attempt.promptWaiter.prompt },
      ...attempt.error === undefined ? {} : { error: attempt.error },
      expiresAt: attempt.expiresAt,
    }
  }

  private async runLogin(attempt: Attempt): Promise<void> {
    try {
      await this.login(attempt.family.nativeId, {
        signal: attempt.controller.signal,
        notify: (event) => this.relay(attempt, event),
        prompt: (prompt) => this.ask(attempt, prompt),
      })
      if (!this.isCurrent(attempt)) return
      const credential = await this.store.read(attempt.family.nativeId, { signal: attempt.controller.signal })
      if (!this.isCurrent(attempt)) return
      if (credential === undefined || !isOauthGrant(credential)) {
        throw new RpcError('store', 'sign-in finished without storing a grant')
      }
      try {
        await this.replaceConfig(withProvider(this.configValue(), attempt.family.nativeId))
      } catch (error) {
        if (!this.isCurrent(attempt)) return
        this.logWarn(`dsh-next-oauth-providers persist ${attempt.family.family}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!this.isCurrent(attempt)) return
      attempt.status = 'authorized'
      this.connected.add(attempt.family.alias)
      this.onRoutesChanged([...this.connected])
    } catch (error) {
      if (!this.isCurrent(attempt)) return
      const classified = classifyLoginError(error)
      attempt.status = 'failed'
      attempt.error = { code: classified.code, ...classified.params === undefined ? {} : { params: classified.params } }
      this.logWarn(`dsh-next-oauth-providers login ${attempt.family.family}: ${classified.message}`)
    } finally {
      this.clearAttemptResources(attempt)
    }
  }

  private relay(attempt: Attempt, event: AuthEvent): void {
    if (!this.isCurrent(attempt)) return
    switch (event.type) {
      case 'auth_url':
        attempt.notice = {
          message: event.instructions ?? 'Open this page to continue signing in.',
          url: event.url,
        }
        return
      case 'device_code':
        attempt.notice = {
          message: 'Enter this code on the verification page to finish signing in.',
          url: event.verificationUri,
          code: event.userCode,
        }
        return
      case 'info':
        attempt.notice = {
          message: event.message,
          ...event.links?.[0] === undefined ? {} : { url: event.links[0].url },
        }
        return
      default:
        attempt.notice = { message: event.message }
    }
  }

  private ask(attempt: Attempt, prompt: AuthPrompt): Promise<string> {
    if (!this.isCurrent(attempt) || prompt.signal?.aborted === true) {
      return Promise.reject(new RpcError('cancelled', 'sign-in ended'))
    }
    attempt.promptWaiter?.reject(new RpcError('cancelled', 'prompt replaced'))
    const id = this.randomId()
    const mapped: AttemptPrompt = prompt.type === 'select'
      ? {
        id,
        kind: 'select',
        message: prompt.message,
        options: prompt.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
      }
      : {
        id,
        kind: prompt.type === 'secret' ? 'secret' : 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    return new Promise<string>((resolve, reject) => {
      const signal = prompt.signal
      const onAbort = (): void => {
        if (attempt.promptWaiter?.prompt.id !== id) return
        attempt.promptWaiter = undefined
        reject(new RpcError('cancelled', 'prompt withdrawn'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      attempt.promptWaiter = {
        prompt: mapped,
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      }
    })
  }
}

function modelView(model: { id: string; name?: string; contextWindow?: number; maxTokens?: number }): ModelView {
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }
}

function nativeModels(family: Family): ModelDraft[] {
  return nativeFactory(family.nativeId).getModels().map((model) => ({
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }))
}
