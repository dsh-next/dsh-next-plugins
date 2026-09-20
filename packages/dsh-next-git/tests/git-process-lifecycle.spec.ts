// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { execGit, execGitBytes, GitRunner, GitProcessShutdownError, gitEnv } from '../src/host/git-runner.ts'

const roots: string[] = []
const options = { cwd: tmpdir(), timeoutMs: 3_000, maxBuffer: 1024 }

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function repository(stream?: 'stdout' | 'stderr'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-lifecycle-'))
  roots.push(root)
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: root, env: gitEnv(), stdio: 'pipe' }) }
  git('init', '-q')
  git('config', 'user.name', 'Lifecycle Test')
  git('config', 'user.email', 'lifecycle@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  git('config', 'core.hooksPath', join(root, '.git/hooks'))
  await writeFile(join(root, 'tracked'), 'before')
  git('add', '--', 'tracked')
  const writer = [
    "const fs = require('node:fs');",
    "process.on('SIGTERM', () => fs.writeFileSync('term-received', 'yes'));",
    "fs.writeFileSync('writer-ready', String(process.pid));",
    "setTimeout(() => { fs.writeFileSync('tracked', 'late orphan write'); require('node:child_process').execFileSync('git', ['add', '--', 'tracked']); fs.writeFileSync('late-write', 'yes'); }, 3000);",
    'setInterval(() => {}, 1000);',
  ].join('\n')
  const hook = [
    '#!' + process.execPath,
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    // Closed stdio is intentional: waiting only for Git's close is not enough.
    "spawn(process.execPath, ['-e', " + JSON.stringify(writer) + "], { stdio: 'ignore' });",
    stream === undefined ? '' : "const output = setInterval(() => { if (fs.existsSync('writer-ready')) { process." + stream + '.write(Buffer.alloc(8192, 120)); clearInterval(output); } }, 5);',
    'setInterval(() => {}, 1000);',
  ].join('\n')
  const path = join(root, '.git/hooks/pre-commit')
  await writeFile(path, hook)
  await chmod(path, 0o755)
  return root
}

async function ready(root: string): Promise<void> {
  await expect.poll(() => existsSync(join(root, 'writer-ready')), { timeout: 2000, interval: 10 }).toBe(true)
}

async function unchangedAfterSettlement(root: string): Promise<void> {
  expect(await readFile(join(root, 'tracked'), 'utf8')).toBe('before')
  // Observe beyond the writer's scheduled deadline, not merely immediate state.
  const started = (await stat(join(root, 'writer-ready'))).mtimeMs
  await delay(Math.max(0, started + 3100 - Date.now()))
  expect(existsSync(join(root, 'late-write'))).toBe(false)
  expect(await readFile(join(root, 'tracked'), 'utf8')).toBe('before')
}

