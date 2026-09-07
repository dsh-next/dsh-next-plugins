/**
 * Host-side JSON RPC at POST /dsh-next-checkpoints/rpc.
 * Success answers the handler's value; failure answers HTTP 200 with
 * `{ error: { code, message, hint? } }`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CheckpointsError, CheckpointsService } from './service.ts'

export const RPC_PATH = '/dsh-next-checkpoints/rpc'

type Handler = (args: unknown) => unknown | Promise<unknown>

function asRecord(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' ? args as Record<string, unknown> : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Snapshot-now RPC used by the Playwright lane (no live model). */
export const CAPTURE_ENV = 'DSH_NEXT_CHECKPOINTS_CAPTURE'

export function captureAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CAPTURE_ENV] === '1'
}

export function createHandlers(service: CheckpointsService): Record<string, Handler> {
  return {
    list: async (args) => {
      const sessionId = str(asRecord(args).sessionId)
      if (sessionId === undefined) throw new CheckpointsError('bad-request', 'list requires sessionId')
      return service.list(sessionId)
    },
    diffs: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      const checkpointId = str(a.checkpointId)
      if (sessionId === undefined || checkpointId === undefined) {
        throw new CheckpointsError('bad-request', 'diffs requires sessionId and checkpointId')
      }
      return service.diffs(sessionId, checkpointId)
    },
    preview: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      const checkpointId = str(a.checkpointId)
      if (sessionId === undefined || checkpointId === undefined) {
        throw new CheckpointsError('bad-request', 'preview requires sessionId and checkpointId')
      }
      return service.preview(sessionId, checkpointId)
    },
    rewind: async (args) => {
      const a = asRecord(args)
      const sessionId = str(a.sessionId)
      const checkpointId = str(a.checkpointId)
      if (sessionId === undefined || checkpointId === undefined) {
        throw new CheckpointsError('bad-request', 'rewind requires sessionId and checkpointId')
      }
      return service.rewind(sessionId, checkpointId)
    },
    capture: async (args) => {
      if (!captureAllowed()) {
        throw new CheckpointsError('disabled', 'capture is only available in the e2e harness')
      }
      const sessionId = str(asRecord(args).sessionId)
      if (sessionId === undefined) throw new CheckpointsError('bad-request', 'capture requires sessionId')
      return service.capture(sessionId)
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

export function registerRpc(ctx: Context, service: CheckpointsService): void {
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
        if (raw.length > 1_048_576) {
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
            const payload = error instanceof CheckpointsError
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
