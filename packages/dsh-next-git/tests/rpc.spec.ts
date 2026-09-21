import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createFixture, createNonRepository, type GitFixture } from './git-fixture.ts'
import { CancellationRegistry, GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { envelopeFor, registerRpc, RPC_PATH } from '../src/host/rpc.ts'
import { GitError } from '../src/host/git-runner.ts'
import { HistoryOperationError } from '../src/host/history-operations.ts'
import type { FileChanges } from '../src/core/types.ts'

/**
 * RPC contract suite: every method the browser half can call is dispatched
 * through the real route handler, and every reply is asserted as an exact
 * envelope. This is the layer that catches "HTTP 200 but the panel renders
 * nothing".
 */

interface FakeResponse {
  status: number
  body: string
  writableEnded: boolean
  headers: Record<string, string>
}

interface Route {
  kind: string
  path: string
  handler: (req: unknown, res: FakeResponse) => void
}

/** Register the route over a service and return a caller for it. */
function mount(service: GitService): {
  call: (method: string, args?: Record<string, unknown>) => Promise<{ status: number; json: unknown; raw: string }>
  raw: (options: { method?: string; body?: string; chunks?: readonly Buffer[]; explode?: boolean; huge?: boolean }) => Promise<FakeResponse>
  routes: Route[]
} {
  const routes: Route[] = []
  const webServer = {
    register(route: Route) {
      routes.push(route)
      return () => {}
    },
  }
  const ctx = {
    get: (name: string) => (name === 'webServer' ? webServer : undefined),
    effect: (run: () => unknown) => run(),
    logger: { warn: () => {} },
  } as unknown as Context
  registerRpc(ctx, service)

  const raw = async (options: {
    method?: string
    body?: string
    chunks?: readonly Buffer[]
    explode?: boolean
    huge?: boolean
  }): Promise<FakeResponse> => {
    const route = routes[0]!
    const response: FakeResponse = { status: 0, body: '', writableEnded: false, headers: {} }
    const listeners: Record<string, ((chunk?: unknown) => void)[]> = {}
    const req = {
      method: options.method ?? 'POST',
      destroy: () => {},
      on(event: string, listener: (chunk?: unknown) => void) {
        listeners[event] = [...(listeners[event] ?? []), listener]
        return req
      },
    }
    const res = {
      ...response,
      writeHead(status: number, headers?: Record<string, string>) {
        response.status = status
        response.headers = headers ?? {}
      },
      end(body?: string) {
        response.body = body ?? ''
        response.writableEnded = true
      },
      get writableEnded() {
        return response.writableEnded
      },
    }
    // Drive the handler: any listeners registered during the data callback for
    // `end` must run after the body arrived.
    route.handler(req, res as unknown as FakeResponse)
    const payload = options.huge === true
      ? 'x'.repeat(16 * 1024 * 1024 + 1)
      : options.explode === true
        ? '{'
        : (options.body ?? '')
    if (!response.writableEnded) {
      for (const chunk of options.chunks ?? [payload]) {
        for (const listener of listeners.data ?? []) listener(chunk)
      }
      if (!response.writableEnded) {
        for (const listener of listeners.end ?? []) listener()
      }
    }
    // The handler answers asynchronously (real git work); wait for the write
    // instead of guessing a delay.
    const deadline = Date.now() + 30_000
    while (!response.writableEnded && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return response
  }

  return {
    routes,
    raw,
    async call(method, args = {}) {
      // The browser half always names its session; the host resolves the
      // working directory from it, so the contract tests do the same.
      const withSession = { sessionId: 'test-session', ...args }
      const response = await raw({ body: JSON.stringify({ method, args: withSession }) })
      let json: unknown = null
      try {
        json = JSON.parse(response.body)
      } catch {
        json = null
      }
      return { status: response.status, json, raw: response.body }
    },
  }
}

/** A service bound to one directory. */
function serviceFor(dir: string): GitService {
  return new GitService({
    runner: new GitRunner(),
    fs: nodeFs(),
    cwdOf: () => dir,
    platform: process.platform,
    env: process.env,
  })
}

const fixtures: GitFixture[] = []
function open(scenario: Parameters<typeof createFixture>[0]): GitFixture {
  const fixture = createFixture(scenario)
  fixtures.push(fixture)
  return fixture
}

describe('extended repository command RPC', () => {
  it('previews, approves and executes with exact envelopes, then reads bounded output', async () => {
    const fixture = open('clean')
    try {
      const rpc = mount(serviceFor(fixture.dir))
      const request = { action: 'remote-add', name: 'backup', url: 'https://example.test/repo.git' }
      const read = await rpc.call('previewRepositoryCommand', { request })
      expect(read.status).toBe(200)
      expect(read.json, JSON.stringify(read.json)).toMatchObject({ ok: true, value: { request, checkout: fixture.dir, version: expect.any(String), summary: expect.any(String), warnings: expect.any(Array) } })
      expect(Object.keys(read.json as object).sort()).toEqual(['ok', 'value'])
      const version = (read.json as { value: { version: string } }).value.version
      expect((await rpc.call('executeRepositoryCommand', { request, version })).json).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
      const write = await rpc.call('executeRepositoryCommand', { request, version, approved: true })
      expect(write.json).toEqual({ ok: true, value: { status: 'completed', refresh: true, conflictRefresh: false, reason: null, message: null, stashOid: null } })
      expect((await rpc.call('repositoryOutput')).json).toMatchObject({ ok: true, value: { text: expect.stringContaining('remote-add') } })
      for (const request of [{ action: 'unknown' }, { action: 'stash-clear', unexpected: true }, { action: 'pull', remote: 'origin', branch: 'main', rebase: 'yes' }]) {
        expect((await rpc.call('previewRepositoryCommand', { request })).json).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
      }
    } finally { fixture.dispose() }
  })

  it('dispatches signoff strictly and exposes stash inspection without applying', async () => {
    const fixture = open('staged')
    try {
      const rpc = mount(serviceFor(fixture.dir))
      expect((await rpc.call('commit', { message: 'signed', signoff: 'yes' })).json).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
      expect((await rpc.call('commit', { message: 'signed', signoff: true })).json).toMatchObject({ ok: true })
      expect((await rpc.call('commit', { message: 'amend', amend: true, expectedHead: 42 })).json).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
      expect((await rpc.call('commitAll', { message: 'amend', amend: true, expectedHead: '0'.repeat(40) })).json).toMatchObject({ ok: false, failure: { code: 'dirty-tree' } })
      const runner = new GitRunner()
      expect(await runner.runOk(['log', '-1', '--format=%B'], fixture.dir)).toContain('Signed-off-by:')
      fixture.write('src/app.ts', 'stash payload\n')
      await runner.runOk(['stash', 'push', '-m', 'read me'], fixture.dir)
      const stashOid = (await runner.runOk(['rev-parse', 'refs/stash'], fixture.dir)).trim()
      expect((await rpc.call('inspectRepositoryStash', { stashOid })).json).toMatchObject({ ok: true, value: { stashOid, patch: expect.stringContaining('stash payload') } })
      expect((await runner.runOk(['rev-parse', 'refs/stash'], fixture.dir)).trim()).toBe(stashOid)
    } finally { fixture.dispose() }
  })

  it('refuses abort-rebase when a different operation is active', async () => {
    const fixture = open('merge-conflict')
    try {
      const rpc = mount(serviceFor(fixture.dir))
      expect((await rpc.call('operationAbort', { expectedKind: 'rebase' })).json).toMatchObject({ ok: false, failure: { code: 'operation-in-progress' } })
      expect((await rpc.call('operationAbort', { expectedKind: 'anything' })).json).toMatchObject({ ok: false, failure: { code: 'invalid-name' } })
    } finally { fixture.dispose() }
  })
})

describe('rpc route registration', () => {
  it('registers one exact POST route', () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    expect(mounted.routes).toHaveLength(1)
    expect(mounted.routes[0]).toMatchObject({ kind: 'exact', path: RPC_PATH })
    for (const fixture2 of fixtures) fixture2.dispose()
    fixtures.length = 0
  })

  it('answers 405 for a non-POST request', async () => {
    const fixture = open('clean')
    const response = await mount(serviceFor(fixture.dir)).raw({ method: 'GET' })
    expect(response.status).toBe(405)
    expect(response.body).toBe('method not allowed')
  })

  it('answers 400 for invalid JSON', async () => {
    const fixture = open('clean')
    const response = await mount(serviceFor(fixture.dir)).raw({ explode: true })
    expect(response.status).toBe(400)
    expect(response.body).toBe('invalid json')
  })

  it('answers 413 for an oversized body', async () => {
    const fixture = open('clean')
    const response = await mount(serviceFor(fixture.dir)).raw({ huge: true })
    expect(response.status).toBe(413)
    for (const fixture2 of fixtures) fixture2.dispose()
    fixtures.length = 0
  })

  it('answers 404 for an unknown method', async () => {
    const fixture = open('clean')
    const { status, raw } = await mount(serviceFor(fixture.dir)).call('nope')
    expect(status).toBe(404)
    expect(raw).toBe('no such method: nope')
  })
})

describe('getState envelope', () => {
  it('returns the panel state under `value`, with no raw config at the top level', async () => {
    const fixture = open('ahead-behind')
    const { status, json } = await mount(serviceFor(fixture.dir)).call('getState')
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true })
    const envelope = json as { ok: true; value: { state: Record<string, unknown>; notice: unknown } }
    expect(Object.keys(envelope)).toEqual(['ok', 'value'])
    expect(Object.keys(envelope.value).sort()).toEqual(['notice', 'state'])
    expect(envelope.value.notice).toBeNull()
    expect(envelope.value.state).toMatchObject({
      root: fixture.dir,
      cwd: fixture.dir,
      bare: false,
    })
    // The grouped change summary is present and JSON-shaped.
    expect(envelope.value.state).toHaveProperty('changes.staged')
    expect(JSON.parse(JSON.stringify(envelope.value))).toBeTruthy()
  })

  it('serializes the whole state as JSON', async () => {
    const fixture = open('worktrees')
    const { json } = await mount(serviceFor(fixture.dir)).call('getState', { includeIgnored: true })
    const value = (json as { value: { state: { worktrees: unknown[]; branches: unknown[] } } }).value
    expect(Array.isArray(value.state.worktrees)).toBe(true)
    expect(Array.isArray(value.state.branches)).toBe(true)
  })

  it('returns a named failure envelope outside a repository', async () => {
    const plain = createNonRepository()
    const { status, json } = await mount(serviceFor(plain.dir)).call('getState')
    expect(status).toBe(200)
    expect(json).toMatchObject({
      ok: false,
      failure: { code: 'not-a-repository' },
      degraded: { code: 'not-a-repository' },
    })
    plain.dispose()
  })
})

