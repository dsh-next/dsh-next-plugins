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
import { contextFingerprint } from './context-fingerprint.ts'
import { GitError, isGitError } from './git-runner.ts'
import type { DegradedState, DiffSide, GitFailure, PreflightAction } from '../core/types.ts'
import type { HistoryAction } from '../core/history-plan.ts'
import type { RepositoryActionRequest } from '../core/repository-actions.ts'

/** Route the client posts to. */
export const RPC_PATH = '/dsh-next-git/rpc'

/** Largest request body accepted. */
const MAX_BODY_BYTES = 16 << 20

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

function repositoryRequest(input: unknown): RepositoryActionRequest {
  const value = record(input)
  const action = value.action
  const keys = action === 'fetch' ? ['action', 'remote', 'prune'] : action === 'push' ? ['action', 'remote', 'branch'] : action === 'stash-save' ? ['action', 'includeUntracked', 'message'] : action === 'stash-apply' ? ['action', 'stashOid'] : []
  if (keys.length === 0 || Object.keys(value).some(key => !keys.includes(key))) throw new GitError({ code: 'invalid-name', detail: 'Unknown repository action or option' })
  if (action === 'fetch' && typeof value.remote === 'string' && typeof value.prune === 'boolean') return { action, remote: value.remote, prune: value.prune }
  if (action === 'push' && typeof value.remote === 'string' && typeof value.branch === 'string') return { action, remote: value.remote, branch: value.branch }
  if (action === 'stash-save' && typeof value.includeUntracked === 'boolean' && (value.message === undefined || typeof value.message === 'string')) return { action, includeUntracked: value.includeUntracked, ...(value.message === undefined ? {} : { message: value.message }) }
  if (action === 'stash-apply' && typeof value.stashOid === 'string') return { action, stashOid: value.stashOid }
  throw new GitError({ code: 'invalid-name', detail: 'Invalid repository action arguments' })
}

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
  const strings = input.filter((item): item is string => typeof item === 'string' && item !== '')
  return strings.length === input.length ? strings : []
}

