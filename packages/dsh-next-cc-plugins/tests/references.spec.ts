/**
 * Plugin-level reference rewriting: pure coverage for `core/references.ts`.
 * Every resolution mode (file-relative `../`-chains, cwd-relative bare
 * forms), every safety rail (existence check, in-skill pass-through, URL
 * and prose immunity, plugin-root escape), and the whole-file map
 * transformation across bundle, flat, and manifest-redirected skills.
 */
import { describe, expect, it } from 'vitest'
import type { SkillComponent } from '../src/core/types.ts'
import { rewriteSkillFiles, rewriteSkillReferences } from '../src/core/references.ts'

const ROOT = '/home/u/.dsh/cc-plugins/plugins/github_o_r_refsy'

const FILES = {
  'skills/deep/SKILL.md': 'body',
  'skills/deep/helpers/notes.md': 'see ../references/guide.md and ../../assets/logo.svg',
  'references/guide.md': 'guide',
  'assets/logo.svg': 'svg',
  'commands/run.md': 'run',
  '.claude-plugin/plugin.json': '{}',
}

const DEEP: SkillComponent = { name: 'deep', description: '', path: 'skills/deep' }

function rw(content: string, skillDir = 'skills/deep', files: Record<string, string> = FILES, root = ROOT): { content: string; count: number } {
  return rewriteSkillReferences(content, skillDir, files, root)
}

describe('rewriteSkillReferences: ../-chains (file-relative)', () => {
  it('rewrites a reference that resolves to an existing plugin-level file', () => {
    const r = rw('Read ../../references/guide.md first.')
    expect(r.count).toBe(1)
    expect(r.content).toBe(`Read ${ROOT}/references/guide.md first.`)
  })

  it('resolves from the skill directory, so depth matters', () => {
    // From skills/deep: ../../assets escapes to the plugin root's assets/.
    const r = rw('See ../../assets/logo.svg.')
    expect(r.count).toBe(1)
    expect(r.content).toBe(`See ${ROOT}/assets/logo.svg.`)
    // A single ../ lands inside skills/ where the file does not exist:
    // left verbatim (it would be dead in Claude Code too).
    const shallow = rw('Read ../references/guide.md.')
    expect(shallow.count).toBe(0)
    expect(shallow.content).toBe('Read ../references/guide.md.')
    // From skills/deep/helpers, the same text reaches one level higher and
    // no longer exists: left verbatim.
    const miss = rw('See ../../assets/logo.svg.', 'skills/deep/helpers')
    expect(miss.count).toBe(0)
    expect(miss.content).toBe('See ../../assets/logo.svg.')
  })

  it('rewrites bare directory links and keeps sentence punctuation', () => {
    const dir = rw('See [](../../references/).')
    expect(dir.count).toBe(1)
    expect(dir.content).toBe(`See [](${ROOT}/references).`)
    const dots = rw('Read ../../references/guide.md. Then stop.')
    expect(dots.content).toBe(`Read ${ROOT}/references/guide.md. Then stop.`)
  })

  it('never touches paths escaping the plugin root or missing files', () => {
    expect(rw('See ../../../etc/passwd.').count).toBe(0)
    expect(rw('See ../../references/missing.md.').count).toBe(0)
    expect(rw('See ../nope/x.md.').count).toBe(0)
  })
})

describe('rewriteSkillReferences: bare forms (cwd-relative)', () => {
  it('resolves bare dir/... references against the plugin root', () => {
    const r = rw('See references/guide.md for details.')
    expect(r.count).toBe(1)
    expect(r.content).toBe(`See ${ROOT}/references/guide.md for details.`)
    // Component roots resolve the same way (they live in the materialized
    // copy too).
    const cmd = rw('Run commands/run.md when done.')
    expect(cmd.count).toBe(1)
    expect(cmd.content).toBe(`Run ${ROOT}/commands/run.md when done.`)
  })

  it('leaves in-skill bare references alone (they work verbatim)', () => {
    // skills/deep/helpers/ exists; a bare mention resolves in-skill against
    // the installed copy, and the plugin-root lookup misses, so it stays.
    const r = rw('Check helpers/notes.md.')
    expect(r.count).toBe(0)
    expect(r.content).toBe('Check helpers/notes.md.')
  })

  it('leaves ./-prefixed in-skill references alone', () => {
    const r = rw('Open ./helpers/notes.md.')
    expect(r.count).toBe(0)
    expect(r.content).toBe('Open ./helpers/notes.md.')
  })
})

