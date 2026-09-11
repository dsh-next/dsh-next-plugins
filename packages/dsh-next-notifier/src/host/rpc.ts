/** Validated, client-scoped JSON RPC on the app's own web server. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NotifierConfig } from '../core/types.ts'
import type { ClientPresence, DeliveryReceipt } from '../core/notifications.ts'
import { cleanPatch } from '../core/config.ts'
import { SOUND_IDS } from '../core/sounds.ts'
import type { Notifier } from './notifier.ts'

const RPC_PATH = '/dsh-next-notifier/rpc'
const MAX_BODY_BYTES = 65536

type Handler = (args: unknown) => unknown | Promise<unknown>

class RpcError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RpcError(400, 'expected an object')
  return value as Record<string, unknown>
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RpcError(400, 'invalid ' + field)
  return value
}

function clientId(args: unknown): string
function clientId(args: unknown, optional: true): string | undefined
function clientId(args: unknown, optional = false): string | undefined {
  if (optional && args == null) return undefined
  const value = object(args).clientId
  if (optional && value === undefined) return undefined
  return nonempty(value, 'clientId')
}

function presence(args: unknown): ClientPresence {
  const a = object(args)
  const id = nonempty(a.clientId, 'clientId')
  if (typeof a.sequence !== 'number' || !Number.isSafeInteger(a.sequence) || a.sequence < 0) throw new RpcError(400, 'invalid sequence')
  if (typeof a.focused !== 'boolean' || typeof a.visible !== 'boolean' || typeof a.open !== 'boolean') throw new RpcError(400, 'invalid presence flags')
  if (a.sessionId !== null && typeof a.sessionId !== 'string') throw new RpcError(400, 'invalid sessionId')
  const permission = a.permission
  if (permission !== 'granted' && permission !== 'denied' && permission !== 'default' && permission !== 'unsupported') throw new RpcError(400, 'invalid permission')
  return { clientId: id, sequence: a.sequence, focused: a.focused, visible: a.visible, open: a.open, sessionId: a.sessionId, permission }
}

function receipt(args: unknown): DeliveryReceipt {
  const a = object(args)
  return { clientId: nonempty(a.clientId, 'clientId'), id: nonempty(a.id, 'id'), lease: nonempty(a.lease, 'lease') }
}

function configPatch(args: unknown): Record<string, unknown> {
  const a = object(args)
  for (const key of ['enabled', 'suppressFocused']) {
    if (key in a && typeof a[key] !== 'boolean') throw new RpcError(400, 'invalid ' + key)
  }
  if ('volume' in a && (typeof a.volume !== 'number' || !Number.isFinite(a.volume))) throw new RpcError(400, 'invalid volume')
  for (const key of ['finished', 'approval', 'question']) {
    if (!(key in a)) continue
    const group = object(a[key])
    for (const field of ['enabled', 'sound', 'subagent', 'goalOnly']) {
      if (field in group && typeof group[field] !== 'boolean') throw new RpcError(400, 'invalid ' + key + '.' + field)
    }
    if ('soundName' in group && (typeof group.soundName !== 'string' || !SOUND_IDS.includes(group.soundName))) throw new RpcError(400, 'invalid soundName')
  }
  const patch = cleanPatch(a)
  if (Object.keys(patch).length === 0) throw new RpcError(400, 'empty config patch')
  return patch
}

export function registerRpc(ctx: Context, notifier: Notifier, scope: SettingsScope<NotifierConfig> | null): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers = new Map<string, Handler>([
    ['getState', (args) => notifier.state(clientId(args, true))],
    ['getPresence', (args) => notifier.getPresence(clientId(args))],
    ['getPendingNotifications', (args) => {
      const report = presence(args)
      notifier.reportPresence(report)
      return notifier.claimPending(report.clientId)
    }],
    ['acknowledgeNotifications', (args) => ({ ok: notifier.acknowledge(receipt(args)) })],
    ['releaseNotification', (args) => { notifier.release(receipt(args)); return { ok: true } }],
    ['reportPresence', (args) => { notifier.reportPresence(presence(args)); return { ok: true } }],
    ['reportWebPermission', (args) => { notifier.reportPresence(presence(args)); return { ok: true } }],
    ['preview', async (args) => {
      const id = nonempty(object(args).id, 'id')
      if (!SOUND_IDS.includes(id)) throw new RpcError(400, 'unknown sound')
      return { ok: await notifier.preview(id) }
    }],
    ['setConfig', async (args) => {
      const patch = configPatch(args)
      const id = clientId(args, true)
      if (!scope || !ctx.get('settings')?.writable) throw new RpcError(403, 'settings are read-only')
      await scope.update(patch)
      await notifier.onConfigChanged()
      return notifier.state(id)
    }],
  ])

  const off = webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      let settled = false
      let ended = false
      let bytes = 0
      let chunks: Buffer[] = []
      const reply = (status: number, result: unknown): void => {
        if (settled || res.writableEnded || res.destroyed) return
        let body: string
        try { body = JSON.stringify(result === undefined ? null : result) } catch {
          status = 500
          body = '{"error":"response serialization failed"}'
        }
        settled = true
        chunks = []
        // A disconnected peer may race either write. Never throw from a stream callback.
        try {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(body)
        } catch {}
      }
      const abandon = (): void => { settled = true; chunks = [] }
      req.on('error', () => reply(400, { error: 'request stream failed' }))
      req.on('aborted', abandon)
      res.on('error', abandon)
      res.on('close', abandon)
      if (req.method !== 'POST') {
        reply(405, { error: 'method not allowed' })
        return
      }
      req.on('data', (chunk: Buffer | string) => {
        if (settled || ended) return
        try {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > MAX_BODY_BYTES) { reply(413, { error: 'request body too large' }); return }
          chunks.push(buffer)
        } catch { reply(400, { error: 'invalid request body' }) }
      })
      req.on('end', () => {
        if (settled || ended) return
        ended = true
        void Promise.resolve().then(async () => {
          if (settled) return
          let parsed: unknown
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RpcError(400, 'invalid json') }
          chunks = []
          const body = object(parsed)
          if (typeof body.method !== 'string') throw new RpcError(400, 'invalid method')
          const handler = handlers.get(body.method)
          if (!handler) throw new RpcError(404, 'no such method')
          const result = await handler(body.args)
          reply(200, result)
        }).catch((error: unknown) => {
          reply(error instanceof RpcError ? error.status : 500, { error: error instanceof RpcError ? error.message : 'request failed' })
        })
      })
    },
  })

  ctx.effect(() => off)
}
