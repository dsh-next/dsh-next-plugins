#!/usr/bin/env node
/**
 * Changeset presence gate.
 *
 * With per-package versioning, every PR that alters a publishable plugin's
 * source must record the change intent in a `.changeset/<id>.md` file — that
 * is what the release pipeline later turns into a per-package version bump.
 * A plugin change without a change file either ships unreleasable (the
 * Version Packages PR never lists the package) or forces a manual bump.
 *
 * The gate fails when the diff touches source of a publishable package
 * (anything under `packages/dsh-next-*/` except manifests, CHANGELOGs,
 * README pairs, and build output) and no `.changeset/*.md` change file is
 * present. When change files exist, each touched package must be named by at
 * least one of them.
 *
 * Packages whose manifest marks them private (`"private": true`) are exempt:
 * they are not released (changes merge silently, no change file needed) and
 * MUST NOT appear in a change file — a mixed changeset (private + released
 * package) makes `changeset version`/`publish` fail, breaking the Version
 * Packages pipeline. The manifest is the single source of truth for
 * publishability, so holding a package back is `"private": true` in the
 * package's own package.json.
 *
 * Usage: node scripts/verify-changeset.mjs --base <git ref>
 *
 * Typical wiring: CI on pull requests runs it with `--base origin/main`; the
 * direct-push release lane runs it against the same ref after `changeset
 * version` consumed the change files, so a Version Packages merge (version +
 * CHANGELOG churn only) passes.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const base = baseIndex !== -1 ? args[baseIndex + 1] : undefined

if (process.env.VERIFY_CHANGESET_SKIP === '1') {
  console.log('verify-changeset: skipped (VERIFY_CHANGESET_SKIP=1)')
  process.exit(0)
}
if (base === undefined) {
  console.error('usage: node scripts/verify-changeset.mjs --base <git ref>')
  process.exit(2)
}

/**
 * Packages whose manifest marks them private (`"private": true`). They are
 * never published — changesets skips them on version/publish, and npm refuses
 * a private publish — so they need no change file and must never appear in
 * one. `private: true` in the package manifest is the single source of truth,
 * so holding a package back is a one-field flip in the package itself.
 */
function privatePackages() {
  const out = new Set()
  for (const entry of execFileSync('git', ['ls-files', 'packages/*/package.json'], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    const m = /^packages\/(dsh-next-[^/]+)\/package\.json$/.exec(entry)
    if (m === null) continue
    try {
      const pkg = JSON.parse(readFileSync(entry, 'utf8'))
      if (pkg.private === true) out.add(`@dsh-next/${m[1]}`)
    } catch {
      // unreadable manifest: treat as not private (the gate's file check fails fast)
    }
  }
  return out
}

/** All paths changed between `base` and the working tree (staged or not). */
function changedPaths() {
  // --diff-filter excludes deletions: a REMOVED package is not being released,
  // so it needs no change file (it will never be published again).
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, '--'], { encoding: 'utf8' })
  const staged = execFileSync('git', ['diff', '--name-only', '--cached', '--diff-filter=ACMR', '--'], { encoding: 'utf8' })
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
  return [...new Set([...out.split('\n'), ...staged.split('\n'), ...untracked.split('\n')])].filter(Boolean)
}

/** Files whose change does NOT require a change file. */
function isNonSource(path) {
  if (/\/lib\//.test(path)) return true // build output (gitignored anyway)
  if (/\/node_modules\//.test(path)) return true
  if (/^packages\/[^/]+\/package\.json$/.test(path)) return true // manifest churn
  if (/^packages\/[^/]+\/CHANGELOG\.md$/.test(path)) return true // written by changeset version
  if (/README\.(i18n\.yaml|md|zh\.md)$/.test(path)) return true // docs pair
  if (path === 'pnpm-lock.yaml' || /^\.changeset\//.test(path)) return true
  return false
}

const paths = changedPaths()
const privateSet = privatePackages()

/** Package dir names touched that are candidates for release (not private). */
const touchedReleasable = new Set()
for (const p of paths) {
  const m = /^packages\/(dsh-next-[^/]+)\//.exec(p)
  if (m === null || isNonSource(p)) continue
  if (privateSet.has(`@dsh-next/${m[1]}`)) continue // private: never released; no change file needed
  touchedReleasable.add(m[1])
}

const changesetFiles = paths.filter((p) => /^\.changeset\/[^/]+\.md$/.test(p))

// The changesets CLI forbids a change file mixing a private package with a
// released one, and one naming a private package alone would also produce no
// bump; better to reject at the gate with a clear message.
if (changesetFiles.length > 0) {
  const named = new Set()
  for (const file of changesetFiles) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^"(@dsh-next\/[^" ]+)":/.exec(line.trim())
      if (m !== null) named.add(m[1])
    }
  }
  const bad = [...named].filter((name) => privateSet.has(name))
  if (bad.length > 0) {
    console.error(
      `verify-changeset: change file(s) name private package(s) ${bad.join(', ')}. ` +
      'Private packages are never published, so they must not appear in a change file ' +
      '(a mixed changeset breaks changeset version/publish). Remove the package ' +
      'from the change file; when the package is ready, remove `"private": true` ' +
      'from its package.json.',
    )
    process.exit(1)
  }
}

if (touchedReleasable.size === 0) {
  console.log('verify-changeset: no releasable package source changed; ok')
  process.exit(0)
}

if (changesetFiles.length === 0) {
  console.error(
    `verify-changeset: source changed in ${[...touchedReleasable].sort().join(', ')} ` +
    'but no .changeset/<id>.md change file is included.\n' +
    'Run `pnpm changeset` in the repo root and commit the generated file.',
  )
  process.exit(1)
}

// Every touched releasable package must be named by at least one change file.
// The file format is `---\n"@dsh-next/<dir>": <bump>\n---`.
const mentioned = new Set()
for (const file of changesetFiles) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^"@dsh-next\/([^" ]+)":/.exec(line.trim())
    if (m !== null) mentioned.add(m[1])
  }
}
const missing = [...touchedReleasable].filter((dir) => !mentioned.has(dir))
if (missing.length > 0) {
  console.error(
    `verify-changeset: change file(s) exist but do not name ${missing.join(', ')}. ` +
    'Edit the change file to include them or add another.',
  )
  process.exit(1)
}

console.log(`verify-changeset: ${changesetFiles.length} change file(s) cover ${[...touchedReleasable].sort().join(', ')}; ok`)
