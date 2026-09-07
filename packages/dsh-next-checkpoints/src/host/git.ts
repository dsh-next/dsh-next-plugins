/**
 * Git discovery against session-start HEAD. Checkpoints are not git:
 * rewind never reset/revert/checkout.
 */
import { execFile } from 'node:child_process'
import type { HeadInfo } from '../core/types.ts'

export interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<GitResult>

const TIMEOUT_MS = 15_000

export const execGit: ExecFn = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (err && err.code === 'ENOENT') {
          resolve({ code: 127, stdout: String(stdout ?? ''), stderr: String(stderr ?? 'git not found') })
          return
        }
        const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })

export interface GitPorts {
  head(cwd: string): Promise<HeadInfo | null>
  diffNames(cwd: string, baselineSha: string): Promise<readonly string[]>
  untracked(cwd: string): Promise<readonly string[]>
  statusNames(cwd: string): Promise<readonly string[]>
  show(cwd: string, sha: string, path: string): Promise<Uint8Array | null>
  isWorktree(cwd: string): Promise<boolean>
}

function splitNames(stdout: string): string[] {
  return stdout.split('\0').map((item) => item.trim()).filter((item) => item !== '')
}

/**
 * Parse `git status --porcelain -z`. Rename/copy records are
 * `XY to\0from\0` — the second field has no status prefix and must not
 * be sliced as `XY path`.
 */
export function parseStatusPorcelainZ(stdout: string): string[] {
  const names: string[] = []
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    if (!/^[ MADRCU?!]{2}$/.test(xy)) continue
    const path = line.slice(3)
    if (path !== '') names.push(path)
    if (xy.includes('R') || xy.includes('C')) i += 1
  }
  return names
}

/** Production git ports. Failures become empty/null — cwd may not be a repo. */
export class GitRunner implements GitPorts {
  constructor(private readonly exec: ExecFn = execGit) {}

  private run(args: readonly string[], cwd: string): Promise<GitResult> {
    return this.exec('git', args, { cwd, timeoutMs: TIMEOUT_MS })
  }

  async head(cwd: string): Promise<HeadInfo | null> {
    const sha = await this.run(['rev-parse', 'HEAD'], cwd)
    if (sha.code !== 0) return null
    const full = sha.stdout.trim()
    if (full === '') return null
    const shortRes = await this.run(['rev-parse', '--short', 'HEAD'], cwd)
    const branchRes = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const branch = branchRes.code === 0 ? branchRes.stdout.trim() : ''
    return {
      sha: full,
      short: shortRes.code === 0 && shortRes.stdout.trim() !== '' ? shortRes.stdout.trim() : full.slice(0, 7),
      branch: branch === '' || branch === 'HEAD' ? null : branch,
    }
  }

  async diffNames(cwd: string, baselineSha: string): Promise<readonly string[]> {
    const result = await this.run(['diff', '--name-only', '-z', baselineSha], cwd)
    // git diff exits 1 when the tree differs; only treat 0/1 as names.
    if (result.code !== 0 && result.code !== 1) return []
    return splitNames(result.stdout)
  }

  async untracked(cwd: string): Promise<readonly string[]> {
    const result = await this.run(['ls-files', '--others', '--exclude-standard', '-z'], cwd)
    if (result.code !== 0) return []
    return splitNames(result.stdout)
  }

  async statusNames(cwd: string): Promise<readonly string[]> {
    const result = await this.run(['status', '--porcelain', '-z'], cwd)
    if (result.code !== 0) return []
    return parseStatusPorcelainZ(result.stdout)
  }

  async show(cwd: string, sha: string, path: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      execFile(
        'git',
        ['show', `${sha}:${path}`],
        { cwd, timeout: TIMEOUT_MS, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(null)
            return
          }
          resolve(new Uint8Array(stdout))
        },
      )
    })
  }

  async isWorktree(cwd: string): Promise<boolean> {
    const dir = await this.run(['rev-parse', '--path-format=absolute', '--git-dir'], cwd)
    const common = await this.run(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
    if (dir.code !== 0 || common.code !== 0) return false
    const a = dir.stdout.trim().replace(/\/+$/, '')
    const b = common.stdout.trim().replace(/\/+$/, '')
    return a !== '' && b !== '' && a !== b
  }
}
