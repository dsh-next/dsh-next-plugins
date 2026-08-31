/**
 * Agent frontmatter translation: Claude Code's per-agent `tools:` and
 * `model:` fields have direct `dsh-tool-subagent` counterparts
 * (`toolFilter.allow` and `agentOptions.model`), but neither value can be
 * passed through verbatim:
 *
 *  - `tools:` names CLAUDE tools (Bash, Read, WebSearch, ...). A
 *    `toolFilter.allow` list matches exact DSH tool names, so an untranslated
 *    allowlist would hide every tool from the child. Every well-known Claude
 *    built-in maps onto a DSH tool here; names with no DSH counterpart
 *    (NotebookEdit, mcp__server__tool, ...) are dropped with a note rather
 *    than silently narrowing the child's surface.
 *  - `model:` names a CLAUDE model (sonnet, opus, haiku, ...). DSH resolves
 *    child models against its own registry, so a Claude id would fail every
 *    delegation at child creation. Only values the user mapped in
 *    `runtime.agentModelMap` are passed on; `model: inherit` (and every
 *    unmapped value) resolves to "no override", which is exactly DSH's
 *    parent-inheritance default.
 */
import type { Frontmatter } from './frontmatter.ts'

/** Well-known Claude Code tool names to DSH tool names. */
export const CLAUDE_TOOL_MAP: Readonly<Record<string, string>> = {
  Agent: 'subagent',
  AskUserQuestion: 'ask_user_question',
  Bash: 'bash',
  Edit: 'edit',
  ExitPlanMode: 'exit_plan_mode',
  Glob: 'glob',
  Grep: 'grep',
  ListAgents: 'list_agents',
  MultiEdit: 'edit',
  Read: 'read',
  Skill: 'skill',
  Task: 'subagent',
  TodoWrite: 'todo_write',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Write: 'write',
}

export interface ToolTranslation {
  /** DSH tool names for `toolFilter.allow`, or undefined for "no filter". */
  allow: string[] | undefined
  notes: string[]
}

/**
 * Translate a Claude agent's `tools:` frontmatter value. Accepts the
 * comma-separated and `[a, b]` flow forms and the permission-pattern form
 * (`Bash(git log:*)` — the argument pattern is noted as unenforced and the
 * base tool allowed). `*` (or an empty translation result after drops when
 * nothing was recognized) means no restriction at all, matching Claude's
 * default when `tools:` is absent.
 */
export function translateTools(raw: string): ToolTranslation {
  const notes: string[] = []
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*') return { allow: undefined, notes }
  const items = trimmed.replace(/^\[/, '').replace(/\]$/, '').split(',')
  const allow: string[] = []
  for (const item of items) {
    const entry = item.trim()
    if (entry === '' || entry === '*') continue
    const base = /^([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(entry)
    const claudeName = base !== null ? base[1] : entry
    if (base !== null) notes.push(`tool pattern "${entry}" maps to "${claudeName}"; argument patterns are not enforced by DSH toolFilter`)
    const mapped = CLAUDE_TOOL_MAP[claudeName]
    if (mapped === undefined) {
      notes.push(`tool "${claudeName}" has no DSH counterpart; dropped from the agent's toolFilter`)
      continue
    }
    if (!allow.includes(mapped)) allow.push(mapped)
  }
  if (allow.length === 0) return { allow: undefined, notes }
  return { allow: [...allow].sort(), notes }
}

export interface ModelResolution {
  /** A DSH model id for `agentOptions.model`, or undefined for "inherit". */
  model: string | undefined
  note?: string
}

/**
 * Resolve a Claude agent's `model:` frontmatter value against the user's
 * `runtime.agentModelMap` (Claude name or full Claude model id to DSH model
 * id; keys match case-insensitively). `model: inherit`, an absent value, or
 * an unmapped value resolves to undefined: the child then inherits the
 * delegating parent's model, which is DSH's default and Claude's `inherit`
 * semantics. Unmapped values produce a note so installs stay honest about
 * what was not applied.
 */
export function resolveAgentModel(
  raw: string | undefined,
  map: Readonly<Record<string, string>>,
): ModelResolution {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed === '' || trimmed === 'inherit') return { model: undefined }
  const hit = map[trimmed]
  if (hit !== undefined && hit.trim() !== '') return { model: hit.trim() }
  const lower = trimmed.toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === lower && value.trim() !== '') return { model: value.trim() }
  }
  return { model: undefined, note: `agent model "${trimmed}" has no mapping in runtime.agentModelMap; the child inherits the parent's model` }
}

/** Parse an agent file's frontmatter into the raw fields this bridge reads. */
export function agentFrontmatter(parsed: Frontmatter | undefined): { tools: string; model: string } {
  return {
    tools: parsed?.tools ?? '',
    model: parsed?.model ?? '',
  }
}
