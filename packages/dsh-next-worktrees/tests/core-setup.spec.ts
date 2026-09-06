import { describe, expect, it } from 'vitest'
import {
  isUnsafeSetupPath,
  parseWorktreesJson,
  resolveSetupSteps,
  setupPlatform,
  worktreesJsonCandidates,
} from '../src/core/setup.ts'

describe('worktreesJsonCandidates', () => {
  it('lists the local override then the project-root file', () => {
    expect(worktreesJsonCandidates('/repos/app')).toEqual([
      '/repos/app/.dsh/worktrees.json',
      '/repos/app/.worktrees.json',
    ])
  })
})

describe('setupPlatform', () => {
  it('treats win32 as windows and everything else as unix', () => {
    expect(setupPlatform('win32')).toBe('windows')
    expect(setupPlatform('darwin')).toBe('unix')
    expect(setupPlatform('linux')).toBe('unix')
  })
})

describe('parseWorktreesJson', () => {
  it('accepts an object', () => {
    expect(parseWorktreesJson('{"setup-worktree":["pnpm install"]}')).toEqual({
      'setup-worktree': ['pnpm install'],
    })
  })

  it('rejects invalid JSON and non-objects', () => {
    expect(parseWorktreesJson('{')).toEqual({ error: '.worktrees.json is not valid JSON' })
    expect(parseWorktreesJson('[]')).toEqual({ error: '.worktrees.json must be a JSON object' })
    expect(parseWorktreesJson('null')).toEqual({ error: '.worktrees.json must be a JSON object' })
    expect(parseWorktreesJson('"x"')).toEqual({ error: '.worktrees.json must be a JSON object' })
  })
})

describe('resolveSetupSteps', () => {
  it('returns no steps when the keys are missing', () => {
    expect(resolveSetupSteps({}, 'unix')).toEqual([])
  })

  it('uses the generic list when no OS key is set', () => {
    expect(resolveSetupSteps({
      'setup-worktree': ['pnpm install', '  ', 'cp "$ROOT_WORKTREE_PATH/.env" .env'],
    }, 'unix')).toEqual([
      { kind: 'command', command: 'pnpm install' },
      { kind: 'command', command: 'cp "$ROOT_WORKTREE_PATH/.env" .env' },
    ])
  })

  it('prefers the unix key on unix and windows key on windows', () => {
    const file = {
      'setup-worktree': ['generic'],
      'setup-worktree-unix': ['unix-only'],
      'setup-worktree-windows': ['win-only'],
    }
    expect(resolveSetupSteps(file, 'unix')).toEqual([{ kind: 'command', command: 'unix-only' }])
    expect(resolveSetupSteps(file, 'windows')).toEqual([{ kind: 'command', command: 'win-only' }])
  })

  it('treats a string as a relative script path', () => {
    expect(resolveSetupSteps({ 'setup-worktree': 'scripts/setup.sh' }, 'unix')).toEqual([
      { kind: 'script', path: 'scripts/setup.sh' },
    ])
  })

  it('rejects an absolute or parent-directory script path', () => {
    expect(resolveSetupSteps({ 'setup-worktree': '/etc/passwd' }, 'unix')).toEqual({
      error: 'setup script path must be relative and stay inside the project',
    })
    expect(resolveSetupSteps({ 'setup-worktree': '../secret.sh' }, 'unix')).toEqual({
      error: 'setup script path must be relative and stay inside the project',
    })
  })

  it('rejects a non-string array entry and a too-long list', () => {
    expect(resolveSetupSteps({ 'setup-worktree': [1] }, 'unix')).toEqual({
      error: 'setup-worktree commands must be strings',
    })
    expect(resolveSetupSteps({ 'setup-worktree': true }, 'unix')).toEqual({
      error: 'setup-worktree must be an array of commands or a script path',
    })
    expect(resolveSetupSteps({
      'setup-worktree': Array.from({ length: 33 }, () => 'true'),
    }, 'unix')).toEqual({
      error: 'setup-worktree is limited to 32 commands',
    })
  })
})

describe('isUnsafeSetupPath', () => {
  it('flags absolute, drive-letter, and parent paths', () => {
    expect(isUnsafeSetupPath('/tmp/x')).toBe(true)
    expect(isUnsafeSetupPath('C:\\windows\\x')).toBe(true)
    expect(isUnsafeSetupPath('foo/../bar')).toBe(true)
    expect(isUnsafeSetupPath('scripts/setup.sh')).toBe(false)
  })
})
