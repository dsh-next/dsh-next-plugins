/**
 * Host-side JSON RPC over the app's own webServer at POST /dsh-next-skills/rpc.
 * The browser half calls this same-origin route; it dispatches to the
 * SkillsService instance and answers with JSON. Business failures return
 * `{ ok: false, error }`; a thrown error becomes an HTTP 500.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillScopeSetting } from '../core/settings.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillsService } from './skills-service.ts'

const RPC_PATH = '/dsh-next-skills/rpc'

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

function strArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((p): p is string => typeof p === 'string') : []
}

/** Parse a scope payload; `null`/absent clears to the global default. */
function parseScopeInput(input: unknown): SkillScopeSetting | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as { kind?: unknown; workspacePaths?: unknown }
  if (raw.kind === 'workspaces') {
    const paths = strArray(raw.workspacePaths).map((p) => p.trim()).filter((p) => p !== '')
    return { kind: 'workspaces', workspacePaths: [...new Set(paths)] }
  }
  return { kind: 'global' }
}

export function registerRpc(ctx: Context, service: SkillsService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers: Record<string, Handler> = {
    getState: (args) => service.state(strArray(record(args).workspacePaths)),
    setScope: (args) => {
      const a = record(args)
      return service.setScope({ name: str(a.name), scope: parseScopeInput(a.scope) })
    },
    installSkill: (args) => {
      const a = record(args)
      return service.installSkill({
        providerId: str(a.providerId),
        skillPath: str(a.skillPath),
        scope: parseScopeInput(a.scope),
      })
    },
    updateSkill: (args) => service.updateSkill({ name: str(record(args).name) }),
    remove: (args) => service.remove({ name: str(record(args).name) }),
    addProvider: (args) => service.addProvider(str(record(args).spec)),
    removeProvider: (args) => service.removeProvider(str(record(args).providerId)),
    refreshProvider: (args) => service.refreshProvider(str(record(args).providerId)),
    refreshProviders: () => service.refreshProviders(),
    getCatalogSkillDetail: (args) => {
      const a = record(args)
      return service.getCatalogSkillDetail({ providerId: str(a.providerId), skillPath: str(a.skillPath) })
    },
    getInstalledSkillDetail: (args) => {
      const a = record(args)
      return service.getInstalledSkillDetail({ name: str(a.name), workspacePaths: strArray(a.workspacePaths) })
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
