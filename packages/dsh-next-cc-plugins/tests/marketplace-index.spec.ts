/**
 * Marketplace index parsing: valid documents of every source form, and every
 * validation branch. Pure core coverage for `parseMarketplaceIndex` and
 * `normalizePluginSource`.
 */
import { describe, expect, it } from 'vitest'
import { normalizePluginSource, parseMarketplaceIndex } from '../src/core/marketplace-index.ts'

const WHERE = '.claude-plugin/marketplace.json'

function indexDoc(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'acme-tools',
    description: 'Internal tools',
    owner: { name: 'Platform Team', email: 'platform@example.com' },
    plugins: [
      { name: 'formatter', description: 'Formats code', source: './plugins/formatter' },
    ],
    ...over,
  })
}

describe('parseMarketplaceIndex', () => {
  it('parses a full valid document', () => {
    const result = parseMarketplaceIndex(indexDoc(), WHERE)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.index.name).toBe('acme-tools')
    expect(result.index.description).toBe('Internal tools')
    expect(result.index.owner).toBe('Platform Team')
    expect(result.index.plugins).toHaveLength(1)
    expect(result.index.plugins[0]).toEqual({
      name: 'formatter',
      description: 'Formats code',
      version: '',
      category: '',
      author: '',
      homepage: '',
      tags: [],
      source: { kind: 'relative', path: 'plugins/formatter' },
    })
  })

  it('falls back to metadata.description when the top level has none', () => {
    const doc = indexDoc({ description: undefined, metadata: { description: 'Nested form', pluginRoot: './bundle' } })
    const result = parseMarketplaceIndex(doc, WHERE)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.index.description).toBe('Nested form')
  })

  it('prefers the top-level description over metadata.description', () => {
    const doc = indexDoc({ metadata: { description: 'Nested form' } })
    const result = parseMarketplaceIndex(doc, WHERE)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.index.description).toBe('Internal tools')
  })

  it('rejects invalid JSON', () => {
    const result = parseMarketplaceIndex('{ not json', WHERE)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('invalid JSON')
  })

  it('rejects a non-object top level', () => {
    expect('error' in parseMarketplaceIndex('[]', WHERE)).toBe(true)
    expect('error' in parseMarketplaceIndex('null', WHERE)).toBe(true)
  })

  it('requires name and plugins', () => {
    let r = parseMarketplaceIndex(JSON.stringify({ plugins: [] }), WHERE)
    expect('error' in r && r.error).toContain('"name"')
    r = parseMarketplaceIndex(JSON.stringify({ name: 'x' }), WHERE)
    expect('error' in r && r.error).toContain('"plugins"')
  })

  it('requires name and source per plugin entry', () => {
    let r = parseMarketplaceIndex(indexDoc({ plugins: [{ source: './x' }] }), WHERE)
    expect('error' in r && r.error).toContain('"name"')
    r = parseMarketplaceIndex(indexDoc({ plugins: [{ name: 'x' }] }), WHERE)
    expect('error' in r && r.error).toContain('"source"')
  })

  it('rejects duplicate plugin names', () => {
    const r = parseMarketplaceIndex(indexDoc({
      plugins: [
        { name: 'a', source: './a' },
        { name: 'a', source: './b' },
      ],
    }), WHERE)
    expect('error' in r && r.error).toContain('duplicate')
  })

  it('collects tags and keywords and reads the author object', () => {
    const r = parseMarketplaceIndex(indexDoc({
      plugins: [{
        name: 'x', source: './x', tags: ['ci'], keywords: ['deploy'], author: { name: 'Ada' },
        version: '1.2.3', category: 'dev', homepage: 'https://x',
      }],
    }), WHERE)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    const p = r.index.plugins[0]
    expect(p.tags).toEqual(['ci', 'deploy'])
    expect(p.author).toBe('Ada')
    expect(p.version).toBe('1.2.3')
    expect(p.category).toBe('dev')
    expect(p.homepage).toBe('https://x')
  })

  it('resolves bare-name sources against metadata.pluginRoot', () => {
    const r = parseMarketplaceIndex(indexDoc({
      metadata: { pluginRoot: './plugins' },
      plugins: [{ name: 'x', source: 'x' }],
    }), WHERE)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.index.plugins[0].source).toEqual({ kind: 'relative', path: 'plugins/x' })
  })
})

