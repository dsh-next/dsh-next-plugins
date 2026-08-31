/**
 * Plugin component inventory: every component type, manifest path overrides,
 * malformed inputs, the skill-file sub-map, and plugin-level reference
 * detection. Pure core coverage for `pluginInventory` / `skillFiles` /
 * `pluginLevelReferenceNotes`.
 */
import { describe, expect, it } from 'vitest'
import { dependencyNotes, pluginInventory, pluginLevelReferenceNotes, hooksDocument, readManifestPaths, skillFiles, skillSemanticNotes, unbridgedNotes } from '../src/core/plugin-inventory.ts'

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
    expect(inv.commands).toEqual([{ name: 'ship', description: 'Ship it', path: 'ship.md', file: 'commands/ship.md' }])
    expect(inv.agents).toEqual([{
      name: 'reviewer',
      description: 'Reviews PRs',
      path: 'reviewer.md',
      file: 'agents/reviewer.md',
      tools: 'Bash, Read',
      model: 'sonnet',
    }])
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
    expect(inv.skills).toEqual([{ name: 'quick', description: 'does things', path: '', file: 'skills/quick.md' }])
  })

  it('resolves a flat skill whose frontmatter name differs from its file name', () => {
    const files = { 'skills/quick.md': SKILL('lightning-fast') }
    const inv = pluginInventory(files)
    expect(inv.skills.map((s) => s.name)).toEqual(['lightning-fast'])
    // The file is read from its real path, not reconstructed from the name.
    expect(skillFiles(files, inv.skills[0])).toEqual({ 'SKILL.md': SKILL('lightning-fast') })
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
      'skills/ignored/SKILL.md': SKILL('ignored'),    }
    const inv = pluginInventory(files)
    expect(inv.skills.map((s) => s.name)).toEqual(['x'])
    expect(inv.commands.map((c) => c.name)).toEqual(['go'])
    expect(inv.agents.map((a) => a.name)).toEqual(['bot'])
    expect(inv.hookEvents).toEqual(['Stop'])
    expect(inv.mcpServers.map((s) => s.name)).toEqual(['s'])
  })

  it('accepts array overrides mixing directories and single files', () => {
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({
        skills: ['./bundle/skills', './solo/one.md'],
        commands: ['./bundle/commands', './one-off.md'],
        agents: ['./extra/ruler.md'],
        hooks: ['./h/security.json', './h/main.json'],
        mcpServers: ['./mcp/primary.json', './mcp/extra.json'],
      }),
      'bundle/skills/deep/SKILL.md': SKILL('deep'),
      'solo/one.md': SKILL('solo-one'),
      'bundle/commands/go.md': '---\ndescription: Go\n---\n',
      'one-off.md': '---\ndescription: Once\n---\n',
      'extra/ruler.md': '---\ndescription: Rules\n---\n',
      'h/security.json': JSON.stringify({ PreToolUse: [] }),
      'h/main.json': JSON.stringify({ Stop: [], PreToolUse: [] }),
      'mcp/primary.json': JSON.stringify({ mcpServers: { alpha: { command: 'a' } } }),
      'mcp/extra.json': JSON.stringify({ mcpServers: { beta: { command: 'b' }, alpha: { command: 'dup' } } }),
      'skills/ignored/SKILL.md': SKILL('ignored'),
    }
    const inv = pluginInventory(files)
    expect(inv.skills.map((s) => s.name)).toEqual(['deep', 'solo-one'])
    expect(inv.skills.find((s) => s.name === 'solo-one')).toEqual({
      name: 'solo-one',
      description: 'does things',
      path: '',
      file: 'solo/one.md',
    })
    expect(inv.commands.map((c) => c.name)).toEqual(['go', 'one-off'])
    expect(inv.commands.find((c) => c.name === 'one-off')?.file).toBe('one-off.md')
    expect(inv.agents.map((a) => a.name)).toEqual(['ruler'])
    expect(inv.agents[0].file).toBe('extra/ruler.md')
    // Hook files merge, deduplicated and sorted.
    expect(inv.hookEvents).toEqual(['PreToolUse', 'Stop'])
    expect(inv.mcpServers.map((s) => s.name)).toEqual(['alpha', 'beta'])
    expect(inv.notes.join(' ')).toContain('declared in more than one file')
  })

  it('notes override files that do not exist and duplicate skill names across roots', () => {
    const inv = pluginInventory({
      '.claude-plugin/plugin.json': JSON.stringify({
        skills: ['./a', './b'],
        hooks: './missing/hooks.json',
        mcpServers: './missing/.mcp.json',
      }),
      'a/dup/SKILL.md': SKILL('dup'),
      'b/dup/SKILL.md': SKILL('dup'),
    })
    expect(inv.skills.map((s) => s.name)).toEqual(['dup'])
    expect(inv.notes.join(' ')).toContain('listed more than once')
    expect(inv.notes.join(' ')).toContain('hooks file "missing/hooks.json" listed in plugin.json was not found')
    expect(inv.notes.join(' ')).toContain('MCP file "missing/.mcp.json" listed in plugin.json was not found')
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

  it('keeps only string path overrides, normalized to lists', () => {
    expect(readManifestPaths({ '.claude-plugin/plugin.json': JSON.stringify({ skills: 3, commands: './c' }) })).toEqual({ commands: ['./c'] })
    expect(readManifestPaths({
      '.claude-plugin/plugin.json': JSON.stringify({ agents: ['./a.md', 7, ' ', './b'] }),
    })).toEqual({ agents: ['./a.md', './b'] })
    // An empty array or empty string clears the override.
    expect(readManifestPaths({ '.claude-plugin/plugin.json': JSON.stringify({ hooks: [] }) })).toEqual({})
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

  it('reads a single-file skill from its recorded file path', () => {
    expect(skillFiles({ 'solo/one.md': SKILL('solo-one') }, { name: 'solo-one', description: '', path: '', file: 'solo/one.md' }))
      .toEqual({ 'SKILL.md': SKILL('solo-one') })
  })
})

describe('hooksDocument', () => {
  it('returns the default hooks file when no override exists', () => {
    expect(hooksDocument({ 'hooks/hooks.json': '{"Stop":[]}' })).toBe('{"Stop":[]}')
    expect(hooksDocument({})).toBe('')
  })

  it('returns the first existing manifest-named hooks file', () => {
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({ hooks: ['./h/security.json', './h/main.json'] }),
      'h/main.json': '{"Stop":[]}',
    }
    expect(hooksDocument(files)).toBe('{"Stop":[]}')
  })
})

describe('pluginLevelReferenceNotes', () => {
  const REF_PLUGIN = (): Record<string, string> => ({
    'skills/analyze/SKILL.md': '---\nname: analyze\ndescription: d\n---\nRead ../references/aql.md first.',
    'skills/visualize/SKILL.md': '---\nname: visualize\ndescription: d\n---\nSee references/chart-types.md.',
    'skills/self-contained/SKILL.md': SKILL('self-contained'),
    'references/aql.md': 'content',
    'references/chart-types.md': 'content',
    '.claude-plugin/plugin.json': '{}',
  })

  it('notes plugin-level directories the skills actually reference', () => {
    const files = REF_PLUGIN()
    const inv = pluginInventory(files)
    expect(pluginLevelReferenceNotes(files, inv.skills)).toEqual([
      '2 skill(s) reference plugin-level "references/"; those paths do not resolve from the installed skills root',
    ])
  })

  it('stays silent when the directory does not exist or the mention is prose', () => {
    // No references/ directory at all: the ../references mention is prose.
    const prose = { 'skills/analyze/SKILL.md': REF_PLUGIN()['skills/analyze/SKILL.md'] }
    const inv = pluginInventory(prose)
    expect(pluginLevelReferenceNotes(prose, inv.skills)).toEqual([])
    // The directory exists but no skill mentions it.
    const unused = { 'skills/only/SKILL.md': SKILL('only'), 'assets/logo.svg': 'x' }
    const inv2 = pluginInventory(unused)
    expect(pluginLevelReferenceNotes(unused, inv2.skills)).toEqual([])
  })

  it('never treats component roots as plugin-level references', () => {
    const files = {
      'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\nSee skills/b/SKILL.md and commands/run.md.',
      'skills/b/SKILL.md': SKILL('b'),
      'commands/run.md': '---\ndescription: d\n---\nRun.',
    }
    const inv = pluginInventory(files)
    expect(pluginLevelReferenceNotes(files, inv.skills)).toEqual([])
  })
})

describe('inline plugin.json mcpServers', () => {
  const INLINE = (): Record<string, string> => ({
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'cdt',
      version: '1.8.0',
      mcpServers: { 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@1.8.0'] } },
    }),
    'skills/audit/SKILL.md': SKILL('audit'),
  })

  it('inventories MCP servers declared inline in plugin.json (no .mcp.json)', () => {
    const inv = pluginInventory(INLINE())
    expect(inv.mcpServers).toEqual([{
      name: 'chrome-devtools',
      def: { transport: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@1.8.0'], env: {} },
    }])
    expect(inv.notes).toEqual([])
  })

  it('prefers a .mcp.json file over the inline manifest declaration', () => {
    const inv = pluginInventory({ ...INLINE(), '.mcp.json': JSON.stringify({ mcpServers: { file: { command: 'run' } } }) })
    expect(inv.mcpServers.map((s) => s.name)).toEqual(['file'])
  })

  it('stays quiet when neither form is present or the manifest is malformed', () => {
    expect(pluginInventory({ 'skills/a/SKILL.md': SKILL('a') }).mcpServers).toEqual([])
    expect(pluginInventory({ '.claude-plugin/plugin.json': '{oops', 'skills/a/SKILL.md': SKILL('a') }).mcpServers).toEqual([])
    expect(pluginInventory({ '.claude-plugin/plugin.json': '{"mcpServers": "not-an-object"}', 'skills/a/SKILL.md': SKILL('a') }).mcpServers).toEqual([])
  })
})

describe('unbridged component families', () => {
  it('counts every family from the default layout', () => {
    const inv = pluginInventory({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'rich' }),
      '.lsp.json': JSON.stringify({ go: { command: 'gopls' }, ts: { command: 'tsserver' } }),
      'monitors/monitors.json': JSON.stringify([{ name: 'deploy-status' }]),
      'output-styles/terse.md': '# Terse',
      'output-styles/verbose.md': '# Verbose',
      'themes/dracula.json': '{"name":"dracula"}',
      'workflows/release-audit.js': 'x',
      'bin/my-tool': '#!/bin/sh',
      'settings.json': JSON.stringify({ agent: 'editor' }),
      'skills/a/SKILL.md': SKILL('a'),
    })
    expect(inv.unbridged).toEqual({
      lspServers: 2,
      monitors: 1,
      outputStyles: 2,
      themes: 1,
      workflows: 1,
      executables: 1,
      settings: 1,
    })
    expect(unbridgedNotes(inv.unbridged)).toEqual([
      'ships 2 LSP servers; no DSH bridge, not installed',
      'ships 1 monitor; no DSH bridge, not installed',
      'ships 2 output styles; no DSH bridge, not installed',
      'ships 1 theme; no DSH bridge, not installed',
      'ships 1 workflow; no DSH bridge, not installed',
      'ships 1 executable; no DSH bridge, not installed',
      'ships 1 settings file; no DSH bridge, not installed',
    ])
  })

  it('reads manifest paths and inline declarations', () => {
    const inv = pluginInventory({
      '.claude-plugin/plugin.json': JSON.stringify({
        lspServers: { python: { command: 'pyright' } },
        outputStyles: './styles/terse.md',
        experimental: { themes: './skins', monitors: './watch/m.json' },
      }),
      'styles/terse.md': 'x',
      'skins/dark.json': '{}',
      'skins/light.json': '{}',
      'watch/m.json': JSON.stringify([{ name: 'a' }, { name: 'b' }]),
    })
    expect(inv.unbridged).toEqual({ lspServers: 1, outputStyles: 1, themes: 2, monitors: 2 })
  })

  it('stays empty and noteless for a plugin without those families', () => {
    const inv = pluginInventory({ 'skills/a/SKILL.md': SKILL('a') })
    expect(inv.unbridged).toEqual({})
    expect(unbridgedNotes(inv.unbridged)).toEqual([])
  })

  it('notes malformed family JSON instead of failing', () => {
    const inv = pluginInventory({ '.lsp.json': '{oops', 'monitors/monitors.json': '[nope' })
    expect(inv.unbridged).toEqual({})
    expect(inv.notes.join(' ')).toContain('LSP servers file ".lsp.json" is not valid JSON')
    expect(inv.notes.join(' ')).toContain('Monitors file "monitors/monitors.json" is not valid JSON')
  })

  it('never treats unbridged roots as plugin-level skill references', () => {
    const files = {
      'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\nSee themes/dark.json and bin/tool.',
      'themes/dark.json': '{}',
      'bin/tool': 'x',
    }
    expect(pluginLevelReferenceNotes(files, pluginInventory(files).skills)).toEqual([])
  })
})