function num(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function bool(input: unknown): boolean {
  return input === true
}

/**
 * Parse a worktree create/preview request.
 *
 * The approval fields are copied only when the client sent an explicit
 * `true`: an absent or malformed value means "not approved", which is the
 * safe reading for a field that authorizes running project commands.
 */
function worktreeRequest(input: Record<string, unknown>): {
  mode: 'new' | 'ref'
  name: string
  ref?: string
  refKind?: 'branch' | 'remote' | 'tag'
  base?: string
  setupApproved?: boolean
  copyApproved?: boolean
  expectedSetupVersion?: string
} {
  const kind = str(input.refKind)
  const refKind = kind === 'branch' || kind === 'remote' || kind === 'tag' ? kind : undefined
  const ref = optStr(input.ref)
  const base = optStr(input.base)
  const version = optStr(input.expectedSetupVersion)
  return {
    mode: str(input.mode) === 'ref' ? 'ref' : 'new',
    name: str(input.name),
    ...(ref === undefined ? {} : { ref }),
    ...(refKind === undefined ? {} : { refKind }),
    ...(base === undefined ? {} : { base }),
    ...(bool(input.setupApproved) ? { setupApproved: true } : {}),
    ...(bool(input.copyApproved) ? { copyApproved: true } : {}),
    ...(version === undefined ? {} : { expectedSetupVersion: version }),
  }
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
        ...(optStr(a.ref) === undefined ? {} : { ref: optStr(a.ref) }),
        ...(optStr(a.search) === undefined ? {} : { search: optStr(a.search) }),
        ...(optStr(a.author) === undefined ? {} : { author: optStr(a.author) }),
        ...(optStr(a.since) === undefined ? {} : { since: optStr(a.since) }),
        ...(optStr(a.until) === undefined ? {} : { until: optStr(a.until) }),
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
    commitAll: (args) => {
      const a = record(args)
      const paths = strList(a.paths)
      return service.commitAll({
        ...source(a),
        message: str(a.message),
        amend: bool(a.amend),
        ...(a.paths === undefined ? {} : { paths }),
        ...(optStr(a.requestId) === undefined ? {} : { requestId: optStr(a.requestId) }),
      })
    },
    cancelCommit: (args) => ({ cancelled: service.cancel(str(args.requestId), optStr(args.sessionId)) }),
    draftMessage: (args) => service.draftMessage(source(args)),
    agentFiles: (args) => {
      const a = record(args)
      const paths = strList(a.paths)
      return service.agentFiles({ ...source(a), ...(a.paths === undefined ? {} : { paths }),
        ...(a.side === 'staged' || a.side === 'unstaged' ? { side: a.side } : {}),
        ...(optStr(a.verb) === undefined ? {} : { verb: optStr(a.verb) }),
        includeSensitive: a.includeSensitive === true,
      })
    },
    worktreeSetup: (args) => service.worktreeSetup({ ...source(args), ...worktreeRequest(record(args)) }),
    worktreeAdd: (args) => service.worktreeAdd({ ...source(args), ...worktreeRequest(record(args)) }),
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
      return service.branchRename({ ...source(a), from: str(a.from), to: str(a.to), ...(optStr(a.expectedOid) === undefined ? {} : { expectedOid: optStr(a.expectedOid) }) })
    },
    branchDelete: (args) => {
      const a = record(args)
      return service.branchDelete({ ...source(a), name: str(a.name), force: bool(a.force), ...(optStr(a.expectedOid) === undefined ? {} : { expectedOid: optStr(a.expectedOid) }) })
    },
    repositoryInventory: args => service.repositoryActions.inventory(source(args)),
    previewRepositoryAction: args => service.repositoryActions.preview(source(args), repositoryRequest(args.request)),
    executeRepositoryAction: args => {
      if (args.approved !== true) throw new GitError({ code: 'invalid-name', detail: 'Approve the action preview first' })
      return service.repositoryActions.execute(source(args), { request: repositoryRequest(args.request), version: str(args.version), approved: true })
    },
    getHunks: args => {
      if (args.side !== 'staged' && args.side !== 'unstaged') throw new GitError({ code: 'invalid-name', detail: 'Choose a valid index side' })
      return service.repositoryActions.inspectHunks(source(args), { path: str(args.path), side: args.side })
    },
    applyHunks: args => {
      if (args.approved !== true || args.side !== 'staged' && args.side !== 'unstaged') throw new GitError({ code: 'invalid-name', detail: 'Approve selected hunks on a valid index side' })
      return service.repositoryActions.applyHunks(source(args), { path: str(args.path), side: args.side, version: str(args.version), hunkIds: strList(args.hunkIds), approved: true })
    },
    getCommitDetails: (args) => service.historyRead.inspect(source(args), str(args.hash)),
    getCommitDiff: (args) => service.historyRead.diff(source(args), str(args.hash), str(args.path), optStr(args.oldPath)),
    compareCommits: (args) => service.historyRead.compare(source(args), str(args.from), str(args.to)),
    historyAgentContext: async (args) => {
      const result = { ...(await service.state(source(args))), ...(await service.historyRead.context(source(args), strList(args.commits))) }
      return { ...result, fingerprint: contextFingerprint(result) }
    },
    previewHistory: (args) => {
      const action = str(args.action)
      if (!['cherry-pick', 'revert', 'squash', 'fixup', 'reorder', 'reword'].includes(action)) throw new GitError({ code: 'invalid-name', detail: 'Unknown history action' })
      return service.historyOperations.preview(source(args), { action: action as HistoryAction, commits: strList(args.commits),
        ...(args.order === undefined ? {} : { order: strList(args.order) }),
        ...(args.message === undefined ? {} : { message: str(args.message) }),
      })
    },
    executeHistory: (args) => {
      if (args.approved !== true) throw new GitError({ code: 'invalid-name', detail: 'Approve the preview before applying it' })
      return service.historyOperations.execute(source(args), str(args.operationId), { approved: true, acknowledgePublishedHistory: args.acknowledgePublishedHistory === true })
    },
    historyOperationStatus: (args) => service.historyOperations.status(source(args), str(args.operationId)),
    recoverHistory: (args) => {
      const id = str(args.operationId)
      if (args.action === 'cancel' || args.action === 'continue' || args.action === 'skip') return service.historyOperations.recover(source(args), id, { action: args.action })
      if (args.action === 'abort' && args.discardResolutionEdits === true) return service.historyOperations.recover(source(args), id, { action: 'abort', discardResolutionEdits: true })
      if (args.action === 'restore' && args.approved === true) return service.historyOperations.recover(source(args), id, { action: 'restore', approved: true })
      throw new GitError({ code: 'invalid-name', detail: 'Unknown or unapproved history recovery action' })
    },
    getConflict: (args) => service.conflicts.inspect(source(args), str(args.path)),
    saveConflict: (args) => {
      if (typeof args.content !== 'string') throw new GitError({ code: 'invalid-name', detail: 'Resolution content must be text' })
      return service.conflicts.save(source(args), { path: str(args.path), expectedVersion: str(args.expectedVersion), content: args.content })
    },
    chooseConflict: (args) => {
      const side = str(args.side)
      if (side !== 'base' && side !== 'current' && side !== 'incoming' && side !== 'delete') {
        throw new GitError({ code: 'invalid-name', detail: 'Unknown conflict choice' })
      }
      return service.conflicts.choose(source(args), { path: str(args.path), expectedVersion: str(args.expectedVersion), side })
    },
    markConflictResolved: (args) => service.conflicts.markResolved(source(args), {
      path: str(args.path), expectedVersion: str(args.expectedVersion),
    }),
    operationContinue: (args) => service.operationContinue(source(args)),
    operationAbort: (args) => service.operationAbort(source(args)),
    operationSkip: (args) => {
      if (args.approved !== true) throw new GitError({ code: 'invalid-name', detail: 'Confirm skipping this step first' })
      return service.operationSkip(source(args))
    },
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
      const chunks: Buffer[] = []
      let bytes = 0
      req.on('data', (chunk: Buffer | string) => {
        if (res.writableEnded) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_BODY_BYTES) {
          res.writeHead(413)
          res.end()
          req.destroy()
          return
        }
        chunks.push(buffer)
      })
      req.on('end', () => {
        if (res.writableEnded) return
        let body: Record<string, unknown>
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
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
