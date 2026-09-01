#!/usr/bin/env node
/**
 * verify-docs - documentation contract gate.
 *
 * Every package ships a bilingual README pair (docs/i18n.md):
 *   README.md         English side
 *   README.zh.md      Simplified Chinese side (equal authority)
 *   README.i18n.yaml  pairing record: git blob hash of each side as of the
 *                     last confirmed-consistent state
 *
 * Checks (default mode):
 *   1. Triplet presence per package.
 *   2. Language switcher lines under the H1 on both sides.
 *   3. Structural signature mirror (headings, fences, tables, lists).
 *   4. Recorded blob hashes match the current content of both sides.
 *
 * Usage:
 *   node scripts/verify-docs.mjs                    # check everything (CI mode)
 *   node scripts/verify-docs.mjs --list             # report state, never fails
 *   node scripts/verify-docs.mjs --write <slug>...  # re-record pairing hashes
 *                                                   # after confirming both
 *                                                   # sides agree
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const writeMode = args.includes('--write')
const namedSlugs = args.filter((a) => !a.startsWith('--')).map(normalizeSlug)

const EN_SWITCHER = 'English | [中文](README.zh.md)'
const ZH_SWITCHER = '[English](README.md) | 中文'

const PAIRING_HEADER = [
  '# Bilingual-pair consistency record (docs/i18n.md): the git blob hash of each',
  '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
  '# after editing either side, bring the other along and re-record with:',
  '#   pnpm docs:write-pair <slug>',
].join('\n')

function normalizeSlug(name) {
  return String(name || '').trim().replace(/^dsh-next-/, '')
}

function packageSlugs() {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name.replace(/^dsh-next-/, ''))
    .sort()
}

/** Git blob hash of a working-tree file (content-addressed, no staging needed). */
function blobHash(file) {
  return execFileSync('git', ['hash-object', file], { cwd: ROOT }).toString().trim()
}