describe('refSummary envelope', () => {
  it('returns head and the two ref lists, and nothing from the panel state', async () => {
    const fixture = open('ahead-behind')
    const { status, json } = await mount(serviceFor(fixture.dir)).call('refSummary')
    expect(status).toBe(200)
    const envelope = json as { ok: true; value: Record<string, unknown> }
    expect(envelope.ok).toBe(true)
    expect(Object.keys(envelope.value).sort()).toEqual(['branches', 'head', 'root', 'tags'])
    expect(envelope.value).toMatchObject({ root: fixture.dir })
    const head = envelope.value.head as Record<string, unknown>
    expect(head).toMatchObject({ branch: 'main', detached: false, unborn: false })
    expect(Array.isArray(envelope.value.branches)).toBe(true)
    expect(Array.isArray(envelope.value.tags)).toBe(true)
    // The chip's read stays small: no status, worktrees, identity or history.
    expect(envelope.value).not.toHaveProperty('changes')
    expect(envelope.value).not.toHaveProperty('worktrees')
    expect(envelope.value).not.toHaveProperty('identity')
  })

  it('carries the session id through to the named failure envelope', async () => {
    const plain = createNonRepository()
    const { status, json } = await mount(serviceFor(plain.dir)).call('refSummary', { sessionId: 'session-1' })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: false, failure: { code: 'not-a-repository' } })
    plain.dispose()
  })
})

