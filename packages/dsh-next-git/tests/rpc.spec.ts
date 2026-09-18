import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createFixture, createNonRepository, type GitFixture } from './git-fixture.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { envelopeFor, registerRpc, RPC_PATH } from '../src/host/rpc.ts'
import { GitError } from '../src/host/git-runner.ts'

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
  raw: (options: { method?: string; body?: string; explode?: boolean; huge?: boolean }) => Promise<FakeResponse>
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
      ? 'x'.repeat(2 * 1024 * 1024)
      : options.explode === true
        ? '{'
        : (options.body ?? '')
    if (!response.writableEnded) {
      for (const listener of listeners.data ?? []) listener(payload)
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

describe('read envelopes', () => {
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

  it('getDiff defaults an unknown side to unstaged', async () => {
    const fixture = open('unstaged')
    const { json } = await mount(serviceFor(fixture.dir)).call('getDiff', {
      path: 'src/app.ts',
      side: 'nonsense',
    })
    expect((json as { value: { side: string } }).value.side).toBe('unstaged')
  })

  it('getHistory returns commits and lanes', async () => {
    const fixture = open('clean')
    const { json } = await mount(serviceFor(fixture.dir)).call('getHistory', { limit: 5 })
    const value = (json as { value: { commits: unknown[]; lanes: unknown[]; hasMore: boolean } }).value
    expect(value.commits).toHaveLength(2)
    expect(value.lanes).toHaveLength(2)
    expect(value.hasMore).toBe(false)
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

  it('operation and history writes round-trip', async () => {
    const fixture = open('merge-conflict')
    const mounted = mount(serviceFor(fixture.dir))
    const aborted = (await mounted.call('operationAbort')).json as { value: { operation: { kind: unknown } } }
    expect(aborted.value.operation.kind).toBeNull()

    const clean = open('clean')
    const mountedClean = mount(serviceFor(clean.dir))
    const head = clean.gitOk(['rev-parse', 'HEAD']).trim()
    expect((await mountedClean.call('revert', { hash: head })).json).toMatchObject({ ok: true })
    const older = clean.gitOk(['rev-parse', 'HEAD~1']).trim()
    const checkedOut = (await mountedClean.call('checkoutCommit', { hash: older })).json as {
      value: { head: { detached: boolean } }
    }
    expect(checkedOut.value.head.detached).toBe(true)
    clean.gitOk(['checkout', '-q', 'main'])
    expect((await mountedClean.call('cherryPick', { hash: older })).json).toMatchObject({ ok: true })
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

describe('method inventory', () => {
  it('dispatches every documented method', async () => {
    const fixture = open('clean')
    const mounted = mount(serviceFor(fixture.dir))
    const calls: [string, Record<string, unknown>][] = [
      ['getState', {}],
      ['getDiff', { path: 'README.md', side: 'unstaged' }],
      ['getHistory', {}],
      ['preflight', { action: 'merge' }],
      ['stage', { paths: ['README.md'] }],
      ['unstage', { paths: ['README.md'] }],
      ['discard', { paths: ['README.md'] }],
      ['commit', { message: 'chore: nothing' }],
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
      ['revert', { hash: 'HEAD' }],
      ['cherryPick', { hash: 'HEAD' }],
      ['checkoutCommit', { hash: 'HEAD' }],
      ['remoteCheckoutCandidates', {}],
      ['localBranchNames', {}],
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
    for (const method of ['stage', 'unstage', 'discard', 'commit', 'worktreeAdd', 'branchCreate', 'revert']) {
      const { status, json } = await mounted.call(method, args)
      expect(status, method).toBe(200)
      expect(json, method).toMatchObject({ ok: false })
      expect((json as { failure: { code: string } }).failure.code, method).toBeTypeOf('string')
    }
    // Reads degrade to an empty answer rather than an error envelope.
    expect(await mounted.call('getDiff', args)).toMatchObject({ status: 200 })
    expect(await mounted.call('getHistory', args)).toMatchObject({ status: 200 })
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
    expect(envelopeFor(new Error('boom'))).toEqual({
      ok: false,
      failure: { code: 'git-failed', detail: 'boom' },
      degraded: null,
    })
    expect(envelopeFor('weird')).toMatchObject({ ok: false, failure: { code: 'git-failed', detail: 'weird' } })
  })
})
