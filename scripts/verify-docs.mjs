#!/usr/bin/env node
/**
 * Verify the documentation contract: every package has a README.md. English
 * only (no paired README.zh.md / README.i18n.yaml required).
 * Usage: node scripts/verify-docs.mjs [--list]
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const listOnly = process.argv.includes('--list')

const missing = []
const present = []

const packageDirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

for (const dir of packageDirs) {
  const readme = join(ROOT, 'packages', dir, 'README.md')
  if (existsSync(readme)) {
    present.push(dir)
  } else {
    missing.push(dir)
  }
}

if (listOnly) {
  for (const dir of present) console.log(`[OK]   packages/${dir}/README.md`)
  for (const dir of missing) console.log(`[MISS] packages/${dir}/README.md`)
  process.exit(missing.length > 0 ? 1 : 0)
}

if (missing.length > 0) {
  console.error('Missing README.md in:')
  for (const dir of missing) console.error(`  packages/${dir}`)
  process.exit(1)
}
console.log(`docs check passed: ${present.length} packages have README.md`)