describe('read envelopes', () => {
  it('preserves commit details and per-file diff envelopes', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const hash = fixture.commit('detail.txt', 'committed text\n', 'Subject\n\nFull message')
    const details = await mounted.call('getCommitDetails', { hash })
    expect(details.status).toBe(200)
    const envelope = details.json as { ok: true; value: import('../src/core/history-view.ts').CommitDetails }
    expect(Object.keys(envelope)).toEqual(['ok', 'value'])
    expect(Object.keys(envelope.value).sort()).toEqual(['commit', 'files', 'message', 'parent'])
    expect(envelope).toMatchObject({ ok: true, value: {
      commit: { hash }, parent: fixture.gitOk(['rev-parse', 'HEAD~1']).trim(),
      message: 'Subject\n\nFull message', files: [{ path: 'detail.txt', status: 'A' }],
    } })
    const diff = await mounted.call('getCommitDiff', { hash, path: 'detail.txt' })
    expect(diff.status).toBe(200)
    const result = diff.json as { ok: true; value: import('../src/core/types.ts').DiffResult }
    expect(Object.keys(result)).toEqual(['ok', 'value'])
    expect(Object.keys(result.value).sort()).toEqual(['empty', 'file', 'path', 'side'])
    expect(result).toMatchObject({ ok: true, value: { path: 'detail.txt', side: 'unstaged', empty: false, file: { added: 1 } } })
    expect(await mounted.call('getCommitDiff', { hash, path: 'absent.txt' })).toMatchObject({
      status: 200, json: { ok: true, value: { path: 'absent.txt', side: 'unstaged', empty: true, file: null } },
    })
    expect(await mounted.call('getCommitDetails', { hash: 'HEAD' })).toMatchObject({ status: 200, json: { ok: false, failure: { code: 'invalid-name' }, degraded: null } })
    expect(await mounted.call('getCommitDiff', { hash, path: '../escape' })).toMatchObject({ status: 200, json: { ok: false, failure: { code: 'path-missing' }, degraded: null } })
  })

  it('getDiff returns the file under value', async () => {
    const fixture = open('unstaged')
    const { json } = await mount(serviceFor(fixture.dir)).call('getDiff', {
      path: 'src/app.ts',
      side: 'unstaged',
    })
    const value = (json as { ok: true; value: { path: string; side: string; file: { added: number } } }).value
    expect(value).toMatchObject({ path: 'src/app.ts', side: 'unstaged' })
    expect(value.file.added).toBe(1)
  })

  it('getFileChanges returns the whole file with its changed lines', async () => {
    const fixture = open('clean')
    fixture.write('src/app.ts', 'export const app = 1\nexport const added = true\n')
    const { json } = await mount(serviceFor(fixture.dir)).call('getFileChanges', {
      path: 'src/app.ts',
      side: 'unstaged',
    })
    const value = (json as { value: FileChanges }).value
    expect(value.text).toBe('export const app = 1\nexport const added = true\n')
    expect(value.language).toBe('typescript')
    expect(value.markers).toEqual([{ line: 2, kind: 'added' }])
    expect(value).toMatchObject({ side: 'unstaged', binary: false, truncated: false, deleted: false })
    expect(value.absolutePath).toBe(join(fixture.dir, 'src/app.ts'))
  })

  it('getFileChanges serves a deleted file from the index with every line removed', async () => {
    const fixture = open('clean')
    const content = fixture.gitOk(['show', 'HEAD:src/app.ts'])
    fixture.gitOk(['rm', '-q', '--', 'src/app.ts'])
    const { json } = await mount(serviceFor(fixture.dir)).call('getFileChanges', {
      path: 'src/app.ts',
      side: 'unstaged',
    })
    const value = (json as { value: FileChanges }).value
    expect(value.deleted).toBe(true)
    expect(value.text).toBe(content)
    expect(value.markers.every((marker: { kind: string }) => marker.kind === 'removed')).toBe(true)
    expect(value.markers.length).toBe(content.replace(/\n$/, '').split('\n').length)
  })

  it('getFileChanges defaults an unknown side to unstaged', async () => {
    const fixture = open('unstaged')
    const { json } = await mount(serviceFor(fixture.dir)).call('getDiff', {
      path: 'src/app.ts',
      side: 'nonsense',
    })
    expect((json as { value: { side: string } }).value.side).toBe('unstaged')
  })

  it('getHistory returns recent current-checkout commits, lanes and an immutable anchor', async () => {
    const fixture = open('clean')
    const head = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    const { status, json } = await mount(serviceFor(fixture.dir)).call('getHistory', { limit: 5 })
    const envelope = json as { ok: true; value: import('../src/core/types.ts').HistoryPage }
    expect(status).toBe(200)
    expect(Object.keys(envelope)).toEqual(['ok', 'value'])
    expect(envelope.ok).toBe(true)
    expect(Object.keys(envelope.value).sort()).toEqual(['anchor', 'commits', 'hasMore', 'lanes'])
    expect(envelope.value.anchor).toBe(head)
    expect(envelope.value.commits[0]?.hash).toBe(head)
    expect(envelope.value.commits).toHaveLength(2)
    expect(envelope.value.lanes).toHaveLength(2)
    expect(envelope.value.hasMore).toBe(false)
  })

  it('getHistory preserves its pagination anchor after a new commit', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const original = fixture.gitOk(['rev-list', 'HEAD']).trim().split('\n')
    const first = (await mounted.call('getHistory', { limit: 1 })).json as { ok: true; value: import('../src/core/types.ts').HistoryPage }
    const anchor = first.value.anchor!
    const later = fixture.commit('later.txt', 'later', 'later change')
    const second = (await mounted.call('getHistory', { limit: 1, skip: 1, anchor })).json as typeof first
    expect(first).toMatchObject({ ok: true, value: { anchor, hasMore: true } })
    expect(second).toMatchObject({ ok: true, value: { anchor, hasMore: false } })
    expect([...first.value.commits, ...second.value.commits].map(commit => commit.hash)).toEqual(original)
    expect((await mounted.call('getHistory', { limit: 1 })).json).toMatchObject({ ok: true, value: { anchor: later, commits: [{ hash: later }] } })
  })

  it('getHistory rejects non-commit pagination anchors', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    for (const anchor of ['main', 'HEAD', 'refs/tags/v1', '--all', '', 42, null]) {
      expect(await mounted.call('getHistory', { anchor })).toMatchObject({
        status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
      })
    }
  })

  it('preflight returns a decision', async () => {
    const fixture = open('unstaged')
    const { json } = await mount(serviceFor(fixture.dir)).call('preflight', { action: 'merge' })
    expect(json).toMatchObject({ ok: true, value: { verdict: 'block', code: 'dirty-tree' } })
  })

  it('draftMessage returns a string', async () => {
    const fixture = open('staged')
    const { json } = await mount(serviceFor(fixture.dir)).call('draftMessage')
    expect(json).toEqual({ ok: true, value: 'Update src: app.ts' })
  })

  it('agentFiles returns files with patches', async () => {
    const fixture = open('untracked')
    const { json } = await mount(serviceFor(fixture.dir)).call('agentFiles')
    const value = (json as { value: { files: { path: string }[] } }).value
    expect(value.files.map((file) => file.path)).toContain('docs/notes.md')
  })

  it('localBranchNames and remoteCheckoutCandidates answer arrays', async () => {
    const fixture = open('branches')
    const mounted = mount(serviceFor(fixture.dir))
    expect((await mounted.call('localBranchNames')).json).toEqual({
      ok: true,
      value: ['alpha', 'beta', 'main'],
    })
    expect((await mounted.call('remoteCheckoutCandidates')).json).toEqual({ ok: true, value: [] })
  })
})

