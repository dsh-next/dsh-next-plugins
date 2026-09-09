/**
 * Tests for the runtime dependency guardrail (scripts/runtime-deps-check.mjs).
 *
 * The pure helpers `importSpecifiers` and `checkRuntimeImports` are exercised
 * directly. `checkRuntimeImports` resolves `@deepseek-ai/*` specifiers from a
 * package directory, so the "resolves" assertions point the resolver at the
 * real cc-plugins package dir (whose devDeps are installed); the "does not
 * resolve" and "undeclared dep" assertions use a non-existent specifier, which
 * is independent of any install state.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const { importSpecifiers, checkRuntimeImports } = await import('./runtime-deps-check.mjs')

// A real package dir under node_modules so `@deepseek-ai/*` resolution works.
const PKG_DIR = join(import.meta.dirname, '..', 'packages', 'dsh-next-cc-plugins')

// Copy the CLI so its root points at an isolated temporary Git repo.
function cliFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'runtime deps check ')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '--quiet')
  mkdirSync(join(root, 'scripts'))
  copyFileSync(join(import.meta.dirname, 'runtime-deps-check.mjs'), join(root, 'scripts/runtime-deps-check.mjs'))
  const run = () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/runtime-deps-check.mjs')], {
      cwd: root, encoding: 'utf8',
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    return result
  }
  return { root, write, git, run }
}

describe('CLI source discovery', () => {
  it('skips deleted tracked sources without restoring them', (t) => {
    const { root, write, git, run } = cliFixture(t)
    write('packages/example/package.json', JSON.stringify({ name: 'example' }))
    write('packages/example/src/deleted.ts', 'import x from "missing-deleted-dep"')
    write('packages/example/src/kept.ts', 'export const kept = true')
    git('add', 'packages')
    rmSync(join(root, 'packages/example/src/deleted.ts'))
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('example (1 source files)'), result.stdout)
    assert.equal(existsSync(join(root, 'packages/example/src/deleted.ts')), false)
  })

  it('checks tracked sources, new sources, and entirely untracked packages', (t) => {
    const { write, git, run } = cliFixture(t)
    write('packages/existing/package.json', JSON.stringify({ name: 'existing' }))
    write('packages/existing/src/tracked.ts', 'import x from "missing-tracked-dep"')
    git('add', 'packages')
    write('packages/existing/src/new.ts', 'import x from "missing-new-dep"')
    write('packages/new package/package.json', JSON.stringify({ name: 'new-package' }))
    write('packages/new package/src/new file.ts', 'import x from "missing-package-dep"')
    const result = run()
    assert.equal(result.status, 1)
    for (const dep of ['missing-tracked-dep', 'missing-new-dep', 'missing-package-dep']) {
      assert.ok(result.stderr.includes('imports "' + dep + '"'), result.stderr)
    }
    assert.ok(result.stderr.includes('2 package(s) FAILED'), result.stderr)
  })

  it('preserves spaces and Git-quoted characters in tracked and untracked paths', (t) => {
    const { write, git, run } = cliFixture(t)
    const dir = 'packages/package with spaces'
    const tracked = dir + '/src/ tracked "quoted" ü file.ts'
    const untracked = dir + '/src/new folder/new\tline\nfile.ts'
    write(dir + '/package.json', JSON.stringify({ name: 'spaces' }))
    write(tracked, 'import x from "missing-tracked-dep"')
    git('add', 'packages')
    write(untracked, 'import x from "missing-new-dep"')
    const result = run()
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes(tracked + ' imports "missing-tracked-dep"'), result.stderr)
    assert.ok(result.stderr.includes(untracked + ' imports "missing-new-dep"'), result.stderr)
  })

  it('excludes ignored and non-source files but checks tracked lib', (t) => {
    const { write, git, run } = cliFixture(t)
    write('.gitignore', 'lib/\nignored.ts\n')
    write('packages/example/package.json', JSON.stringify({ name: 'example' }))
    write('packages/example/src/index.ts', 'export const ok = true')
    write('packages/example/lib/tracked.js', 'import x from "missing-lib-dep"')
    git('add', 'packages/example/package.json', 'packages/example/src')
    git('add', '-f', 'packages/example/lib/tracked.js')
    write('packages/example/lib/generated.js', 'import x from "ignored-build-dep"')
    write('packages/example/src/ignored.ts', 'import x from "ignored-source-dep"')
    write('packages/example/src/example.txt', 'import x from "non-source-dep"')
    write('packages/example/tests/example.ts', 'import x from "test-only-dep"')
    const result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /imports "missing-lib-dep"/)
    assert.doesNotMatch(result.stderr, /ignored-build-dep|ignored-source-dep|non-source-dep|test-only-dep/)
  })

  it('skips packages with deleted manifests or no remaining source', (t) => {
    const { root, write, git, run } = cliFixture(t)
    write('packages/deleted/package.json', JSON.stringify({ name: 'deleted' }))
    write('packages/deleted/src/index.ts', 'import x from "missing-dep"')
    write('packages/empty/package.json', JSON.stringify({ name: 'empty' }))
    write('packages/empty/src/index.ts', 'import x from "missing-dep"')
    git('add', 'packages')
    rmSync(join(root, 'packages/deleted/package.json'))
    rmSync(join(root, 'packages/empty/src/index.ts'))
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /all 0 scanned packages pass/)
  })
})

describe('importSpecifiers', () => {
  it('extracts default and named imports and re-exports', () => {
    assert.deepEqual(
      importSpecifiers('import a from "b"; import { c } from \'d\'; export * from "e";'),
      ['b', 'd', 'e'],
    )
  })

  it('ignores comments, strings, and template literals', () => {
    const src = [
      '// import x from "not-an-import"',
      '/* from "also-not" */',
      'const s = "from \\"nope\\""',
      'import y from "real"',
    ].join('\n')
    assert.deepEqual(importSpecifiers(src), ['real'])
  })

  it('extracts dynamic import() specifiers', () => {
    assert.deepEqual(importSpecifiers('const m = import("mod")'), ['mod'])
  })
})

