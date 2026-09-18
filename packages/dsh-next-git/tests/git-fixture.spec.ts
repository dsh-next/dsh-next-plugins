import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture, createNonRepository, SCENARIOS, type ScenarioName } from './git-fixture.ts'

/**
 * The fixture is the determinism guarantee for every other suite, so it is
 * tested like production code: every scenario must build, the isolated
 * environment must hold, and two builds of one scenario must produce the same
 * object ids (otherwise a flake could be setup, not the plugin).
 */
describe('git fixture', () => {
  it('builds every scenario', () => {
    for (const scenario of SCENARIOS) {
      const fixture = createFixture(scenario)
      try {
        const outcome = fixture.git(['rev-parse', '--git-dir'])
        expect(outcome.code, `${scenario} should be a repository`).toBe(0)
      } finally {
        fixture.dispose()
      }
    }
  })

  it('isolates the git environment from the user config', () => {
    const fixture = createFixture('clean')
    try {
      // With GIT_CONFIG_GLOBAL pointed at /dev/null the fixture identity is the
      // only one git can see.
      expect(fixture.gitOk(['config', '--get', 'user.name']).trim()).toBe('Fixture Author')
      expect(fixture.gitOk(['config', '--get', 'core.hooksPath']).trim()).toBe(fixture.hooksDir)
      expect(fixture.gitOk(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main')
    } finally {
      fixture.dispose()
    }
  })

  it('is deterministic: two builds produce identical commit ids', () => {
    const first = createFixture('branches')
    const second = createFixture('branches')
    try {
      expect(first.gitOk(['rev-parse', 'HEAD'])).toBe(second.gitOk(['rev-parse', 'HEAD']))
      expect(first.gitOk(['rev-parse', 'HEAD~1'])).toBe(second.gitOk(['rev-parse', 'HEAD~1']))
      expect(first.gitOk(['rev-list', '--all'])).toBe(second.gitOk(['rev-list', '--all']))
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('shapes each working-tree scenario as advertised', () => {
    const expectations: Partial<Record<ScenarioName, string>> = {
      clean: '',
      staged: '1 M. ',
      unstaged: '1 .M ',
      untracked: '? ',
      renamed: '2 R. ',
      ignored: '! ',
      binary: '1 .M ',
      large: '1 .M ',
    }
    for (const [scenario, prefix] of Object.entries(expectations)) {
      const fixture = createFixture(scenario as ScenarioName)
      try {
        const status = fixture.gitOk(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching'])
        if (prefix === '') expect(status, scenario).toBe('')
        else expect(status, scenario).toContain(prefix)
      } finally {
        fixture.dispose()
      }
    }
  })

  it('leaves an operation in progress for each conflict scenario', () => {
    const markers: Record<string, string> = {
      'merge-conflict': 'MERGE_HEAD',
      'rebase-conflict': 'rebase-merge',
      'cherry-pick-conflict': 'CHERRY_PICK_HEAD',
    }
    for (const [scenario, marker] of Object.entries(markers)) {
      const fixture = createFixture(scenario as ScenarioName)
      try {
        // `rebase-merge` is a directory, the others are refs.
        const present = marker === 'rebase-merge'
          ? existsSync(join(fixture.gitDir, marker))
          : fixture.git(['rev-parse', '-q', '--verify', marker]).code === 0
        expect(present, scenario).toBe(true)
        expect(fixture.gitOk(['status', '--porcelain=v2'])).toContain('u UU ')
      } finally {
        fixture.dispose()
      }
    }
  })

  it('measures ahead and behind against a local bare remote', () => {
    const fixture = createFixture('ahead-behind')
    try {
      expect(fixture.gitOk(['rev-list', '--count', '@{u}..HEAD']).trim()).toBe('1')
      expect(fixture.gitOk(['rev-list', '--count', 'HEAD..@{u}']).trim()).toBe('1')
    } finally {
      fixture.dispose()
    }
  })

  it('builds the worktree topology under .worktrees/', () => {
    const fixture = createFixture('worktrees')
    try {
      const list = fixture.gitOk(['worktree', 'list', '--porcelain'])
      expect(list).toContain('/.worktrees/ready')
      expect(list).toContain('refs/heads/dsh-git/ready')
      expect(list).toContain('refs/heads/dsh-git/merged')
      // The convention keeps the primary checkout clean.
      expect(fixture.gitOk(['status', '--porcelain']).trim()).toBe('')
    } finally {
      fixture.dispose()
    }
  })

  it('installs a failing and a hanging pre-commit hook', () => {
    const failing = createFixture('hook-fail')
    try {
      const outcome = failing.git(['commit', '-m', 'should fail'])
      expect(outcome.code).not.toBe(0)
      expect(`${outcome.stdout}${outcome.stderr}`).toContain('fixture pre-commit refused')
    } finally {
      failing.dispose()
    }
    const hanging = createFixture('hook-hang')
    try {
      expect(hanging.git(['config', '--get', 'core.hooksPath']).stdout.trim()).toBe(hanging.hooksDir)
    } finally {
      hanging.dispose()
    }
  })

  it('provides a directory that is not a repository', () => {
    const plain = createNonRepository()
    try {
      expect(plain.dir).not.toBe('')
    } finally {
      plain.dispose()
    }
  })
})
