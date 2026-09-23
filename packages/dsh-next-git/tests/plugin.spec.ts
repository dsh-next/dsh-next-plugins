import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createFixture, type GitFixture } from './git-fixture.ts'
import { apply, GIT_SERVICE_KEY, inject, WORKTREES_SERVICE_KEY, type ReclaimFace } from '../src/index.ts'
import { RPC_PATH } from '../src/host/rpc.ts'
import { GitService } from '../src/host/git-service.ts'

/**
 * Host-entry wiring: what the profile tree gains when this plugin mounts.
 *
 * The two service keys are the point of this suite. `dsh-next-checkpoints`
 * looks up `dsh-next-worktrees` structurally and calls `reclaim(from, to)`;
 * if this plugin stops providing that key, checkpoint rewind breaks silently
 * in that other package.
 */

interface Mounted {
  provides: Map<string, unknown>
  routes: { kind: string; path: string; handler?: unknown }[]
  disposers: (() => void)[]
  warnings: string[]
}

function mount(cwd: string | undefined, settings?: unknown): Mounted {
  const provides = new Map<string, unknown>()
  const routes: { kind: string; path: string; handler?: unknown }[] = []
  const disposers: (() => void)[] = []
  const warnings: string[] = []
  const ctx = {
    get: (name: string) => {
      if (name === 'webServer') {
        return {
          register(route: { kind: string; path: string; handler?: unknown }) {
            routes.push(route)
            return () => {}
          },
        }
      }
      if (name === 'sessions') {
        return { get: (id: string) => (id === 'known' && cwd !== undefined ? { header: { cwd } } : undefined) }
      }
      if (name === 'settings') return settings
      return undefined
    },
    provide: (name: string, value: unknown) => {
      provides.set(name, value)
    },
    effect: (run: () => unknown) => {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as Context
  apply(ctx)
  return { provides, routes, disposers, warnings }
}

const fixtures: GitFixture[] = []
function repo(scenario: Parameters<typeof createFixture>[0]): GitFixture {
  const fixture = createFixture(scenario)
  fixtures.push(fixture)
  return fixture
}

describe('host entry', () => {
  it('declares the services it needs', () => {
    expect([...inject]).toEqual(['webServer', 'sessions', 'settings', 'llm', 'sessionController'])
  })

  it('provides the plugin key with the git service', () => {
    const fixture = repo('clean')
    const mounted = mount(fixture.dir)
    expect(mounted.provides.has(GIT_SERVICE_KEY)).toBe(true)
    expect(mounted.provides.get(GIT_SERVICE_KEY)).toBeInstanceOf(GitService)
  })

  it('keeps the retired worktrees key alive for reset and checkpoints', async () => {
    const fixture = repo('worktrees')
    const worktree = `${fixture.dir}/.worktrees/ready`
    const mounted = mount(worktree)
    const face = mounted.provides.get(WORKTREES_SERVICE_KEY) as ReclaimFace
    expect(face).toBeDefined()
    expect(typeof face.reclaim).toBe('function')
    // Called exactly the way dsh-next-checkpoints calls it.
    const result = await face.reclaim('parent', 'known')
    expect(result.claimed).toBe(true)
    expect(result.branch).toBe('dsh-git/ready')
  })

  it('skips reclaim when the new session has no working directory', async () => {
    const mounted = mount(undefined)
    const face = mounted.provides.get(WORKTREES_SERVICE_KEY) as ReclaimFace
    expect(await face.reclaim('parent', 'known')).toEqual({
      claimed: false,
      reason: 'not-a-worktree',
      path: null,
      branch: null,
    })
  })

  it('stays mounted when the settings service lacks namespace registration', () => {
    const mounted = mount(undefined, { writable: true })
    expect(mounted.provides.get(GIT_SERVICE_KEY)).toBeInstanceOf(GitService)
    expect(mounted.routes).toHaveLength(1)
    expect(mounted.warnings).toContain(
      'dsh-next-git: drafting preferences are read-only in this runtime',
    )
  })

  it('registers the RPC route', () => {
    const fixture = repo('clean')
    const mounted = mount(fixture.dir)
    expect(mounted.routes).toHaveLength(1)
    expect(mounted.routes[0]).toMatchObject({ kind: 'exact', path: RPC_PATH })
    expect(typeof mounted.routes[0]!.handler).toBe('function')
  })

  it('disposes its cancellation registry on unload', () => {
    const fixture = repo('clean')
    const mounted = mount(fixture.dir)
    expect(mounted.disposers.length).toBeGreaterThan(0)
    // Disposal must not throw, and a second call is harmless.
    for (const dispose of mounted.disposers) dispose()
    for (const dispose of mounted.disposers) dispose()
  })

  it('mounts without a webServer or sessions service', () => {
    const ctx = {
      get: () => undefined,
      provide: () => {},
      effect: (run: () => unknown) => {
        run()
      },
      logger: { warn: () => {} },
    } as unknown as Context
    expect(() => apply(ctx)).not.toThrow()
  })

  it('cleans up every fixture it opened', () => {
    for (const fixture of fixtures.splice(0)) fixture.dispose()
    expect(fixtures).toHaveLength(0)
  })
})
