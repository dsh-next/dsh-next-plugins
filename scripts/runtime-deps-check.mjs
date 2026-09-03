#!/usr/bin/env node
/**
 * Runtime dependency guardrail.
 *
 * Every bare (non-relative) import in a package's committed source must
 * resolve at consumer install time:
 *
 * - node:* builtins are always available;
 * - relative imports (./ ../) resolve within the package;
 * - a package declared in `dependencies` or `peerDependencies` is installed
 *   (or provided by the runtime) for consumers;
 * - @deepseek-ai/* is provided by the DSH runtime, but the specifier must still
 *   resolve in the local install — the check verifies the imported package
 *   actually exists under node_modules (and, for a subpath, that the subpath
 *   entry exists) rather than blindly skipping it;
 * - every other bare import must be in `dependencies`.
 *
 * A runtime import of a package that only sits in devDependencies crashes
 * dsh web at boot with ERR_MODULE_NOT_FOUND: pnpm/npm do not install a
 * dependency's devDependencies. This script fails that bug class fast in CI.
 *
 * Scans committed source (src/ and any committed lib/) because the built
 * lib/ output is gitignored and does not exist in a fresh CI checkout —
 * scanning only lib/ made the check a permanent no-op.
 *
 * Usage: node scripts/runtime-deps-check.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

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

export function checkRuntimeImports(pkgJson, files, pkgDir) {
  const deps = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ])
  // Bare specifiers resolve from the package's own directory, where its
  // devDependencies (build-time @deepseek-ai host peers) are installed. The
  // repo root does not hoist per-package devDeps.
  const req = createRequire(join(pkgDir, 'package.json'))
  const violations = []
  for (const [file, source] of Object.entries(files)) {
    for (const specifier of importSpecifiers(source)) {
      if (specifier === '' || /^['".]/.test(specifier)) continue
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('@deepseek-ai/')) {
        // Provided by the DSH runtime, but the specifier (including any
        // /client subpath) must still resolve in the local install — catches a
        // transitive missing dep surfacing at our import border, or a
        // stale/typo'd subpath.
        if (!resolves(req, specifier)) {
          violations.push({ file, specifier })
        }
        continue
      }
      const depKey = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (deps.has(depKey)) continue
      violations.push({ file, specifier })
    }
  }
  return violations
}

/** True when a bare specifier resolves to a real file from a package. */
function resolves(req, specifier) {
  try {
    req.resolve(specifier)
    return true
  } catch {
    return false
  }
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
    // Committed source (src/) plus any committed lib/ (lib/ is gitignored by
    // default, so this usually means src/ only).
    const sourcePrefixes = [`${dir}/src/`, `${dir}/lib/`]
    const sourceFiles = files.filter((f) =>
      sourcePrefixes.some((p) => f.startsWith(p)) && /\.(?:js|cjs|mjs|ts|tsx|jsx)$/.test(f),
    )
    if (sourceFiles.length === 0) continue
    scanned += 1
    const sources = Object.fromEntries(sourceFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
    const violations = checkRuntimeImports(pkgJson, sources, join(ROOT, dir))
    if (violations.length === 0) {
      console.log(`[OK]   ${pkgJson.name} (${sourceFiles.length} source files)`)
    } else {
      failed += 1
      console.error(`[FAIL] ${pkgJson.name}`)
      for (const v of violations) {
        console.error(`       ${v.file} imports "${v.specifier}" which is not in dependencies/peerDependencies or does not resolve`)
      }
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} package(s) FAILED runtime dependency check`)
    process.exit(1)
  }
  console.log(`\nall ${scanned} scanned packages pass the runtime dependency check`)
}
