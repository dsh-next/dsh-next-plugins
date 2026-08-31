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
  extractManagedBlock,
  normalizeMcpServers,
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