describe('checkRuntimeImports', () => {
  it('allows node: builtins and relative imports', () => {
    const files = {
      'a.ts': 'import { join } from "node:path"; import x from "./local"',
    }
    assert.deepEqual(checkRuntimeImports({ dependencies: {} }, files, PKG_DIR), [])
  })

  it('flags an undeclared bare import', () => {
    const files = { 'a.ts': 'import x from "left-pad"' }
    const v = checkRuntimeImports({ dependencies: {} }, files, PKG_DIR)
    assert.equal(v.length, 1)
    assert.equal(v[0].specifier, 'left-pad')
  })

  it('allows a declared dependency', () => {
    const files = { 'a.ts': 'import ys from "js-yaml"' }
    assert.deepEqual(
      checkRuntimeImports({ dependencies: { 'js-yaml': '^4.1.0' } }, files, PKG_DIR),
      [],
    )
  })

  it('allows a declared peer dependency (react)', () => {
    const files = { 'a.tsx': 'import React from "react"' }
    assert.deepEqual(
      checkRuntimeImports({ peerDependencies: { react: '^18.2.0' } }, files, PKG_DIR),
      [],
    )
  })

  it('allows a resolvable @deepseek-ai/* specifier incl. a /client subpath', () => {
    const files = { 'a.ts': 'import { x } from "@deepseek-ai/dsh-client-runtime/client"' }
    assert.deepEqual(checkRuntimeImports({ dependencies: {} }, files, PKG_DIR), [])
  })

  it('flags a non-resolving @deepseek-ai/* specifier (transitive-missing-dep class)', () => {
    const files = { 'a.ts': 'import { y } from "@deepseek-ai/definitely-not-installed/client"' }
    const v = checkRuntimeImports({ dependencies: {} }, files, PKG_DIR)
    assert.equal(v.length, 1)
    assert.equal(v[0].specifier, '@deepseek-ai/definitely-not-installed/client')
  })
})