describe('write envelopes', () => {
  it('stage, commit and unstage round-trip through the envelopes', async () => {
    const fixture = open('untracked')
    fixture.write('src/app.ts', 'export const app = 77\n')
    const mounted = mount(serviceFor(fixture.dir))
    const staged = (await mounted.call('stage', { paths: ['src/app.ts'] })).json as {
      ok: true
      value: { changes: { staged: { path: string }[] } }
    }
    expect(staged.value.changes.staged.map((entry) => entry.path)).toContain('src/app.ts')
    const committed = (await mounted.call('commit', { message: 'feat: raise app' })).json as {
      ok: true
      value: { head: { oid: string } }
    }
    expect(committed.value.head.oid).toBe(fixture.gitOk(['rev-parse', 'HEAD']).trim())
    const unstaged = (await mounted.call('unstage', { paths: ['docs/notes.md'] })).json
    expect(unstaged).toMatchObject({ ok: true })
  })

  it('reports a failing hook as a failure envelope with its output', async () => {
    const fixture = open('hook-fail')
    const { status, json } = await mount(serviceFor(fixture.dir)).call('commit', { message: 'feat: nope' })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: false, failure: { code: 'hook-failed' } })
    expect((json as { failure: { detail: string } }).failure.detail).toContain('fixture pre-commit refused')
  })

  it('cancelCommit reports whether anything was in flight', async () => {
    const fixture = open('clean')
    const { json } = await mount(serviceFor(fixture.dir)).call('cancelCommit', { requestId: 'nothing' })
    expect(json).toEqual({ ok: true, value: { cancelled: false } })
  })

  it('branchCreate and branchSwitch round-trip', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    expect((await mounted.call('branchCreate', { name: 'feature' })).json).toMatchObject({ ok: true })
    const switched = (await mounted.call('branchSwitch', { name: 'feature' })).json as {
      value: { head: { branch: string } }
    }
    expect(switched.value.head.branch).toBe('feature')
    expect((await mounted.call('branchRename', { from: 'feature', to: 'feat' })).json).toMatchObject({ ok: true })
    expect((await mounted.call('branchDelete', { name: 'main', force: true })).json).toMatchObject({ ok: true })
  })

  it('worktreeAdd returns the plan, state, setup and notice', async () => {
    const fixture = open('clean')
    const { json } = await mount(serviceFor(fixture.dir)).call('worktreeAdd', { name: 'Feature One' })
    const value = (json as { value: { plan: { slug: string; path: string }; state: unknown; setup: unknown; notice: unknown } }).value
    expect(value.plan.slug).toBe('feature-one')
    expect(value.plan.path).toBe(`${fixture.dir}/.worktrees/feature-one`)
    expect(value.setup).toEqual({ ran: 0, failed: false, output: '' })
    expect(value.notice).toBeNull()
  })

  it('worktreeSetup previews the declaration and worktreeAdd honors the approval', async () => {
    const fixture = open('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo one'] }))
    fixture.write('.worktreeinclude', '.env\n')
    fixture.write('.env', 'SECRET=1\n')
    const mounted = mount(serviceFor(fixture.dir))
    const preview = (await mounted.call('worktreeSetup', { name: 'setup-one' })).json as {
      value: { version: string; steps: unknown[]; includePaths: string[]; path: string; baseOid: string }
    }
    expect(preview.value.steps).toEqual([{ kind: 'command', command: 'echo one' }])
    expect(preview.value.includePaths).toEqual(['.env'])
    expect(preview.value.baseOid).toMatch(/^[0-9a-f]{40}$/)
    expect(preview.value.version).not.toBe('')

    const created = (await mounted.call('worktreeAdd', {
      name: 'setup-one',
      copyApproved: true,
      expectedSetupVersion: preview.value.version,
    })).json as { value: { copied: string[]; setup: { ran: number }; notice: string | null } }
    expect(created.value.copied).toEqual(['.env'])
    expect(created.value.setup.ran).toBe(0)
    expect(created.value.notice).toBe('setup-skipped')
  })

  it('refuses an approval that carries no setup version', async () => {
    const fixture = open('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo one'] }))
    const failed = (await mount(serviceFor(fixture.dir)).call('worktreeAdd', {
      name: 'stale',
      setupApproved: true,
    })).json as { ok: boolean; failure: { code: string } }
    expect(failed.ok).toBe(false)
    expect(failed.failure.code).toBe('setup-stale')
  })

  it('operation abort and commit checkout round-trip', async () => {
    const fixture = open('merge-conflict')
    const mounted = mount(serviceFor(fixture.dir))
    const aborted = (await mounted.call('operationAbort')).json as { value: { operation: { kind: unknown } } }
    expect(aborted.value.operation.kind).toBeNull()

    const clean = open('clean')
    const mountedClean = mount(serviceFor(clean.dir))
    const older = clean.gitOk(['rev-parse', 'HEAD~1']).trim()
    const checkedOut = (await mountedClean.call('checkoutCommit', { hash: older })).json as {
      value: { head: { detached: boolean } }
    }
    expect(checkedOut.value.head.detached).toBe(true)
  })

  it('updateFromBranch round-trips', async () => {
    const fixture = open('ahead-behind')
    const { json } = await mount(serviceFor(fixture.dir)).call('updateFromBranch')
    expect(json).toMatchObject({ ok: true })
    expect((json as { value: { head: { behind: number } } }).value.head.behind).toBe(0)
  })

  it('worktreeMerge, worktreeUpdate and worktreeRemove round-trip', async () => {
    const fixture = open('worktrees')
    const mounted = mount(serviceFor(fixture.dir))
    const ahead = `${fixture.dir}/.worktrees/ahead`
    expect((await mounted.call('worktreeUpdate', { path: ahead })).json).toMatchObject({ ok: true })
    expect((await mounted.call('worktreeMerge', { path: ahead })).json).toMatchObject({ ok: true })
    const ready = `${fixture.dir}/.worktrees/ready`
    expect((await mounted.call('worktreeRemove', { path: ready, force: true })).json).toMatchObject({ ok: true })
  })

  it('worktreeAdd creates from a picked ref, and the base override rides getState', async () => {
    const fixture = open('clean')
    fixture.gitOk(['branch', 'wk-existing'])
    const mounted = mount(serviceFor(fixture.dir))
    const created = (await mounted.call('worktreeAdd', {
      mode: 'ref',
      ref: 'wk-existing',
      refKind: 'branch',
    })).json as { value: { plan: { slug: string; branch: string } } }
    expect(created.value.plan).toMatchObject({ slug: 'wk-existing', branch: 'wk-existing' })

    const read = (await mounted.call('getState', { base: 'main' })).json as {
      value: { state: { worktreeBase: { name: string; source: string } } }
    }
    expect(read.value.state.worktreeBase).toMatchObject({ name: 'main', source: 'panel' })
  })

  it('worktreeUnlock and worktreePrune round-trip', async () => {
    const fixture = open('worktrees')
    const mounted = mount(serviceFor(fixture.dir))
    const ready = `${fixture.dir}/.worktrees/ready`
    fixture.gitOk(['worktree', 'lock', ready])
    expect((await mounted.call('worktreeUnlock', { path: ready })).json).toMatchObject({ ok: true })
    expect((await mounted.call('worktreePrune', {})).json).toMatchObject({ ok: true })
  })

  it('discard deletes an untracked file', async () => {
    const fixture = open('untracked')
    const { json } = await mount(serviceFor(fixture.dir)).call('discard', { paths: ['docs/notes.md'] })
    expect(json).toMatchObject({ ok: true })
  })
})

