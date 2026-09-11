// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { SoundDriver, type Backends } from '../src/host/sound-driver.ts'
import { SOUNDS } from '../src/core/sounds.ts'

const none: Backends = { win: null, sh: null, afplay: null, paplay: null, aplay: null }
const posix: Backends = { ...none, sh: '/bin/sh', afplay: '/bin/afplay' }
const windows: Backends = { ...none, win: 'powershell.exe' }
const success: SubprocessOutcome = { exitCode: 0, signal: null }
const sound = SOUNDS[0].id
const directory = (n: number) => '/tmp/dsh-next-notifier-test' + n
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
type Role = 'allocate' | 'write' | 'play' | 'cleanup'
function role(spec: SubprocessSpawnSpec): Role {
  if (spec.stdio.stdout === 'inherit') return 'play'
  if (typeof spec.stdio.stdin === 'object') return 'write'
  return spec.env?.DSH_NOTIFIER_DIR ? 'cleanup' : 'allocate'
}
function mockRuntime() {
  let count = 0
  const records: { spec: SubprocessSpawnSpec; handle: SubprocessHandle; role: Role }[] = []
  const hooks: Partial<Record<Role, (spec: SubprocessSpawnSpec) => Partial<SubprocessHandle>>> = {}
  const spawnMock = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    const kind = role(spec)
    const text = kind === 'allocate' ? directory(++count) : ''
    const handle: SubprocessHandle = {
      pid: count, stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
      done: Promise.resolve(success), terminate: vi.fn(), waitForExit: vi.fn(async () => true),
      ...hooks[kind]?.(spec),
    }
    records.push({ spec, handle, role: kind })
    return handle
  })
  const resolveExecutable = vi.fn(async (cmd: string) => '/bin/' + cmd)
  const runtime = { spawn: spawnMock, resolveExecutable } as unknown as SubprocessRuntime
  const calls = (kind: Role) => records.filter(r => r.role === kind)
  return { runtime, records, hooks, calls, spawnMock, resolveExecutable }
}

// Exercises the generated shell programs, not a second implementation of them.
function localRuntime(extraEnv: Record<string, string> = {}) {
  return {
    resolveExecutable: async (cmd: string) => cmd,
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd, env: { ...process.env, ...extraEnv, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'],
      })
      let text = ''
      child.stdout.on('data', data => { text += String(data) })
      const done = new Promise<SubprocessOutcome>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      child.stdin.on('error', () => {})
      child.stdin.end(typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : undefined)
      return {
        pid: child.pid ?? -1, stdin: undefined, stdout: undefined, stderr: undefined,
        collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
        done, terminate: () => { child.kill() }, waitForExit: async () => { await done; return true },
      }
    },
  } as unknown as SubprocessRuntime
}

