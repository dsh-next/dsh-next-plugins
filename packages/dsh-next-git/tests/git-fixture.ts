/**
 * One real-git fixture module, shared by the vitest suites and the Playwright
 * mount marker.
 *
 * Dependency-free on purpose (`node:fs` + `execFile('git')` only) so the
 * self-contained e2e lane can import it without resolving this package's
 * dependencies. The retired worktrees plugin kept a host fixture and a
 * hand-mirrored e2e copy, and keeping them in step was a standing tax; here
 * the state a unit test asserts is the state the browser marker drives.
 *
 * Determinism is part of the fixture, not the test:
 *
 * - an isolated git environment (`GIT_CONFIG_GLOBAL=/dev/null`,
 *   `GIT_CONFIG_NOSYSTEM=1`, `core.hooksPath` to a per-repo hook directory,
 *   `commit.gpgsign=false`, `init.defaultBranch=main`);
 * - fixed author, committer and dates, so object ids are stable;
 * - a fresh temp directory per scenario, disposed by the caller.
 *
 * `build` twice over the same scenario must produce identical commit ids —
 * `tests/git-fixture.spec.ts` asserts exactly that, so a flake traces to the
 * plugin rather than to setup.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Fixed author/committer identity every fixture commit uses. */
export const FIXTURE_AUTHOR = { name: 'Fixture Author', email: 'fixture@example.com' } as const

/** Fixed commit timestamp (Unix epoch seconds) every fixture commit uses. */
export const FIXTURE_EPOCH = 1_700_000_000

/** The main branch name every scenario starts on. */
export const MAIN_BRANCH = 'main'

/** Outcome of one git invocation. */
export interface GitOutcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** A scenario instance: a real repository plus helpers, and its disposer. */
export interface GitFixture {
  /** Absolute repository root (the primary worktree). */
  readonly dir: string
  /** Absolute path of the `.git` directory. */
  readonly gitDir: string
  /** Absolute path of the hook directory (`core.hooksPath`). */
  readonly hooksDir: string
  /** Run git; never throws. */
  git(args: readonly string[], options?: { cwd?: string; env?: Record<string, string> }): GitOutcome
  /** Run git in the repository; throws on a non-zero exit. */
  gitOk(args: readonly string[], options?: { cwd?: string; env?: Record<string, string> }): string
  /** Write a file (creating parents). */
  write(relative: string, contents: string): void
  /** Delete a file if present. */
  remove(relative: string): void
  /** Write a file, stage it, and commit it; returns the commit id. */
  commit(relative: string, contents: string, message: string): string
  /** Commit the current index with a fixed identity/date; returns the commit id. */
  commitIndex(message: string): string
  /** Absolute path of a repository-relative path. */
  path(relative: string): string
  /** Create a linked worktree under `.worktrees/<slug>` on `dsh-git/<slug>`. */
  addWorktree(slug: string, base?: string): string
  /** Create a linked worktree checking out an existing branch. */
  addWorktreeOnBranch(slug: string, branch: string): string
  /** A sibling temp directory owned by this fixture (removed on dispose). */
  scratch(prefix: string): string
  /** Remove the fixture directory tree and any sibling scratch paths. */
  dispose(): void
}

/** The environment every git child in a fixture uses. */
function fixtureEnv(dir: string, hooksDir: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_AUTHOR_NAME = FIXTURE_AUTHOR.name
  env.GIT_AUTHOR_EMAIL = FIXTURE_AUTHOR.email
  env.GIT_COMMITTER_NAME = FIXTURE_AUTHOR.name
  env.GIT_COMMITTER_EMAIL = FIXTURE_AUTHOR.email
  env.GIT_AUTHOR_DATE = `${FIXTURE_EPOCH} +0000`
  env.GIT_COMMITTER_DATE = `${FIXTURE_EPOCH} +0000`
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_EDITOR = 'true'
  env.GIT_PAGER = 'cat'
  env.LC_ALL = 'C'
  env.HOME = dir
  env.XDG_CONFIG_HOME = join(dir, '.config')
  Object.assign(env, extra)
  void hooksDir
  return env
}