describe('host safety RPC contracts', () => {
  it('commits all changes through one host call and returns a PanelState', async () => {
    const fixture = open('unstaged')
    const mounted = mount(serviceFor(fixture.dir))
    const result = await mounted.call('commitAll', { message: 'atomic bulk', requestId: 'client-unique' })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, value: { root: fixture.dir, changes: { staged: [], unstaged: [] } } })
    expect(fixture.gitOk(['log', '-1', '--format=%s']).trim()).toBe('atomic bulk')
  })

  it('returns named failures for unresolved bulk commits and explicit empty path lists', async () => {
    const fixture = open('merge-conflict')
    const mounted = mount(serviceFor(fixture.dir))
    expect((await mounted.call('commitAll', { message: 'unsafe' })).json).toMatchObject({ ok: false, failure: { code: 'operation-in-progress' }, degraded: null })
    expect((await mounted.call('commitAll', { message: 'empty', paths: [] })).json).toMatchObject({ ok: false, failure: { code: 'path-missing' }, degraded: null })
    expect((await mounted.call('commitAll', { message: 'bad path type', paths: 'README.md' })).json).toMatchObject({ ok: false, failure: { code: 'path-missing' }, degraded: null })
    expect(fixture.gitOk(['ls-files', '--unmerged'])).not.toBe('')
  })

  it('forwards cancellation session ownership without an unscoped fallback', async () => {
    const fixture = open('clean')
    const cancellations = new CancellationRegistry()
    const git = new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => fixture.dir, platform: process.platform, env: process.env, cancellations })
    const signal = cancellations.begin('commit', 'owner')
    const mounted = mount(git)
    expect((await mounted.call('cancelCommit', { requestId: 'commit', sessionId: 'other' })).json).toEqual({ ok: true, value: { cancelled: false } })
    expect(signal.aborted).toBe(false)
    expect((await mounted.call('cancelCommit', { requestId: 'commit', sessionId: 'owner' })).json).toEqual({ ok: true, value: { cancelled: true } })
    expect(signal.aborted).toBe(true)
  })
})