describe('SoundDriver public contract', () => {
  it('detects all players and tolerates individual executable lookup failures', async () => {
    const mock = mockRuntime()
    mock.resolveExecutable.mockImplementation(async cmd => {
      if (cmd === 'powershell' || cmd === 'paplay') throw new Error('missing')
      return '/bin/' + cmd
    })
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.detect()).toEqual({ ...posix, aplay: '/bin/aplay' })
    expect(mock.resolveExecutable.mock.calls.map(c => c[0])).toEqual(['powershell', 'sh', 'afplay', 'paplay', 'aplay'])
    await driver.dispose()
  })

  it('is inert without subprocess or a writer and before generation', async () => {
    const absent = new SoundDriver(undefined, '/work')
    expect(await absent.detect()).toEqual(none)
    expect(await absent.ensureSounds(50, posix)).toBeNull()
    expect(absent.play(sound, posix)).toBe(false)
    await absent.dispose()
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(driver.play(sound, posix)).toBe(false)
    expect(await driver.ensureSounds(50, none)).toBeNull()
    expect(mock.spawnMock).not.toHaveBeenCalled()
    await driver.dispose()
  })

  it('serializes writes, coalesces queued volumes and caches normalized volume', async () => {
    const mock = mockRuntime()
    const gate = deferred<SubprocessOutcome>()
    mock.hooks.write = () => ({ done: gate.promise })
    const driver = new SoundDriver(mock.runtime, '/work')
    const first = driver.ensureSounds(20, posix)
    await vi.waitFor(() => expect(mock.calls('write')).toHaveLength(1))
    const second = driver.ensureSounds(30, posix)
    const third = driver.ensureSounds(40, posix)
    expect(mock.calls('allocate')).toHaveLength(1)
    gate.resolve(success)
    await Promise.all([first, second, third])
    expect(mock.calls('write')).toHaveLength(2)
    const good = driver.soundDir
    expect(await driver.ensureSounds(40.1, posix)).toBe(good)
    expect(await driver.ensureSounds(Number.NaN, posix)).toBe(good)
    expect(await driver.ensureSounds(40, none)).toBe(good)
    expect(mock.calls('write')).toHaveLength(2)
    await driver.dispose()
  })

  it('does not lose an update submitted immediately after a cache hit', async () => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    const first = await driver.ensureSounds(50, posix)
    const cached = driver.ensureSounds(50, posix)
    const changed = driver.ensureSounds(60, posix)
    await cached
    expect(await changed).not.toBe(first)
    expect(mock.calls('write')).toHaveLength(2)
    await driver.dispose()
  })

  it('normalizes volume boundaries and ignores non-finite requests', async () => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(Infinity, posix)).toBeNull()
    const quiet = await driver.ensureSounds(-10, posix)
    expect(await driver.ensureSounds(0, posix)).toBe(quiet)
    const loud = await driver.ensureSounds(200, posix)
    expect(loud).not.toBe(quiet)
    expect(await driver.ensureSounds(100, posix)).toBe(loud)
    expect(await driver.ensureSounds(-Infinity, posix)).toBe(loud)
    expect(mock.calls('write')).toHaveLength(2)
    await driver.dispose()
  })

  it('deduplicates a concurrent request for the same volume', async () => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await Promise.all([driver.ensureSounds(50, posix), driver.ensureSounds(50, posix)])
    expect(mock.calls('allocate')).toHaveLength(1)
    expect(mock.calls('write')).toHaveLength(1)
    await driver.dispose()
  })

  it.each([
    { exitCode: 1, signal: null }, { exitCode: null, signal: 'SIGTERM' }, { exitCode: 0, signal: 'SIGTERM' },
  ] as SubprocessOutcome[])('preserves last good audio on unsuccessful write: %j', async outcome => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    const good = await driver.ensureSounds(50, posix)
    mock.hooks.write = () => ({ done: Promise.resolve(outcome) })
    expect(await driver.ensureSounds(60, posix)).toBe(good)
    expect(driver.play(sound, posix)).toBe(true)
    expect(mock.calls('play')[0].spec.argv[1]).toBe(good + '/' + sound + '.wav')
    expect(mock.calls('cleanup').some(c => c.spec.env?.DSH_NOTIFIER_DIR === directory(2))).toBe(true)
    delete mock.hooks.write
    expect(await driver.ensureSounds(60, posix)).not.toBe(good)
    await driver.dispose()
  })

  it.each(['spawn', 'done'] as const)('tolerates allocator %s errors without deleting unknown paths', async failure => {
    const mock = mockRuntime()
    mock.hooks.allocate = () => {
      if (failure === 'spawn') throw new Error('allocation unavailable')
      return { done: Promise.reject(new Error('allocation unavailable')), collected: {} }
    }
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(50, posix)).toBeNull()
    await driver.dispose()
    expect(mock.calls('write')).toHaveLength(0)
    expect(mock.calls('cleanup')).toHaveLength(0)
  })

  it.each(['spawn', 'done'] as const)('tolerates generation %s errors and retries', async failure => {
    const mock = mockRuntime()
    mock.hooks.write = () => {
      if (failure === 'spawn') throw new Error('spawn failed')
      return { done: Promise.reject(new Error('failed')) }
    }
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(50, posix)).toBeNull()
    delete mock.hooks.write
    expect(await driver.ensureSounds(50, posix)).toBe(directory(2))
    await driver.dispose()
  })

  it.each(['exit', 'missing', 'lossy', 'unsafe', 'relative', 'multiline', 'read'] as const)('rejects invalid allocation output: %s', async failure => {
    const mock = mockRuntime()
    mock.hooks.allocate = () => ({
      done: Promise.resolve(failure === 'exit' ? { exitCode: 1, signal: null } : success),
      collected: failure === 'missing' ? {} : { stdout: { readFrom: () => {
        if (failure === 'read') throw new Error('reader failed')
        const text = failure === 'unsafe' ? '/tmp' : failure === 'relative' ? 'dsh-next-notifier-test1' : failure === 'multiline' ? directory(1) + '\n/tmp' : directory(1)
        return { text, nextOffset: text.length, lossy: failure === 'lossy' }
      } } },
    })
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(50, posix)).toBeNull()
    expect(mock.calls('write')).toHaveLength(0)
    expect(mock.calls('cleanup').every(c => c.spec.env?.DSH_NOTIFIER_DIR !== '/tmp')).toBe(true)
    await driver.dispose()
  })

  it.each(['/tmp/../dsh-next-notifier-test1', '/tmp/./dsh-next-notifier-test1', 'C:\\Temp\\..\\dsh-next-notifier-test1', '/tmp/dsh-next-notifier-test1\0'])('never cleans malformed allocator ownership paths: %s', async text => {
    const mock = mockRuntime()
    mock.hooks.allocate = () => ({ collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } } })
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(50, posix)).toBeNull()
    await driver.dispose()
    expect(mock.calls('write')).toHaveLength(0)
    expect(mock.calls('cleanup')).toHaveLength(0)
  })

  it.each(['afplay', 'win', 'paplay', 'aplay'] as const)('plays catalog IDs using %s without interpolating paths', async player => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await driver.ensureSounds(50, posix)
    const backends = { ...none, [player]: '/player' }
    expect(driver.play(sound, backends)).toBe(true)
    const spec = mock.calls('play')[0].spec
    expect(spec.cwd).toBe('/work')
    expect(spec.argv[0]).toBe('/player')
    expect(player === 'win' ? spec.env?.DSH_WAV_PATH : spec.argv[1]).toBe(directory(1) + '/' + sound + '.wav')
    for (const bad of ['../secret', '/tmp/secret', '..\\secret', sound + '.wav', '', 'unknown', '__proto__']) {
      expect(driver.play(bad, backends)).toBe(false)
    }
    expect(mock.calls('play')).toHaveLength(1)
    expect(driver.play(sound, none)).toBe(false)
    await driver.dispose()
  })

  it('reports immediate playback failure and handles rejected playback completion', async () => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await driver.ensureSounds(50, posix)
    mock.hooks.play = () => { throw new Error('missing player') }
    expect(driver.play(sound, posix)).toBe(false)
    mock.hooks.play = () => ({ done: Promise.reject(new Error('failed')) })
    expect(driver.play(sound, posix)).toBe(true)
    await driver.dispose()
  })

  it('uses private Windows allocation and fail-fast byte writes', async () => {
    const mock = mockRuntime()
    mock.hooks.allocate = () => ({ collected: { stdout: { readFrom: () => ({ text: 'C:\\Temp\\dsh-next-notifier-test1\r\n', nextOffset: 40, lossy: false }) } } })
    const driver = new SoundDriver(mock.runtime, '/work')
    expect(await driver.ensureSounds(50, windows)).toBe('C:\\Temp\\dsh-next-notifier-test1')
    const allocation = mock.calls('allocate')[0].spec.argv.join(' ')
    expect(allocation).toContain('NewGuid')
    expect(allocation).toContain('Stop')
    const spec = mock.calls('write')[0].spec
    const script = typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : ''
    expect(script).toContain('Stop')
    expect(script).toContain('WriteAllBytes')
    for (const item of SOUNDS) expect(script).toContain(item.id + '.wav')
    await driver.dispose()
    expect(mock.calls('cleanup')[0].spec.argv.join(' ')).toContain('-LiteralPath')
  })
})

