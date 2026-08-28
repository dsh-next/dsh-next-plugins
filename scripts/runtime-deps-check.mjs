#!/usr/bin/env node
/**
 * Runtime dependency guardrail.
 *
 * Every bare (non-relative) import in a package's committed lib/ must
 * resolve at consumer install time:
 *
 * - node:* builtins are always available;
 * - @deepseek-ai/* is provided by the DSH runtime;
 * - everything else must be declared in the package's `dependencies`.
 *
 * A runtime import of a package that only sits in devDependencies crashes
 * dsh web at boot with ERR_MODULE_NOT_FOUND: pnpm/npm do not install a
 * dependency's devDependencies. This script fails that bug class fast in CI.
 *
 * Only git-tracked lib/ files are scanned (some packages do not commit lib/).
 *
 * Usage: node scripts/runtime-deps-check.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export function importSpecifiers(source) {
  const specifiers = []
  const n = source.length
  let i = 0
  let state = 'code'

  const readSpecifier = (start) => {
    let end = start + 1
    while (end < n) {
      const ch = source[end]
      if (ch === '\\') { end += 2; continue }
      if (ch === source[start]) return [source.slice(start + 1, end), end + 1]
      if (ch === '\n') return null
      end += 1
    }
    return null
  }

  const isKeywordAt = (word) => {
    if (!source.startsWith(word, i)) return false
    const prev = i > 0 ? source[i - 1] : ' '
    return !/[A-Za-z0-9_$.]/.test(prev)
  }

  while (i < n) {
    const ch = source[i]
    const next = i + 1 < n ? source[i + 1] : ''
    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') { state = 'line'; i += 2; break }
        if (ch === '/' && next === '*') { state = 'block'; i += 2; break }
        if (ch === '"') { state = 'double'; i += 1; break }
        if (ch === "'") { state = 'single'; i += 1; break }
        if (ch === '`') { state = 'template'; i += 1; break }
        if (ch === 'f' && isKeywordAt('from')) {
          let j = i + 4
          while (j < n && /\s/.test(source[j])) j += 1
          const quote = source[j]
          if (quote === "'" || quote === '"') {
            const got = readSpecifier(j)
            if (got !== null) { specifiers.push(got[0]); i = got[1]; break }
            i = j + 1; break
          }
        }
        if (ch === 'i' && isKeywordAt('import')) {
          let j = i + 6
          while (j < n && /\s/.test(source[j])) j += 1
          if (source[j] === '(') {
            j += 1
            while (j < n && /\s/.test(source[j])) j += 1
            const quote = source[j]
            if (quote === "'" || quote === '"') {
              const got = readSpecifier(j)
              if (got !== null) { specifiers.push(got[0]); i = got[1]; break }
              i = j + 1; break
            }
          }
        }
        i += 1
        break
      }
      case 'line':
        if (ch === '\n') state = 'code'
        i += 1
        break
      case 'block':
        if (ch === '*' && next === '/') { state = 'code'; i += 2; break }
        i += 1
        break
      case 'single':
        if (ch === '\\') { i += 2; break }
        if (ch === "'" || ch === '\n') state = 'code'
        i += 1
        break
      case 'double':
        if (ch === '\\') { i += 2; break }
        if (ch === '"' || ch === '\n') state = 'code'
        i += 1
        break
      case 'template':
        if (ch === '\\') { i += 2; break }
        if (ch === '`') state = 'code'
        i += 1
        break
    }
  }
  return specifiers
}

export function checkRuntimeImports(pkgJson, files) {
  const deps = new Set(Object.keys(pkgJson.dependencies ?? {}))
  const violations = []
  for (const [file, source] of Object.entries(files)) {
    for (const specifier of importSpecifiers(source)) {
      if (specifier === '' || /^['".]/.test(specifier)) continue
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('@deepseek-ai/')) continue
      const depKey = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (deps.has(depKey)) continue
      violations.push({ file, specifier })
    }
  }
  return violations
}

function trackedPackageFiles() {
  const files = execFileSync('git', ['ls-files', 'packages'], { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .filter(Boolean)
  const tracked = new Set(files)
  const byDir = new Map()
  for (const file of files) {
    let dir = dirname(file)
    while (dir !== '.' && dir !== 'packages' && !tracked.has(dir + '/package.json')) dir = dirname(dir)
    if (!tracked.has(dir + '/package.json')) continue
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(file)
  }
  return byDir
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isCli) {
  const byDir = trackedPackageFiles()
  let failed = 0
  let scanned = 0
  for (const [dir, files] of byDir) {
    if (!files.includes(`${dir}/package.json`)) continue
    const pkgPath = join(ROOT, dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const libPrefix = `${dir}/lib/`
    const libFiles = files.filter((f) => f.startsWith(libPrefix) && /\.(?:js|cjs|mjs)$/.test(f))
    if (libFiles.length === 0) continue
    scanned += 1
    const sources = Object.fromEntries(libFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
    const violations = checkRuntimeImports(pkgJson, sources)
    if (violations.length === 0) {
      console.log(`[OK]   ${pkgJson.name} (${libFiles.length} lib files)`)
    } else {
      failed += 1
      console.error(`[FAIL] ${pkgJson.name}`)
      for (const v of violations) {
        console.error(`       ${v.file} imports "${v.specifier}" which is not in dependencies`)
      }
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} package(s) FAILED runtime dependency check`)
    process.exit(1)
  }
  console.log(`\nall ${scanned} scanned packages pass the runtime dependency check`)
}
