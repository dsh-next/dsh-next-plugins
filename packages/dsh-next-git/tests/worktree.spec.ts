import { describe, expect, it } from 'vitest'
import {
  branchForSlug,
  describeWorktrees,
  excludesWorktrees,
  INCLUDE_FILE,
  isManagedWorktreePath,
  isUnsafeRelativePath,
  normalizeSlug,
  parseSetupFile,
  parseWorktreeInclude,
  parseWorktreeList,
  planWorktree,
  resolveSetupSteps,
  SETUP_ENV_ROOT,
  SETUP_FILE,
  SETUP_MAX_STEPS,
  setupChildEnv,
  setupPlatform,
  shortBranch,
  slugFromBranch,
  slugFromWorktreePath,
  SLUG_MAX_LENGTH,
  validateSlug,
  withWorktreesExcluded,
  WORKTREES_DIR,
  WORKTREES_EXCLUDE_ENTRY,
  WORKTREE_BRANCH_PREFIX,
  worktreePathFor,
} from '../src/core/worktree.ts'

describe('slug validation and folding', () => {
  it('accepts a well-formed slug', () => {
    expect(validateSlug('feature-1')).toEqual({ ok: true, slug: 'feature-1' })
    expect(validateSlug('a.b')).toEqual({ ok: true, slug: 'a.b' })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['a/b', 'separator'],
    ['a\\b', 'separator'],
    ['.', 'reserved'],
    ['..', 'reserved'],
    ['Feature', 'invalid-character'],
    ['feature_1', 'invalid-character'],
    ['-lead', 'invalid-character'],
    ['trail-', 'invalid-character'],
    ['x'.repeat(SLUG_MAX_LENGTH + 1), 'too-long'],
  ])('refuses %j with %s', (input, issue) => {
    expect(validateSlug(input)).toEqual({ ok: false, issue })
  })

  it('folds a human name into slug shape', () => {
    expect(normalizeSlug('  My Feature  ')).toBe('my-feature')
    expect(normalizeSlug('fix__the___thing')).toBe('fix-the-thing')
    expect(normalizeSlug('weird!@#name')).toBe('weird-name')
    expect(normalizeSlug('--dashes--')).toBe('dashes')
    expect(normalizeSlug('dots..dots')).toBe('dots-dots')
    expect(normalizeSlug('!!!!')).toBe('')
  })

  it('truncates at a separator boundary', () => {
    const long = `${'a'.repeat(40)}-${'b'.repeat(40)}`
    const slug = normalizeSlug(long)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(validateSlug(slug).ok).toBe(true)
  })
})

describe('worktree placement', () => {
  it('places a worktree under .worktrees/ and branches it dsh-git/', () => {
    expect(worktreePathFor('/repo', 'feature')).toBe('/repo/.worktrees/feature')
    expect(worktreePathFor('/repo/', 'feature')).toBe('/repo/.worktrees/feature')
    expect(worktreePathFor('C:\\repo', 'feature')).toBe('C:/repo/.worktrees/feature')
    expect(branchForSlug('feature')).toBe(`${WORKTREE_BRANCH_PREFIX}feature`)
  })

  it('recognizes managed paths and branches', () => {
    expect(isManagedWorktreePath('/repo/.worktrees/x')).toBe(true)
    expect(isManagedWorktreePath('/repo/src/x')).toBe(false)
    expect(slugFromWorktreePath('/repo/.worktrees/x')).toBe('x')
    expect(slugFromWorktreePath('/repo/.worktrees/x/nested')).toBe('x')
    expect(slugFromWorktreePath('/repo/.worktrees/')).toBeNull()
    expect(slugFromWorktreePath('/repo/src/x')).toBeNull()
    expect(slugFromBranch('refs/heads/dsh-git/x')).toBe('x')
    expect(slugFromBranch('dsh-git/x')).toBe('x')
    expect(slugFromBranch('refs/heads/main')).toBeNull()
    expect(slugFromBranch('dsh-git/')).toBeNull()
    expect(slugFromBranch(null)).toBeNull()
  })

  it('shortens a ref name', () => {
    expect(shortBranch('refs/heads/main')).toBe('main')
    expect(shortBranch('main')).toBe('main')
    expect(shortBranch(null)).toBeNull()
  })

  it('builds a create plan', () => {
    const plan = planWorktree({ root: '/repo', slug: 'feature', base: 'main' })
    expect(plan).toEqual({
      slug: 'feature',
      path: '/repo/.worktrees/feature',
      branch: 'dsh-git/feature',
      base: 'main',
      setup: [],
    })
  })
})

