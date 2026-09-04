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

/**
 * The handler map. Contract tests import this directly and pin every
 * envelope; registerRpc only adds transport.
 */
export function createHandlers(service: WorktreesService): Record<string, Handler> {
  return {
    preflight: (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      if (cwd === undefined) throw new WorktreeFlowError('bad-request', 'preflight requires cwd')
      return service.preflight(cwd)
    },
    create: (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      if (cwd === undefined) throw new WorktreeFlowError('bad-request', 'create requires cwd')
      return service.create({
        cwd,
        title: str(a.title) ?? '',
        baseRef: str(a.baseRef),
      })
    },
    bind: (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      if (sessionId === undefined) throw new WorktreeFlowError('bad-request', 'bind requires sessionId')
      return service.bind(sessionId)
    },
    status: (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      if (sessionId === undefined) throw new WorktreeFlowError('bad-request', 'status requires sessionId')
      return service.status(sessionId)
    },
    remove: (args) => {
      const a = asRecord(args)
      const cwd = str(a.cwd)
      const slug = str(a.slug)
      if (cwd === undefined || slug === undefined) {
        throw new WorktreeFlowError('bad-request', 'remove requires cwd and slug')
      }
      return service.remove({ cwd, slug, force: a.force === true })
    },
  }
}

/** Register the same-origin RPC route (no-op without a webServer service). */
export function registerRpc(ctx: Context, service: WorktreesService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers = createHandlers(service)

  const off = webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let raw = ''
      req.on('data', (chunk: Buffer | string) => {
        raw += chunk
        if (raw.length > 65536) {
          res.writeHead(413)
          res.end()
          req.destroy()
        }
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: { method?: unknown; args?: unknown }
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid json')
          return
        }
        const method = typeof body.method === 'string' ? body.method : ''
        const handler = handlers[method]
        if (typeof handler !== 'function') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('no such method: ' + method)
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
              : { code: 'internal', message: String(error) }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: payload }))
          })
      })
    },
  })

  ctx.effect(() => off)
}
