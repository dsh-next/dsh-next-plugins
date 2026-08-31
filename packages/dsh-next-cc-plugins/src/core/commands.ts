/**
 * Pure translation of Claude Code `commands/*.md` files into DSH slash
 * command definitions.
 *
 * A Claude command is a markdown prompt template with optional frontmatter
 * (`description`, `argument-hint`). DSH's command grammar is stricter than
 * Claude's naming (lowercase letters, digits, `_`, `-`; no dots or colons),
 * so a command whose file name is not already a valid DSH name is exposed
 * under a qualified `cc-<plugin>-<command>` form. `$ARGUMENTS` in the
 * template expands to the user's raw input.
 */
import { parseFrontmatter } from './frontmatter.ts'
import type { PluginFiles } from './plugin-inventory.ts'

/** DSH slash-command name grammar (parseCommand: lowercase name of letters, digits, _, -). */
const DSH_COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** One command extracted from an installed plugin's files. */
export interface CcCommand {
  /** The DSH-registered slash command name (no leading slash). */
  name: string
  /** Claude's original command name (the file name). */
  claudeName: string
  description: string
  /** Composer placeholder from Claude's `argument-hint`. */
  hint: string
  /** The prompt template body ($ARGUMENTS unexpanded). */
  template: string
}

/** Sanitize an arbitrary token into the DSH command-name grammar. */
function toDshName(parts: readonly string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, 64)
}

/**
 * Derive the DSH command name for one Claude command: the plain name when it
 * already satisfies the grammar, else the qualified `cc-<plugin>-<command>`
 * form. Returns '' when nothing usable remains.
 */
export function dshCommandName(pluginName: string, claudeName: string): string {
  if (DSH_COMMAND_NAME.test(claudeName)) return claudeName
  return toDshName(['cc', pluginName, claudeName])
}

/**
 * Extract command definitions from a plugin's file map. `roots` is the
 * commands root (default `commands`) or the manifest override list — each
 * entry may be a directory (scanned) or a single .md file. Nested command
 * files (Claude's `commands/group/name.md` qualified form) are skipped with
 * a note: DSH has no namespaced command grammar.
 */
export function commandsFromFiles(
  files: PluginFiles,
  pluginName: string,
  roots: string | readonly string[] = 'commands',
): { commands: CcCommand[]; notes: string[] } {
  const rootList = typeof roots === 'string' ? [roots] : roots
  const out: CcCommand[] = []
  const notes: string[] = []
  for (const rootRaw of rootList) {
    const root = rootRaw.replace(/\/+$/, '').replace(/^\.\/+/, '')
    // A root that names an existing file is a single command definition.
    if (files[root] !== undefined) {
      if (!root.endsWith('.md')) continue
      const rel = root.split('/').pop() ?? root
      const claudeName = rel.slice(0, -3)
      if (claudeName === '') continue
      appendCommand(files, root, claudeName, pluginName, out)
      continue
    }
    const prefix = `${root}/`
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue
      const rel = path.slice(prefix.length)
      if (!rel.endsWith('.md')) continue
      if (rel.includes('/')) {
        notes.push(`nested command "${rel}" skipped (no DSH namespaced command grammar)`)
        continue
      }
      const claudeName = rel.slice(0, -3)
      if (claudeName === '') continue
      appendCommand(files, path, claudeName, pluginName, out)
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return { commands: out, notes }
}

function appendCommand(files: PluginFiles, path: string, claudeName: string, pluginName: string, out: CcCommand[]): void {
  const name = dshCommandName(pluginName, claudeName)
  if (name === '') return
  const parsed = parseFrontmatter(files[path] ?? '')
  out.push({
    name,
    claudeName,
    description: parsed?.description !== undefined && parsed.description !== '' ? parsed.description : `Claude command ${claudeName}`,
    hint: parsed?.scalars['argument-hint'] ?? '',
    template: parsed?.body ?? files[path] ?? '',
  })
}

/**
 * Expand a command template for one invocation: every `$ARGUMENTS` token is
 * replaced by the user's raw input (trimmed), preserving everything else
 * verbatim.
 */
export function expandTemplate(template: string, rawInput: string): string {
  const args = rawInput.trim()
  return template.split('$ARGUMENTS').join(args)
}