describe('worktree list parsing', () => {
  const raw = [
    'worktree /repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/ready',
    'HEAD bbbb',
    'branch refs/heads/dsh-git/ready',
    '',
    'worktree /repo/.worktrees/detached',
    'HEAD cccc',
    'detached',
    'locked reason',
    '',
    'worktree /bare',
    'bare',
    '',
  ].join('\n')

  it('parses every entry shape', () => {
    const entries = parseWorktreeList(raw)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({ path: '/repo', branch: 'refs/heads/main', bare: false, detached: false })
    expect(entries[2]).toMatchObject({ path: '/repo/.worktrees/detached', detached: true, locked: true, branch: null })
    expect(entries[3]).toMatchObject({ path: '/bare', bare: true })
  })

  it('describes rows with the managed convention and host facts', () => {
    const rows = describeWorktrees(parseWorktreeList(raw), {
      '/repo': { clean: true, ahead: 0, merged: false },
      '/repo/.worktrees/ready': { clean: true, ahead: 2, merged: false },
    })
    expect(rows[0]).toMatchObject({ primary: true, managed: false, slug: null, clean: true })
    expect(rows[1]).toMatchObject({
      primary: false,
      managed: true,
      slug: 'ready',
      branch: 'dsh-git/ready',
      ahead: 2,
      merged: false,
      clean: true,
    })
    // A detached managed path still resolves its slug from the path.
    expect(rows[2]).toMatchObject({ managed: true, slug: 'detached', branch: null, clean: false })
    // A bare entry has no working tree, so it is reported clean.
    expect(rows[3]).toMatchObject({ clean: true, primary: false })
  })

  it('handles an empty listing', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(describeWorktrees([])).toEqual([])
  })
})