describe('method inventory', () => {
  it.each(['historyAgentContext', 'revert', 'cherryPick'])('rejects removed history command %s as unknown', async method => {
    const fixture = open('clean')
    expect(await mount(serviceFor(fixture.dir)).call(method, { approved: true })).toEqual({
      status: 404, json: null, raw: `no such method: ${method}`,
    })
  })

  it('dispatches every documented method', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const head = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    const older = fixture.gitOk(['rev-parse', 'HEAD~1']).trim()
    const operationId = '00000000-0000-4000-8000-000000000000'
    const calls: [string, Record<string, unknown>][] = [
      ['getState', {}],
      ['refSummary', {}],
      ['getDiff', { path: 'README.md', side: 'unstaged' }],
      ['getFileChanges', { path: 'README.md', side: 'unstaged' }],
      ['getHistory', {}],
      ['preflight', { action: 'merge' }],
      ['stage', { paths: ['README.md'] }],
      ['unstage', { paths: ['README.md'] }],
      ['discard', { paths: ['README.md'] }],
      ['commit', { message: 'chore: nothing' }],
      ['commitAll', { message: 'chore: nothing' }],
      ['cancelCommit', { requestId: 'x' }],
      ['draftMessage', {}],
      ['agentFiles', {}],
      ['worktreeAdd', { name: 'inventory-one' }],
      ['worktreeRemove', { path: `${fixture.dir}/.worktrees/inventory-one`, force: true }],
      ['worktreeMerge', { path: `${fixture.dir}/.worktrees/inventory-one` }],
      ['worktreeUpdate', { path: `${fixture.dir}/.worktrees/inventory-one` }],
      ['worktreePrune', {}],
      ['worktreeUnlock', { path: `${fixture.dir}/.worktrees/inventory-one` }],
      ['branchCreate', { name: 'inventory-branch' }],
      ['branchSwitch', { name: 'inventory-branch' }],
      ['branchRename', { from: 'inventory-branch', to: 'inventory-branch-2' }],
      ['branchDelete', { name: 'inventory-branch-2' }],
      ['operationContinue', {}],
      ['operationAbort', {}],
      ['updateFromBranch', {}],
      ['getCommitDetails', { hash: 'HEAD' }],
      ['getCommitDiff', { hash: 'HEAD', path: 'README.md' }],
      ['checkoutCommit', { hash: 'HEAD' }],
      ['remoteCheckoutCandidates', {}],
      ['localBranchNames', {}],
      ['compareCommits', { from: older, to: head }],
      ['previewHistory', { action: 'cherry-pick', commits: [head] }],
      ['executeHistory', { operationId, approved: true }],
      ['historyOperationStatus', { operationId }],
      ['recoverHistory', { operationId, action: 'cancel' }],
    ]
    for (const [method, args] of calls) {
      const { status, raw } = await mounted.call(method, args)
      expect(status, `${method} should be dispatched`).toBe(200)
      expect(raw, `${method} should answer an envelope`).toMatch(/"ok":(true|false)/)
    }
  })

  it('refuses wrongly typed arguments instead of failing open', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const args = { path: 42, paths: 'nope', message: 7, name: null, hash: 9 }
    // A write with no usable arguments is a named failure, never a silent
    // success with nothing done.
    for (const method of ['stage', 'unstage', 'discard', 'commit', 'commitAll', 'worktreeAdd', 'branchCreate', 'checkoutCommit']) {
      const { status, json } = await mounted.call(method, args)
      expect(status, method).toBe(200)
      expect(json, method).toMatchObject({ ok: false })
      expect((json as { failure: { code: string } }).failure.code, method).toBeTypeOf('string')
    }
    // Reads degrade to an empty answer rather than an error envelope.
    expect(await mounted.call('getDiff', args)).toMatchObject({ status: 200 })
    expect(await mounted.call('getFileChanges', args)).toMatchObject({ status: 200 })
    expect(await mounted.call('getHistory', args)).toMatchObject({ status: 200 })
  })
})

