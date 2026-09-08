/**
 * POST /dsh-next-oauth-providers/rpc — JSON envelope { ok, value | error }.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RPC_PATH } from '../core/ids.ts'
import { RpcError, type ErrorCode } from '../core/errors.ts'
import { assertLocalOwner } from './http-guard.ts'
import { SubscriptionsService } from './service.ts'

export { RPC_PATH }

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

function record(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function str(input: unknown): string {
  return typeof input === 'string' ? input : ''
}

export function createHandlers(service: SubscriptionsService): Record<string, Handler> {
  return {
    getState: () => service.state(),
    addProvider: (args) => service.addProvider(str(record(args).family)),
    removeProvider: (args) => service.removeProvider(str(record(args).family)),
    startLogin: (args) => service.startLogin(str(record(args).family)),
    getAttempt: (args) => service.getAttempt(str(record(args).attemptId)),
    submitPrompt: (args) => {
      const a = record(args)
      return service.submitPrompt(str(a.attemptId), str(a.promptId), str(a.value))
    },
    cancelLogin: (args) => service.cancelLogin(str(record(args).attemptId)),
    disconnect: (args) => service.disconnect(str(record(args).family)),
    listModels: (args) => service.listModels(str(record(args).family)),
    refreshModels: (args) => service.refreshModels(str(record(args).family)),
    addModel: (args) => {
      const a = record(args)
      return service.addModel(str(a.alias), a.model)
    },
    setModels: (args) => {
      const a = record(args)
      return service.setModels(str(a.alias), a.models)
    },
    restoreModels: (args) => service.restoreModels(str(record(args).alias)),
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function fail(code: ErrorCode, params?: Record<string, string | number>) {
  return { ok: false as const, error: { code, ...params === undefined ? {} : { params } } }
}

export function registerRpc(ctx: Context, service: SubscriptionsService): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const handlers = createHandlers(service)
  const off = webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end('method not allowed')
        return
      }
      try {
        assertLocalOwner(req)
      } catch (error) {
        const rpc = error instanceof RpcError ? error : new RpcError('origin', String(error))
        writeJson(res, 403, fail(rpc.code, rpc.params))
        return
      }
      const type = req.headers['content-type'] ?? ''
      if (type.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        writeJson(res, 415, fail('bad-request'))
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      req.on('data', (chunk: Buffer | string) => {
        if (res.writableEnded) return
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        bytes += buffer.length
        if (bytes > 1_048_576) {
          chunks.length = 0
          res.writeHead(413, { 'Cache-Control': 'no-store' })
          res.end()
          req.destroy()
          return
        }
        chunks.push(buffer)
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8') || '{}')
        } catch {
          writeJson(res, 400, fail('bad-request'))
          return
        }
        if (!isRecord(body)) {
          writeJson(res, 400, fail('bad-request'))
          return
        }
        const method = typeof body.method === 'string' ? body.method : ''
        const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
        if (typeof handler !== 'function') {
          writeJson(res, 404, fail('not-found'))
          return
        }
        Promise.resolve()
          .then(() => handler(record(body.args)))
          .then((value) => {
            writeJson(res, 200, { ok: true, value: value === undefined ? null : value })
          })
          .catch((error: unknown) => {
            const rpc = error instanceof RpcError ? error : new RpcError('unknown', error instanceof Error ? error.message : String(error))
            writeJson(res, 200, fail(rpc.code, rpc.params))
          })
      })
    },
  })
  ctx.effect(() => off)
}
