/**
 * MCP row rendering and managed-block splicing: the exact YAML the plugin
 * writes into `$DSH_HOME/cordis.patch.yml`, the marker-delimited replace/
 * append/remove behavior, and preservation of foreign patch content. Pure
 * core coverage for `core/mcp.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  applyManagedBlock,
  applyManagedBlockText,
  expandMcpServerTemplates,
  extractManagedBlock,
  normalizeMcpServers,
  renderMcpConfig,
  renderMcpRow,
  renderManagedBlock,
  resolveServerName,
} from '../src/core/mcp.ts'

const STDIO = { transport: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { TOKEN: 'abc' } }
const HTTP = { transport: 'streamable-http' as const, url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } }

describe('renderManagedBlock', () => {
  it('renders dsh-mcp-client rows inside the markers', () => {
    const text = renderManagedBlock([{ rowId: 'cc-mcp-a-b-linear', serverName: 'linear', def: STDIO }])
    const lines = text.split('\n')
    expect(lines[0]).toBe(MANAGED_BEGIN)
    expect(lines[1]).toBe('- insert:')
    expect(lines[2]).toBe("    - id: 'cc-mcp-a-b-linear'")
    expect(lines[3]).toBe("      name: '@deepseek-ai/dsh-mcp-client'")
    expect(lines[4]).toBe('      config:')
    expect(lines[5]).toBe("        serverName: 'linear'")
    expect(lines[6]).toBe("        transport: 'stdio'")
    expect(lines[7]).toBe("        command: 'npx'")
    expect(lines[8]).toBe("        args: ['-y', '@modelcontextprotocol/server-github']")
    expect(lines[9]).toBe("        env: { 'TOKEN': 'abc' }")
    expect(lines[lines.length - 1]).toBe(MANAGED_END)
  })

  it('renders http servers with url and headers', () => {
    const text = renderManagedBlock([{ rowId: 'r', serverName: 'web', def: HTTP }])
    expect(text).toContain("        transport: 'streamable-http'")
    expect(text).toContain("        url: 'https://mcp.example.com/mcp'")
    expect(text).toContain("        headers: { 'Authorization': 'Bearer t' }")
    expect(text).not.toContain('command:')
  })

  it('omits empty env and headers collections', () => {
    const text = renderManagedBlock([{ rowId: 'r', serverName: 's', def: { transport: 'stdio', command: 'run', args: [], env: {} } }])
    expect(text).not.toContain('env:')
    expect(text).toContain('args: []')
  })

  it('escapes single quotes in scalars', () => {
    const text = renderManagedBlock([{ rowId: 'r', serverName: 's', def: { ...STDIO, command: "it's" } }])
    expect(text).toContain("command: 'it''s'")
  })

  it('returns an empty string for no rows', () => {
    expect(renderManagedBlock([])).toBe('')
  })

  it('renders agent delegation rows with the persona as a block scalar', () => {
    const text = renderManagedBlock([
      { rowId: 'cc-agent-k-reviewer', toolName: 'cc-agent-reviewer', persona: '---\nname: reviewer\ndescription: Reviews\n---\nYou review PRs.\n\nCarefully.' },
    ])
    expect(text).toContain("      name: '@deepseek-ai/dsh-tool-subagent'")
    expect(text).toContain("        provider: 'spawn'")
    expect(text).toContain("        toolName: 'cc-agent-reviewer'")
    expect(text).toContain('        persona: |-\n          ---\n          name: reviewer\n          description: Reviews\n          ---\n          You review PRs.\n\n          Carefully.')
    expect(text).not.toContain('toolFilter:')
    expect(text).not.toContain('agentOptions:')
  })

  it('renders translated toolFilter and mapped model on agent rows', () => {
    const text = renderManagedBlock([
      { rowId: 'r', toolName: 'cc-agent-reviewer', persona: 'You review PRs.', toolFilter: ['bash', 'read'], model: 'glm-4.7' },
    ])
    expect(text).toContain("        toolFilter:\n          allow: ['bash', 'read']")
    expect(text).toContain("        agentOptions:\n          model: 'glm-4.7'")
    // toolFilter/agentOptions sit before the persona, all under config.
    expect(text.indexOf('toolFilter:')).toBeGreaterThan(text.indexOf('config:'))
    expect(text.indexOf('persona:')).toBeGreaterThan(text.indexOf('agentOptions:'))
  })

  it('escapes quotes inside a mapped model id', () => {
    const text = renderManagedBlock([{ rowId: 'r', toolName: 't', persona: 'p', model: "it's" }])
    expect(text).toContain("model: 'it''s'")
  })

  it('mixes MCP and agent rows in one block', () => {
    const text = renderManagedBlock([
      { rowId: 'r1', serverName: 's', def: STDIO },
      { rowId: 'r2', toolName: 'cc-agent-x', persona: 'Be X.' },
    ])
    expect(text).toContain("'@deepseek-ai/dsh-mcp-client'")
    expect(text).toContain("'@deepseek-ai/dsh-tool-subagent'")
  })
})

describe('applyManagedBlock', () => {
  it('appends the block to an empty file', () => {
    const next = applyManagedBlock('', [{ rowId: 'r', serverName: 's', def: STDIO }])
    expect(next.startsWith(MANAGED_BEGIN)).toBe(true)
    expect(next.endsWith(MANAGED_END + '\n')).toBe(true)
  })

  it('appends after foreign rows, preserving them byte-for-byte', () => {
    const foreign = "- insert:\n    - id: my-row\n      name: 'my-plugin'\n"
    const next = applyManagedBlock(foreign, [{ rowId: 'r', serverName: 's', def: STDIO }])
    expect(next.startsWith(foreign + '\n')).toBe(true)
    expect(next).toContain(MANAGED_BEGIN)
  })

  it('replaces an existing block in place', () => {
    const first = applyManagedBlock('', [{ rowId: 'r1', serverName: 'one', def: STDIO }])
    const second = applyManagedBlock(first, [{ rowId: 'r2', serverName: 'two', def: HTTP }])
    expect(second).not.toContain("'r1'")
    expect(second).toContain("'r2'")
    expect(second.split(MANAGED_BEGIN).length - 1).toBe(1)
    expect(second.split(MANAGED_END).length - 1).toBe(1)
  })

  it('removes the block when rows become empty', () => {
    const withBlock = applyManagedBlock('foreign: 1\n', [{ rowId: 'r', serverName: 's', def: STDIO }])
    const cleared = applyManagedBlock(withBlock, [])
    expect(cleared).not.toContain(MANAGED_BEGIN)
    expect(cleared).toContain('foreign: 1')
  })

  it('leaves the canonical empty array when the removal empties the file', () => {
    // Uninstalling the last plugin must never leave an empty document: the
    // loader requires a top-level array and refuses to boot otherwise.
    const blockOnly = applyManagedBlock('', [{ rowId: 'r', serverName: 's', def: STDIO }])
    expect(applyManagedBlock(blockOnly, [])).toBe('[]\n')
  })

  it('replaces the canonical empty array when the first block arrives', () => {
    // Round trip of the removal placeholder: appending to `[]` must swap the
    // placeholder out, never concatenate rows after the array's end.
    const next = applyManagedBlock('[]\n', [{ rowId: 'r', serverName: 's', def: STDIO }])
    expect(next.startsWith(MANAGED_BEGIN)).toBe(true)
    expect(next).not.toContain('[]')
    expect(applyManagedBlock(next, [])).toBe('[]\n')
  })

  it('leaves a file without a block untouched when rows are empty', () => {
    expect(applyManagedBlock('x: 1\n', [])).toBe('x: 1\n')
  })

  it('applyManagedBlockText matches the rows form', () => {
    const rows = [{ rowId: 'r', serverName: 's', def: STDIO }]
    expect(applyManagedBlockText('a: 1\n', renderManagedBlock(rows))).toBe(applyManagedBlock('a: 1\n', rows))
  })
})

describe('extractManagedBlock', () => {
  it('returns null without markers and the block with them', () => {
    expect(extractManagedBlock('nothing')).toBeNull()
    const block = renderManagedBlock([{ rowId: 'r', serverName: 's', def: STDIO }])
    expect(extractManagedBlock(`before\n${block}\nafter`)).toBe(block)
  })
})

describe('normalizeMcpServers', () => {
  it('notes invalid definitions instead of failing', () => {
    const notes: string[] = []
    const { servers } = normalizeMcpServers({
      broken: 'not-an-object',
      noShape: {},
      noUrl: { type: 'http' },
    }, notes)
    expect(servers).toEqual([])
    expect(notes.length).toBe(3)
  })

  it('accepts stdio without an explicit type', () => {
    const notes: string[] = []
    const { servers } = normalizeMcpServers({ s: { command: 'node', args: ['s.js'], env: { A: '1' } } }, notes)
    expect(servers).toEqual([{ name: 's', def: { transport: 'stdio', command: 'node', args: ['s.js'], env: { A: '1' } } }])
    expect(notes).toEqual([])
  })

  it('rejects a non-object mcpServers root', () => {
    const notes: string[] = []
    expect(normalizeMcpServers([1, 2], notes).servers).toEqual([])
    expect(notes.join(' ')).toContain('not an object')
  })
})

describe('resolveServerName', () => {
  it('keeps valid names and sanitizes invalid ones', () => {
    expect(resolveServerName('github')).toEqual({ name: 'github', sanitized: false })
    expect(resolveServerName('my server!')).toEqual({ name: 'my-server', sanitized: true })
    expect(resolveServerName('a'.repeat(40)).name.length).toBeLessThanOrEqual(32)
  })
})

describe('renderMcpConfig cwd', () => {
  it('emits cwd for stdio servers so relative command paths resolve', () => {
    const lines = renderMcpConfig('srv', STDIO, '/root/plugins/p')
    expect(lines).toContain("        cwd: '/root/plugins/p'")
    // Without a cwd nothing is emitted.
    expect(renderMcpConfig('srv', STDIO).some((l) => l.includes('cwd'))).toBe(false)
  })

  it('renders cwd through renderMcpRow and never for remote servers', () => {
    const stdio = renderMcpRow({ rowId: 'r', serverName: 's', def: STDIO, cwd: '/p' })
    expect(stdio).toContain("cwd: '/p'")
    const http = renderMcpRow({ rowId: 'r', serverName: 's', def: HTTP, cwd: '/p' })
    expect(http.includes('cwd')).toBe(false)
  })
})

describe('expandMcpServerTemplates', () => {
  const VARS = { pluginRoot: '/root/plugin', pluginData: '/root/data', userConfig: {} as Record<string, string>, env: { TOKEN: 't1', EMPTY: '' } as Record<string, string | undefined> }

  it('expands plugin paths and env names in every stdio string field', () => {
    const { server, notes } = expandMcpServerTemplates(
      {
        name: 'db',
        def: {
          transport: 'stdio',
          command: '${CLAUDE_PLUGIN_ROOT}/servers/db.js',
          args: ['--cfg', '${CLAUDE_PLUGIN_DATA}/config.json'],
          env: { TOKEN: '${TOKEN}', EMPTY: '${EMPTY}' },
        },
      },
      VARS,
    )
    expect(server.def).toEqual({
      transport: 'stdio',
      command: '/root/plugin/servers/db.js',
      args: ['--cfg', '/root/data/config.json'],
      env: { TOKEN: 't1', EMPTY: '' },
    })
    expect(notes).toEqual([])
  })

  it('expands url and header values for remote servers', () => {
    const { server, notes } = expandMcpServerTemplates(
      {
        name: 'web',
        def: {
          transport: 'streamable-http',
          url: 'https://mcp.test/${TOKEN}/mcp',
          headers: { Authorization: 'Bearer ${TOKEN}' },
        },
      },
      VARS,
    )
    expect(server.def).toEqual({
      transport: 'streamable-http',
      url: 'https://mcp.test/t1/mcp',
      headers: { Authorization: 'Bearer t1' },
    })
    expect(notes).toEqual([])
  })

  it('leaves unset names literal with one note per name, sorted', () => {
    const { server, notes } = expandMcpServerTemplates(
      {
        name: 'odd',
        def: { transport: 'stdio', command: '${ZZZ} ${AAA}', args: ['${AAA}', '${ZZZ}'], env: {} },
      },
      VARS,
    )
    if (server.def.transport !== 'stdio') throw new Error('unreachable')
    expect(server.def.command).toBe('${ZZZ} ${AAA}')
    expect(notes).toEqual([
      'MCP server "odd" references ${AAA} which is not set in the environment; left as written',
      'MCP server "odd" references ${ZZZ} which is not set in the environment; left as written',
    ])
  })

  it('explains CLAUDE_PROJECT_DIR separately and keeps it literal', () => {
    const { server, notes } = expandMcpServerTemplates(
      { name: 'ws', def: { transport: 'stdio', command: '${CLAUDE_PROJECT_DIR}/tool', args: [], env: {} } },
      VARS,
    )
    if (server.def.transport !== 'stdio') throw new Error('unreachable')
    expect(server.def.command).toBe('${CLAUDE_PROJECT_DIR}/tool')
    expect(notes).toEqual([
      'MCP server "ws" references ${CLAUDE_PROJECT_DIR}, which has no single value across scope roots; left as written',
    ])
  })

  it('expands user_config keys from the user configuration map', () => {
    const { server, notes } = expandMcpServerTemplates(
      {
        name: 'grafana',
        def: {
          transport: 'stdio',
          command: 'docker',
          args: [],
          env: { GRAFANA_URL: '${user_config.grafana_url}', TOKEN: '${user_config.grafana_token}' },
        },
      },
      { ...VARS, userConfig: { grafana_url: 'https://grafana.test', grafana_token: 'tok' } },
    )
    if (server.def.transport !== 'stdio') throw new Error('unreachable')
    expect(server.def.env).toEqual({ GRAFANA_URL: 'https://grafana.test', TOKEN: 'tok' })
    expect(notes).toEqual([])
  })

  it('leaves unconfigured user_config keys literal with their own note', () => {
    const { server, notes } = expandMcpServerTemplates(
      { name: 'g', def: { transport: 'stdio', command: 'x', args: [], env: { URL: '${user_config.grafana_url}' } } },
      VARS,
    )
    if (server.def.transport !== 'stdio') throw new Error('unreachable')
    expect(server.def.env.URL).toBe('${user_config.grafana_url}')
    expect(notes).toEqual([
      'MCP server "g" references ${user_config.grafana_url} which is not configured (set runtime.userConfig or cc-plugins/user-config.json); left as written',
    ])
  })

  it('returns the definition values unchanged when no template is present', () => {
    const def = { transport: 'streamable-http' as const, url: 'https://x.test/mcp', headers: {} }
    const { server, notes } = expandMcpServerTemplates({ name: 'plain', def }, VARS)
    expect(server.def).toEqual(def)
    expect(notes).toEqual([])
  })

  it('never treats env or header keys as templates', () => {
    const { server } = expandMcpServerTemplates(
      { name: 'k', def: { transport: 'stdio', command: 'x', args: [], env: { '${TOKEN}': '${TOKEN}' } } },
      VARS,
    )
    if (server.def.transport !== 'stdio') throw new Error('unreachable')
    expect(Object.keys(server.def.env)).toEqual(['${TOKEN}'])
    expect(server.def.env['${TOKEN}']).toBe('t1')
  })
})