describe('history engine RPC contracts', () => {
  it('compares two commits under an exact compareCommits envelope', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const from = fixture.gitOk(['rev-parse', 'HEAD~1']).trim()
    const to = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    const { status, json } = await mounted.call('compareCommits', { from, to })
    expect(status).toBe(200)
    const envelope = json as { ok: true; value: import('../src/core/history-view.ts').CommitComparison }
    expect(Object.keys(envelope)).toEqual(['ok', 'value'])
    expect(Object.keys(envelope.value).sort()).toEqual(['from', 'patch', 'summary', 'to', 'truncated'])
    expect(envelope.value).toMatchObject({ from, to, truncated: false })
    expect(envelope.value.summary).toContain('src/app.ts')
    expect(envelope.value.patch).toContain('+export const app = 1')
    expect(await mounted.call('compareCommits', { from: 'HEAD', to })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' }, degraded: null },
    })
  })

  it('previews, executes, reports and restores a history plan through the envelopes', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const head = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    const preview = (await mounted.call('previewHistory', { action: 'revert', commits: [head] })).json as {
      ok: true; value: import('../src/core/history-plan.ts').HistoryPreview
    }
    expect(preview.ok).toBe(true)
    expect(preview.value).toMatchObject({ requiresPublishedAcknowledgment: false, plan: { action: 'revert', selected: [head], rewrites: false } })
    expect(preview.value.permission).toMatchObject({ authority: 'apply-approved-history-plan' })

    expect(await mounted.call('executeHistory', { operationId: preview.value.operationId })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' }, degraded: null },
    })

    const executed = (await mounted.call('executeHistory', { operationId: preview.value.operationId, approved: true })).json as {
      ok: true; value: import('../src/core/history-plan.ts').HistoryStatus
    }
    expect(executed).toMatchObject({ ok: true, value: { phase: 'completed', canRestore: true, error: null } })
    expect(executed.value.currentHead).not.toBe(head)

    const reported = (await mounted.call('historyOperationStatus', { operationId: preview.value.operationId })).json as {
      ok: true; value: import('../src/core/history-plan.ts').HistoryStatus
    }
    expect(reported).toMatchObject({ ok: true, value: { phase: 'completed', currentHead: executed.value.currentHead } })

    const restored = (await mounted.call('recoverHistory', {
      operationId: preview.value.operationId, action: 'restore', approved: true,
    })).json as { ok: true; value: import('../src/core/history-plan.ts').HistoryStatus }
    expect(restored).toMatchObject({ ok: true, value: { phase: 'recovered', currentHead: head } })
  })

  it('guards unapproved execution and unknown or unapproved recovery actions', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const operationId = '00000000-0000-4000-8000-000000000000'
    expect(await mounted.call('executeHistory', { operationId })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
    })
    expect(await mounted.call('recoverHistory', { operationId, action: 'abort' })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
    })
    expect(await mounted.call('recoverHistory', { operationId, action: 'restore' })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
    })
    expect(await mounted.call('recoverHistory', { operationId, action: 'nope' })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
    })
    expect(await mounted.call('previewHistory', { action: 'exec', commits: [] })).toMatchObject({
      status: 200, json: { ok: false, failure: { code: 'invalid-name' } },
    })
  })
})

