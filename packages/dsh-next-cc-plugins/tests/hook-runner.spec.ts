/**
 * The hook-command environment composition: Claude contract variables ride
 * the runner, and the plugin's `bin/` directory joins the head of `PATH`
 * (Claude Code puts plugin executables on the PATH hooks invoke them by
 * name from). Pure coverage for `host/hook-runner.ts`'s `hookEnv`.
 */
import { describe, expect, it } from 'vitest'
import { hookEnv } from '../src/host/hook-runner.ts'

describe('hookEnv', () => {
  it('prepends the plugin bin directory to PATH', () => {
    const env = hookEnv({ PATH: '/usr/bin:/bin', HOME: '/home/u' }, '/root/plugins/team-tools')
    expect(env.PATH).toBe('/root/plugins/team-tools/bin:/usr/bin:/bin')
    // Other variables pass through untouched.
    expect(env.HOME).toBe('/home/u')
  })

  it('uses the bin directory alone when the base PATH is missing', () => {
    expect(hookEnv({}, '/p').PATH).toBe('/p/bin')
    expect(hookEnv({ PATH: '' }, '/p').PATH).toBe('/p/bin')
  })

  it('does not mutate the input environment', () => {
    const base = { PATH: '/usr/bin' } as Record<string, string | undefined>
    hookEnv(base, '/p')
    expect(base.PATH).toBe('/usr/bin')
  })
})
