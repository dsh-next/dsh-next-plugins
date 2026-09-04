/**
 * Host-side JSON RPC over the app's own webServer at POST /dsh-next-notifier/rpc.
 * The browser half calls this same-origin route; it dispatches to the Notifier
 * instance and answers with JSON. Replaces the dynamic plugin's package-private
 * harness RPC with a transport that works for a published, static bundle.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NotifierConfig } from '../core/types.ts'
import { cleanPatch } from '../core/config.ts'
import { Notifier } from './notifier.ts'

const RPC_PATH = '/dsh-next-notifier/rpc'

type Handler = (args: unknown) => unknown | Promise<unknown>

export function registerRpc(ctx: Context, notifier: Notifier, scope: SettingsScope<NotifierConfig> | null): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers: Record<string, Handler> = {
    getState: () => notifier.state(),
    getPresence: () => notifier.getPresence(),
    getPendingNotifications: (args) => {
      const a = (args && typeof args === 'object') ? args as { channel?: string } : {}
      const channel = a.channel === 'toast' || a.channel === 'web' ? a.channel : undefined
      return notifier.drainPending(channel)
    },
    reportPresence: (args) => {
      notifier.reportPresence((args && typeof args === 'object') ? args as Record<string, unknown> : {})
      return { ok: true }
    },
    reportWebPermission: (args) => {
      const a = (args && typeof args === 'object') ? args as { status?: string } : {}
      if (typeof a.status === 'string') notifier.reportWebPermission(a.status)
      return { ok: true }
    },
    preview: (args) => {
      const a = (args && typeof args === 'object') ? args as { id?: string } : {}
      const id = typeof a.id === 'string' ? a.id : null
      if (!id) return { ok: false }
      return { ok: notifier.preview(id) }
    },
    setConfig: async (args) => {
      const patch = cleanPatch(args)
      if (scope && Object.keys(patch).length > 0) {
        const settings = ctx.get('settings')
        if (settings && settings.writable) {
          try {
            await scope.update(patch)
          } catch {
            // fall through: the notifier keeps its last in-memory config
          }
        }
      }
      notifier.onConfigChanged()
      return notifier.state()
    },
  }

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
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: String(error) }))
          })
      })
    },
  })

  ctx.effect(() => off)
}
