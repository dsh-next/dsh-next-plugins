/**
 * Host-side JSON RPC over the app's own webServer at POST /dsh-next-skills/rpc.
 * The browser half calls this same-origin route; it dispatches to the
 * SkillsService instance and answers with JSON. Business failures return
 * `{ ok: false, error }`; a thrown error becomes an HTTP 500.
 */
import type { Context } from '@deepseek-ai/cordis'
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

/**
 * Parse the workspace list from a scope payload. Accepted shapes: the new
 * `{ workspaces: [name, ...] }`, a bare array of names, and the legacy
 * `{ kind: 'workspaces', workspacePaths: [...] }`. `null`/absent (or a
 * legacy global marker) clears to the everywhere default. Entries may be
 * full paths; the service normalizes them to directory names.
 */
function parseWorkspacesInput(args: Record<string, unknown>): string[] | undefined {
  // `workspaces: null` (or a legacy global marker) must stay distinct from an
  // empty list: null clears the stored scope, [] disables everywhere.
  if (args.workspaces === null) return undefined
  if (args.workspaces !== undefined) return strArray(args.workspaces)
  if (args.scope === null) return undefined
  if (Array.isArray(args.scope)) return strArray(args.scope)
  const scope = args.scope
  if (scope && typeof scope === 'object') {
    const raw = scope as { kind?: unknown; workspaces?: unknown; workspacePaths?: unknown }
    if (raw.kind === 'workspaces') return strArray(Array.isArray(raw.workspaces) ? raw.workspaces : raw.workspacePaths)
  }
  return undefined
}

export function registerRpc(ctx: Context, service: SkillsService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const handlers: Record<string, Handler> = {
    getState: (args) => service.state(strArray(record(args).workspacePaths)),
    setSkillScope: (args) => {
      const a = record(args)
      return service.setSkillScope({ name: str(a.name), workspaces: parseWorkspacesInput(a) })
    },
    installSkill: (args) => {
      const a = record(args)
      return service.installSkill({
        providerId: str(a.providerId),
        skillPath: str(a.skillPath),
        workspaces: parseWorkspacesInput(a),
      })
    },
    updateSkill: (args) => service.updateSkill({ name: str(record(args).name) }),
    uninstallSkill: (args) => service.uninstallSkill({ name: str(record(args).name) }),
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