describe('.worktrees.json', () => {
  it('parses an object and refuses anything else', () => {
    expect(parseSetupFile('{"setup-worktree":["a"]}')).toEqual({ 'setup-worktree': ['a'] })
    expect(parseSetupFile('nope')).toEqual({ error: 'setup-not-object' })
    expect(parseSetupFile('[1]')).toEqual({ error: 'setup-not-object' })
    expect(parseSetupFile('null')).toEqual({ error: 'setup-not-object' })
  })

  it('resolves commands, scripts and platform precedence', () => {
    const file = {
      'setup-worktree': ['generic'],
      'setup-worktree-unix': ['unix-only'],
      'setup-worktree-windows': ['windows-only'],
    }
    expect(resolveSetupSteps(file, 'unix')).toEqual([{ kind: 'command', command: 'unix-only' }])
    expect(resolveSetupSteps(file, 'windows')).toEqual([{ kind: 'command', command: 'windows-only' }])
    expect(resolveSetupSteps({ 'setup-worktree': ['generic'] }, 'unix')).toEqual([
      { kind: 'command', command: 'generic' },
    ])
    expect(resolveSetupSteps({ 'setup-worktree': 'scripts/setup.sh' }, 'unix')).toEqual([
      { kind: 'script', path: 'scripts/setup.sh' },
    ])
  })

  it('returns no steps for missing or empty values', () => {
    expect(resolveSetupSteps({}, 'unix')).toEqual([])
    expect(resolveSetupSteps({ 'setup-worktree': [] }, 'unix')).toEqual([])
    expect(resolveSetupSteps({ 'setup-worktree': '   ' }, 'unix')).toEqual([])
    expect(resolveSetupSteps({ 'setup-worktree': ['  ', ''] }, 'unix')).toEqual([])
  })

  it('refuses unsafe paths, bad shapes and oversized lists', () => {
    expect(resolveSetupSteps({ 'setup-worktree': '/etc/passwd' }, 'unix')).toEqual({ error: 'setup-unsafe-path' })
    expect(resolveSetupSteps({ 'setup-worktree': '../x.sh' }, 'unix')).toEqual({ error: 'setup-unsafe-path' })
    expect(resolveSetupSteps({ 'setup-worktree': 42 }, 'unix')).toEqual({ error: 'setup-invalid' })
    expect(resolveSetupSteps({ 'setup-worktree': ['ok', 7] }, 'unix')).toEqual({ error: 'setup-invalid' })
    expect(
      resolveSetupSteps({ 'setup-worktree': Array.from({ length: SETUP_MAX_STEPS + 1 }, () => 'x') }, 'unix'),
    ).toEqual({ error: 'setup-too-many' })
  })

  it('maps the platform string', () => {
    expect(setupPlatform('win32')).toBe('windows')
    expect(setupPlatform('darwin')).toBe('unix')
    expect(setupPlatform('linux')).toBe('unix')
  })

  it('flags unsafe relative paths', () => {
    expect(isUnsafeRelativePath('/abs')).toBe(true)
    expect(isUnsafeRelativePath('//server/share')).toBe(true)
    expect(isUnsafeRelativePath('C:\\x')).toBe(true)
    expect(isUnsafeRelativePath('a/../../b')).toBe(true)
    expect(isUnsafeRelativePath('a/b')).toBe(false)
  })

  it('pins setup child env to the worktree and drops package-manager inheritance', () => {
    const env = setupChildEnv(
      {
        PATH: '/usr/bin',
        npm_config_registry: 'https://example.test',
        PNPM_HOME: '/pnpm',
        NODE_PATH: '/node',
        INIT_CWD: '/parent',
        PWD: '/parent',
        CI: 'false',
      },
      { [SETUP_ENV_ROOT]: '/repo' },
      '/repo/.worktrees/x',
    )
    expect(env.PATH).toBe('/usr/bin')
    expect(env.npm_config_registry).toBeUndefined()
    expect(env.PNPM_HOME).toBeUndefined()
    expect(env.NODE_PATH).toBeUndefined()
    expect(env.INIT_CWD).toBe('/repo/.worktrees/x')
    expect(env.PWD).toBe('/repo/.worktrees/x')
    expect(env.NPM_CONFIG_WORKSPACE_DIR).toBe('/repo/.worktrees/x')
    expect(env.ROOT_WORKTREE_PATH).toBe('/repo')
    expect(env.CI).toBe('false')
  })

  it('defaults CI when the parent has none', () => {
    const env = setupChildEnv({}, {}, '/w')
    expect(env.CI).toBe('true')
    expect(env.SETUP_ENV_ROOT_MISSING).toBeUndefined()
  })
})

describe('.worktreeinclude', () => {
  it('reads literal relative paths, dropping comments and unsafe entries', () => {
    const entries = parseWorktreeInclude([
      '# env files',
      '.env',
      '',
      '  config/local.json  ',
      '/absolute',
      '../escape',
      '.env',
      'sub/dir/file',
    ].join('\n'))
    expect(entries).toEqual(['.env', 'config/local.json', 'sub/dir/file'])
  })

  it('returns nothing for an empty file', () => {
    expect(parseWorktreeInclude('')).toEqual([])
    expect(parseWorktreeInclude('# only a comment')).toEqual([])
  })
})

describe('exclude handling', () => {
  it('detects an existing entry in its accepted spellings', () => {
    expect(excludesWorktrees('.worktrees/\n')).toBe(true)
    expect(excludesWorktrees(`${WORKTREES_DIR}\n`)).toBe(true)
    expect(excludesWorktrees('.worktrees/*\n')).toBe(true)
    expect(excludesWorktrees('node_modules\n')).toBe(false)
  })

  it('appends the entry once, preserving existing content', () => {
    expect(withWorktreesExcluded('')).toBe(`${WORKTREES_EXCLUDE_ENTRY}\n`)
    expect(withWorktreesExcluded('node_modules\n')).toBe(`node_modules\n${WORKTREES_EXCLUDE_ENTRY}\n`)
    expect(withWorktreesExcluded('node_modules')).toBe(`node_modules\n${WORKTREES_EXCLUDE_ENTRY}\n`)
    // Never writes twice: the user's file is not the plugin's to churn.
    expect(withWorktreesExcluded(`${WORKTREES_EXCLUDE_ENTRY}\n`)).toBeNull()
  })

  it('names the project files it owns', () => {
    expect(SETUP_FILE).toBe('.worktrees.json')
    expect(INCLUDE_FILE).toBe('.worktreeinclude')
  })
})
