import type { IncomingMessage, ServerResponse } from 'node:http'
import { DecisionError, RPC_PATH, type RpcEnvelope } from '../core/types.ts'
import { record } from '../core/validation.ts'
import type { DecisionService } from './service.ts'

export interface WebServer { register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void }
/** This first version's settings RPC is local-owner only; no multi-user authorization claim. */
export function assertLocalOwner(req: IncomingMessage): void {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['sec-fetch-site'] === 'cross-site') throw new DecisionError('origin')
  const host = req.headers.host
  if (typeof host !== 'string') throw new DecisionError('origin')
  let url: URL
  try { url = new URL(`http://${host}`) } catch { throw new DecisionError('origin') }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new DecisionError('origin')
  const origin = req.headers.origin
  if (origin !== undefined) {
    if (typeof origin !== 'string') throw new DecisionError('origin')
    let parsed: URL
    try { parsed = new URL(origin) } catch { throw new DecisionError('origin') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== url.host || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new DecisionError('origin')
  }
}
export async function dispatch(service: DecisionService, body: unknown, signal?: AbortSignal): Promise<RpcEnvelope<unknown>> {
  try {
    if (!record(body) || Object.keys(body).some(key => !['method', 'args'].includes(key)) || typeof body.method !== 'string') throw new DecisionError('invalid-request')
    let value: unknown
    switch (body.method) {
      case 'state': value = await service.state(); break
      case 'save': value = await service.save(body.args); break
      case 'remove': value = await service.remove(body.args); break
      case 'test': value = await service.test(body.args, signal); break
      default: throw new DecisionError('not-found')
    }
    return { ok: true, value }
  } catch (error) { return { ok: false, error: { code: error instanceof DecisionError ? error.code : 'failed' } } }
}
export function registerRpc(web: WebServer, service: DecisionService): () => void {
  const active = new Map<AbortController, () => void>()
  const off = web.register({ kind: 'exact', path: RPC_PATH, handler: (req, res) => {
    const reply = (status: number, value: unknown) => {
      if (res.writableEnded || res.destroyed) return
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const fail = (status: number, code: string) => reply(status, { ok: false, error: { code } })
    if (req.method !== 'POST') return fail(405, 'invalid-request')
    try { assertLocalOwner(req) } catch { return fail(403, 'origin') }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415, 'invalid-request')
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(); fail(408, 'timeout') }, 20_000)
    const close = () => { clearTimeout(timer); controller.abort(); active.delete(controller) }
    active.set(controller, () => { close(); fail(503, 'disposed') })
    res.once('close', close)
    req.once('aborted', close)
    req.once('error', close)
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer | string) => {
      if (res.writableEnded || controller.signal.aborted) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > 128_000) { chunks.length = 0; controller.abort(); fail(413, 'invalid-request'); return }
      chunks.push(buffer)
    })
    req.once('end', () => {
      if (res.writableEnded || controller.signal.aborted) return
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail(400, 'invalid-request'); return }
      void dispatch(service, body, controller.signal).then(value => reply(200, value))
    })
  } })
  return () => { off(); for (const cancel of active.values()) cancel(); active.clear() }
}
