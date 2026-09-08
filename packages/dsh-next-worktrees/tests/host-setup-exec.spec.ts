import { describe, expect, it } from 'vitest'
import { posixShellQuote, winShellQuote, wrapSetupCommand } from '../src/host/setup-exec.ts'

describe('wrapSetupCommand', () => {
  it('cds into the worktree on posix', () => {
    expect(wrapSetupCommand('pnpm install', '/repos/wt/.dsh/worktrees/foo', false))
      .toBe("cd '/repos/wt/.dsh/worktrees/foo' && pnpm install")
  })

  it('quotes apostrophes in the path', () => {
    expect(posixShellQuote("/tmp/it's")).toBe(`'/tmp/it'\\''s'`)
  })

  it('cds on windows', () => {
    expect(wrapSetupCommand('pnpm install', 'C:\\wt\\foo', true))
      .toBe('cd /d "C:\\wt\\foo" && pnpm install')
    expect(winShellQuote('C:\\say "hi"')).toBe('"C:\\say ""hi"""')
  })
})
