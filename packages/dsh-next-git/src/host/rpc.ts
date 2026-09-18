/**
 * Host-side JSON RPC for the git panel, served from the app's own webServer at
 * `POST /dsh-next-git/rpc`.
 *
 * The browser half calls this same-origin route. Every reply is a result
 * envelope — `{ ok: true, value }` or `{ ok: false, failure, degraded }` —
 * so a named failure state survives the wire instead of collapsing into an
 * HTTP status. Transport errors (bad method, bad JSON, oversized body) stay
 * HTTP-level, because the client cannot do anything with them but log.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { GitService } from './git-service.ts'
import { isGitError } from './git-runner.ts'
import type { DegradedState, DiffSide, GitFailure, PreflightAction } from '../core/types.ts'

/** Route the client posts to. */
export const RPC_PATH = '/dsh-next-git/rpc'

/** Largest request body accepted. */
const MAX_BODY_BYTES = 1 << 20

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function str(input: unknown): string {
  return typeof input === 'string' ? input : ''
}

function optStr(input: unknown): string | undefined {
  return typeof input === 'string' && input !== '' ? input : undefined
}

function strList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is string => typeof item === 'string' && item !== '')
}

function num(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function bool(input: unknown): boolean {
  return input === true
}

/**
 * Register the RPC route.
 *
 * @param ctx - host context carrying `webServer`.
 * @param service - the git service the route dispatches into.
 */
export function registerRpc(ctx: Context, service: GitService): void {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') return

  const source = (args: Record<string, unknown>): { sessionId?: string } => {
    const sessionId = optStr(args.sessionId)
    return sessionId === undefined ? {} : { sessionId }
  }

  const handlers: Record<string, Handler> = {
    getState: (args) =>
      service.state({
        ...source(args),
        includeIgnored: bool(args.includeIgnored),
        ...(optStr(args.base) === undefined ? {} : { base: optStr(args.base) }),
      }),
    getDiff: (args) => {
      const a = record(args)
      const side: DiffSide = a.side === 'staged' ? 'staged' : 'unstaged'
      const oldPath = optStr(a.oldPath)
      return service.diff({
        ...source(a),
        path: str(a.path),
        side,
        ...(oldPath === undefined ? {} : { oldPath }),
      })
    },
    getHistory: (args) => {
      const a = record(args)
      return service.history({
        ...source(a),
        ...(num(a.limit) === undefined ? {} : { limit: num(a.limit) }),
        ...(num(a.skip) === undefined ? {} : { skip: num(a.skip) }),
      })
    },
    preflight: (args) => {
      const a = record(args)
      const action = str(a.action) as PreflightAction
      return service.preflight({ ...source(a), action, ...(optStr(a.target) === undefined ? {} : { target: optStr(a.target) }) })
    },
    stage: (args) => {
      const a = record(args)
      return service.stage({ ...source(a), paths: strList(a.paths) })
    },
    unstage: (args) => {
      const a = record(args)
      return service.unstage({ ...source(a), paths: strList(a.paths) })
    },
    discard: (args) => {
      const a = record(args)
      return service.discard({ ...source(a), paths: strList(a.paths) })
    },
    commit: (args) => {
      const a = record(args)
      const paths = strList(a.paths)
      return service.commit({
        ...source(a),
        message: str(a.message),
        amend: bool(a.amend),
        ...(paths.length === 0 ? {} : { paths }),
        ...(optStr(a.requestId) === undefined ? {} : { requestId: optStr(a.requestId) }),
      })
    },
    cancelCommit: (args) => ({ cancelled: service.cancel(str(record(args).requestId)) }),
    draftMessage: (args) => service.draftMessage(source(args)),
    agentFiles: (args) => {
      const a = record(args)
      const paths = strList(a.paths)
      return service.agentFiles({ ...source(a), ...(paths.length === 0 ? {} : { paths }) })
    },
    worktreeAdd: (args) => {
      const a = record(args)
      const kind = str(a.refKind)
      const refKind = kind === 'branch' || kind === 'remote' || kind === 'tag' ? kind : undefined
      return service.worktreeAdd({
        ...source(a),
        mode: str(a.mode) === 'ref' ? 'ref' : 'new',
        name: str(a.name),
        ...(optStr(a.ref) === undefined ? {} : { ref: optStr(a.ref) }),
        ...(refKind === undefined ? {} : { refKind }),
        ...(optStr(a.base) === undefined ? {} : { base: optStr(a.base) }),
      })
    },
    worktreeRemove: (args) => {
      const a = record(args)
      return service.worktreeRemove({
        ...source(a),
        path: str(a.path),
        force: bool(a.force),
        deleteBranch: bool(a.deleteBranch),
      })
    },
    worktreeMerge: (args) => {
      const a = record(args)
      return service.worktreeMerge({ ...source(a), path: str(a.path) })
    },
    worktreeUpdate: (args) => {
      const a = record(args)
      return service.worktreeUpdate({
        ...source(a),
        path: str(a.path),
        ...(optStr(a.base) === undefined ? {} : { base: optStr(a.base) }),
      })
    },
    worktreePrune: (args) => service.worktreePrune(source(args)),
    worktreeUnlock: (args) => service.worktreeUnlock({ ...source(args), path: str(record(args).path) }),
    branchCreate: (args) => {
      const a = record(args)
      return service.branchCreate({
        ...source(a),
        name: str(a.name),
        ...(optStr(a.from) === undefined ? {} : { from: optStr(a.from) }),
      })
    },
    branchSwitch: (args) => {
      const a = record(args)
      return service.branchSwitch({
        ...source(a),
        name: str(a.name),
        ...(optStr(a.remote) === undefined ? {} : { remote: optStr(a.remote) }),
      })
    },
    branchRename: (args) => {
      const a = record(args)
      return service.branchRename({ ...source(a), from: str(a.from), to: str(a.to) })
    },
    branchDelete: (args) => {
      const a = record(args)
      return service.branchDelete({ ...source(a), name: str(a.name), force: bool(a.force) })
    },
    operationContinue: (args) => service.operationContinue(source(args)),
    operationAbort: (args) => service.operationAbort(source(args)),
    updateFromBranch: (args) => service.updateFromBranch(source(args)),
    revert: (args) => {
      const a = record(args)
      return service.revert({ ...source(a), hash: str(a.hash) })
    },
    cherryPick: (args) => {
      const a = record(args)
      return service.cherryPick({ ...source(a), hash: str(a.hash) })
    },
    checkoutCommit: (args) => {
      const a = record(args)
      return service.checkoutCommit({ ...source(a), hash: str(a.hash) })
    },
    remoteCheckoutCandidates: (args) => service.remoteCheckoutCandidates(source(args)),
    localBranchNames: (args) => service.localBranchNames(source(args)),
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
        if (raw.length > MAX_BODY_BYTES) {
          res.writeHead(413)
          res.end()
          req.destroy()
        }
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: Record<string, unknown>
        try {
          body = record(JSON.parse(raw === '' ? '{}' : raw))
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid json')
          return
        }
        const method = typeof body.method === 'string' ? body.method : ''
        const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
        if (typeof handler !== 'function') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`no such method: ${method}`)
          return
        }
        Promise.resolve()
          .then(() => handler(record(body.args)))
          .then((value) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, value: value === undefined ? null : value }))
          })
          .catch((error: unknown) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(envelopeFor(error)))
          })
      })
    },
  })

  ctx.effect(() => off)
}

/** The failure envelope for a thrown error; unexpected throws stay generic. */
export function envelopeFor(error: unknown): {
  ok: false
  failure: GitFailure
  degraded: DegradedState | null
} {
  if (isGitError(error)) {
    return { ok: false, failure: error.failure, degraded: GitService.degradedFor(error) }
  }
  const failure: GitFailure = {
    code: 'git-failed',
    detail: error instanceof Error ? error.message : String(error),
  }
  return { ok: false, failure, degraded: null }
}
