/**
 * Pure SKILL.md frontmatter parsing. Matches the DSH filesystem provider's
 * grammar: YAML frontmatter fenced by `---` with a required `name` and
 * `description`, plus the invocation-policy keys `disable-model-invocation`
 * and `user-invocable`.
 *
 * A skill has two independent invocation surfaces: the model catalog
 * (`modelInvocable`, driven by `disable-model-invocation`) and the human-facing
 * `/` command menu (`userInvocable`, driven by `user-invocable`). Since the
 * settings-based refactor the plugin never edits these keys: enablement is
 * config-driven (per-name scopes applied by the plugin's `ctx.skills`
 * provider), and the flags here are the skill author's own defaults.
 */
import { load } from 'js-yaml'

export interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
  userInvocable: boolean
  metadata?: Record<string, unknown>
  body: string
}

export interface SplitFrontmatter {
  yaml: string | null
  body: string
}

export function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/** Split a SKILL.md into its YAML frontmatter block and the body. */
export function splitFrontmatter(content: string): SplitFrontmatter {
  const eol = detectEol(content)
  const lines = content.split(eol)
  if (lines.length === 0 || lines[0].trim() !== '---') return { yaml: null, body: content }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close === -1) return { yaml: null, body: content }
  return {
    yaml: lines.slice(1, close).join(eol),
    body: lines.slice(close + 1).join(eol),
  }
}

/** Coerce a frontmatter value to a boolean using the provider's accepted forms. */
function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * Parse a SKILL.md document. Returns undefined when the frontmatter is absent,
 * malformed, or missing the required `name`/`description`.
 */
export function parseSkillFile(content: string): ParsedSkill | undefined {
  const { yaml, body } = splitFrontmatter(content)
  if (yaml === null || yaml.trim() === '') return undefined
  let data: unknown
  try {
    data = load(yaml)
  } catch {
    return undefined
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const d = data as Record<string, unknown>
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  const description = typeof d.description === 'string' ? d.description.trim() : ''
  if (name === '' || description === '') return undefined

  const parsed: ParsedSkill = { name, description, modelInvocable: true, userInvocable: true, body }

  if (typeof d.whenToUse === 'string' && d.whenToUse.trim() !== '') parsed.whenToUse = d.whenToUse.trim()

  try {
    const dm = frontmatterBoolean(d, 'disable-model-invocation')
    if (dm !== undefined) parsed.modelInvocable = dm !== true
  } catch {
    return undefined
  }
  try {
    const ui = frontmatterBoolean(d, 'user-invocable')
    if (ui !== undefined) parsed.userInvocable = ui !== false
  } catch {
    return undefined
  }

  if (typeof d.metadata === 'object' && d.metadata !== null && !Array.isArray(d.metadata)) {
    parsed.metadata = d.metadata as Record<string, unknown>
  }
  return parsed
}

/**
 * Parse a SKILL.md document. Returns undefined when the frontmatter is absent,
 * malformed, or missing the required `name`/`description`.
 */
