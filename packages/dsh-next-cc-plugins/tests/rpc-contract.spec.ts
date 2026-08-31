/**
 * RPC contract test: the Host `state()` must return the full browser-facing
 * envelope, and every mutation method must answer with the shared
 * `{ ok, error | message | state }` shape. This pins the regression class
 * where a silent payload-shape mismatch returns HTTP 200 yet renders
 * nothing.
 */
import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { CcMarketplaceService } from '../src/host/service.ts'
import { createGhDouble } from './helpers/gh.ts'
import { createMemFs } from './helpers/memfs.ts'

const SKILL = '---\nname: deploy\ndescription: Deploys\n---\nbody\n'

const MARKET: Record<string, string> = {
  '.claude-plugin/marketplace.json': JSON.stringify({
    name: 'acme-tools',
    plugins: [{ name: 'team-tools', description: 'Tools', version: '1.0.0', source: './plugins/team-tools' }],
  }),
  'plugins/team-tools/skills/deploy/SKILL.md': SKILL,
  'plugins/team-tools/.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'npx' } } }),
}

function makeService(): CcMarketplaceService {
  const gh = createGhDouble({ 'o/r': MARKET })
  return new CcMarketplaceService({
    fs: createMemFs(),
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    home: '/home/u',
    cordisPatchPath: '/home/u/.dsh/cordis.patch.yml',
  })
}

describe('cc-plugins state() RPC contract', () => {
  it('returns the envelope, not raw internals', async () => {
    const state = await makeService().state()
    expect(state).toHaveProperty('installed')
    expect(state).toHaveProperty('marketplaces')
    // Raw persistence keys must NOT sit at the envelope's top level.
    expect(state).not.toHaveProperty('plugins')
    expect(state).not.toHaveProperty('files')
    expect(state).not.toHaveProperty('config')
  })

  it('mutation failures carry { ok: false, error } and success { ok: true, message, state }', async () => {
    const service = makeService()
    const fail = await service.uninstallPlugin('missing')
    expect(fail).toEqual({ ok: false, error: 'plugin "missing" is not installed' })

    await service.addMarketplace('o/r')
    const ok = await service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    expect(ok).toHaveProperty('ok', true)
    expect(typeof (ok as { message?: unknown }).message).toBe('string')
    expect((ok as { state?: unknown }).state).toHaveProperty('installed')
    expect((ok as { state?: unknown }).state).toHaveProperty('marketplaces')
  })

  it('state.installed entries carry the normalized record fields', async () => {
    const service = makeService()
    await service.addMarketplace('o/r')
    await service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    const state = await service.state()
    expect(state.installed).toHaveLength(1)
    const record = state.installed[0]
    expect(Object.keys(record).sort()).toEqual([
      'agents', 'installedAt', 'key', 'marketplaceId', 'marketplaceSpec', 'mcpServers', 'pending',
      'pluginName', 'targets', 'updatedAt', 'version',
    ])
    expect(record.pending).toEqual({ commands: [], hookEvents: [] })
  })

  it('state.marketplaces rows carry the view fields', async () => {
    const service = makeService()
    await service.addMarketplace('o/r')
    const m = (await service.state()).marketplaces[0]
    expect(Object.keys(m).sort()).toEqual(['description', 'id', 'lastSync', 'name', 'owner', 'plugins', 'spec'])
    expect(m.error).toBeUndefined()
    expect(m.plugins[0]).toMatchObject({ name: 'team-tools', installed: false })
  })

  it('getPluginDetail answers the detail envelope', async () => {
    const service = makeService()
    await service.addMarketplace('o/r')
    const detail = await service.getPluginDetail({ marketplaceId: 'github:o/r', plugin: 'team-tools' })
    expect(Object.keys(detail ?? {}).sort()).toEqual(['description', 'inventory', 'name'])
  })
})
