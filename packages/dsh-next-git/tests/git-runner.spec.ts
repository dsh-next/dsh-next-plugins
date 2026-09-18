import { describe, expect, it } from 'vitest'
import {
  CancellationRegistry,
  GitError,
  gitEnv,
  GitRunner,
  isGitError,
  isLockContention,
  LOCK_BACKOFF_MS,
  type ExecFn,
} from '../src/host/git-runner.ts'
import { classifyGitFailure, type RawGitOutcome } from '../src/core/degraded.ts'

/** A scripted executor that records every call. */
function scripted(outcomes: readonly RawGitOutcome[]): {
  exec: ExecFn
  calls: { args: readonly string[]; cwd: string; options: { timeoutMs: number; signal?: AbortSignal | undefined } }[]
  sleeps: number[]
} {
  const calls: { args: readonly string[]; cwd: string; options: { timeoutMs: number; signal?: AbortSignal | undefined } }[] = []
  const queue = [...outcomes]
  const exec: ExecFn = async (_file, args, options) => {
    calls.push({ args, cwd: options.cwd, options })
    return queue.shift() ?? { code: 0, stdout: '', stderr: '' }
  }
  return { exec, calls, sleeps: [] }
}

const ok = (stdout = ''): RawGitOutcome => ({ code: 0, stdout, stderr: '' })
const fail = (stderr: string, code = 1): RawGitOutcome => ({ code, stdout: '', stderr })

describe('git runner', () => {
  it('runs git and returns the raw outcome', async () => {
    const { exec, calls } = scripted([ok('main\n')])
    const runner = new GitRunner(exec)
    const outcome = await runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo', { timeoutMs: 1234 })
    expect(outcome).toMatchObject({ code: 0, stdout: 'main\n' })
    expect(calls[0]!.options.timeoutMs).toBe(1234)
    expect(calls[0]!.cwd).toBe('/repo')
  })

  it('throws a classified GitError from runOk and returns null from runSoft', async () => {
    const runner = new GitRunner(scripted([fail('fatal: not a git repository')]).exec)
    await expect(runner.runOk(['status'], '/tmp')).rejects.toBeInstanceOf(GitError)
    const soft = new GitRunner(scripted([fail('fatal: not a git repository')]).exec)
    expect(await soft.runSoft(['status'], '/tmp')).toBeNull()
    const again = new GitRunner(scripted([fail('fatal: not a git repository')]).exec)
    expect(await again.ok(['status'], '/tmp')).toBe(false)
    const good = new GitRunner(scripted([ok()]).exec)
    expect(await good.ok(['status'], '/tmp')).toBe(true)
  })

  it('carries the classified failure on the error', async () => {
    const runner = new GitRunner(scripted([fail("fatal: Unable to create '/repo/.git/index.lock': File exists.")]).exec)
    try {
      await runner.runOk(['add', '--', 'a.ts'], '/repo')
      throw new Error('should have thrown')
    } catch (error) {
      expect(isGitError(error)).toBe(true)
      if (!isGitError(error)) return
      expect(error.failure.code).toBe('index-locked')
      expect(isLockContention(error.failure)).toBe(true)
    }
  })

  it('retries an index.lock collision with backoff and then succeeds', async () => {
    const { exec, calls, sleeps } = scripted([
      fail("fatal: Unable to create '/repo/.git/index.lock': File exists."),
      fail("fatal: Unable to create '/repo/.git/index.lock': File exists."),
      ok('done'),
    ])
    const runner = new GitRunner(exec, async (ms) => {
      sleeps.push(ms)
    })
    const outcome = await runner.run(['add', '--', 'a.ts'], '/repo', { lockRetries: 4 })
    expect(outcome.code).toBe(0)
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([LOCK_BACKOFF_MS[0], LOCK_BACKOFF_MS[1]])
  })

  it('does not retry a failure that is not lock contention', async () => {
    const { exec, calls } = scripted([fail('fatal: pathspec did not match')])
    const runner = new GitRunner(exec, async () => {})
    await runner.run(['add', '--', 'a.ts'], '/repo', { lockRetries: 3 })
    expect(calls).toHaveLength(1)
  })

  it('returns a cancellation outcome for an already-aborted signal', async () => {
    const { exec, calls } = scripted([ok()])
    const runner = new GitRunner(exec)
    const controller = new AbortController()
    controller.abort()
    const outcome = await runner.run(['status'], '/repo', { signal: controller.signal })
    expect(outcome).toMatchObject({ code: 130, killed: true, stderr: 'cancelled' })
    expect(calls).toHaveLength(0)
  })

  it('stops retrying once the signal aborts', async () => {
    const controller = new AbortController()
    const { exec, calls } = scripted([
      fail("fatal: Unable to create '/repo/.git/index.lock': File exists."),
      ok(),
    ])
    const runner = new GitRunner(exec, async () => {
      controller.abort()
    })
    await runner.run(['add', '--', 'a.ts'], '/repo', { lockRetries: 4, signal: controller.signal })
    expect(calls).toHaveLength(1)
  })
})

