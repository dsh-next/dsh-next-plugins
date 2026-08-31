/**
 * Agent frontmatter translation: the Claude tool-name map, pattern and
 * unmapped-name handling, `mcp__` tool-ref resolution against the installed
 * MCP rows, and model resolution against the user's runtime.agentModelMap.
 * Pure core coverage for `core/agents.ts`.
 */
import { describe, expect, it } from 'vitest'
import { agentFrontmatter, CLAUDE_TOOL_MAP, dshMcpToolName, resolveAgentModel, translateTools } from '../src/core/agents.ts'
import { parseFrontmatter } from '../src/core/frontmatter.ts'

describe('translateTools', () => {
  it('translates well-known Claude tool names to DSH tool names', () => {
    const result = translateTools('Bash, Read, WebSearch')
    expect(result.allow).toEqual(['bash', 'read', 'web_search'])
    expect(result.notes).toEqual([])
  })

  it('accepts the bracket flow form', () => {
    expect(translateTools('[Bash, Write]').allow).toEqual(['bash', 'write'])
  })

  it('deduplicates names that map to the same DSH tool', () => {
    expect(translateTools('Edit, MultiEdit, Task, Agent').allow).toEqual(['edit', 'subagent'])
  })

  it('reduces permission patterns to the base tool with a note', () => {
    const result = translateTools('Bash(git log:*), Read')
    expect(result.allow).toEqual(['bash', 'read'])
    expect(result.notes).toEqual(['tool pattern "Bash(git log:*)" maps to "Bash"; argument patterns are not enforced by DSH toolFilter'])
  })

  it('drops unmapped tools with a note and passes foreign mcp refs through', () => {
    const result = translateTools('Bash, NotebookEdit, mcp__linear__create_issue')
    expect(result.allow).toEqual(['bash', 'mcp__linear__create_issue'])
    expect(result.notes).toEqual(['tool "NotebookEdit" has no DSH counterpart; dropped from the agent\'s toolFilter'])
  })

  it('returns no filter for empty, wildcard, or fully-unmapped lists', () => {
    expect(translateTools('')).toEqual({ allow: undefined, notes: [] })
    expect(translateTools('*').allow).toBeUndefined()
    expect(translateTools('SomeFutureTool').allow).toBeUndefined()
    expect(translateTools('SomeFutureTool').notes.length).toBe(1)
  })

  it('is case-sensitive on tool names but trims whitespace', () => {
    expect(translateTools('  Bash ,  Read  ').allow).toEqual(['bash', 'read'])
    expect(translateTools('bash').notes.length).toBe(1)
  })

  it('covers the documented Claude built-ins in the map', () => {
    expect(CLAUDE_TOOL_MAP.Bash).toBe('bash')
    expect(CLAUDE_TOOL_MAP.Task).toBe('subagent')
    expect(CLAUDE_TOOL_MAP.ExitPlanMode).toBe('exit_plan_mode')
    expect(CLAUDE_TOOL_MAP.AskUserQuestion).toBe('ask_user_question')
    expect(CLAUDE_TOOL_MAP.TodoWrite).toBe('todo_write')
    expect(CLAUDE_TOOL_MAP.ListAgents).toBe('list_agents')
  })
})

describe('translateTools mcp__ refs', () => {
  const EPISODIC = 'mcp__plugin_episodic-memory_episodic-memory__search, mcp__plugin_episodic-memory_episodic-memory__read'

  it('resolves plugin-prefixed refs through the installed rows', () => {
    const result = translateTools(`Read, ${EPISODIC}`, {
      pluginName: 'episodic-memory',
      servers: [{ claudeName: 'episodic-memory', serverName: 'episodic-memory' }],
    })
    expect(result.allow).toEqual(['mcp__episodic-memory__read', 'mcp__episodic-memory__search', 'read'])
    expect(result.notes).toEqual([])
  })

  it('honors a deduped serverName so toolFilter matches the live tools', () => {
    const result = translateTools('mcp__plugin_episodic-memory_episodic-memory__search', {
      pluginName: 'episodic-memory',
      servers: [{ claudeName: 'episodic-memory', serverName: 'episodic-memory-2' }],
    })
    expect(result.allow).toEqual(['mcp__episodic-memory-2__search'])
  })

  it('resolves bare server refs that name one of the plugin rows', () => {
    const result = translateTools('mcp__linear__list_issues', {
      pluginName: 'team-tools',
      servers: [{ claudeName: 'linear', serverName: 'linear' }],
    })
    expect(result.allow).toEqual(['mcp__linear__list_issues'])
    expect(result.notes).toEqual([])
  })

  it('drops plugin-prefixed refs whose server the plugin does not ship', () => {
    const result = translateTools('mcp__plugin_team-tools_missing__query', {
      pluginName: 'team-tools',
      servers: [{ claudeName: 'linear', serverName: 'linear' }],
    })
    expect(result.allow).toBeUndefined() // fully-unmapped list = no filter
    expect(result.notes).toEqual(['tool "mcp__plugin_team-tools_missing__query" has no DSH counterpart; dropped from the agent\'s toolFilter'])
  })

  it('drops malformed mcp refs with a note', () => {
    const result = translateTools('mcp__server')
    expect(result.allow).toBeUndefined()
    expect(result.notes[0]).toContain('malformed')
  })

  it('normalizes exotic names with the digest and drops them without one', () => {
    const ctx = {
      pluginName: 'p',
      servers: [{ claudeName: 'srv', serverName: 'srv' }],
      digest: (input: string) => `digest-of-${input}`,
    }
    const resolved = translateTools('mcp__plugin_p_srv__to.ol', ctx)
    expect(resolved.allow).toEqual(['mcp__srv__to_ol_digest-of-sr']) // the first 12 chars of the digest input's hash
    expect(resolved.notes).toEqual([])

    const dropped = translateTools('mcp__plugin_p_srv__to.ol', { pluginName: 'p', servers: ctx.servers })
    expect(dropped.allow).toBeUndefined()
    expect(dropped.notes[0]).toContain('exotic name')
  })
})

