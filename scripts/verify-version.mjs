#!/usr/bin/env node
/**
 * Verify every package version equals the release tag version (unified
 * versioning). Usage: node scripts/verify-version.mjs <X.Y.Z>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function packageDirs() {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

const target = process.argv[2]
if (!target || !/^\d+\.\d+\.\d+/.test(target)) {
  console.error('usage: node scripts/verify-version.mjs <X.Y.Z>')
  process.exit(2)
}

let failed = 0
for (const dir of packageDirs()) {
  const pkgPath = join(ROOT, 'packages', dir, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    console.error(`[SKIP] ${dir}: no package.json`)
    continue
  }
  if (pkg.version === target) {
    console.log(`[OK]   ${pkg.name} @ ${pkg.version}`)
  } else {
    failed += 1
    console.error(`[FAIL] ${pkg.name} @ ${pkg.version} (expected ${target})`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} package(s) do not match the tag version ${target}`)
  process.exit(1)
}
console.log(`\nall packages match tag version ${target}`)
