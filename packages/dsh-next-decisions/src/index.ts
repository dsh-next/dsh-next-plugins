import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { SERVICE_KEY, type Decisions } from './core/types.ts'
import { Config, configStore, type ConfigEditor, type ProviderConfig } from './host/config.ts'
import { decisionKeys } from './host/credentials.ts'
import { registerRpc, type WebServer } from './host/rpc.ts'
import { DecisionService } from './host/service.ts'

export { Config }
export type { Decisions, DecisionModel, ChoiceRequest, ChoiceResult, ChoiceQuestion, ChoiceAnswer } from './core/types.ts'
export const inject = ['credentials', 'webServer'] as const

/** Decision providers never register an LLM adapter or a chat-catalog entry. */
export function apply(ctx: Context, config?: ProviderConfig): void {
  const credentials = ctx.get('credentials')
  if (!credentials) { ctx.logger.warn('dsh-next-decisions: credentials unavailable'); return }
  const service = new DecisionService({
    config: configStore(config, ctx.get('configEditor') as ConfigEditor | undefined),
    keys: decisionKeys(credentials),
    fetch: (url, init) => fetch(url, init),
  })
  ctx.provide(SERVICE_KEY, {
    listModels: () => service.listModels(),
    evaluate: (request, signal) => service.evaluate(request, signal),
  } satisfies Decisions)
  const web = ctx.get('webServer') as WebServer | undefined
  const off = web ? registerRpc(web, service) : () => {}
  ctx.effect(() => () => { off(); service.dispose() }, 'decisions: dispose requests and RPC')
}