describe('dshMcpToolName', () => {
  const digest = (input: string): string => input.replace(/[^0-9a-f]/g, '').padEnd(64, '0')

  it('is the verbatim server-qualified name for clean names', () => {
    expect(dshMcpToolName('episodic-memory', 'search')).toBe('mcp__episodic-memory__search')
  })

  it('normalizes invalid characters and appends the 12-char digest slice', () => {
    expect(dshMcpToolName('srv', 'to.ol', digest)).toBe('mcp__srv__to_ol_000000000000')
  })

  it('truncates overlong names to the 64-char contract', () => {
    const long = 'a'.repeat(70)
    const name = dshMcpToolName('srv', long, digest)
    expect(name).toBeDefined()
    expect(name).toHaveLength(64)
    expect(name!.endsWith(digest(`srv\0${long}`).slice(0, 12))).toBe(true)
  })

  it('returns undefined for lossy names without a digest', () => {
    expect(dshMcpToolName('srv', 'to.ol')).toBeUndefined()
    expect(dshMcpToolName('srv', 'a'.repeat(70))).toBeUndefined()
  })
})

describe('resolveAgentModel', () => {
  const MAP = { sonnet: 'glm-4.7', 'claude-opus-4-1': 'glm-4.8' }

  it('passes mapped models through', () => {
    expect(resolveAgentModel('sonnet', MAP)).toEqual({ model: 'glm-4.7' })
    expect(resolveAgentModel('claude-opus-4-1', MAP)).toEqual({ model: 'glm-4.8' })
  })

  it('matches map keys case-insensitively', () => {
    expect(resolveAgentModel('Sonnet', MAP).model).toBe('glm-4.7')
  })

  it('treats inherit and absent as no override without a note', () => {
    expect(resolveAgentModel(undefined, MAP)).toEqual({ model: undefined })
    expect(resolveAgentModel('', MAP)).toEqual({ model: undefined })
    expect(resolveAgentModel('inherit', MAP)).toEqual({ model: undefined })
  })

  it('notes unmapped models instead of passing a Claude id through', () => {
    const result = resolveAgentModel('haiku', MAP)
    expect(result.model).toBeUndefined()
    expect(result.note).toContain('haiku')
    expect(result.note).toContain('agentModelMap')
  })

  it('ignores empty map values', () => {
    expect(resolveAgentModel('sonnet', { sonnet: '  ' }).model).toBeUndefined()
  })
})

describe('agentFrontmatter', () => {
  it('reads tools and model from parsed agent frontmatter', () => {
    const parsed = parseFrontmatter('---\nname: reviewer\ntools: Bash, Read\nmodel: sonnet\n---\nbody')
    expect(agentFrontmatter(parsed)).toEqual({ tools: 'Bash, Read', model: 'sonnet' })
  })

  it('reads the tools block-list form and joins it like the scalar', () => {
    const parsed = parseFrontmatter('---\nname: reviewer\ntools:\n  - Bash\n  - Read\nmodel: sonnet\n---\nbody')
    expect(agentFrontmatter(parsed)).toEqual({ tools: 'Bash, Read', model: 'sonnet' })
    // The joined list translates exactly like the scalar form.
    expect(translateTools(agentFrontmatter(parsed).tools).allow).toEqual(['bash', 'read'])
  })

  it('handles a bare tools key with no items and stray dash lines elsewhere', () => {
    expect(agentFrontmatter(parseFrontmatter('---\ntools:\n---\nbody'))).toEqual({ tools: '', model: '' })
    // A dash line before any bare key is skipped, not collected.
    expect(agentFrontmatter(parseFrontmatter('---\n- stray\nmodel: haiku\n---\nbody'))).toEqual({ tools: '', model: 'haiku' })
  })

  it('returns empty strings when the file has no frontmatter or fields', () => {
    expect(agentFrontmatter(undefined)).toEqual({ tools: '', model: '' })
    expect(agentFrontmatter(parseFrontmatter('---\ndescription: x\n---\nbody'))).toEqual({ tools: '', model: '' })
  })

  it('exposes every scalar and list key for fields beyond the well-known ones', () => {
    const parsed = parseFrontmatter('---\nargument-hint: "[issue-number]"\nallowed-tools:\n  - Read\n  - Grep\nmodel: sonnet\n---\nbody')
    expect(parsed?.scalars['argument-hint']).toBe('[issue-number]')
    expect(parsed?.scalars.model).toBe('sonnet')
    expect(parsed?.lists['allowed-tools']).toEqual(['Read', 'Grep'])
    // A key given twice keeps its first value, matching Claude's behavior.
    const dup = parseFrontmatter('---\nmodel: sonnet\nmodel: opus\n---\nbody')
    expect(dup?.scalars.model).toBe('sonnet')
  })
})
