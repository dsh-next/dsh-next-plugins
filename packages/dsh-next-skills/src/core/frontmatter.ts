/**
 * Pure SKILL.md frontmatter parsing and surgical invocation toggling. Matches
 * the DSH filesystem provider's grammar: YAML frontmatter fenced by `---` with
 * a required `name` and `description`, plus the invocation-policy keys
 * `disable-model-invocation` and `user-invocable`.
 *
 * A skill has two independent invocation surfaces: the model catalog
 * (`modelInvocable`, toggled by `disable-model-invocation`) and the human-facing
 * `/` command menu (`userInvocable`, toggled by `user-invocable`). The plugin's
 * single enabled/disabled switch drives both, so a disabled skill vanishes from
 * every surface.
 */
import { dump, load } from 'js-yaml'

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
 * Invocation-policy keys surfaced by the enable/disable switch. `enabled`
 * removes every key (both surfaces default to true); `disabled` writes each
 * key with its disabling value. Order is stable for deterministic output.
 */
const INVOCATION_KEYS: ReadonlyArray<{ key: string; disabledValue: string }> = [
  { key: 'disable-model-invocation', disabledValue: 'true' },
  { key: 'user-invocable', disabledValue: 'false' },
]

/**
 * Toggle a skill's invocation policy in a SKILL.md without touching any other
 * line. Disabling sets (or inserts) both `disable-model-invocation: true` and
 * `user-invocable: false`; enabling removes both keys so the skill is invocable
 * from every surface. Returns the input unchanged when there is no frontmatter.
 */
export function toggleInvocation(content: string, enabled: boolean): string {
  const eol = detectEol(content)
  const { yaml, body } = splitFrontmatter(content)
  if (yaml === null) return content
  const lines = yaml.split(eol)
  const out: string[] = []
  const found = new Set<string>()
  for (const line of lines) {
    const entry = INVOCATION_KEYS.find(({ key }) => new RegExp(`^\\s*${key}\\s*:`).test(line))
    if (entry) {
      found.add(entry.key)
      if (enabled) continue // drop the line
      out.push(`${entry.key}: ${entry.disabledValue}`)
      continue
    }
    out.push(line)
  }
  if (!enabled) {
    for (const { key, disabledValue } of INVOCATION_KEYS) {
      // Append missing keys at the very end of the frontmatter, never after the
      // `description` line: description is often a YAML block scalar
      // (`description: |`), and inserting a sibling key directly after it would
      // corrupt the block.
      if (!found.has(key)) out.push(`${key}: ${disabledValue}`)
    }
  }
  return `---${eol}${out.join(eol)}${eol}---${eol}${body}`
}

/**
 * Build a workspace shadow skill that disables a global skill of the same name
 * for that workspace (the workspace root ranks above the user root, so this
 * shadow wins the duplicate name outright).
 */
export function buildShadowSkill(name: string, description: string): string {
  // Serialize the description through js-yaml: raw interpolation corrupts the
  // file for any description containing a newline or ": " (the shadow then
  // fails to parse everywhere and the disable silently does nothing).
  const descriptionLine = dump(description, { lineWidth: 0 }).trimEnd()
  return [
    '---',
    `name: ${name}`,
    `description: ${descriptionLine}`,
    'disable-model-invocation: true',
    'user-invocable: false',
    '---',
    '',
    '# Disabled in this workspace',
    '',
    `This shadow skill disables the global skill "${name}" for this workspace.`,
    'Remove it to re-enable the global skill.',
    '',
    `<!-- ${SHADOW_MARKER} -->`,
    '',
  ].join('\n')
}

/**
 * Marker emitted in a shadow skill body; identifies a workspace-level disable
 * so re-enabling can remove the shadow instead of editing a real skill.
 */
export const SHADOW_MARKER = 'dsh-next-skills:workspace-shadow'

/** Whether a SKILL.md body is a workspace shadow generated by this plugin. */
export function isShadowSkill(content: string): boolean {
  return content.includes(SHADOW_MARKER)
}
