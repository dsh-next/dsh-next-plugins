import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { execGitBytes, GitRunner, GitError } from '../src/host/git-runner.ts'

const options = { cwd: tmpdir(), timeoutMs: 3000, maxBuffer: 1024 }

describe('bounded raw Git byte execution', () => {
  it('preserves non-UTF8 and NUL bytes exactly', async () => {
    const result = await execGitBytes(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,128,10]))'], options)
    expect(result.code).toBe(0)
    expect([...result.stdout]).toEqual([0, 255, 128, 10])
  })

  it('names spawn failures and nonzero exits without decoding stdout', async () => {
    expect(await execGitBytes('/no/such/dsh-git-executable', [], options)).toMatchObject({ code: 127, spawnFailed: true })
    const result = await execGitBytes(process.execPath, ['-e', 'process.stderr.write("failure");process.exit(7)'], options)
    expect(result).toMatchObject({ code: 7, stderr: 'failure' })
  })

  it('bounds output and wall time', async () => {
    const huge = await execGitBytes(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(10000))'], { ...options, maxBuffer: 16 })
    expect(huge.code).not.toBe(0)
    const slow = await execGitBytes(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { ...options, timeoutMs: 100 })
    expect(slow.killed).toBe(true)
  })

  it('propagates cancellation while running', async () => {
    const abort = new AbortController()
    const pending = execGitBytes(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { ...options, signal: abort.signal })
    abort.abort()
    expect(await pending).toMatchObject({ code: 130, killed: true })
  })

  it('uses the injected byte port, classifies failures, and refuses already-cancelled reads', async () => {
    const raw = vi.fn(async () => ({ code: 0, stdout: new Uint8Array([255]), stderr: '' }))
    const runner = new GitRunner(undefined, undefined, raw)
    expect([...await runner.runBytesOk(['cat-file', 'blob', 'oid'], '/repo')]).toEqual([255])
    expect(raw.mock.calls).toHaveLength(1)
    raw.mockResolvedValueOnce({ code: 1, stdout: new Uint8Array(), stderr: 'fatal: bad object' })
    await expect(runner.runBytesOk([], '/repo')).rejects.toBeInstanceOf(GitError)
    const abort = new AbortController()
    abort.abort()
    await expect(runner.runBytesOk([], '/repo', { signal: abort.signal })).rejects.toMatchObject({ failure: { code: 'cancelled' } })
    expect(raw.mock.calls).toHaveLength(2)
  })
})