/** Every scenario the factory can build. */
export const SCENARIOS = [
  'clean',
  'staged',
  'unstaged',
  'untracked',
  'renamed',
  'ignored',
  'binary',
  'large',
  'merge-conflict',
  'rebase-conflict',
  'cherry-pick-conflict',
  'detached',
  'unborn',
  'branches',
  'ahead-behind',
  'worktrees',
  'hook-fail',
  'hook-hang',
] as const

/** One scenario name. */
export type ScenarioName = (typeof SCENARIOS)[number]

/**
 * Build a scenario in a fresh temp directory.
 *
 * @param scenario - which state to construct.
 * @param options.scratch - parent directory for the temp repo.
 * @param options.dir - seed an existing directory instead of a temp one (the
 *   e2e lane registers the fixture repository as the session workspace, so it
 *   must already exist); the directory is left in place on dispose.
 * @returns the fixture; the caller must `dispose()` it.
 */
export function createFixture(
  scenario: ScenarioName,
  options: { scratch?: string; dir?: string } = {},
): GitFixture {
  const parent = options.scratch ?? tmpdir()
  // Canonicalize: on macOS `mkdtemp` yields `/var/...` while git resolves
  // `/private/var/...`, and every path comparison downstream would then be
  // between two spellings of the same directory.
  const ownsDir = options.dir === undefined
  const dir = realpathSync(options.dir ?? mkdtempSync(join(parent, `dsh-git-fx-${scenario}-`)))
  // A temp directory can host its hook directory; a pre-existing workspace
  // must not grow a `.githooks` folder that the panel would then list as an
  // untracked change.
  const hooksDir = ownsDir ? join(dir, '.githooks') : mkdtempSync(join(tmpdir(), 'dsh-git-hooks-'))
  mkdirSync(hooksDir, { recursive: true })
  const gitDir = join(dir, '.git')
  const envBase = fixtureEnv(dir, hooksDir)

  /** Sibling scratch paths (bare remotes, clones, non-repos) to clean up. */
  const extras: string[] = ownsDir ? [] : [hooksDir]

  const git: GitFixture['git'] = (args, opts = {}) => {
    const cwd = opts.cwd ?? dir
    const env = opts.env === undefined ? envBase : { ...envBase, ...opts.env }
    try {
      const stdout = execFileSync('git', [...args], { cwd, env, encoding: 'utf8' })
      return { code: 0, stdout, stderr: '' }
    } catch (error) {
      const err = error as { status?: number | null; stdout?: string; stderr?: string }
      return {
        code: typeof err.status === 'number' ? err.status : 1,
        stdout: String(err.stdout ?? ''),
        stderr: String(err.stderr ?? ''),
      }
    }
  }

  const gitOk: GitFixture['gitOk'] = (args, opts = {}) => {
    const outcome = git(args, opts)
    if (outcome.code !== 0) {
      throw new Error(`git ${args.join(' ')} failed (${outcome.code}): ${outcome.stderr || outcome.stdout}`)
    }
    return outcome.stdout
  }

  const write: GitFixture['write'] = (relative, contents) => {
    const full = join(dir, relative)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }

  const fixture: GitFixture = {
    dir,
    gitDir,
    hooksDir,
    git,
    gitOk,
    write,
    remove(relative) {
      try {
        unlinkSync(join(dir, relative))
      } catch {
        // Missing is the desired end state.
      }
    },
    commit(relative, contents, message) {
      write(relative, contents)
      gitOk(['add', '--', relative])
      return fixture.commitIndex(message)
    },
    commitIndex(message) {
      gitOk(['commit', '-q', '-m', message])
      return gitOk(['rev-parse', 'HEAD']).trim()
    },
    path(relative) {
      return join(dir, relative)
    },
    addWorktree(slug, base = MAIN_BRANCH) {
      const target = join(dir, '.worktrees', slug)
      mkdirSync(join(dir, '.worktrees'), { recursive: true })
      fixture.gitOk(['worktree', 'add', '-b', `dsh-git/${slug}`, target, base])
      return target
    },
    addWorktreeOnBranch(slug, branch) {
      const target = join(dir, '.worktrees', slug)
      mkdirSync(join(dir, '.worktrees'), { recursive: true })
      fixture.gitOk(['worktree', 'add', target, branch])
      return target
    },
    scratch(prefix) {
      const created = realpathSync(mkdtempSync(join(parent, `dsh-git-fx-${prefix}-`)))
      extras.push(created)
      return created
    },
    dispose() {
      for (const extra of extras) rmSync(extra, { recursive: true, force: true })
      if (ownsDir) rmSync(dir, { recursive: true, force: true })
    },
  }

  initRepo(fixture)
  applyScenario(fixture, scenario)
  // Re-read the git dir path: `git init` may have created a worktree-local dir.
  ;(fixture as { gitDir: string }).gitDir = gitOk(['rev-parse', '--absolute-git-dir']).trim()
  return fixture
}

