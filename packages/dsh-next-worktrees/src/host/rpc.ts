/**
 * Host-side JSON RPC over the app's own webServer at
 * POST /dsh-next-worktrees/rpc — the notifier-proven transport for
 * published bundles. Handlers are a plain map so contract tests pin the
 * envelope shapes without a server.
 *
 * Envelope contract: success answers the handler's value directly; failure
 * answers HTTP 200 with `{ error: { code, message, hint? } }` so the client
 * renders one stable error shape.
 */
import type { Context } from '@deepseek-ai/cordis'
import { WorktreeFlowError, WorktreesService } from './service.ts'
import { nameSuggestion } from './service.ts'

export const RPC_PATH = '/dsh-next-worktrees/rpc'

type Handler = (args: unknown) => unknown | Promise<unknown>

function asRecord(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object'
    ? args as Record<string, unknown>
    : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function strArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v !== '')
    : []
}

/**
 * The handler map. Contract tests import this directly and pin every
 * envelope; registerRpc only adds transport.
 */
export function createHandlers(service: WorktreesService): Record<string, Handler> {
  return {
    preflight: async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      if (cwd === undefined) throw new WorktreeFlowError('bad-request', 'preflight requires cwd')
      return service.preflight(cwd)
    },
    suggestName: async () => nameSuggestion(Date.now()),
    create: async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      if (cwd === undefined) throw new WorktreeFlowError('bad-request', 'create requires cwd')
      return service.create({
        cwd,
        name: str(a.name),
        baseRef: str(a.baseRef),
      })
    },
    bind: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      if (sessionId === undefined) throw new WorktreeFlowError('bad-request', 'bind requires sessionId')
      return service.bind(sessionId)
    },
    status: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      if (sessionId === undefined) throw new WorktreeFlowError('bad-request', 'status requires sessionId')
      return service.status(sessionId)
    },
    remove: async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'remove requires cwd and slug')
      }
      return service.remove({ cwd, slug, force: a.force === true })
    },
    topology: async (args) => {
      const a = asRecord(args)
      return service.topology(strArray(a.cwds))
    },
    'merge/preflight': async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'merge/preflight requires cwd and slug')
      }
      return service.mergePreflight({ cwd, slug })
    },
    'merge/execute': async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'merge/execute requires cwd and slug')
      }
      return service.mergeExecute({ cwd, slug })
    },
  }
}

interface WebServerLike {
  get(path: string, handler: (req: unknown, res: unknown) => void): unknown
  post(path: string, handler: (req: unknown, res: unknown) => void): unknown
}

interface ReqLike {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
}

interface ResLike {
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
}

/** Mount the RPC route on the app webServer. */
export function registerRpc(ctx: Context, service: WorktreesService): void {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.post !== 'function') return
  const handlers = createHandlers(service)
  server.post(RPC_PATH, (req: unknown, res: unknown) => {
    const request = req as ReqLike
    const response = res as ResLike
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let method = ''
      let args: unknown = null
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method?: unknown
          args?: unknown
        }
        if (typeof body.method === 'string') method = body.method
        args = body.args ?? null
      } catch {
        // Fall through to the bad-request answer below.
      }
      const answer = (payload: string): void => {
        response.setHeader('content-type', 'application/json')
        response.end(payload)
      }
      if (method === '' || handlers[method] === undefined) {
        answer(JSON.stringify({
          error: { code: 'bad-request', message: `unknown method ${method}` },
        }))
        return
      }
      Promise.resolve()
        .then(() => handlers[method]!(args))
        .then((value) => answer(JSON.stringify(value ?? {})))
        .catch((error: unknown) => {
          if (error instanceof WorktreeFlowError) {
            answer(JSON.stringify({
              error: { code: error.code, message: error.message, hint: error.hint },
            }))
            return
          }
          answer(JSON.stringify({
            error: {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            },
          }))
        })
    })
  })
}