describe.skipIf(process.platform === 'win32')('production Git process lifecycle', () => {
  it('holds the mutation queue through cancellation and SIGKILL of a resistant grandchild', async () => {
    const root = await repository()
    const runner = new GitRunner()
    const abort = new AbortController()
    const pending = runner.mutate(root, () => runner.run(['commit', '-m', 'cancel me'], root, { signal: abort.signal }))
    await ready(root)
    let nextStarted = false
    const next = runner.mutate(root, async () => {
      nextStarted = true
      expect(() => process.kill(Number(writerPid), 0)).toThrow()
      expect(await runner.runOk(['diff', '--cached', '--', 'tracked'], root)).toContain('+before')
    })
    const writerPid = await readFile(join(root, 'writer-ready'), 'utf8')
    abort.abort()
    abort.abort()
    await delay(50)
    expect(nextStarted).toBe(false)
    expect(await pending).toMatchObject({ code: 130, killed: true })
    expect(existsSync(join(root, 'term-received'))).toBe(true)
    await next
    await unchangedAfterSettlement(root)
  })

  it.each(['text', 'bytes'] as const)('waits for hook descendants on %s timeout', async (port) => {
    const root = await repository()
    const exec = port === 'text' ? execGit : execGitBytes
    const pending = exec('git', ['commit', '-m', 'timeout'], { ...options, cwd: root, timeoutMs: 1500 })
    await ready(root)
    const result = await pending
    expect(result).toMatchObject({ code: 1, killed: true })
    expect(result.stderr).not.toContain('unconfirmed')
    await unchangedAfterSettlement(root)
  })

  it.each(['stdout', 'stderr'] as const)('kills descendants when %s exceeds the byte limit', async (stream) => {
    const root = await repository(stream)
    const result = await execGitBytes('git', ['commit', '-m', 'overflow'], { ...options, cwd: root, maxBuffer: 16 })
    expect(result).toMatchObject({ code: 1, killed: true })
    expect(result.stdout.byteLength).toBeLessThanOrEqual(16)
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(16)
    await unchangedAfterSettlement(root)
  })

  it.each([execGit, execGitBytes])('does not spawn for a pre-aborted signal', async (exec) => {
    const abort = new AbortController()
    abort.abort()
    expect(await exec('/definitely/missing', [], { ...options, signal: abort.signal })).toMatchObject({ code: 130, killed: true })
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
  })

  it.each([execGit, execGitBytes])('cancels during output and keeps already-read bytes', async (exec) => {
    const root = await mkdtemp(join(tmpdir(), 'git-lifecycle-output-'))
    roots.push(root)
    const abort = new AbortController()
    const pending = exec(process.execPath, ['-e', 'process.stdout.write(Buffer.from([65,0,66]));require("node:fs").writeFileSync("writer-ready","yes");setInterval(()=>{},1000)'], { ...options, cwd: root, signal: abort.signal })
    await ready(root)
    abort.abort()
    abort.signal.dispatchEvent(new Event('abort'))
    const result = await pending
    expect(result).toMatchObject({ code: 130, killed: true })
    expect([...Buffer.from(result.stdout)]).toEqual([65, 0, 66])
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
  })

  it('rejects invalid limits and synchronous spawn errors without retaining listeners', async () => {
    const abort = new AbortController()
    for (const limits of [{ timeoutMs: -1 }, { timeoutMs: NaN }, { maxBuffer: -1 }, { maxBuffer: NaN }]) {
      await expect(execGit(process.execPath, [], { ...options, ...limits, signal: abort.signal })).rejects.toBeInstanceOf(RangeError)
    }
    await expect(execGit('', [], { ...options, signal: abort.signal })).rejects.toBeInstanceOf(TypeError)
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
  })

  it('does not reclassify or signal a completed process when its caller aborts later', async () => {
    const abort = new AbortController()
    const kill = vi.spyOn(process, 'kill')
    const result = await execGit(process.execPath, ['-e', 'process.stdout.write("done")'], { ...options, signal: abort.signal })
    expect(result).toMatchObject({ code: 0, stdout: 'done' })
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
    const calls = kill.mock.calls.length
    abort.abort()
    await delay(30)
    expect(kill.mock.calls).toHaveLength(calls)
  })

  it('preserves text across split UTF8 chunks, literal argv, and ordinary exit failures', async () => {
    const literal = '$(touch never-created); spaces'
    const result = await execGit(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xe2]));setTimeout(()=>{process.stdout.write(Buffer.from([0x82,0xac]));process.stderr.write(process.argv[1]);process.exitCode=7},20)', literal], options)
    expect(result).toEqual({ code: 7, stdout: '€', stderr: literal })
    expect(await execGit('/definitely/missing', [], options)).toMatchObject({ code: 127, spawnFailed: true })
    expect(await execGit(process.execPath, [], { ...options, cwd: '/definitely/missing' })).toMatchObject({ code: 127, spawnFailed: true })
  })

  it('disposes cancellation listeners after timeout, output overflow and spawn failure', async () => {
    for (const args of [['-e', 'setInterval(()=>{},1000)'], ['-e', 'process.stdout.write(Buffer.alloc(10000))']]) {
      const abort = new AbortController()
      await execGit(process.execPath, args, { ...options, timeoutMs: 100, signal: abort.signal })
      expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
    }
    const abort = new AbortController()
    await execGit('/definitely/missing', [], { ...options, signal: abort.signal })
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
  })

  it('reports bounded unconfirmed shutdown explicitly and disposes timers/listeners', async () => {
    const abort = new AbortController()
    const actualKill = process.kill.bind(process)
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0 || signal === 'SIGKILL') throw Object.assign(new Error('cannot verify group'), { code: 'EPERM' })
      return actualKill(pid, signal)
    })
    const runner = new GitRunner()
    const start = performance.now()
    const pending = runner.mutate('unsafe', () => execGit(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, timeoutMs: 100, signal: abort.signal }))
    const nextWork = vi.fn(async () => 'must not run')
    const next = runner.mutate('unsafe', nextWork)
    const results = await Promise.allSettled([pending, next])
    expect(performance.now() - start).toBeLessThan(3500)
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status !== 'rejected') continue
      expect(result.reason).toBeInstanceOf(GitProcessShutdownError)
      expect(result.reason.message).toContain('shutdown unconfirmed')
      expect(result.reason.message).toContain('cannot verify group')
    }
    expect(nextWork).not.toHaveBeenCalled()
    await expect(runner.mutate('unsafe', nextWork)).rejects.toBeInstanceOf(GitProcessShutdownError)
    expect(await runner.mutate('other-repository', async () => 'safe')).toBe('safe')
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0)
    const calls = kill.mock.calls.length
    abort.abort()
    await delay(30)
    expect(kill.mock.calls).toHaveLength(calls)
  })

  it.each([0, 7])('cleans remaining descendants after normal Git-like exit %s', async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'git-lifecycle-exit-'))
    roots.push(root)
    const worker = "require('node:fs').writeFileSync('ready', 'yes'); setTimeout(() => require('node:fs').writeFileSync('late', 'yes'), 500);"
    const program = "require('node:child_process').spawn(process.execPath, ['-e', " + JSON.stringify(worker) + "], {stdio: 'inherit'}); const check = setInterval(() => { if (require('node:fs').existsSync('ready')) process.exit(" + code + "); }, 5);"
    const result = await execGit(process.execPath, ['-e', program], { ...options, cwd: root })
    expect(result.code).toBe(code)
    await delay(600)
    expect(existsSync(join(root, 'late'))).toBe(false)
  })

  it('escalates after a signal error without throwing or killing unrelated processes', async () => {
    const actualKill = process.kill.bind(process)
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGTERM') throw Object.assign(new Error('test permission denied'), { code: 'EPERM' })
      return actualKill(pid, signal)
    })
    const result = await execGit(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, timeoutMs: 100 })
    expect(result).toMatchObject({ code: 1, killed: true })
    expect(kill.mock.calls.some(([, signal]) => signal === 'SIGKILL')).toBe(true)
    expect(kill.mock.calls.every(([pid]) => pid < 0 && pid !== -process.pid)).toBe(true)
  })
})

it('refuses unsupported Windows process-tree execution before spawning', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const result = await execGit('/definitely/missing', [], options)
  expect(result).toMatchObject({ code: 1 })
  expect(result.stderr).toContain('unsupported on Windows')
  expect(result.spawnFailed).toBeUndefined()
})