describe('plugin dependencies', () => {
  it('reads string and versioned object entries', () => {
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({
        dependencies: ['helper-lib', { name: 'secrets-vault', version: '~2.1.0' }, { name: 'bare' }],
      }),
    }
    expect(pluginInventory(files).dependencies).toEqual(['helper-lib', 'secrets-vault@~2.1.0', 'bare'])
    expect(dependencyNotes(pluginInventory(files).dependencies)).toEqual([
      'requires plugin(s) helper-lib, secrets-vault@~2.1.0, bare; this bridge does not auto-install dependencies',
    ])
  })

  it('drops invalid entries and stays empty without the field', () => {
    expect(pluginInventory({}).dependencies).toEqual([])
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({ dependencies: [7, null, { version: '1.0.0' }, '  ', 'ok'] }),
    }
    expect(pluginInventory(files).dependencies).toEqual(['ok'])
    expect(dependencyNotes([])).toEqual([])
  })
})

describe('skill semantic-difference notes', () => {
  it('notes the frontmatter keys DSH skills do not act on, per skill', () => {
    const files = {
      'skills/deploy/SKILL.md': '---\nname: deploy\ndescription: d\nallowed-tools: Bash, Read\nmodel: sonnet\n---\nbody',
      'skills/audit/SKILL.md': '---\nname: audit\ndescription: d\ndisallowed-tools:\n  - AskUserQuestion\ncontext: fork\n---\nbody',
      'skills/clean/SKILL.md': '---\nname: clean\ndescription: d\n---\nbody',
    }
    const inv = pluginInventory(files)
    expect(skillSemanticNotes(files, inv.skills)).toEqual([
      'skill "audit" declares disallowed-tools, context which DSH skills do not act on',
      'skill "deploy" declares allowed-tools, model which DSH skills do not act on',
    ])
  })

  it('stays silent for DSH-native keys and frontmatter-less skills', () => {
    const files = {
      // disable-model-invocation and user-invocable pass through working:
      // DSH's own skill runtime reads them.
      'skills/plain/SKILL.md': '---\nname: plain\ndescription: d\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody',
      'skills/bare/SKILL.md': 'no frontmatter at all',
    }
    const inv = pluginInventory(files)
    expect(skillSemanticNotes(files, inv.skills)).toEqual([])
  })
})