describe('mutation serialization', () => {
  it('runs mutations on one repository strictly in order', async () => {
    const runner = new GitRunner()
    const order: string[] = []
    const first = runner.mutate('/repo', async () => {
      order.push('first:start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first:end')
    })
    const second = runner.mutate('/repo', async () => {
      order.push('second:start')
      order.push('second:end')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('runs mutations on different repositories concurrently', async () => {
    const runner = new GitRunner()
    const order: string[] = []
    await Promise.all([
      runner.mutate('/a', async () => {
        order.push('a:start')
        await new Promise((resolve) => setTimeout(resolve, 20))
        order.push('a:end')
      }),
      runner.mutate('/b', async () => {
        order.push('b:start')
        order.push('b:end')
      }),
    ])
    expect(order).toEqual(['a:start', 'b:start', 'b:end', 'a:end'])
  })

  it('does not poison the chain when a mutation throws', async () => {
    const runner = new GitRunner()
    const failing = runner.mutate('/repo', async () => {
      throw new Error('boom')
    })
    const after = runner.mutate('/repo', async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ok')
  })

  it('forgets the chain once every waiter settled', async () => {
    const runner = new GitRunner()
    await runner.mutate('/repo', async () => undefined)
    // A second batch still works, which it would not if the key leaked a
    // resolved gate that never reopens.
    await expect(runner.mutate('/repo', async () => 1)).resolves.toBe(1)
  })
})

describe('cancellation registry', () => {
  it('aborts one request and reports whether it was in flight', () => {
    const registry = new CancellationRegistry()
    const signal = registry.begin('r1')
    expect(signal.aborted).toBe(false)
    expect(registry.cancel('r1')).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(registry.cancel('r1')).toBe(false)
  })

  it('aborts the previous controller when an id is reused', () => {
    const registry = new CancellationRegistry()
    const first = registry.begin('r1')
    registry.begin('r1')
    expect(first.aborted).toBe(true)
  })

  it('disposes every in-flight request', () => {
    const registry = new CancellationRegistry()
    const a = registry.begin('a')
    const b = registry.begin('b')
    registry.dispose()
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(true)
    expect(registry.cancel('a')).toBe(false)
  })
})

describe('git child environment', () => {
  it('disables prompts, pager and editor', () => {
    const env = gitEnv({ PATH: '/usr/bin', GIT_PAGER: 'less' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_PAGER).toBe('cat')
    expect(env.GIT_EDITOR).toBe('true')
    expect(env.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(env.LC_ALL).toBe('C')
  })

  it('drops undefined values', () => {
    const env = gitEnv({ PATH: '/usr/bin', HOME: undefined })
    expect('HOME' in env).toBe(false)
  })
})

describe('classification re-export', () => {
  it('exposes the classifier the runner uses', () => {
    expect(classifyGitFailure(fail('fatal: not a git repository')).code).toBe('not-a-repository')
  })
})
