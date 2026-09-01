#!/usr/bin/env node
/**
 * i18n-check - plugin UI translation gate.
 *
 * Every user-facing string in a plugin's browser half must come from the
 * package's locale dictionaries (docs/i18n.md, "Plugin UI strings"); the
 * DSH locale service does the runtime work (typed registration, en fallback,
 * common vocabulary, interpolation). This gate enforces the repo-side
 * contract the platform cannot see:
 *
 *   1. UI mandate        - a package whose client half ships .tsx files must
 *                          declare src/client/dictionaries/en.ts + zh.ts.
 *   2. Key parity        - zh mirrors the en key set exactly (the compiler
 *                          checks this too; the gate reports it readably and
 *                          covers compositions the compiler cannot see).
 *   3. Placeholder parity- every `{name}` placeholder set matches between
 *                          en and zh for the same key.
 *   4. CJK leak          - no Simplified-Chinese text outside the dictionary
 *                          files (line exemption: `// i18n-allow: <reason>`).
 *
 * Usage:
 *   node scripts/i18n-check.mjs            # check every package (CI mode)
 *   node scripts/i18n-check.mjs --list     # report state, never fails
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const listOnly = process.argv.includes('--list')

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
const KEY_LINE = /^\s+'([^']+)':\s*(.+?),\s*$/
const PLACEHOLDER = /\{(\w+)\}/g

const failures = []

function packageSlugs() {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** Client source files of a package, relative to the package dir. */
function clientFiles(slug) {
  const dir = join(ROOT, 'packages', slug, 'src', 'client')
  const out = []
  if (!existsSync(dir)) return out
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

function isDictionaryFile(file) {
  return /[\\/]dictionaries[\\/](en|zh)\.ts$/.test(file)
    || /[\\/]dictionaries\.ts$/.test(file)
}

/** Parse `export const <name> = { ... }` key/value pairs from a dictionary file. */
function parseDictionary(file) {
  const entries = new Map()
  let inside = false
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!inside) {
      if (/^export const (en|zh)(?::[^=]+)? = \{/.test(line)) inside = true
      continue
    }
    if (/^\}/.test(line)) break
    const m = line.match(KEY_LINE)
    if (m) {
      const value = m[2].replace(/^['"]|['"],?$/g, '')
      const placeholders = new Set()
      for (const match of value.matchAll(PLACEHOLDER)) placeholders.add(match[1])
      entries.set(m[1], placeholders)
    }
  }
  return entries
}

function checkPackage(slug) {
  const label = `packages/${slug}`
  const fails = []
  const files = clientFiles(slug)
  const hasUi = files.some((f) => f.endsWith('.tsx'))
  const dictDir = join(ROOT, 'packages', slug, 'src', 'client', 'dictionaries')
  const enPath = join(dictDir, 'en.ts')
  const zhPath = join(dictDir, 'zh.ts')
  const hasDictionaries = existsSync(enPath) && existsSync(zhPath)

  if (hasUi && !hasDictionaries) {
    fails.push(`${label}: client UI (.tsx) without locale dictionaries - add src/client/dictionaries/{en,zh}.ts (docs/i18n.md)`)
  }
  if (!hasDictionaries) {
    if (existsSync(enPath) || existsSync(zhPath)) {
      fails.push(`${label}: incomplete dictionary pair - en.ts and zh.ts must exist together`)
    }
    return { slug, label, fails, hasDictionaries, hasUi }
  }

  const en = parseDictionary(enPath)
  const zh = parseDictionary(zhPath)
  if (en.size === 0) fails.push(`${label}: dictionaries/en.ts parsed to zero keys - is the object exported as \`export const en = { ... }\`?`)

  for (const key of en.keys()) {
    if (!zh.has(key)) fails.push(`${label}: zh misses key "${key}"`)
  }
  for (const key of zh.keys()) {
    if (!en.has(key)) fails.push(`${label}: zh has extra key "${key}" (en is the key source)`)
  }
  for (const [key, enPlaceholders] of en) {
    const zhPlaceholders = zh.get(key)
    if (zhPlaceholders === undefined) continue
    for (const name of enPlaceholders) {
      if (!zhPlaceholders.has(name)) fails.push(`${label}: key "${key}" placeholder {${name}} missing in zh`)
    }
    for (const name of zhPlaceholders) {
      if (!enPlaceholders.has(name)) fails.push(`${label}: key "${key}" placeholder {${name}} missing in en`)
    }
  }

  for (const file of files) {
    if (isDictionaryFile(file)) continue
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (!CJK.test(lines[i])) continue
      if (/i18n-allow:/.test(lines[i]) || (i > 0 && /i18n-allow:/.test(lines[i - 1]))) continue
      fails.push(`${label}: CJK text outside dictionaries at ${file}:${i + 1} (move it into dictionaries/zh.ts, or exempt the line with "// i18n-allow: <reason>")`)
    }
  }

  return { slug, label, fails, hasDictionaries, hasUi }
}

function main() {
  const results = packageSlugs().map(checkPackage)

  if (listOnly) {
    for (const r of results) {
      const state = r.hasDictionaries
        ? 'localized'
        : r.hasUi
          ? 'UI WITHOUT DICTIONARIES'
          : 'no UI strings'
      const mark = r.fails.length === 0 ? '[OK]  ' : '[FAIL]'
      console.log(`${mark} ${r.label}: ${state}${r.fails.length > 0 ? ` (${r.fails.length} problem(s))` : ''}`)
    }
    return
  }

  const failed = results.filter((r) => r.fails.length > 0)
  for (const r of failed) {
    console.error(`${r.label}:`)
    for (const f of r.fails) console.error(`  - ${f}`)
  }
  if (failed.length > 0) {
    console.error(`i18n check failed: ${failed.length}/${results.length} package(s) inconsistent`)
    process.exit(1)
  }
  const localized = results.filter((r) => r.hasDictionaries).length
  console.log(`i18n check passed: ${localized} localized package(s), ${results.length - localized} without UI strings`)
}

main()
