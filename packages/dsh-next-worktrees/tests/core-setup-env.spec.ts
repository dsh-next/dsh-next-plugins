import { describe, expect, it } from 'vitest'
import { setupChildEnv } from '../src/core/setup-env.ts'

describe('setupChildEnv', () => {
  it('drops npm/pnpm workspace inheritance and pins cwd', () => {
    const env = setupChildEnv(
      {
        PATH: '/usr/bin',
        HOME: '/Users/x',
        npm_config_workspace: '/repos/harbor',
        npm_package_json: '/repos/harbor/package.json',
        PNPM_SCRIPT_SRC_DIR: '/repos/harbor',
        NPM_CONFIG_WORKSPACE_DIR: '/repos/harbor',
        INIT_CWD: '/repos/harbor',
        PWD: '/repos/harbor',
        NODE_PATH: '/repos/harbor/node_modules',
        NODE_ENV: 'development',
      },
      { ROOT_WORKTREE_PATH: '/repos/harbor' },
      '/repos/harbor/.dsh/worktrees/swift-01',
    )
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/x')
    expect(env.NODE_ENV).toBe('development')
    expect(env.ROOT_WORKTREE_PATH).toBe('/repos/harbor')
    expect(env.INIT_CWD).toBe('/repos/harbor/.dsh/worktrees/swift-01')
    expect(env.PWD).toBe('/repos/harbor/.dsh/worktrees/swift-01')
    expect(env.NPM_CONFIG_WORKSPACE_DIR).toBe('/repos/harbor/.dsh/worktrees/swift-01')
    expect(env.npm_config_workspace_dir).toBe('/repos/harbor/.dsh/worktrees/swift-01')
    expect(env.CI).toBe('true')
    expect(env.npm_config_confirm_modules_purge).toBe('false')
    expect(env.npm_config_workspace).toBeUndefined()
    expect(env.npm_package_json).toBeUndefined()
    expect(env.PNPM_SCRIPT_SRC_DIR).toBeUndefined()
    expect(env.NODE_PATH).toBeUndefined()
  })

  it('keeps an explicit CI value', () => {
    const env = setupChildEnv({ CI: '1', PATH: '/bin' }, {}, '/wt')
    expect(env.CI).toBe('1')
  })
})
