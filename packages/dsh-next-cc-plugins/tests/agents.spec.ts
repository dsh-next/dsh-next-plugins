/**
 * Agent frontmatter translation: the Claude tool-name map, pattern and
 * unmapped-name handling, and model resolution against the user's
 * runtime.agentModelMap. Pure core coverage for `core/agents.ts`.
 */
import { describe, expect, it } from 'vitest'
import { agentFrontmatter, CLAUDE_TOOL_MAP, resolveAgentModel, translateTools } from '../src/core/agents.ts'
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

  it('drops unmapped tools with a note', () => {
    const result = translateTools('Bash, NotebookEdit, mcp__linear__create_issue')
    expect(result.allow).toEqual(['bash'])
    expect(result.notes[0]).toContain('NotebookEdit')
    expect(result.notes[1]).toContain('mcp__linear__create_issue')
    expect(result.notes.every((note) => note.includes('no DSH counterpart'))).toBe(true)
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
})
