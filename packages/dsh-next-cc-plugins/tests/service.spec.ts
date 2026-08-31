/**
 * Host service integration: marketplaces, installs, MCP rows, uninstall, and
 * update against the in-memory FsLike and a codeload fetch double. Every
 * mutation path and error branch of CcMarketplaceService.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/core/types.ts'
import { CcMarketplaceService, SOURCE_MARKER, TRASH_DIR } from '../src/host/service.ts'
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
  over: { agentsEnabled?: boolean; agentModelMap?: Record<string, string> } = {},
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

  it('removes an empty marketplace and refuses one with installed plugins', async () => {
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
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

  it('installs skills natively, writes MCP and agent rows, and materializes the plugin copy', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
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
    expect(record.scope).toBe('global')
    expect(record.skills.map((s) => s.name)).toEqual(['deploy'])
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
    const result = await disabled.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
    expect(result.ok).toBe(true)
    const state = await disabled.service.state()
    expect(state.installed[0].agents).toEqual([])
    expect((disabled.fs.snapshot()[PATCH] ?? '')).not.toContain('dsh-tool-subagent')
    // Skills and MCP rows are unaffected by the agent gate.
    expect(disabled.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect((disabled.fs.snapshot()[PATCH] ?? '')).toContain('dsh-mcp-client')
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
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/agents-repo', plugin: 'agentic', scope: 'global' })
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
    const result = await mapped.service.installPlugin({ marketplaceId: 'github:o/agents-repo', plugin: 'agentic', scope: 'global' })
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
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/refs-repo', plugin: 'refsy', scope: 'global' })
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

    const result = await f.service.installPlugin({ marketplaceId: 'github:o/cdt-mcp', plugin: 'cdt-mcp', scope: 'global' })
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
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
    const patch = f.fs.snapshot()[PATCH] ?? ''
    expect(patch.startsWith("- insert:\n    - id: foreign-row")).toBe(true)
    expect(patch).toContain('cc-mcp-')
  })

  it('rejects a duplicate install and an unsupported source', async () => {
    await f.service.addMarketplace('o/r')
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
    const dup = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('already installed')

    const npm = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'packed', scope: 'global' })
    expect(npm.ok).toBe(false)
    if (!npm.ok) expect(npm.error).toContain('npm')
  })

  it('requires a workspacePath for workspace scope', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'workspace' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('workspacePath')
  })

  it('installs into the workspace skills root when scoped', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'workspace', workspacePath: '/w1' })
    expect(result.ok).toBe(true)
    expect(f.fs.has('/w1/.agents/skills/deploy/SKILL.md')).toBe(true)
    expect(f.fs.has('/home/u/.agents/skills/deploy/SKILL.md')).toBe(false)
  })

  it('fails without partial state when a skill already exists', async () => {
    const seeded = makeFixture({ '/home/u/.agents/skills/deploy/SKILL.md': SKILL('deploy', 'existing') })
    await seeded.service.addMarketplace('o/r')
    const result = await seeded.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
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
    const result = await seeded.service.installPlugin({ marketplaceId: 'github:o/two', plugin: 'multi', scope: 'global' })
    expect(result.ok).toBe(false)
    expect(seeded.fs.has('/home/u/.agents/skills/first')).toBe(false) // rolled back
    expect((await seeded.service.state()).installed).toEqual([])
  })

  it('fetches an external GitHub plugin source at install time', async () => {
    await f.service.addMarketplace('o/r')
    const result = await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'external', scope: 'global' })
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
    await f.service.installPlugin({ marketplaceId: 'github:o/dup', plugin: 'a', scope: 'global' })
    const second = await f.service.installPlugin({ marketplaceId: 'github:o/dup', plugin: 'b', scope: 'global' })
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
    await f.service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
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
    await service.installPlugin({ marketplaceId: 'github:o/r', plugin: 'team-tools', scope: 'global' })
    await service.updatePlugin('github:o/r/team-tools')
    await service.uninstallPlugin('github:o/r/team-tools')
    expect(calls).toHaveLength(3)
  })

  it('uninstall of an unknown key fails cleanly', async () => {
    const result = await f.service.uninstallPlugin('nope')
    expect(result.ok).toBe(false)
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
    expect(record.skills.map((s) => s.name).sort()).toEqual(['audit', 'deploy'])
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
    expect((await f.service.state()).installed[0].skills.map((s) => s.name)).toEqual(['audit'])
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
