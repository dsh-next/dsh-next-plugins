/**
 * Minimal YAML-frontmatter reader for the markdown files a Claude Code plugin
 * bundles (SKILL.md, command definitions, agent definitions). Only the
 * single-line `name` / `description` / `tools` / `model` scalars and the
 * `tools:` block-list form (`tools:` followed by `  - Name` items) are needed
 * for the inventory, so this is a deliberately tiny reader: fence detection
 * plus line extraction with simple quoting. Files whose frontmatter uses
 * richer YAML still parse — unknown lines are skipped, and a missing `name`
 * is legal (Claude Code derives skill and command names from the file path).
 */
export interface Frontmatter {
  name: string
  description: string
  /** Raw `tools:` value (comma-separated Claude tool names), '' when absent. */
  tools: string
  /** Raw `model:` scalar (a Claude model name or id), '' when absent. */
  model: string
  body: string
  /** Every parsed scalar key (first value wins), for fields beyond the
   * well-known ones (`argument-hint`, `allowed-tools`, ...). */
  scalars: Record<string, string>
  /** Every block-list key and its items (`tools:` list form, ...). */
  lists: Record<string, string[]>
}

function unquote(value: string): string {
  const t = value.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Parse frontmatter and body. Returns undefined when the file has no
 * `---`-fenced frontmatter block at the top. A `key:` line with an empty
 * value starts collecting `- item` block-list lines into that key (joined
 * with `, `); any other line ends the collection.
 */
export function parseFrontmatter(content: string): Frontmatter | undefined {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(eol)
  if (lines.length === 0 || lines[0].trim() !== '---') return undefined
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close === -1) return undefined
  const scalars: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  let listKey: string | null = null
  for (const line of lines.slice(1, close)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item !== null && listKey !== null) {
      const value = unquote(item[1])
      if (value !== '') (lists[listKey] ??= []).push(value)
      continue
    }
    listKey = null
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    if (match[2].trim() === '') {
      // A bare `key:` opens a block list; scalars keep their first value.
      if (scalars[match[1]] === undefined && (lists[match[1]] ?? []).length === 0) listKey = match[1]
      continue
    }
    if (scalars[match[1]] === undefined) scalars[match[1]] = unquote(match[2])
  }
  const listOf = (key: string): string => (lists[key] ?? []).join(', ')
  return {
    name: scalars.name ?? '',
    description: scalars.description ?? '',
    tools: scalars.tools ?? listOf('tools'),
    model: scalars.model ?? '',
    body: lines.slice(close + 1).join(eol),
    scalars,
    lists,
  }
}
