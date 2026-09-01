/**
 * Host-side JSON RPC over the app's own webServer at POST /dsh-next-cc-plugins/rpc.
 * The browser half calls this same-origin route; it dispatches to the
 * CcMarketplaceService instance and answers with JSON. Business failures
 * return `{ ok: false, error }`; a thrown error becomes an HTTP 500.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseScope } from '../core/scope.ts'
import type { CcMarketplaceService } from './service.ts'

const RPC_PATH = '/dsh-next-cc-plugins/rpc'

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

function record(input: unknown): Record<string, unknown> {
  return (input && typeof input === 'object') ? input as Record<string, unknown> : {}
}

function str(input: unknown): string {
  return typeof input === 'string' ? input : ''
}

export function registerRpc(ctx: Context, service: CcMarketplaceService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers: Record<string, Handler> = {
    getState: () => service.getState(),
    addMarketplace: (args) => service.addMarketplace(str(record(args).spec)),
    removeMarketplace: (args) => service.removeMarketplace(str(record(args).marketplaceId)),
    refreshMarketplaces: () => service.refreshMarketplaces(),
    getPluginDetail: (args) => {
      const a = record(args)
      return service.getPluginDetail({ marketplaceId: str(a.marketplaceId), plugin: str(a.plugin) })
    },
    installPlugin: (args) => {
      const a = record(args)
      // The scope is either/or: `{ kind: 'global' }` (the default when
      // absent) or `{ kind: 'workspaces', workspacePaths: [...] }`.
      // Stale browser bundles may still send the old target-list form; a
      // workspace-shaped one answers with the honest error instead of
      // silently installing elsewhere.
      if (Array.isArray(a.targets)) {
        return { ok: false, error: 'multi-target installs are no longer supported; pass scope: { kind: "global" } or { kind: "workspaces", workspacePaths: [...] }' }
      }
      const parsed = parseScope(a.scope)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      return service.installPlugin({
        marketplaceId: str(a.marketplaceId),
        plugin: str(a.plugin),
        scope: parsed.scope,
      })
    },
    setPluginScope: (args) => {
      const a = record(args)
      const parsed = parseScope(a.scope)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      return service.setPluginScope(str(a.key), parsed.scope)
    },
    uninstallPlugin: (args) => service.uninstallPlugin(str(record(args).key)),
    updatePlugin: (args) => service.updatePlugin(str(record(args).key)),
    setAgentModelOverrides: (args) => service.setAgentModelOverrides(record(args).map),
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
        if (raw.length > 1048576) {
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
          .then(() => handler(record(body.args)))
          .then((result) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(result === undefined ? null : result))
          })
          .catch((error: unknown) => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          })
      })
    },
  })

  ctx.effect(() => off)
}
