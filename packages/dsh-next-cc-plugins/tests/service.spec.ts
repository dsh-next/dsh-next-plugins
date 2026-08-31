/**
 * Host service integration: marketplaces, installs, MCP rows, uninstall, and
 * update against the in-memory FsLike and a codeload fetch double. Every
 * mutation path and error branch of CcMarketplaceService.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { CcMarketplaceService, SOURCE_MARKER, TRASH_DIR } from '../src/host/service.ts'
import { Store } from '../src/host/store.ts'
import { createGhDouble } from './helpers/gh.ts'
import { createMemFs, type MemFs } from './helpers/memfs.ts'

const SKILL = (name: string, description = 'does things'): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`

const TEAM_TOOLS_V1: Record<string, string> = {
  '.claude-plugin/marketplace.json': JSON.stringify({
    name: 'acme-tools',
    description: 'Internal tools',
    owner: { name: 'Platform' },
    plugins: [
      { name: 'team-tools', description: 'Bundled tools', version: '1.0.0', source: './plugins/team-tools' },
      { name: 'external', description: 'Lives elsewhere', source: { source: 'github', repo: 'x/external' } },
      { name: 'packed', description: 'npm only', source: { source: 'npm', package: 'packed' } },
    ],
  }),
  'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys the app'),
  'plugins/team-tools/skills/deploy/run.sh': 'echo deploy',
  'plugins/team-tools/commands/ship.md': '---\ndescription: Ship it\n---\nShip.',
  'plugins/team-tools/agents/reviewer.md': '---\ndescription: Reviews\n---\nReview.',
  'plugins/team-tools/hooks/hooks.json': JSON.stringify({ PreToolUse: [{ matcher: 'Bash' }] }),
  'plugins/team-tools/.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'npx', args: ['-y', 'linear-mcp'] } } }),
}

const TEAM_TOOLS_V2: Record<string, string> = {
  '.claude-plugin/marketplace.json': JSON.stringify({
    name: 'acme-tools',
    plugins: [
      { name: 'team-tools', description: 'Bundled tools', version: '2.0.0', source: './plugins/team-tools' },
    ],
  }),
  'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys the app v2'),
  'plugins/team-tools/skills/audit/SKILL.md': SKILL('audit', 'Audits things'),
  'plugins/team-tools/commands/ship.md': '---\ndescription: Ship it\n---\nShip.',
  'plugins/team-tools/.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'npx', args: ['-y', 'linear-mcp@2'] } } }),
}

const EXTERNAL_FILES: Record<string, string> = {
  'skills/helper/SKILL.md': SKILL('helper', 'Helps'),
}

const PATCH = '/home/u/.dsh/cordis.patch.yml'

interface Fixture {
  fs: MemFs
  gh: ReturnType<typeof createGhDouble>
  service: CcMarketplaceService
}

function makeFixture(
  seed: Record<string, string> = {},
  over: { agentsEnabled?: boolean; agentModelMap?: Record<string, string>; listRuntimeModels?: () => Promise<Array<{ provider: string; id: string; name: string }>>; env?: Record<string, string | undefined> } = {},
): Fixture {
  const fs = createMemFs(seed)
  const gh = createGhDouble({ 'o/r': TEAM_TOOLS_V1, 'x/external': EXTERNAL_FILES })
  const service = new CcMarketplaceService({
    fs,
    fetch: gh.fetch as FetchLike,
    dshHome: '/home/u/.dsh',
    agentsHome: '/home/u/.agents',
    home: '/home/u',
    cordisPatchPath: PATCH,
    agentsEnabled: over.agentsEnabled !== false,
    agentModelMap: over.agentModelMap,
    listRuntimeModels: over.listRuntimeModels,
    env: over.env,
  })
  return { fs, gh, service }
}

describe('CcMarketplaceService marketplaces', () => {
  let f: Fixture
  beforeEach(() => { f = makeFixture() })

  it('adds a GitHub marketplace and lists its plugins with inventories', async () => {
    const result = await f.service.addMarketplace('o/r')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('acme-tools')
    expect(result.message).toContain('3 plugins')

    const state = await f.service.state()
    expect(state.marketplaces).toHaveLength(1)
    const m = state.marketplaces[0]
    expect(m.id).toBe('github:o/r')
    expect(m.name).toBe('acme-tools')
    expect(m.lastSync).not.toBe('')
    expect(m.plugins.map((p) => p.name)).toEqual(['team-tools', 'external', 'packed'])

    const team = m.plugins[0]
    expect(team.inventory?.skills.map((s) => s.name)).toEqual(['deploy'])
    expect(team.inventory?.commands.map((c) => c.name)).toEqual(['ship'])
    expect(team.inventory?.mcpServers.map((s) => s.name)).toEqual(['linear'])
    expect(team.installed).toBe(false)

    expect(m.plugins[1].inventory).toBeUndefined() // external: resolves on install
    expect(m.plugins[2].sourceUnsupported).toContain('npm')
  })

  it('accepts every GitHub spec form and rejects duplicates and invalid specs', async () => {
    for (const spec of ['o/r', 'https://github.com/o/r', 'https://github.com/o/r.git', 'git@github.com:o/r.git']) {
      const fresh = makeFixture()
      expect((await fresh.service.addMarketplace(spec)).ok).toBe(true)
    }
    expect((await f.service.addMarketplace('o/r')).ok).toBe(true)
    const dup = await f.service.addMarketplace('https://github.com/o/r')
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('already added')
    const bad = await f.service.addMarketplace('gitlab.com/x/y')
    expect(bad.ok).toBe(false)
  })

  it('fails with a readable error when the repo has no marketplace index', async () => {
    f.gh.setRepo('o', 'empty', { 'README.md': 'hi' })
    const result = await f.service.addMarketplace('o/empty')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('marketplace.json')
  })

  it('fails with a readable error when the download fails', async () => {
    f.gh.failRepo('o', 'r', 404)
    const result = await f.service.addMarketplace('o/r')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not found')
  })

  it('honors the .grok-plugin fallback index (Grok Build interop)', async () => {
    f.gh.setRepo('g', 'm', {
      '.grok-plugin/marketplace.json': JSON.stringify({
        name: 'grok-market',
        plugins: [{ name: 'gdrive', source: { type: 'local', path: './plugins/gdrive' } }],
      }),
      'plugins/gdrive/skills/gdrive/SKILL.md': SKILL('gdrive'),
    })
    const result = await f.service.addMarketplace('g/m')
    expect(result.ok).toBe(true)
    const state = await f.service.state()
    expect(state.marketplaces[0].name).toBe('grok-market')
    expect(state.marketplaces[0].plugins[0].inventory?.skills[0].name).toBe('gdrive')
  })

  it('adds a local-directory marketplace from disk', async () => {
    const fs = createMemFs({
      '/local/market/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'local-market',
        plugins: [{ name: 'tool', source: './tools/tool' }],
      }),
      '/local/market/tools/tool/skills/t/SKILL.md': SKILL('t'),
    })
    const service = new CcMarketplaceService({
      fs, fetch: f.gh.fetch as FetchLike,
      dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents', home: '/home/u', cordisPatchPath: PATCH,
    })
    const result = await service.addMarketplace('/local/market')
    expect(result.ok).toBe(true)
    const state = await service.state()
    expect(state.marketplaces[0].id).toBe('local:/local/market')
    expect(state.marketplaces[0].plugins[0].inventory?.skills[0].name).toBe('t')
  })

  it('refreshes all marketplaces and reports failures per marketplace', async () => {
    await f.service.addMarketplace('o/r')
    expect((await f.service.refreshMarketplaces()).ok).toBe(true)
    f.gh.failRepo('o', 'r', 500)
    const failed = await f.service.refreshMarketplaces()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error).toContain('HTTP 500')
  })

  it('getState re-syncs stale snapshots but leaves fresh ones alone', async () => {
    await f.service.addMarketplace('o/r')
    const afterAdd = f.gh.calls.length
    // Fresh snapshot: the panel load answers from the cache.
    await f.service.getState()
    expect(f.gh.calls).toHaveLength(afterAdd)

    // Age the cached snapshot past the TTL: the next panel load re-syncs.
    const snapPath = '/home/u/.dsh/cc-plugins/cache/github_o_r/snapshot.json'
    const snap = JSON.parse(await f.fs.readFile(snapPath)) as { fetchedAt: string }
    await f.fs.writeFile(snapPath, JSON.stringify({ ...snap, fetchedAt: '2020-01-01T00:00:00.000Z' }))
    const state = await f.service.getState()
    expect(f.gh.calls.length).toBeGreaterThan(afterAdd)
    expect(state.marketplaces[0].lastSync).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('getState keeps cached data when a stale refresh fails', async () => {
    await f.service.addMarketplace('o/r')
    const snapPath = '/home/u/.dsh/cc-plugins/cache/github_o_r/snapshot.json'
    const snap = JSON.parse(await f.fs.readFile(snapPath)) as { fetchedAt: string }
    await f.fs.writeFile(snapPath, JSON.stringify({ ...snap, fetchedAt: '2020-01-01T00:00:00.000Z' }))
    f.gh.failRepo('o', 'r', 500)
    // The panel load still answers with the cached catalog and old stamp.
    const state = await f.service.getState()
    expect(state.marketplaces).toHaveLength(1)
    expect(state.marketplaces[0].plugins.map((p) => p.name)).toContain('team-tools')
    expect(state.marketplaces[0].error).toBeUndefined()
  })

  it('marks installedVersion and updateAvailable when the catalog moves ahead', async () => {
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })

    const current = (await f.service.state()).marketplaces[0].plugins[0]
    expect(current.installed).toBe(true)
    expect(current.installedVersion).toBe('1.0.0')
    expect(current.updateAvailable).toBeUndefined()

    f.gh.setRepo('o', 'r', TEAM_TOOLS_V2) // catalog moves to 2.0.0
    await f.service.refreshMarketplaces()
    const ahead = (await f.service.state()).marketplaces[0].plugins[0]
    expect(ahead.version).toBe('2.0.0')
    expect(ahead.installedVersion).toBe('1.0.0')
    expect(ahead.updateAvailable).toBe(true)

    await f.service.updatePlugin('github:o/r/team-tools')
    const updated = (await f.service.state()).marketplaces[0].plugins[0]
    expect(updated.installedVersion).toBe('2.0.0')
    expect(updated.updateAvailable).toBeUndefined()
  })

  it('falls back to the plugin.json version when the entry carries none', async () => {
    const repo = {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'team-tools', source: './plugins/team-tools' }],
      }),
      'plugins/team-tools/.claude-plugin/plugin.json': JSON.stringify({ name: 'team-tools', version: '3.2.1' }),
      'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys the app'),
    }
    f.gh.setRepo('o', 'r', repo)
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })

    const state = await f.service.state()
    // The card shows the effective catalog version (the manifest's), and the
    // record stored it as the installed version.
    expect(state.marketplaces[0].plugins[0].version).toBe('3.2.1')
    expect(state.installed[0].version).toBe('3.2.1')
    expect(state.installed[0].snapshotDigest).toBeDefined()
    expect(state.marketplaces[0].plugins[0].updateAvailable).toBeUndefined()
  })

  it('flags version-less plugins through snapshot digest changes', async () => {
    const repo = (): Record<string, string> => ({
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'team-tools', source: './plugins/team-tools' }],
      }),
      'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys the app'),
    })
    f.gh.setRepo('o', 'r', repo())
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })

    // No version anywhere: nothing to compare yet.
    const fresh = (await f.service.state()).marketplaces[0].plugins[0]
    expect(fresh.version).toBe('')
    expect(fresh.updateAvailable).toBeUndefined()

    // Content changes without any version appearing: the digest moves.
    f.gh.setRepo('o', 'r', { ...repo(), 'plugins/team-tools/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys v2') })
    await f.service.refreshMarketplaces()
    const changed = (await f.service.state()).marketplaces[0].plugins[0]
    expect(changed.updateAvailable).toBe(true)

    // Updating adopts the new digest and clears the flag.
    const result = await f.service.updatePlugin('github:o/r/team-tools')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toContain('latest')
    const updated = (await f.service.state()).marketplaces[0].plugins[0]
    expect(updated.updateAvailable).toBeUndefined()
  })

  it('removes an empty marketplace and refuses one with installed plugins', async () => {
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    const blocked = await f.service.removeMarketplace('github:o/r')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('team-tools')
    await f.service.uninstallPlugin('github:o/r/team-tools')
    const ok = await f.service.removeMarketplace('github:o/r')
    expect(ok.ok).toBe(true)
    expect((await f.service.state()).marketplaces).toHaveLength(0)
  })
})

describe('CcMarketplaceService install', () => {
  let f: Fixture
  beforeEach(() => { f = makeFixture() })

  it('expands ${...} templates in MCP definitions against the plugin root and host env', async () => {
    const repo = {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'db-plugin', source: './plugins/db' }],
      }),
      'plugins/db/.mcp.json': JSON.stringify({
        mcpServers: {
          'db-server': {
            command: 'node',
            args: ['${CLAUDE_PLUGIN_ROOT}/servers/db-server.js'],
            env: { DB_PATH: '${CLAUDE_PLUGIN_DATA}/db', TOKEN: '${DB_TOKEN}', HOME_DIR: '${CLAUDE_PROJECT_DIR}/x' },
          },
          'web-hooks': { type: 'http', url: 'https://${MCP_HOST}/mcp', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } },
        },
      }),
    }
    const env = makeFixture({}, { env: { DB_TOKEN: 'tok-1', MCP_HOST: 'mcp.acme.test', MCP_TOKEN: 'mtok' } })
    env.gh.setRepo('o', 'r', repo)
    await env.service.addMarketplace('o/r')
    const result = await env.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'db-plugin', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)

    const record = (await env.service.state()).installed[0]
    const stdio = record.mcpServers.find((s) => s.claudeName === 'db-server')?.def
    expect(stdio?.transport).toBe('stdio')
    if (stdio?.transport === 'stdio') {
      expect(stdio.args).toEqual(['/home/u/.dsh/cc-plugins/plugins/github_o_r_db-plugin/servers/db-server.js'])
      expect(stdio.env.DB_PATH).toBe('/home/u/.dsh/cc-plugins/data/github_o_r_db-plugin/db')
      expect(stdio.env.TOKEN).toBe('tok-1')
      // No single project dir across targets: left literal, with a note.
      expect(stdio.env.HOME_DIR).toBe('${CLAUDE_PROJECT_DIR}/x')
    }
    const http = record.mcpServers.find((s) => s.claudeName === 'web-hooks')?.def
    expect(http?.transport).toBe('streamable-http')
    if (http?.transport === 'streamable-http') {
      expect(http.url).toBe('https://mcp.acme.test/mcp')
      expect(http.headers.Authorization).toBe('Bearer mtok')
    }

    // The managed patch row carries the expanded command path, and the
    // unresolvable CLAUDE_PROJECT_DIR surfaced in the install notes.
    const patch = env.fs.snapshot()[PATCH] ?? ''
    expect(patch).toContain('/servers/db-server.js')
    if (result.ok) expect(result.message).toContain('CLAUDE_PROJECT_DIR')
  })

  it('persists install notes on the record for later review', async () => {
    f.gh.setRepo('o', 'r', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'rich', source: './plugins/rich' }],
      }),
      'plugins/rich/.lsp.json': JSON.stringify({ go: { command: 'gopls' } }),
      'plugins/rich/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys'),
    })
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'rich', targets: [{ scope: 'global' }] })
    const record = (await f.service.state()).installed[0]
    expect(record.notes).toEqual(['ships 1 LSP server; no DSH bridge, not installed'])
    // A noteless install persists no empty array. (Workspace target so the
    // shared "deploy" skill does not collide with the install above.)
    f.gh.setRepo('x', 'clean', TEAM_TOOLS_V1)
    await f.service.addMarketplace('x/clean')
    await f.service.installPlugin({ marketplaceId: 'github:x/clean', plugin: 'team-tools', targets: [{ scope: 'workspace', workspacePath: '/w1' }] })
    const clean = (await f.service.state()).installed.find((p) => p.key === 'github:x/clean/team-tools')
    expect(clean).toBeDefined()
    expect(clean?.notes).toBeUndefined()
  })

  it('notes declared plugin dependencies without auto-installing them', async () => {
    f.gh.setRepo('o', 'r', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [
          { name: 'vault-user', source: './plugins/vault-user' },
          { name: 'secrets-vault', source: './plugins/secrets-vault' },
        ],
      }),
      'plugins/vault-user/.claude-plugin/plugin.json': JSON.stringify({
        name: 'vault-user',
        dependencies: ['secrets-vault'],
      }),
      'plugins/vault-user/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys'),
      'plugins/secrets-vault/skills/keep/SKILL.md': SKILL('keep', 'Keeps'),
    })
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'vault-user', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('requires plugin(s) secrets-vault; this bridge does not auto-install dependencies')
    // Only the requested plugin installed.
    expect((await f.service.state()).installed).toHaveLength(1)
  })

  it('notes unbridged component families in the install message', async () => {
    f.gh.setRepo('o', 'r', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'rich', source: './plugins/rich' }],
      }),
      'plugins/rich/.lsp.json': JSON.stringify({ go: { command: 'gopls' } }),
      'plugins/rich/monitors/monitors.json': JSON.stringify([{ name: 'm' }]),
      'plugins/rich/skills/deploy/SKILL.md': SKILL('deploy', 'Deploys'),
    })
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'rich', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('ships 1 LSP server; no DSH bridge, not installed')
    expect(result.message).toContain('ships 1 monitor; no DSH bridge, not installed')
    // The view carries the counts for the card summary.
    const view = (await f.service.state()).marketplaces[0].plugins[0]
    expect(view.inventory?.unbridged).toEqual({ lspServers: 1, monitors: 1 })
  })

  it('notes MCP templates that resolve nowhere instead of failing the install', async () => {
    const none = makeFixture()
    none.gh.setRepo('o', 'r', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'db-plugin', source: './plugins/db' }],
      }),
      'plugins/db/.mcp.json': JSON.stringify({
        mcpServers: { lonely: { command: '${MISSING_BIN}', args: [] } },
      }),
    })
    await none.service.addMarketplace('o/r')
    const result = await none.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'db-plugin', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('${MISSING_BIN} which is not set')
    const record = (await none.service.state()).installed[0]
    expect(record.mcpServers[0].def.transport).toBe('stdio')
    if (record.mcpServers[0].def.transport === 'stdio') {
      expect(record.mcpServers[0].def.command).toBe('${MISSING_BIN}')
    }
  })


  it('installs skills natively, writes MCP and agent rows, and materializes the plugin copy', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('1 skill')
    expect(result.message).toContain('1 MCP server')
    expect(result.message).toContain('1 agent tool')
    expect(result.message).toContain('runtime.hooks')

    // Skill files land in the native user skills root, with the source marker.
    expect(f.fs.snapshot()['/home/u/.agents/skills/deploy/SKILL.md']).toContain('name: deploy')
    expect(f.fs.snapshot()['/home/u/.agents/skills/deploy/run.sh']).toBe('echo deploy')
    expect(f.fs.snapshot()['/home/u/.agents/skills/deploy/' + SOURCE_MARKER]).toContain('github:o/r/team-tools')

    // The patch file carries the managed dsh-mcp-client and dsh-tool-subagent rows.
    const patch = f.fs.snapshot()[PATCH] ?? ''
    // stdio MCP rows run with the plugin root as cwd (Claude Code behavior
    // that relative command paths rely on).
    expect(patch).toContain("cwd: '/home/u/.dsh/cc-plugins/plugins/github_o_r_team-tools'")
    expect(patch).toContain("'@deepseek-ai/dsh-mcp-client'")
    expect(patch).toContain("serverName: 'linear'")
    expect(patch).toContain("args: ['-y', 'linear-mcp']")
    expect(patch).toContain("'@deepseek-ai/dsh-tool-subagent'")
    expect(patch).toContain("toolName: 'cc-agent-reviewer'")
    expect(patch).toContain('persona: |-')

    // The plugin copy is materialized for the runtime bridge and hook scripts.
    const snap = f.fs.snapshot()
    expect(snap['/home/u/.dsh/cc-plugins/plugins/github_o_r_team-tools/commands/ship.md']).toBeDefined()
    expect(snap['/home/u/.dsh/cc-plugins/plugins/github_o_r_team-tools/hooks/hooks.json']).toBeDefined()

    // Registry record.
    const state = await f.service.state()
    expect(state.installed).toHaveLength(1)
    const record = state.installed[0]
    expect(record.key).toBe('github:o/r/team-tools')
    expect(record.version).toBe('1.0.0')
    expect(record.targets).toHaveLength(1)
    expect(record.targets[0].scope).toBe('global')
    expect(record.targets[0].skills.map((s) => s.name)).toEqual(['deploy'])
    expect(record.mcpServers.map((s) => s.serverName)).toEqual(['linear'])
    expect(record.agents.map((a) => a.toolName)).toEqual(['cc-agent-reviewer'])
    expect(record.agents[0].persona).toContain('Reviews')
    expect(record.pending).toEqual({ commands: ['ship'], hookEvents: ['PreToolUse'] })
    // The marketplace view flips to installed.
    expect(state.marketplaces[0].plugins[0].installed).toBe(true)
  })

  it('omits agent rows while runtime.agents is disabled', async () => {
    const disabled = makeFixture({}, { agentsEnabled: false })
    await disabled.service.addMarketplace('o/r')
    const result = await disabled.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    const state = await disabled.service.state()
    expect(state.installed[0].agents).toEqual([])
    expect((disabled.fs.snapshot()[PATCH] ?? '')).not.toContain('dsh-tool-subagent')
    // Skills and MCP rows are unaffected by the agent gate.
    expect(disabled.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect((disabled.fs.snapshot()[PATCH] ?? '')).toContain('dsh-mcp-client')
  })

  it('translates mcp__ tool refs in agent frontmatter to the installed server names', async () => {
    f.gh.setRepo('o', 'episodic', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'episodic-market',
        plugins: [{ name: 'episodic-memory', description: 'Memory', version: '1.4.2', source: './plugins/episodic-memory' }],
      }),
      'plugins/episodic-memory/.mcp.json': JSON.stringify({
        mcpServers: { 'episodic-memory': { command: 'npx', args: ['-y', 'episodic-memory-mcp'] } },
      }),
      'plugins/episodic-memory/agents/search-conversations.md':
        '---\ndescription: Search past conversations\nmodel: haiku\ntools: Read, mcp__plugin_episodic-memory_episodic-memory__search, mcp__plugin_episodic-memory_episodic-memory__read\n---\nSearch.',
    })
    await f.service.addMarketplace('o/episodic')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/episodic', plugin: 'episodic-memory', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The plugin-owned refs resolved through the installed row: no drop notes.
    expect(result.message).not.toContain('no DSH counterpart')
    expect(result.message).not.toContain('exotic name')
    const record = (await f.service.state()).installed[0]
    expect(record.agents[0].toolFilter).toEqual(['mcp__episodic-memory__read', 'mcp__episodic-memory__search', 'read'])
    // The unmapped model note stays honest (no agentModelMap in this fixture).
    expect(result.message).toContain('agent "search-conversations": agent model "haiku" has no mapping')
    expect(record.agents[0].model).toBeUndefined()
  })

  it('installs agent models through the effective map (config baseline + saved overrides)', async () => {
    const fs = createMemFs()
    // A saved panel override from an earlier session.
    await fs.writeFile('/home/u/.dsh/cc-plugins/model-map.json', JSON.stringify({ haiku: 'dsh-fast' }))
    const gh = createGhDouble({ 'o/r': TEAM_TOOLS_V1 })
    const service = new CcMarketplaceService({
      fs, fetch: gh.fetch as FetchLike,
      dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents', home: '/home/u', cordisPatchPath: PATCH,
      agentsEnabled: true,
      agentModelMap: { sonnet: 'dsh-pro' },
    })
    await service.addMarketplace('o/r')
    await service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    // reviewer.md has no model: frontmatter, so exercise via a model-bearing agent.
    gh.setRepo('o', 'r', {
      ...TEAM_TOOLS_V1,
      'plugins/team-tools/agents/reviewer.md': '---\ndescription: Reviews\nmodel: haiku\n---\nReview.',
    })
    await service.refreshMarketplaces()
    await service.updatePlugin('github:o/r/team-tools')
    const record = (await service.state()).installed[0]
    expect(record.agents[0].model).toBe('dsh-fast') // the file override wins
  })

  describe('agent model overrides (Models tab)', () => {
    const EPISODIC_AGENT = '---\ndescription: Search\nmodel: haiku\n---\nSearch.'

    async function installEpisodic(over: Parameters<typeof makeFixture>[1] = {}): Promise<Fixture> {
      const fix = makeFixture({}, over)
      fix.gh.setRepo('o', 'episodic', {
        '.claude-plugin/marketplace.json': JSON.stringify({
          name: 'episodic-market',
          plugins: [{ name: 'episodic-memory', description: 'Memory', source: './plugins/episodic-memory' }],
        }),
        'plugins/episodic-memory/agents/search-conversations.md': EPISODIC_AGENT,
      })
      await fix.service.addMarketplace('o/episodic')
      await fix.service.installPlugin({ marketplaceId: 'github:o/episodic', plugin: 'episodic-memory', targets: [{ scope: 'global' }] })
      return fix
    }

    it('state exposes discovered models, the effective map, and aliases from installed agents', async () => {
      const fix = await installEpisodic({ listRuntimeModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' }] })
      const state = await fix.service.state()
      expect(state.models).toEqual([{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' }])
      expect(state.agentModelMap).toEqual({})
      expect(state.agentModelConfig).toEqual({})
      // haiku comes both from the family list and the installed agent's frontmatter.
      expect(state.agentModelAliases).toEqual(['haiku', 'opus', 'sonnet'])
    })

    it('merges config baseline with overrides in the effective map', async () => {
      const fix = await installEpisodic({ agentModelMap: { sonnet: 'dsh-pro' } })
      await fix.service.setAgentModelOverrides({ haiku: 'dsh-fast' })
      const state = await fix.service.state()
      expect(state.agentModelConfig).toEqual({ sonnet: 'dsh-pro' })
      expect(state.agentModelMap).toEqual({ haiku: 'dsh-fast', sonnet: 'dsh-pro' })
      expect(state.agentModelOverrides).toEqual({ haiku: 'dsh-fast' })
    })

    it('an explicit inherit marker suppresses the config baseline', async () => {
      const fix = await installEpisodic({ agentModelMap: { haiku: 'dsh-pro' } })
      // Baseline resolves first.
      expect((await fix.service.state()).installed[0].agents[0].model).toBe('dsh-pro')
      const result = await fix.service.setAgentModelOverrides({ haiku: null })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.message).toContain('haiku -> inherit')
      expect(result.message).toContain('agent "search-conversations" inherits the session model')
      const state = await fix.service.state()
      expect(state.agentModelMap).toEqual({})
      expect(state.agentModelOverrides).toEqual({ haiku: null })
      expect(state.installed[0].agents[0].model).toBeUndefined()
      expect((fix.fs.snapshot()[PATCH] ?? '')).not.toContain("model: 'dsh-pro'")
    })

    it('saving overrides re-resolves installed agent rows and rewrites the managed block', async () => {
      const fix = await installEpisodic()
      const result = await fix.service.setAgentModelOverrides({ haiku: 'dsh-fast' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.message).toContain('saved model overrides: haiku -> dsh-fast')
      expect(result.message).toContain('agent "search-conversations" -> dsh-fast')
      const record = (await fix.service.state()).installed[0]
      expect(record.agents[0].model).toBe('dsh-fast')
      expect(fix.fs.snapshot()[PATCH]).toContain("model: 'dsh-fast'")
    })

    it('clearing overrides returns agents to session-model inheritance', async () => {
      const fix = await installEpisodic()
      await fix.service.setAgentModelOverrides({ haiku: 'dsh-fast' })
      const cleared = await fix.service.setAgentModelOverrides({})
      expect(cleared.ok).toBe(true)
      if (!cleared.ok) return
      expect(cleared.message).toContain('cleared model overrides')
      expect(cleared.message).toContain('agent "search-conversations" inherits the session model')
      const record = (await fix.service.state()).installed[0]
      expect(record.agents[0].model).toBeUndefined()
      expect((fix.fs.snapshot()[PATCH] ?? '')).not.toContain("model: 'dsh-fast'")
    })

    it('sanitizes the payload: non-strings and blank entries drop out, null passes', async () => {
      const fix = await installEpisodic()
      const result = await fix.service.setAgentModelOverrides({ haiku: ' dsh-fast ', '': 'x', opus: 42, sonnet: '', 'claude-3': null } as Record<string, unknown>)
      expect(result.ok).toBe(true)
      const state = await fix.service.state()
      expect(state.agentModelMap).toEqual({ haiku: 'dsh-fast' })
      expect(state.agentModelOverrides).toEqual({ haiku: 'dsh-fast', 'claude-3': null })
      // Corrupt persisted files read as empty maps, never crash the panel.
      await fix.fs.writeFile('/home/u/.dsh/cc-plugins/model-map.json', '{not json')
      expect((await fix.service.state()).agentModelMap).toEqual({})
    })
  })

  it('translates agent tools frontmatter into toolFilter and maps model through agentModelMap', async () => {
    f.gh.setRepo('o', 'agents-repo', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'agents-mkt',
        plugins: [{ name: 'agentic', description: '', version: '1.0.0', source: './plugins/agentic' }],
      }),
      'plugins/agentic/agents/security.md': [
        '---',
        'name: security',
        'description: Security review',
        'tools: Bash, Read, NotebookEdit',
        'model: sonnet',
        '---',
        'You audit changes.',
      ].join('\n'),
    })
    await f.service.addMarketplace('o/agents-repo')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/agents-repo', plugin: 'agentic', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The unmapped tool and the mapped model are both reported.
    expect(result.message).toContain('NotebookEdit')
    expect(result.message).toContain('no DSH counterpart')
    expect(result.message).toContain('sonnet')

    const state = await f.service.state()
    const row = state.installed[0].agents[0]
    expect(row.toolFilter).toEqual(['bash', 'read'])
    expect(row.model).toBeUndefined() // no agentModelMap configured: inherit
    const patch = f.fs.snapshot()[PATCH] ?? ''
    expect(patch).toContain("          allow: ['bash', 'read']")
    expect(patch).not.toContain('agentOptions:')
  })

  it('writes agentOptions.model when the model has a mapping', async () => {
    const mapped = makeFixture({}, { agentModelMap: { sonnet: 'glm-4.7' } })
    mapped.gh.setRepo('o', 'agents-repo', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'agents-mkt',
        plugins: [{ name: 'agentic', description: '', version: '1.0.0', source: './plugins/agentic' }],
      }),
      'plugins/agentic/agents/reviewer.md': '---\ntools: Read\nmodel: sonnet\n---\nReview.',
    })
    await mapped.service.addMarketplace('o/agents-repo')
    const result = await mapped.service.installPlugin({ marketplaceId: 'github:o/agents-repo', plugin: 'agentic', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).not.toContain('agentModelMap')
    const state = await mapped.service.state()
    expect(state.installed[0].agents[0].model).toBe('glm-4.7')
    const patch = mapped.fs.snapshot()[PATCH] ?? ''
    expect(patch).toContain("          allow: ['read']")
    expect(patch).toContain("          model: 'glm-4.7'")
  })

  it('surfaces skill references to plugin-level directories and the nested marketplace description', async () => {
    f.gh.setRepo('o', 'refs-repo', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'refs-mkt',
        metadata: { description: 'Nested description form' },
        plugins: [{ name: 'refsy', description: '', version: '1.0.0', source: './plugins/refsy' }],
      }),
      'plugins/refsy/skills/deep/SKILL.md': '---\nname: deep\ndescription: d\n---\nRead ../references/guide.md.',
      'plugins/refsy/references/guide.md': 'content',
    })
    await f.service.addMarketplace('o/refs-repo')
    // The nested metadata.description form is surfaced on the marketplace row.
    const before = await f.service.state()
    expect(before.marketplaces.find((m) => m.id === 'github:o/refs-repo')?.description).toBe('Nested description form')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/refs-repo', plugin: 'refsy', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('1 skill(s) reference plugin-level "references/"')
    expect(result.message).toContain('do not resolve from the installed skills root')
  })

  it('installs a root-source plugin (the marketplace repo IS the plugin) with inline manifest MCP servers', async () => {
    f.gh.setRepo('o', 'cdt-mcp', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'cdt-plugins',
        description: 'Bundled plugins for actuating Chrome.',
        plugins: [{ name: 'cdt-mcp', description: 'Chrome DevTools', version: '1.8.0', source: './' }],
      }),
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'cdt-mcp',
        version: '1.8.0',
        mcpServers: { 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@1.8.0'] } },
      }),
      'skills/audit/SKILL.md': SKILL('audit', 'Audits pages'),
    })
    await f.service.addMarketplace('o/cdt-mcp')
    // The panel view resolves the root source to an inventory, not an error.
    const before = await f.service.state()
    expect(before.marketplaces[0].plugins[0].sourceUnsupported).toBeUndefined()
    expect(before.marketplaces[0].plugins[0].inventory?.skills.map((s) => s.name)).toEqual(['audit'])
    expect(before.marketplaces[0].plugins[0].inventory?.mcpServers.map((s) => s.name)).toEqual(['chrome-devtools'])

    const result = await f.service.installPlugin({ marketplaceId: 'github:o/cdt-mcp', plugin: 'cdt-mcp', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('1 skill(s)')
    expect(result.message).toContain('1 MCP server')
    expect(f.fs.has('/home/u/.agents/skills/audit/SKILL.md')).toBe(true)
    const patch = f.fs.snapshot()[PATCH] ?? ''
    expect(patch).toContain("'@deepseek-ai/dsh-mcp-client'")
    expect(patch).toContain("serverName: 'chrome-devtools'")
    expect(patch).toContain("command: 'npx'")
    expect(patch).toContain("args: ['chrome-devtools-mcp@1.8.0']")
  })

  it('preserves foreign patch rows around the managed block', async () => {
    f.fs.writeFile(PATCH, "- insert:\n    - id: foreign-row\n      name: 'some-plugin'\n")
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    const patch = f.fs.snapshot()[PATCH] ?? ''
    expect(patch.startsWith("- insert:\n    - id: foreign-row")).toBe(true)
    expect(patch).toContain('cc-mcp-')
  })

  it('rejects a duplicate install and an unsupported source', async () => {
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    const dup = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('already installed')

    const npm = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'packed', targets: [{ scope: 'global' }] })
    expect(npm.ok).toBe(false)
    if (!npm.ok) expect(npm.error).toContain('npm')
  })

  it('requires a workspacePath for workspace scope', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'workspace' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('workspacePath')
  })

  it('installs into the workspace skills root when scoped', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'workspace', workspacePath: '/w1' }] })
    expect(result.ok).toBe(true)
    expect(f.fs.has('/w1/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect(f.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(false)
  })

  it('fails without partial state when a skill already exists', async () => {
    const seeded = makeFixture({ '/home/u/.agents/skills/deploy/SKILL.md': SKILL('deploy', 'existing') })
    await seeded.service.addMarketplace('o/r')
    const result = await seeded.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('already exists')
    // No registry entry and no managed rows were written.
    const state = await seeded.service.state()
    expect(state.installed).toEqual([])
    expect((seeded.fs.snapshot()[PATCH] ?? '')).not.toContain('dsh-mcp-client')
  })

  it('rolls back earlier skills when a later one collides', async () => {
    const seeded = makeFixture({ '/home/u/.agents/skills/second/SKILL.md': SKILL('second', 'existing') })
    seeded.gh.setRepo('o', 'two', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'two',
        plugins: [{ name: 'multi', source: './multi' }],
      }),
      'multi/skills/first/SKILL.md': SKILL('first'),
      'multi/skills/second/SKILL.md': SKILL('second'),
    })
    await seeded.service.addMarketplace('o/two')
    const result = await seeded.service.installPlugin({ marketplaceId: 'github:o/two', plugin: 'multi', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(false)
    expect(seeded.fs.has('/home/u/.agents/skills/first')).toBe(false) // rolled back
    expect((await seeded.service.state()).installed).toEqual([])
  })

  it('fetches an external GitHub plugin source at install time', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'external', targets: [{ scope: 'global' }] })
    expect(result.ok).toBe(true)
    expect(f.fs.has('/home/u/.agents/skills/helper/SKILL.md')).toBe(true)
  })

  it('dedupes a colliding MCP server name across plugins', async () => {
    f.gh.setRepo('o', 'dup', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'dup',
        plugins: [
          { name: 'a', source: './a' },
          { name: 'b', source: './b' },
        ],
      }),
      'a/skills/one/SKILL.md': SKILL('one'),
      'a/.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'x' } } }),
      'b/skills/two/SKILL.md': SKILL('two'),
      'b/.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'y' } } }),
    })
    await f.service.addMarketplace('o/dup')
    await f.service.installPlugin({ marketplaceId: 'github:o/dup', plugin: 'a', targets: [{ scope: 'global' }] })
    const second = await f.service.installPlugin({ marketplaceId: 'github:o/dup', plugin: 'b', targets: [{ scope: 'global' }] })
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.message).toContain('linear-2')
    const patch = f.fs.snapshot()[PATCH] ?? ''
    expect(patch).toContain("serverName: 'linear'")
    expect(patch).toContain("serverName: 'linear-2'")
  })
})

describe('CcMarketplaceService uninstall and update', () => {
  let f: Fixture
  beforeEach(async () => {
    f = makeFixture()
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
  })

  it('uninstalls: skills go to trash, managed rows drop, plugin copy is removed', async () => {
    const result = await f.service.uninstallPlugin('github:o/r/team-tools')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('1 skill')
    expect(result.message).toContain('1 MCP row')
    expect(result.message).toContain('1 agent row')

    const snap = f.fs.snapshot()
    expect(snap['/home/u/.agents/skills/deploy/SKILL.md']).toBeUndefined()
    const trashed = Object.keys(snap).filter((k) => k.startsWith(`/home/u/.agents/skills/${TRASH_DIR}/`) && k.endsWith('SKILL.md'))
    expect(trashed).toHaveLength(1)
    expect((snap[PATCH] ?? '')).not.toContain('dsh-mcp-client')
    expect((snap[PATCH] ?? '')).not.toContain('dsh-tool-subagent')
    expect(Object.keys(snap).some((k) => k.startsWith('/home/u/.dsh/cc-plugins/plugins/github_o_r_team-tools/'))).toBe(false)
    expect((await f.service.state()).installed).toEqual([])
  })

  it('notifies the runtime after install, uninstall, and update', async () => {
    const calls: string[] = []
    const fs = createMemFs()
    const gh = createGhDouble({ 'o/r': TEAM_TOOLS_V1 })
    const service = new CcMarketplaceService({
      fs, fetch: gh.fetch as FetchLike,
      dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents', home: '/home/u', cordisPatchPath: PATCH,
      onInstalledChanged: () => calls.push('changed'),
    })
    await service.addMarketplace('o/r')
    expect(calls).toEqual([]) // marketplace adds do not touch the registry
    await service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'global' }] })
    await service.updatePlugin('github:o/r/team-tools')
    await service.uninstallPlugin('github:o/r/team-tools')
    expect(calls).toHaveLength(3)
  })

  it('uninstall of an unknown key fails cleanly', async () => {
    const result = await f.service.uninstallPlugin('nope')
    expect(result.ok).toBe(false)
  })

  it('installs into multiple targets at once with plugin-level rows emitted once', async () => {
    const result = await f.service.installPlugin({
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      targets: [{ scope: 'workspace', workspacePath: '/w1' }, { scope: 'workspace', workspacePath: '/w2' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('added targets to')
    expect(result.message).toContain('targets:')

    const snap = f.fs.snapshot()
    expect(snap['/w1/.agents/skills/deploy/SKILL.md']).toBeDefined()
    expect(snap['/w2/.agents/skills/deploy/SKILL.md']).toBeDefined()
    const patch = snap[PATCH] ?? ''
    expect(patch.match(/serverName: 'linear'/g)).toHaveLength(1)

    const record = (await f.service.state()).installed[0]
    expect(record.targets.map((t) => t.scope)).toEqual(['global', 'workspace', 'workspace'])
    expect(record.targets[1].skills.map((s) => s.name)).toEqual(['deploy'])
    expect(record.targets[1].skills[0].directory).toBe('/w1/.agents/skills/deploy')
  })

  it('rejects a target that already holds the plugin', async () => {
    const dup = await f.service.installPlugin({
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      targets: [{ scope: 'global' }, { scope: 'workspace', workspacePath: '/w1' }],
    })
    expect(dup.ok).toBe(false)
    if (dup.ok) return
    expect(dup.error).toContain('already installed in the global root')
    // A fresh workspace target still merges.
    const added = await f.service.installPlugin({
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      targets: [{ scope: 'workspace', workspacePath: '/w9' }],
    })
    expect(added.ok).toBe(true)
    const record = (await f.service.state()).installed[0]
    expect(record.targets).toHaveLength(2)
    // Its own MCP row keeps the stable name across the merge.
    expect((f.fs.snapshot()[PATCH] ?? '').match(/serverName: 'linear'/g)).toHaveLength(1)
  })

  it('uninstalls one target while others remain, then fully on the last target', async () => {
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'workspace', workspacePath: '/w1' }] })
    const one = await f.service.uninstallPlugin('github:o/r/team-tools', { scope: 'workspace', workspacePath: '/w1' })
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.message).toContain('1 target(s) remain')
    // Global skills and the managed rows survive.
    const snap = f.fs.snapshot()
    expect(snap['/home/u/.agents/skills/deploy/SKILL.md']).toBeDefined()
    expect((snap[PATCH] ?? '')).toContain("serverName: 'linear'")
    expect((await f.service.state()).installed[0].targets).toHaveLength(1)

    const last = await f.service.uninstallPlugin('github:o/r/team-tools', { scope: 'global' })
    expect(last.ok).toBe(true)
    if (!last.ok) return
    expect(last.message).toContain('uninstalled')
    expect((await f.service.state()).installed).toEqual([])
    expect((f.fs.snapshot()[PATCH] ?? '')).not.toContain('dsh-mcp-client')
  })

  it('rejects uninstalling a target the plugin is not installed in', async () => {
    const miss = await f.service.uninstallPlugin('github:o/r/team-tools', { scope: 'workspace', workspacePath: '/nope' })
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    expect(miss.error).toContain('is not installed in')
  })

  it('updates skills in every target', async () => {
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', targets: [{ scope: 'workspace', workspacePath: '/w1' }] })
    f.gh.setRepo('o', 'r', TEAM_TOOLS_V2)
    const result = await f.service.updatePlugin('github:o/r/team-tools')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const snap = f.fs.snapshot()
    expect(snap['/home/u/.agents/skills/deploy/SKILL.md']).toContain('v2')
    expect(snap['/w1/.agents/skills/deploy/SKILL.md']).toContain('v2')
    expect(snap['/w1/.agents/skills/audit/SKILL.md']).toContain('name: audit')
    const record = (await f.service.state()).installed[0]
    expect(record.targets).toHaveLength(2)
    expect(record.targets[1].skills.map((s) => s.name).sort()).toEqual(['audit', 'deploy'])
  })

  it('migrates a legacy single-scope record on read', async () => {
    const fs = createMemFs()
    const gh = createGhDouble({ 'o/r': TEAM_TOOLS_V1 })
    const store = new Store({ fs, fetch: gh.fetch as FetchLike, root: '/home/u/.dsh/cc-plugins', home: '/home/u' })
    await fs.mkdir('/home/u/.dsh/cc-plugins', { recursive: true })
    await fs.writeFile('/home/u/.dsh/cc-plugins/installed.json', JSON.stringify({
      plugins: [{
        key: 'github:o/r/team-tools',
        marketplaceId: 'github:o/r',
        marketplaceSpec: 'o/r',
        pluginName: 'team-tools',
        version: '1.0.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        scope: 'workspace',
        workspacePath: '/legacy',
        skills: [{ name: 'deploy', directory: '/legacy/.agents/skills/deploy' }],
        mcpServers: [],
        agents: [],
        pending: { commands: [], hookEvents: [] },
      }],
    }))
    const service = new CcMarketplaceService({
      fs, fetch: gh.fetch as FetchLike,
      dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents', home: '/home/u', cordisPatchPath: PATCH, store,
    })
    const state = await service.state()
    expect(state.installed).toHaveLength(1)
    expect(state.installed[0].targets).toEqual([{
      scope: 'workspace',
      workspacePath: '/legacy',
      skills: [{ name: 'deploy', directory: '/legacy/.agents/skills/deploy' }],
    }])
  })

  it('updates skills, MCP defs, and the version from upstream v2', async () => {
    f.gh.setRepo('o', 'r', TEAM_TOOLS_V2)
    const result = await f.service.updatePlugin('github:o/r/team-tools')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('2.0.0')

    const snap = f.fs.snapshot()
    expect(snap['/home/u/.agents/skills/deploy/SKILL.md']).toContain('v2')
    expect(snap['/home/u/.agents/skills/audit/SKILL.md']).toContain('name: audit')
    expect(snap[PATCH]).toContain("args: ['-y', 'linear-mcp@2']")
    expect(snap[PATCH]).toContain("serverName: 'linear'") // stable name

    const state = await f.service.state()
    const record = state.installed[0]
    expect(record.version).toBe('2.0.0')
    expect(record.targets).toHaveLength(1)
    expect(record.targets[0].skills.map((s) => s.name).sort()).toEqual(['audit', 'deploy'])
    expect(record.pending).toEqual({ commands: ['ship'], hookEvents: [] })
  })

  it('trashes skills removed upstream on update', async () => {
    f.gh.setRepo('o', 'r', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme-tools',
        plugins: [{ name: 'team-tools', version: '3.0.0', source: './plugins/team-tools' }],
      }),
      'plugins/team-tools/skills/audit/SKILL.md': SKILL('audit'),
    })
    await f.service.updatePlugin('github:o/r/team-tools')
    const snap = f.fs.snapshot()
    expect(snap['/home/u/.agents/skills/audit/SKILL.md']).toBeDefined()
    const trashed = Object.keys(snap).filter((k) => k.startsWith(`/home/u/.agents/skills/${TRASH_DIR}/`) && k.endsWith('SKILL.md'))
    expect(trashed).toHaveLength(1)
    expect((await f.service.state()).installed[0].targets[0].skills.map((s) => s.name)).toEqual(['audit'])
  })

  it('update of an unknown key fails cleanly', async () => {
    expect((await f.service.updatePlugin('nope')).ok).toBe(false)
  })
})

describe('CcMarketplaceService plugin detail', () => {
  it('resolves detail for a listed plugin and undefined for unknowns', async () => {
    const f = makeFixture()
    await f.service.addMarketplace('o/r')
    const detail = await f.service.getPluginDetail({ marketplaceId: 'github:o/r', plugin: 'team-tools' })
    expect(detail?.inventory.skills.map((s) => s.name)).toEqual(['deploy'])
    expect(await f.service.getPluginDetail({ marketplaceId: 'github:o/r', plugin: 'ghost' })).toBeUndefined()
    expect(await f.service.getPluginDetail({ marketplaceId: 'github:missing', plugin: 'team-tools' })).toBeUndefined()
  })
})