describe('normalizePluginSource', () => {
  it('normalizes Claude github sources with an optional ref', () => {
    expect(normalizePluginSource({ source: 'github', repo: 'o/r' }, '')).toEqual({ kind: 'github', owner: 'o', repo: 'r' })
    expect(normalizePluginSource({ source: 'github', repo: 'o/r', ref: 'v2' }, '')).toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'v2' })
  })

  it('normalizes github URLs in url sources', () => {
    expect(normalizePluginSource({ source: 'url', url: 'https://github.com/o/r.git' }, '')).toEqual({ kind: 'github', owner: 'o', repo: 'r' })
  })

  it('marks non-GitHub url sources unsupported', () => {
    const r = normalizePluginSource({ source: 'url', url: 'https://gitlab.com/o/r.git' }, '')
    expect(r.kind).toBe('unsupported')
    if (r.kind === 'unsupported') expect(r.reason).toContain('non-GitHub')
  })

  it('marks npm, archive, and command sources unsupported with reasons', () => {
    for (const raw of [
      { source: 'npm', package: 'x' },
      { source: 'archive', url: 'https://x/z.zip' },
      { source: 'command', command: 'make plugin' },
      { source: 'git-subdir', url: 'https://github.com/o/r.git' }, // no path
      { source: 'git-subdir', url: 'https://gitlab.com/o/r', path: 'p' }, // non-GitHub host
    ]) {
      const r = normalizePluginSource(raw, '')
      expect(r.kind).toBe('unsupported')
    }
    const command = normalizePluginSource({ source: 'command', command: 'x' }, '')
    expect(command.kind === 'unsupported' ? command.reason : '').toContain('execute a local command')
  })

  it('resolves git-subdir sources as a pinned GitHub repo plus subdirectory', () => {
    // The official marketplace's monorepo form: url + path, pinned by sha.
    expect(normalizePluginSource({
      source: 'git-subdir',
      url: 'https://github.com/Airtable/skills.git',
      path: 'plugins/airtable',
      ref: 'main',
      sha: '812ee67f1fd3d76fb45ff8df40afaa0448602ba8',
    }, '')).toEqual({
      kind: 'github',
      owner: 'Airtable',
      repo: 'skills',
      ref: '812ee67f1fd3d76fb45ff8df40afaa0448602ba8', // the exact pin beats the movable ref
      subdir: 'plugins/airtable',
    })
    // ref-only still pins; a missing path stays unsupported.
    expect(normalizePluginSource({ source: 'git-subdir', url: 'https://github.com/o/r', path: './p/', ref: 'v1' }, ''))
      .toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'v1', subdir: 'p' })
  })

  it('pins url and github sources by sha when one is carried', () => {
    expect(normalizePluginSource({ source: 'url', url: 'https://github.com/o/r.git', sha: 'abc123' }, ''))
      .toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'abc123' })
    expect(normalizePluginSource({ source: 'github', repo: 'o/r', ref: 'v2', sha: 'def456' }, ''))
      .toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'def456' })
    // Unpinned forms stay unpinned.
    expect(normalizePluginSource({ source: 'url', url: 'https://github.com/o/r' }, ''))
      .toEqual({ kind: 'github', owner: 'o', repo: 'r' })
  })

  it('normalizes the Grok local-object form', () => {
    expect(normalizePluginSource({ type: 'local', path: './plugins/gdrive' }, '')).toEqual({ kind: 'relative', path: 'plugins/gdrive' })
  })

  it('normalizes a root source ("./" — the marketplace repo IS the plugin)', () => {
    expect(normalizePluginSource('./', '')).toEqual({ kind: 'relative', path: '' })
    expect(normalizePluginSource('.', '')).toEqual({ kind: 'relative', path: '.' })
  })

  it('normalizes grok url sources with a sha as github when GitHub-hosted', () => {
    expect(normalizePluginSource({ source: 'url', url: 'https://github.com/my-org/gdrive' }, '')).toEqual({ kind: 'github', owner: 'my-org', repo: 'gdrive' })
  })

  it('marks invalid shapes unsupported', () => {
    expect(normalizePluginSource(42, '').kind).toBe('unsupported')
    expect(normalizePluginSource(null, '').kind).toBe('unsupported')
    expect(normalizePluginSource('', '').kind).toBe('unsupported')
    expect(normalizePluginSource({ source: 'github', repo: 'not-a-repo' }, '').kind).toBe('unsupported')
    expect(normalizePluginSource({ source: 'local' }, '').kind).toBe('unsupported')
    expect(normalizePluginSource({ source: 'wat' }, '').kind).toBe('unsupported')
  })
})