describe('SoundDriver lifecycle', () => {
  it('aborts pending detection and never exposes late results after dispose', async () => {
    const mock = mockRuntime()
    const gate = deferred<string>()
    mock.resolveExecutable.mockReturnValue(gate.promise)
    const driver = new SoundDriver(mock.runtime, '/work')
    const detection = driver.detect()
    await driver.dispose()
    gate.resolve('/late')
    expect(await detection).toEqual(none)
    expect(await driver.detect()).toEqual(none)
    expect(mock.resolveExecutable).toHaveBeenCalledTimes(5)
    const args = mock.resolveExecutable.mock.calls[0] as unknown as [string, unknown, AbortSignal]
    expect(args[2].aborted).toBe(true)
  })

  it('does not return partially resolved detection after disposal', async () => {
    const mock = mockRuntime()
    const gate = deferred<string>()
    mock.resolveExecutable.mockImplementation(async cmd => cmd === 'sh' ? gate.promise : '/bin/' + cmd)
    const driver = new SoundDriver(mock.runtime, '/work')
    const detection = driver.detect()
    await Promise.resolve()
    await driver.dispose()
    gate.resolve('/bin/sh')
    expect(await detection).toEqual(none)
  })

  it.each(['false', 'reject', 'terminate'] as const)('does not delete audio if the provider cannot prove tree quiescence: %s', async failure => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await driver.ensureSounds(50, posix)
    const gate = deferred<SubprocessOutcome>()
    mock.hooks.play = () => ({
      done: gate.promise,
      terminate: () => { gate.resolve(success); if (failure === 'terminate') throw new Error('unavailable') },
      waitForExit: async () => { if (failure === 'reject') throw new Error('unavailable'); return failure !== 'false' },
    })
    driver.play(sound, posix)
    await driver.dispose()
    expect(mock.calls('cleanup')).toHaveLength(0)
  })

  it('retires a replaced directory when its last player finishes naturally', async () => {
    const mock = mockRuntime()
    const gate = deferred<SubprocessOutcome>()
    mock.hooks.play = () => ({ done: gate.promise })
    const driver = new SoundDriver(mock.runtime, '/work')
    const old = await driver.ensureSounds(50, posix)
    driver.play(sound, posix)
    const current = await driver.ensureSounds(60, posix)
    expect(mock.calls('cleanup')).toHaveLength(0)
    gate.resolve(success)
    await vi.waitFor(() => expect(mock.calls('cleanup')).toHaveLength(1))
    expect(mock.calls('cleanup')[0].spec.env?.DSH_NOTIFIER_DIR).toBe(old)
    expect(driver.soundDir).toBe(current)
    await driver.dispose()
  })

  it('cancels owned generation, drains its tree, drops queued updates and cleans the unpublished dir', async () => {
    const mock = mockRuntime()
    const gate = deferred<SubprocessOutcome>()
    const tree = deferred<boolean>()
    const terminate = vi.fn(() => gate.resolve({ exitCode: null, signal: 'SIGTERM' }))
    mock.hooks.write = () => ({ done: gate.promise, terminate, waitForExit: vi.fn(() => tree.promise) })
    const driver = new SoundDriver(mock.runtime, '/work')
    const generation = driver.ensureSounds(50, posix)
    await vi.waitFor(() => expect(mock.calls('write')).toHaveLength(1))
    const queued = driver.ensureSounds(60, posix)
    const disposal = driver.dispose()
    expect(driver.play(sound, posix)).toBe(false)
    expect(await driver.ensureSounds(70, posix)).toBeNull()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(mock.calls('cleanup')).toHaveLength(0)
    tree.resolve(true)
    await Promise.all([generation, queued, disposal, driver.dispose()])
    expect(driver.soundDir).toBeNull()
    expect(mock.calls('write')).toHaveLength(1)
    expect(mock.calls('cleanup')).toHaveLength(1)
  })

  it('finishes the allocation ownership handoff before disposing, even if its path is not emitted yet', async () => {
    const mock = mockRuntime()
    const gate = deferred<SubprocessOutcome>()
    let text = ''
    const terminate = vi.fn(() => gate.resolve({ exitCode: null, signal: 'SIGTERM' }))
    mock.hooks.allocate = () => ({
      done: gate.promise, terminate,
      collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
    })
    const driver = new SoundDriver(mock.runtime, '/work')
    const generation = driver.ensureSounds(50, posix)
    const disposal = driver.dispose()
    expect(terminate).not.toHaveBeenCalled()
    expect(mock.calls('cleanup')).toHaveLength(0)
    text = directory(1)
    gate.resolve(success)
    await disposal
    expect(await generation).toBeNull()
    expect(mock.calls('write')).toHaveLength(0)
    expect(mock.calls('cleanup')).toHaveLength(1)
  })

  it('keeps in-use audio until playback exits and terminates only its own players', async () => {
    const mock = mockRuntime()
    const playing = deferred<SubprocessOutcome>()
    const terminate = vi.fn(() => playing.resolve(success))
    mock.hooks.play = () => ({ done: playing.promise, terminate })
    const driver = new SoundDriver(mock.runtime, '/work')
    const other = new SoundDriver(mock.runtime, '/work')
    const old = await driver.ensureSounds(50, posix)
    const foreign = await other.ensureSounds(50, posix)
    driver.play(sound, posix)
    await driver.ensureSounds(60, posix)
    expect(mock.calls('cleanup').some(c => c.spec.env?.DSH_NOTIFIER_DIR === old)).toBe(false)
    await driver.dispose()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(mock.calls('cleanup').some(c => c.spec.env?.DSH_NOTIFIER_DIR === old)).toBe(true)
    expect(mock.calls('cleanup').some(c => c.spec.env?.DSH_NOTIFIER_DIR === foreign)).toBe(false)
    expect(other.play(sound, posix)).toBe(true)
    await other.dispose()
  })

  it.each(['spawn', 'done'] as const)('settles disposal when cleanup %s throws', async failure => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await driver.ensureSounds(50, posix)
    mock.hooks.cleanup = () => {
      if (failure === 'spawn') throw new Error('cleanup unavailable')
      return { done: Promise.reject(new Error('cleanup unavailable')) }
    }
    await expect(driver.dispose()).resolves.toBeUndefined()
    expect(driver.soundDir).toBeNull()
  })

  it('settles disposal even when cleanup fails', async () => {
    const mock = mockRuntime()
    const driver = new SoundDriver(mock.runtime, '/work')
    await driver.ensureSounds(50, posix)
    mock.hooks.cleanup = () => ({ done: Promise.resolve({ exitCode: 1, signal: null }) })
    await expect(driver.dispose()).resolves.toBeUndefined()
    expect(driver.play(sound, posix)).toBe(false)
    expect(await driver.ensureSounds(50, posix)).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('generated POSIX programs', () => {
  it('falls back to openssl when base64 cannot decode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sound-driver-fallback-'))
    await writeFile(join(root, 'base64'), '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    const driver = new SoundDriver(localRuntime({ TMPDIR: root, PATH: root + ':' + process.env.PATH }), root)
    try {
      const dir = await driver.ensureSounds(50, posix)
      expect(dir).not.toBeNull()
      expect((await readFile(join(dir!, sound + '.wav'))).subarray(0, 4).toString()).toBe('RIFF')
    } finally {
      await driver.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes complete private WAV sets, preserves good bytes on decoder failure, and removes only owned directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sound-driver-spec-'))
    const foreign = join(root, 'keep.txt')
    await writeFile(foreign, 'foreign')
    const env = { TMPDIR: root }
    const runtime = localRuntime(env)
    const first = new SoundDriver(runtime, root)
    const second = new SoundDriver(runtime, root)
    try {
      const a = await first.ensureSounds(50, posix)
      const b = await second.ensureSounds(50, posix)
      expect(a).not.toBeNull()
      expect(b).not.toBe(a)
      expect((await stat(a!)).mode & 0o777).toBe(0o700)
      expect((await readdir(a!)).sort()).toEqual(SOUNDS.map(s => s.id + '.wav').sort())
      const before = await readFile(join(a!, sound + '.wav'))
      expect(before.subarray(0, 4).toString()).toBe('RIFF')
      expect(await first.ensureSounds(50, posix)).toBe(a)
      for (const binary of ['base64', 'openssl']) await writeFile(join(root, binary), '#!/bin/sh\nprintf partial\nexit 1\n', { mode: 0o700 })
      Object.assign(env, { PATH: root + ':' + process.env.PATH })
      expect(await first.ensureSounds(70, posix)).toBe(a)
      expect(await readFile(join(a!, sound + '.wav'))).toEqual(before)
      await first.dispose()
      expect(await readdir(b!)).toHaveLength(SOUNDS.length)
      await second.dispose()
      expect((await readdir(root)).filter(n => n.startsWith('dsh-next-notifier-'))).toEqual([])
      expect(await readFile(foreign, 'utf8')).toBe('foreign')
    } finally {
      await first.dispose()
      await second.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