describe('conflict workspace RPC contracts', () => {
  it('preserves split UTF-8 resolution bytes, versions, and explicit staging', async () => {
    const fixture = createFixture('merge-conflict')
    try {
      const mounted = mount(serviceFor(fixture.dir))
      const inspected = (await mounted.call('getConflict', { path: 'src/app.ts' })).json as { ok: boolean; value: import('../src/core/conflict-types.ts').ConflictWorkspace }
      expect(inspected.ok).toBe(true)
      expect(inspected.value).toMatchObject({ path: 'src/app.ts', canSave: true, canMarkResolved: false })
      const content = 'export const message = "résolution"\n'
      const body = Buffer.from(JSON.stringify({ method: 'saveConflict', args: { sessionId: 'test-session', path: 'src/app.ts', expectedVersion: inspected.value.version, content } }))
      const split = body.indexOf(Buffer.from('é')) + 1
      const response = await mounted.raw({ chunks: [body.subarray(0, split), body.subarray(split)] })
      const saved = JSON.parse(response.body) as { ok: boolean; value: import('../src/core/conflict-types.ts').ConflictWriteResult }
      expect(saved).toMatchObject({ ok: true, value: { workspace: { worktree: { content }, canMarkResolved: true }, backupId: expect.any(String) } })
      expect(fixture.gitOk(['ls-files', '-u'])).not.toBe('')
      expect(await mounted.call('markConflictResolved', { path: 'src/app.ts', expectedVersion: saved.value.workspace.version })).toMatchObject({ json: { ok: true, value: { resolved: true, path: 'src/app.ts', backupId: expect.any(String) } } })
      expect(fixture.gitOk(['show', ':0:src/app.ts'])).toBe(content)
      expect(fixture.gitOk(['ls-files', '-u'])).toBe('')
    } finally { fixture.dispose() }
  })

  it('rejects stale writes and invalid content/side without changing files', async () => {
    const fixture = createFixture('merge-conflict')
    try {
      const mounted = mount(serviceFor(fixture.dir))
      const inspected = (await mounted.call('getConflict', { path: 'src/app.ts' })).json as { value: import('../src/core/conflict-types.ts').ConflictWorkspace }
      const args = { path: 'src/app.ts', expectedVersion: inspected.value.version }
      expect(await mounted.call('saveConflict', { ...args, content: 42 })).toMatchObject({ json: { ok: false, failure: { code: 'invalid-name' } } })
      expect(await mounted.call('chooseConflict', { ...args, side: 'anything' })).toMatchObject({ json: { ok: false, failure: { code: 'invalid-name' } } })
      const chosen = (await mounted.call('chooseConflict', { ...args, side: 'incoming' })).json as { ok: boolean; value: import('../src/core/conflict-types.ts').ConflictWriteResult }
      expect(chosen).toMatchObject({ ok: true, value: { workspace: { canMarkResolved: true } } })
      expect(await mounted.call('saveConflict', { ...args, content: 'stale' })).toMatchObject({ json: { ok: false, failure: { code: 'dirty-tree' } } })
    } finally { fixture.dispose() }
  })
})

describe('failure envelope helper', () => {
  it('classifies a GitError and a plain throw', () => {
    const named = envelopeFor(new GitError({ code: 'not-a-repository', detail: '/tmp' }))
    expect(named).toEqual({
      ok: false,
      failure: { code: 'not-a-repository', detail: '/tmp' },
      degraded: {
        code: 'not-a-repository',
        detail: '/tmp',
        requiredVersion: null,
        installedVersion: null,
      },
    })
    // A session the host has not loaded yet is named and never degraded, so the
    // panel retries it instead of latching the no-repository state.
    expect(envelopeFor(new GitError({ code: 'session-not-ready', detail: 'session has no working directory' }))).toEqual({
      ok: false,
      failure: { code: 'session-not-ready', detail: 'session has no working directory' },
      degraded: null,
    })
    expect(envelopeFor(new Error('boom'))).toEqual({
      ok: false,
      failure: { code: 'git-failed', detail: 'boom' },
      degraded: null,
    })
    expect(envelopeFor('weird')).toMatchObject({ ok: false, failure: { code: 'git-failed', detail: 'weird' } })
  })

  it('keeps a history plan refusal as a named failure with the plan sentence', () => {
    // Without this mapping the panel can only say "the request failed" while
    // the engine knew exactly what to change.
    expect(envelopeFor(new HistoryOperationError('dirty-checkout', 'Tracked files, the index and untracked files must all be clean; no automatic stash is performed.')))
      .toEqual({
        ok: false,
        failure: { code: 'dirty-tree', detail: 'Tracked files, the index and untracked files must all be clean; no automatic stash is performed.' },
        degraded: null,
      })
    for (const [reason, code] of [['hidden-index-state', 'dirty-tree'], ['active-operation', 'operation-in-progress'], ['incomplete-operation', 'operation-in-progress'], ['root-unsupported', 'invalid-name'], ['noncontiguous-selection', 'invalid-name']] as const) {
      expect(envelopeFor(new HistoryOperationError(reason, 'detail'))).toMatchObject({ failure: { code, detail: 'detail' } })
    }
    expect(envelopeFor(new HistoryOperationError('unsafe-editor-path', 'detail'))).toMatchObject({ failure: { code: 'git-failed' } })
  })
})
