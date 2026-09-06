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
import type { IncomingMessage, ServerResponse } from 'node:http'
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
    setup: async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'setup requires cwd and slug')
      }
      return service.setup({ cwd, slug })
    },
    bind: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      if (sessionId === undefined) throw new WorktreeFlowError('bad-request', 'bind requires sessionId')
      return service.bind(sessionId)
    },
    reclaim: async (args) => {
      const a = asRecord(args)
      const from = str(a.from)
      const to = str(a.to)
      if (from === undefined || to === undefined) {
        throw new WorktreeFlowError('bad-request', 'reclaim requires from and to')
      }
      return service.reclaim(from, to)
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
    'update/preflight': async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'update/preflight requires cwd and slug')
      }
      return service.updatePreflight({ cwd, slug })
    },
    'update/execute': async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'update/execute requires cwd and slug')
      }
      return service.updateExecute({ cwd, slug })
    },
    'update/abort': async (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'update/abort requires cwd and slug')
      }
      return service.updateAbort({ cwd, slug })
    },
  }
}

interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): unknown
}

/**
 * Mount the RPC route on the app webServer.
 *
 * Transport shape: the service's `register({ kind: 'exact', path,
 * handler })` face (the notifier- and M1-proven transport; a `.post()`
 * convenience does not exist on this service).
 */
export function registerRpc(ctx: Context, service: WorktreesService): void {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.register !== 'function') return
  const handlers = createHandlers(service)
  const off = server.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let raw = ''
      req.on('data', (chunk: Buffer | string) => {
        raw += chunk
        if (raw.length > 65_536) {
          res.writeHead(413)
          res.end()
          req.destroy()
        }
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: { method?: unknown; args?: unknown }
        try {
          body = JSON.parse(raw === '' ? '{}' : raw) as { method?: unknown; args?: unknown }
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid json')
          return
        }
        const method = typeof body.method === 'string' ? body.method : ''
        const handler = handlers[method]
        if (handler === undefined) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`no such method: ${method}`)
          return
        }
        Promise.resolve()
          .then(() => handler(body.args))
          .then((result) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(result === undefined ? null : result))
          })
          .catch((error: unknown) => {
            const payload = error instanceof WorktreeFlowError
              ? { code: error.code, message: error.message, hint: error.hint }
              : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: payload }))
          })
      })
    },
  })
  if (typeof off === 'function') {
    const dispose = off as () => void
    ctx.effect(() => dispose)
  }
}