/** Parse a pairing record into { 'README.md': hash, 'README.zh.md': hash }. */
function readPairing(yamlPath) {
  const out = {}
  for (const line of readFileSync(yamlPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(README(?:\.zh)?\.md):\s*([0-9a-f]{40})\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function writePairing(yamlPath, hashes) {
  const body = `README.md: ${hashes['README.md']}\nREADME.zh.md: ${hashes['README.zh.md']}\n`
  writeFileSync(yamlPath, PAIRING_HEADER + '\n' + body)
}

/**
 * Structural signature: heading levels, fence open/close with language
 * markers, table row/column shapes, list kinds. Headings compare by level
 * only (text is translated); fenced block CONTENT is not compared, because
 * translating comments inside code samples is legitimate localization. The
 * mirror rule guards against a missing or added section, not translated
 * sample text.
 */
function signature(text) {
  const sig = { headings: [], fences: [], tables: [], lists: [] }
  let inFence = null
  let tableRows = 0
  let tableCols = 0
  const flushTable = () => {
    if (tableRows > 0) sig.tables.push(`r${tableRows}c${tableCols}`)
    tableRows = 0
    tableCols = 0
  }
  for (const line of text.split(/\r?\n/)) {
    const fence = line.match(/^(`{3,}|~{3,})\s*(\S*)\s*$/)
    if (fence) {
      if (!inFence) {
        inFence = fence[1][0]
        sig.fences.push('open:' + (fence[2] || 'plain'))
      } else if (fence[1][0] === inFence && !fence[2]) {
        inFence = null
        sig.fences.push('close')
      }
      flushTable()
      continue
    }
    if (inFence) continue
    const heading = line.match(/^(#{1,6})\s+\S/)
    if (heading) {
      flushTable()
      sig.headings.push(heading[1].length)
      continue
    }
    if (/^\s*\|/.test(line)) {
      const cols = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
      if (tableRows === 0) tableCols = cols
      tableRows += 1
      continue
    }
    flushTable()
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      const marker = line.trim()[0]
      sig.lists.push(marker === '-' || marker === '*' || marker === '+' ? 'ul' : 'ol')
    }
  }
  flushTable()
  return sig
}

/** Full pairing check for one package; returns its failure list. */
function checkPackage(slug) {
  const dir = join(ROOT, 'packages', `dsh-next-${slug}`)
  const label = `packages/dsh-next-${slug}`
  const enPath = join(dir, 'README.md')
  const zhPath = join(dir, 'README.zh.md')
  const yamlPath = join(dir, 'README.i18n.yaml')
  const fails = []

  for (const [path, name] of [[enPath, 'README.md'], [zhPath, 'README.zh.md'], [yamlPath, 'README.i18n.yaml']]) {
    if (!existsSync(path)) fails.push(`${label}: missing ${name}`)
  }
  if (fails.length > 0) return { slug, label, fails }

  const en = readFileSync(enPath, 'utf8')
  const zh = readFileSync(zhPath, 'utf8')

  if (!en.split(/\r?\n/).slice(0, 5).includes(EN_SWITCHER)) {
    fails.push(`${label}: README.md lacks the switcher line "English | [中文](README.zh.md)" within its first 5 lines`)
  }
  if (!zh.split(/\r?\n/).slice(0, 5).includes(ZH_SWITCHER)) {
    fails.push(`${label}: README.zh.md lacks the switcher line "[English](README.md) | 中文" within its first 5 lines`)
  }

  const enSig = signature(en)
  const zhSig = signature(zh)
  for (const key of ['headings', 'fences', 'tables', 'lists']) {
    if (JSON.stringify(enSig[key]) !== JSON.stringify(zhSig[key])) {
      fails.push(
        `${label}: structural signature mismatch (${key}) - `
        + `EN [${enSig[key].join(' ')}] vs ZH [${zhSig[key].join(' ')}]`,
      )
    }
  }

  const record = readPairing(yamlPath)
  for (const [name, path] of [['README.md', enPath], ['README.zh.md', zhPath]]) {
    const recorded = record[name]
    if (!recorded) {
      fails.push(`${label}: ${name} has no valid blob hash in README.i18n.yaml`)
      continue
    }
    if (blobHash(path) !== recorded) {
      fails.push(
        `${label}: ${name} changed since the pairing record was written `
        + `(mirror the edit into the other language, then: pnpm docs:write-pair ${slug})`,
      )
    }
  }
  return { slug, label, fails }
}

/** Re-record pairing hashes for the named packages, then re-check them. */
function writePairs(slugs) {
  let bad = 0
  for (const slug of slugs) {
    const dir = join(ROOT, 'packages', `dsh-next-${slug}`)
    const enPath = join(dir, 'README.md')
    const zhPath = join(dir, 'README.zh.md')
    const yamlPath = join(dir, 'README.i18n.yaml')
    if (!existsSync(enPath) || !existsSync(zhPath)) {
      console.error(`[FAIL] packages/dsh-next-${slug}: README.md and README.zh.md must both exist before recording`)
      bad += 1
      continue
    }
    writePairing(yamlPath, { 'README.md': blobHash(enPath), 'README.zh.md': blobHash(zhPath) })
    const { fails } = checkPackage(slug)
    if (fails.length > 0) {
      bad += 1
      console.error(`[STALE] packages/dsh-next-${slug}: hashes re-recorded, but the pair still fails:`)
      for (const f of fails) console.error(`  - ${f}`)
    } else {
      console.log(`[PAIRED] packages/dsh-next-${slug}: pairing record written and verified`)
    }
  }
  if (bad > 0) process.exit(1)
}

function main() {
  if (writeMode) {
    if (namedSlugs.length === 0) {
      console.error('usage: node scripts/verify-docs.mjs --write <slug>...   e.g. --write cc-plugins')
      process.exit(1)
    }
    writePairs(namedSlugs)
    return
  }

  const results = packageSlugs().map(checkPackage)
  if (listOnly) {
    for (const r of results) {
      if (r.fails.length === 0) console.log(`[OK]   ${r.label}`)
      else console.log(`[INCONSISTENT] ${r.label}: ${r.fails.length} problem(s), run pnpm docs:check for details`)
    }
    return
  }

  const failed = results.filter((r) => r.fails.length > 0)
  for (const r of failed) {
    console.error(`${r.label}:`)
    for (const f of r.fails) console.error(`  - ${f}`)
  }
  if (failed.length > 0) {
    console.error(`docs check failed: ${failed.length}/${results.length} package(s) inconsistent`)
    process.exit(1)
  }
  console.log(`docs check passed: ${results.length} packages carry consistent bilingual README pairs`)
}

main()
