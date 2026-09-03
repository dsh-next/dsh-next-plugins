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
import { join } from 'node:path'

const { importSpecifiers, checkRuntimeImports } = await import('./runtime-deps-check.mjs')

// A real package dir under node_modules so `@deepseek-ai/*` resolution works.
const PKG_DIR = join(import.meta.dirname, '..', 'packages', 'dsh-next-cc-plugins')

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