describe('rewriteSkillReferences: immunity rails', () => {
  it('never matches URLs or mid-path fragments', () => {
    const urls = 'Visit https://example.com/a/../b and http://x.test/references/guide.md.'
    const r = rw(urls)
    expect(r.count).toBe(0)
    expect(r.content).toBe(urls)
  })

  it('leaves prose mentions of a directory without a following path alone', () => {
    const r = rw('Add the references folder yourself.')
    expect(r.count).toBe(0)
  })

  it('rewrites multiple tokens in one body', () => {
    const r = rw('Read ../../references/guide.md and references/guide.md again.')
    expect(r.count).toBe(2)
    expect(r.content).toBe(`Read ${ROOT}/references/guide.md and ${ROOT}/references/guide.md again.`)
  })

  it('keeps a pure up-chain untouched', () => {
    expect(rw('Go up with ../ and ../..').count).toBe(0)
  })
})

describe('rewriteSkillFiles', () => {
  it('rewrites bundle skills and leaves the source map untouched', () => {
    const source = {
      'skills/deep/SKILL.md': '---\nname: deep\ndescription: d\n---\nRead ../../references/guide.md now.',
      'references/guide.md': 'guide',
    }
    const out = rewriteSkillFiles(source, [DEEP], ROOT)
    expect(out.rewrites).toBe(1)
    expect(out.skills).toBe(1)
    expect(out.files['skills/deep/SKILL.md']).toContain(`${ROOT}/references/guide.md`)
    // The original map is not mutated.
    expect(source['skills/deep/SKILL.md']).toContain('../../references/guide.md')
    // Non-skill files are shared verbatim.
    expect(out.files['references/guide.md']).toBe('guide')
  })

  it('rewrites every file inside a skill directory, not just SKILL.md', () => {
    const source = {
      'skills/deep/SKILL.md': 'Read the helper first.',
      'skills/deep/helpers/notes.md': 'see ../../references/guide.md',
      'references/guide.md': 'guide',
    }
    const out = rewriteSkillFiles(source, [DEEP], ROOT)
    expect(out.rewrites).toBe(1)
    expect(out.files['skills/deep/helpers/notes.md']).toBe(`see ${ROOT}/references/guide.md`)
  })

  it('handles flat (skills/<name>.md) skills against the skills/ base', () => {
    const flat: SkillComponent = { name: 'quick', description: '', path: '' }
    const source = {
      'skills/quick.md': '---\nname: quick\ndescription: d\n---\nSee ../references/guide.md.',
      'references/guide.md': 'guide',
    }
    const out = rewriteSkillFiles(source, [flat], ROOT)
    expect(out.rewrites).toBe(1)
    // The rewritten content lands back on the flat file's true key.
    expect(out.files['skills/quick.md']).toContain(`${ROOT}/references/guide.md`)
  })

  it('handles manifest-redirected single-file skills via skill.file', () => {
    const file: SkillComponent = { name: 'pinned', description: '', path: 'skills/ignored', file: 'docs/pinned-skill.md' }
    const source = {
      'docs/pinned-skill.md': '---\nname: pinned\ndescription: d\n---\nSee ../references/guide.md.',
      'references/guide.md': 'guide',
    }
    const out = rewriteSkillFiles(source, [file], ROOT)
    expect(out.rewrites).toBe(1)
    expect(out.files['docs/pinned-skill.md']).toContain(`${ROOT}/references/guide.md`)
  })

  it('reports zero for skills without plugin-level references', () => {
    const source = { 'skills/plain/SKILL.md': '---\nname: plain\ndescription: d\n---\nSelf-contained.' }
    const plain: SkillComponent = { name: 'plain', description: '', path: 'skills/plain' }
    const out = rewriteSkillFiles(source, [plain], ROOT)
    expect(out).toEqual({ files: source, rewrites: 0, skills: 0 })
  })
})
