/**
 * Plugin-level reference rewriting: makes relative references that pointed
 * at plugin-level content (the `references/` convention, `assets/`, other
 * component roots, ...) work from DSH's standalone skill installs.
 *
 * In Claude Code a skill's `../../references/guide.md` resolves because
 * the plugin tree stays intact; DSH installs each skill standalone into
 * a skills root, where that path is dead. Instead of leaving a dead link,
 * the installed skill copy's references are rewritten to absolute paths
 * into the materialized plugin copy (`$DSH_HOME/cc-plugins/plugins/<key>`)
 * — but only when the reference provably resolves inside the plugin:
 *
 *  - `../`-chains resolve against the skill's own plugin-relative
 *    directory (Claude's file-relative semantic);
 *  - bare `dir/...` forms resolve against the plugin root (Claude's
 *    cwd-relative semantic);
 *  - the resolved path must exist in the plugin file map (as a file or a
 *    directory prefix) and land OUTSIDE the skill's own directory —
 *    in-skill relatives already work verbatim and are never touched.
 *
 * Everything else — URLs, prose, unknown paths, references escaping the
 * plugin — stays byte-identical. The source file map is never mutated:
 * rewriting applies to the installed copies only (the materialized plugin
 * copy and the cached files that feed the runtime bridge stay verbatim).
 */
import type { SkillComponent } from './types.ts'
import { skillFiles, type PluginFiles } from './plugin-inventory.ts'

/** Token boundary: not preceded by path or word characters, so URLs and
 *  mid-path fragments never match. Markdown syntax (`](`, spaces) is a
 *  valid boundary — `[](../../references/)` is the primary real form. */
const BOUNDARY = '[^A-Za-z0-9_./%~@:-]'
const TOKEN = new RegExp(`(^|${BOUNDARY})((?:\\.\\./)+(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]*|(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]*)`, 'g')

/**
 * Lexically resolve `rel` against `base` (both plugin-relative, `/`
 * separated; `resolveRelative` drops a trailing slash). Returns undefined
 * when the path escapes the plugin root or is malformed.
 */
function resolveRelative(base: string, rel: string): string | undefined {
  const parts = `${base}/${rel}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return undefined // escapes the plugin root
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** Whether a plugin-relative path exists as a file or directory prefix. */
function existsIn(files: PluginFiles, path: string): boolean {
  if (path === '') return false
  if (files[path] !== undefined) return true
  const prefix = `${path}/`
  return Object.keys(files).some((k) => k.startsWith(prefix))
}

/** Whether `path` sits inside `dir` (the skill's own directory). */
function insideDir(path: string, dir: string): boolean {
  if (dir === '') return false
  return path === dir || path.startsWith(`${dir}/`)
}

/** Rewrite one skill file's content; returns the new text and the number
 *  of references rewritten. `../`-chains resolve against `skillDir`
 *  (Claude's file-relative semantic); bare `dir/...` forms resolve
 *  against the plugin root (Claude's cwd-relative semantic). */
export function rewriteSkillReferences(content: string, skillDir: string, files: PluginFiles, pluginRoot: string): { content: string; count: number } {
  let count = 0
  const next = content.replace(TOKEN, (match, boundary: string, token: string) => {
    // Peel trailing dots into a suffix: sentence punctuation after a path
    // (`Read ../references/aql.md.`) must not defeat the existence check.
    let core = token
    let suffix = ''
    while (core.endsWith('.')) {
      core = core.slice(0, -1)
      suffix += '.'
    }
    if (core === '' || core === '../') return match // pure up-chain, nothing to resolve
    const resolved = resolveRelative(core.startsWith('../') ? skillDir : '', core)
    if (resolved === undefined) return match // escapes the plugin
    if (insideDir(resolved, skillDir)) return match // in-skill relative: works verbatim
    if (!existsIn(files, resolved)) return match
    count += 1
    return `${boundary}${pluginRoot}/${resolved}${suffix}`
  })
  return { content: next, count }
}

/** The plugin-relative directory a skill's files resolve against: the
 *  bundle form's directory, the manifest-redirected file's directory, or
 *  `skills/` for the flat form. */
function skillBase(skill: SkillComponent): string {
  if (skill.file !== undefined) {
    const parts = skill.file.split('/')
    parts.pop()
    return parts.join('/')
  }
  return skill.path !== '' ? skill.path : 'skills'
}

/** The plugin-relative key one skillFiles entry came from. */
function skillFileKey(skill: SkillComponent, rel: string): string {
  if (skill.file !== undefined) return skill.file
  if (skill.path !== '') return `${skill.path}/${rel}`
  return `skills/${skill.name}.md`
}

/**
 * Rewrite every skill's files in a copy of the plugin file map. The
 * returned map replaces the skill-file entries with rewritten contents
 * (everything else — including every non-skill file — is shared
 * verbatim); `rewrites` counts references, `skills` the skills touched.
 */
export function rewriteSkillFiles(
  files: PluginFiles,
  skills: readonly SkillComponent[],
  pluginRoot: string,
): { files: PluginFiles; rewrites: number; skills: number } {
  let rewrites = 0
  let touched = 0
  const out: PluginFiles = { ...files }
  for (const skill of skills) {
    const base = skillBase(skill)
    let skillCount = 0
    for (const [rel, content] of Object.entries(skillFiles(files, skill))) {
      const result = rewriteSkillReferences(content, base, files, pluginRoot)
      if (result.count === 0) continue
      skillCount += result.count
      out[skillFileKey(skill, rel)] = result.content
    }
    if (skillCount > 0) touched += 1
    rewrites += skillCount
  }
  return { files: out, rewrites, skills: touched }
}
