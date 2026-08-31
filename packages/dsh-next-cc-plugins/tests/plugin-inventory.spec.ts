/**
 * Plugin component inventory: every component type, manifest path overrides,
 * malformed inputs, and the skill-file sub-map. Pure core coverage for
 * `pluginInventory` / `skillFiles`.
 */
import { describe, expect, it } from 'vitest'
import { pluginInventory, readManifestPaths, skillFiles } from '../src/core/plugin-inventory.ts'

const SKILL = (name: string, description = 'does things'): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`

function fullPlugin(): Record<string, string> {
  return {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'team-tools', version: '1.0.0' }),
    'skills/deploy/SKILL.md': SKILL('deploy', 'Deploys the app'),
    'skills/deploy/helper.sh': 'echo hi',
    'skills/review/SKILL.md': SKILL('review', 'Reviews code'),
    'commands/ship.md': '---\ndescription: Ship it\n---\nDeploy now.',
    'agents/reviewer.md': '---\ndescription: Reviews PRs\ntools: Bash, Read\nmodel: sonnet\n---\nYou review PRs.',
    'hooks/hooks.json': JSON.stringify({ PreToolUse: [{ matcher: 'Bash' }], Stop: [] }),
    '.mcp.json': JSON.stringify({ mcpServers: { linear: { command: 'npx', args: ['-y', 'linear-mcp'] } } }),
  }
}

describe('pluginInventory', () => {
  it('extracts every component type from the standard layout', () => {
    const inv = pluginInventory(fullPlugin())
    expect(inv.skills.map((s) => s.name)).toEqual(['deploy', 'review'])
    expect(inv.skills[0]).toEqual({ name: 'deploy', description: 'Deploys the app', path: 'skills/deploy' })
    expect(inv.commands).toEqual([{ name: 'ship', description: 'Ship it', path: 'ship.md' }])
    expect(inv.agents).toEqual([{ name: 'reviewer', description: 'Reviews PRs', path: 'reviewer.md', tools: 'Bash, Read', model: 'sonnet' }])
    expect(inv.hookEvents).toEqual(['PreToolUse', 'Stop'])
    expect(inv.mcpServers).toEqual([{
      name: 'linear',
      def: { transport: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'], env: {} },
    }])
    expect(inv.notes).toEqual([])
  })

  it('derives a skill name from its directory when frontmatter has none', () => {
    const inv = pluginInventory({ 'skills/gdrive/SKILL.md': '---\ndescription: Drive access\n---\nbody' })
    expect(inv.skills).toEqual([{ name: 'gdrive', description: 'Drive access', path: 'skills/gdrive' }])
  })

  it('supports flat skills (skills/<name>.md at the root)', () => {
    const inv = pluginInventory({ 'skills/quick.md': SKILL('quick') })
    expect(inv.skills).toEqual([{ name: 'quick', description: 'does things', path: '' }])
  })

  it('notes a hidden skill directory instead of failing', () => {
    const inv = pluginInventory({ 'skills/.hidden/SKILL.md': 'no frontmatter' })
    expect(inv.skills).toEqual([])
    expect(inv.notes.join(' ')).toContain('hidden')
  })

  it('honors plugin.json component path overrides', () => {
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({
        skills: './bundle/skills',
        commands: './bundle/commands',
        agents: './bundle/agents',
        hooks: './bundle/hooks/hooks.json',
        mcpServers: './bundle/.mcp.json',
      }),
      'bundle/skills/x/SKILL.md': SKILL('x'),
      'bundle/commands/go.md': '---\ndescription: Go\n---\n',
      'bundle/agents/bot.md': '---\ndescription: Bot\n---\n',
      'bundle/hooks/hooks.json': JSON.stringify({ Stop: [] }),
      'bundle/.mcp.json': JSON.stringify({ mcpServers: { s: { command: 'run' } } }),
      'skills/ignored/SKILL.md': SKILL('ignored'),
    }
    const inv = pluginInventory(files)
    expect(inv.skills.map((s) => s.name)).toEqual(['x'])
    expect(inv.commands.map((c) => c.name)).toEqual(['go'])
    expect(inv.agents.map((a) => a.name)).toEqual(['bot'])
    expect(inv.hookEvents).toEqual(['Stop'])
    expect(inv.mcpServers.map((s) => s.name)).toEqual(['s'])
  })

  it('ignores nested command markdown but keeps top-level commands', () => {
    const inv = pluginInventory({ 'commands/a/b.md': 'x', 'commands/top.md': 'y' })
    expect(inv.commands.map((c) => c.name)).toEqual(['top'])
  })

  it('notes malformed hooks and MCP JSON instead of failing', () => {
    const inv = pluginInventory({ 'hooks/hooks.json': '{oops', '.mcp.json': '{oops' })
    expect(inv.hookEvents).toEqual([])
    expect(inv.mcpServers).toEqual([])
    expect(inv.notes.length).toBeGreaterThanOrEqual(2)
  })

  it('notes an MCP document without mcpServers', () => {
    const inv = pluginInventory({ '.mcp.json': JSON.stringify({ servers: {} }) })
    expect(inv.mcpServers).toEqual([])
    expect(inv.notes.join(' ')).toContain('mcpServers')
  })

  it('supports remote (http/sse) MCP servers', () => {
    const inv = pluginInventory({ '.mcp.json': JSON.stringify({ mcpServers: {
      web: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
      legacy: { type: 'sse', url: 'https://old.example.com/sse' },
    } }) })
    expect(inv.mcpServers).toEqual([
      { name: 'web', def: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } } },
      { name: 'legacy', def: { transport: 'streamable-http', url: 'https://old.example.com/sse', headers: {} } },
    ])
  })

  it('returns an empty inventory for an empty plugin', () => {
    const inv = pluginInventory({})
    expect(inv.skills).toEqual([])
    expect(inv.commands).toEqual([])
    expect(inv.agents).toEqual([])
    expect(inv.hookEvents).toEqual([])
    expect(inv.mcpServers).toEqual([])
  })
})

describe('readManifestPaths', () => {
  it('ignores a malformed manifest', () => {
    expect(readManifestPaths({ '.claude-plugin/plugin.json': '{oops' })).toEqual({})
  })

  it('keeps only string path overrides', () => {
    expect(readManifestPaths({ '.claude-plugin/plugin.json': JSON.stringify({ skills: 3, commands: './c' }) })).toEqual({ commands: './c' })
  })
})

describe('skillFiles', () => {
  it('returns the skill directory subtree rewritten relative to the skill root', () => {
    const files = fullPlugin()
    expect(skillFiles(files, { name: 'deploy', description: '', path: 'skills/deploy' })).toEqual({
      'SKILL.md': SKILL('deploy', 'Deploys the app'),
      'helper.sh': 'echo hi',
    })
  })

  it('returns a flat skill as a SKILL.md-only map', () => {
    expect(skillFiles({ 'skills/quick.md': SKILL('quick') }, { name: 'quick', description: '', path: '' })).toEqual({
      'SKILL.md': SKILL('quick'),
    })
  })
})
