/**
 * Host-side JSON RPC over the app's own webServer at POST /dsh-next-cc-plugins/rpc.
 * The browser half calls this same-origin route; it dispatches to the
 * CcMarketplaceService instance and answers with JSON. Business failures
 * return `{ ok: false, error }`; a thrown error becomes an HTTP 500.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseTargets } from '../core/targets.ts'
import type { CcMarketplaceService } from './service.ts'

const RPC_PATH = '/dsh-next-cc-plugins/rpc'

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

function record(input: unknown): Record<string, unknown> {
  return (input && typeof input === 'object') ? input as Record<string, unknown> : {}
}

function str(input: unknown): string {
  return typeof input === 'string' ? input : ''
}

function optStr(input: unknown): string | undefined {
  return typeof input === 'string' && input !== '' ? input : undefined
}

function scope(input: unknown): 'global' | 'workspace' {
  return input === 'workspace' ? 'workspace' : 'global'
}

/** The uninstall target selector: '' = global, a path = that workspace. */
function targetRequest(input: unknown): { scope: 'global' | 'workspace'; workspacePath?: string } | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined
  const t = input as Record<string, unknown>
  const sc = scope(t.scope)
  const workspacePath = optStr(t.workspacePath)
  if (sc === 'workspace' && workspacePath === undefined) return undefined
  return sc === 'workspace' ? { scope: sc, workspacePath } : { scope: sc }
}

export function registerRpc(ctx: Context, service: CcMarketplaceService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers: Record<string, Handler> = {
    getState: () => service.state(),
    addMarketplace: (args) => service.addMarketplace(str(record(args).spec)),
    removeMarketplace: (args) => service.removeMarketplace(str(record(args).marketplaceId)),
    refreshMarketplaces: () => service.refreshMarketplaces(),
    getPluginDetail: (args) => {
      const a = record(args)
      return service.getPluginDetail({ marketplaceId: str(a.marketplaceId), plugin: str(a.plugin) })
    },
    installPlugin: (args) => {
      const a = record(args)
      // New shape: targets: [{scope, workspacePath?}]. The legacy single
      // scope/workspacePath pair still works (one target).
      const parsed = parseTargets(a.targets)
      if ('error' in parsed) {
        const legacyScope = scope(a.scope)
        const legacyPath = optStr(a.workspacePath)
        if (legacyScope === 'workspace' && legacyPath === undefined) {
          return { ok: false, error: parsed.error }
        }
        return service.installPlugin({
          marketplaceId: str(a.marketplaceId),
          plugin: str(a.plugin),
          targets: [legacyScope === 'workspace' ? { scope: legacyScope, workspacePath: legacyPath } : { scope: legacyScope }],
        })
      }
      return service.installPlugin({
        marketplaceId: str(a.marketplaceId),
        plugin: str(a.plugin),
        targets: parsed.targets,
      })
    },
    uninstallPlugin: (args) => {
      const a = record(args)
      return service.uninstallPlugin(str(a.key), a.target === undefined ? undefined : targetRequest(a.target))
    },
    updatePlugin: (args) => service.updatePlugin(str(record(args).key)),
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