/** `git init` plus the identity/config every scenario shares. */
function initRepo(fixture: GitFixture): void {
  fixture.gitOk(['init', '-q', '-b', MAIN_BRANCH])
  const config: readonly (readonly string[])[] = [
    ['config', 'user.name', FIXTURE_AUTHOR.name],
    ['config', 'user.email', FIXTURE_AUTHOR.email],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'core.hooksPath', fixture.hooksDir],
    ['config', 'init.defaultBranch', MAIN_BRANCH],
    ['config', 'advice.detachedHead', 'false'],
  ]
  for (const args of config) fixture.gitOk(args)
}

/** Build one scenario's state on top of an initialized repository. */
function applyScenario(fixture: GitFixture, scenario: ScenarioName): void {
  const seed = (): void => {
    fixture.commit('README.md', '# fixture\n', 'chore: seed')
    fixture.commit('src/app.ts', 'export const app = 1\n', 'feat: add app')
  }

  switch (scenario) {
    case 'unborn':
      // No commits at all: `git status` reports `(initial)`.
      return

    case 'clean':
      seed()
      return

    case 'staged': {
      seed()
      fixture.write('src/app.ts', 'export const app = 2\n')
      fixture.gitOk(['add', '--', 'src/app.ts'])
      return
    }

    case 'unstaged': {
      seed()
      fixture.write('src/app.ts', 'export const app = 3\n')
      return
    }

    case 'untracked': {
      seed()
      fixture.write('docs/notes.md', 'notes\n')
      return
    }

    case 'renamed': {
      seed()
      fixture.gitOk(['mv', 'src/app.ts', 'src/main.ts'])
      return
    }

    case 'ignored': {
      seed()
      fixture.commit('.gitignore', 'ignored.txt\n', 'chore: ignore ignored.txt')
      fixture.write('ignored.txt', 'ignore me\n')
      return
    }

    case 'binary': {
      seed()
      writeFileSync(join(fixture.dir, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
      fixture.gitOk(['add', '--', 'logo.bin'])
      fixture.commitIndex('chore: add binary asset')
      // A tracked binary file modified in the worktree: the diff is binary.
      writeFileSync(join(fixture.dir, 'logo.bin'), Buffer.from([0, 9, 9, 9, 0, 255]))
      return
    }

    case 'large': {
      seed()
      fixture.commit('src/big.ts', largeFile(1), 'feat: add big file')
      fixture.write('src/big.ts', largeFile(2))
      return
    }

    case 'merge-conflict':
    case 'rebase-conflict':
    case 'cherry-pick-conflict': {
      seed()
      fixture.gitOk(['checkout', '-q', '-b', 'feature'])
      fixture.commit('src/app.ts', 'export const app = 100\n', 'feat: feature change')
      fixture.gitOk(['checkout', '-q', MAIN_BRANCH])
      fixture.commit('src/app.ts', 'export const app = 200\n', 'feat: main change')
      if (scenario === 'merge-conflict') {
        fixture.git(['merge', '--no-edit', 'feature'])
        return
      }
      if (scenario === 'rebase-conflict') {
        fixture.gitOk(['checkout', '-q', 'feature'])
        fixture.git(['rebase', MAIN_BRANCH])
        return
      }
      fixture.git(['cherry-pick', fixture.gitOk(['rev-parse', 'feature']).trim()])
      return
    }

    case 'detached': {
      seed()
      fixture.gitOk(['checkout', '-q', '--detach', 'HEAD'])
      return
    }

    case 'branches': {
      seed()
      fixture.gitOk(['branch', 'alpha'])
      fixture.gitOk(['branch', 'beta'])
      fixture.commit('src/extra.ts', 'export const extra = true\n', 'feat: extra')
      return
    }

    case 'ahead-behind': {
      seed()
      const remote = join(fixture.scratch('remote'), 'origin.git')
      execFileSync('git', ['init', '-q', '--bare', '-b', MAIN_BRANCH, remote], {
        env: fixtureEnv(fixture.dir, fixture.hooksDir),
      })
      fixture.gitOk(['remote', 'add', 'origin', remote])
      fixture.gitOk(['push', '-q', '-u', 'origin', MAIN_BRANCH])
      // One local commit (ahead) and one remote commit (behind).
      fixture.commit('src/local.ts', 'export const local = true\n', 'feat: local')
      const clone = fixture.scratch('clone')
      execFileSync('git', ['clone', '-q', remote, clone], { env: fixtureEnv(fixture.dir, fixture.hooksDir) })
      writeFileSync(join(clone, 'src', 'remote.ts'), 'export const remote = true\n')
      execFileSync('git', ['-C', clone, 'add', '--', 'src/remote.ts'], { env: fixtureEnv(clone, fixture.hooksDir) })
      execFileSync('git', ['-C', clone, 'commit', '-q', '-m', 'feat: remote'], {
        env: fixtureEnv(clone, fixture.hooksDir),
      })
      execFileSync('git', ['-C', clone, 'push', '-q', 'origin', MAIN_BRANCH], {
        env: fixtureEnv(clone, fixture.hooksDir),
      })
      fixture.gitOk(['fetch', '-q', 'origin'])
      return
    }

    case 'worktrees': {
      seed()
      // `ready` is a clean worktree on a branch at the primary tip.
      // `merged` is a worktree whose branch was really merged into main, so
      // its row reports the merged fact rather than merely a shared tip.
      fixture.gitOk(['branch', 'dsh-git/ready'])
      fixture.gitOk(['checkout', '-q', '-b', 'dsh-git/merged'])
      fixture.commit('src/merged.ts', 'export const merged = true\n', 'feat: merged work')
      fixture.gitOk(['checkout', '-q', MAIN_BRANCH])
      fixture.gitOk(['merge', '-q', '--no-edit', 'dsh-git/merged'])
      fixture.addWorktreeOnBranch('ready', 'dsh-git/ready')
      fixture.addWorktreeOnBranch('merged', 'dsh-git/merged')
      const dirty = fixture.addWorktree('dirty')
      writeFileSync(join(dirty, 'dirty.txt'), 'uncommitted\n')
      const ahead = fixture.addWorktree('ahead')
      fixture.gitOk(['-C', ahead, 'commit', '-q', '--allow-empty', '-m', 'feat: worktree commit'])
      // The plugin's own convention: hide the directory locally, never in the
      // user's committed .gitignore.
      writeFileSync(join(fixture.gitDir, 'info', 'exclude'), '.worktrees/\n')
      return
    }

    case 'hook-fail': {
      seed()
      const hook = join(fixture.hooksDir, 'pre-commit')
      writeFileSync(hook, '#!/bin/sh\necho "fixture pre-commit refused" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
      fixture.write('src/app.ts', 'export const app = 42\n')
      fixture.gitOk(['add', '--', 'src/app.ts'])
      return
    }

    case 'hook-hang': {
      seed()
      const hook = join(fixture.hooksDir, 'pre-commit')
      writeFileSync(hook, '#!/bin/sh\necho "fixture pre-commit hanging"\nsleep 120\n')
      chmodSync(hook, 0o755)
      fixture.write('src/app.ts', 'export const app = 43\n')
      fixture.gitOk(['add', '--', 'src/app.ts'])
      return
    }

    default:
      return
  }
}

/** A file whose change crosses the diff size cap. */
function largeFile(revision: number): string {
  const lines: string[] = []
  for (let index = 0; index < 6000; index += 1) {
    lines.push(`export const value${index} = ${index + revision}`)
  }
  return `${lines.join('\n')}\n`
}

/** Write a standalone path (used by the not-a-repository scenario). */
export function createNonRepository(options: { scratch?: string } = {}): { dir: string; dispose: () => void } {
  const parent = options.scratch ?? tmpdir()
  const dir = realpathSync(mkdtempSync(join(parent, 'dsh-git-fx-no-repo-')))
  writeFileSync(join(dir, 'plain.txt'), 'not a repository\n')
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
