/**
 * Real-git fixtures for host-side merge/update tests.
 *
 * These are the states the FakeGit cannot lie about: fast-forward vs merge
 * commit, conflict + MERGE_HEAD, dirty trees, already-merged / already-updated.
 * Playwright e2e drives the same states through the GUI; this module is the
 * unit-speed half.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Run git in `cwd`; throws on non-zero. */
export function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Whether `git <args>` exits 0. */
export function gitOk(cwd: string, args: readonly string[]): boolean {
  try {
    runGit(cwd, args)
    return true
  } catch {
    return false
  }
}

/** Whether MERGE_HEAD exists at cwd (in-flight merge). */
export function hasMergeHead(cwd: string): boolean {
  return gitOk(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
}

/** `git init` + identity. Does not create a commit. */
export function initGitRepo(dir: string, branch = 'main'): void {
  runGit(dir, ['init', '-q', '-b', branch])
  runGit(dir, ['config', 'user.email', 'test@example.com'])
  runGit(dir, ['config', 'user.name', 'test'])
}

/** Write, add, and commit one file relative to cwd. */
export async function commitFile(
  cwd: string,
  relative: string,
  contents: string,
  message: string,
): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, contents)
  runGit(cwd, ['add', '--', relative])
  runGit(cwd, ['commit', '-q', '-m', message])
}

/**
 * Finish an in-progress merge the way the bound session's agent would:
 * write a resolution, `git add`, `git commit`. The primary is untouched.
 */
export async function completeConflictedMerge(
  cwd: string,
  relative: string,
  contents: string,
  message: string,
): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, contents)
  runGit(cwd, ['add', '--', relative])
  runGit(cwd, ['-c', 'core.editor=true', 'commit', '-q', '-m', message])
}

/** Write an uncommitted file (does not add). */
export async function writeUncommitted(cwd: string, relative: string, contents: string): Promise<string> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, contents)
  return full
}

/**
 * A throwaway repo with one commit on `main`. Caller must `cleanup`.
 */
export async function makeTempRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wt-fx-'))
  initGitRepo(dir)
  await commitFile(dir, 'seed.txt', 'seed\n', 'seed')
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}
