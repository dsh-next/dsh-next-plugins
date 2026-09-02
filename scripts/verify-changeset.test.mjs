/**
 * Tests for the changeset presence gate (scripts/verify-changeset.mjs).
 *
 * The gate compares `git diff --name-only <base>` against a base ref, so the
 * test builds a real throwaway git repo in a temp dir, commits a baseline,
 * then applies the scenario (plugin source change, change file, ...) and runs
 * the script against `--base <baseline commit>`. Node 18+ --test runner keeps
 * this in the root `pnpm test:scripts` lane (the repo runs `node --test
 * scripts/*.test.mjs`).
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname ?? '.', 'verify-changeset.mjs')

let repo = ''
let base = ''

function git(...args) {
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function write(path, content) {
  const full = join(repo, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function runGate() {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, '--base', base], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'cs-gate-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(repo, 'packages/dsh-next-skills/src'), { recursive: true })
  mkdirSync(join(repo, 'packages/dsh-next-cron/src'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  write('packages/dsh-next-skills/src/index.ts', 'export const a = 1\n')
  write('packages/dsh-next-cron/src/index.ts', 'export const c = 1\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  base = 'HEAD'
  write('.changeset/config.json', '{}\n')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('verify-changeset gate', () => {
  it('fails when a plugin source change has no change file', () => {
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    const result = runGate()
    assert.equal(result.code, 1)
    assert.match(result.out, /dsh-next-skills/)
    assert.match(result.out, /\.changeset/)
  })

  it('passes when a change file names the touched package', () => {
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    write('.changeset/calm-cats.md', '---\n"@dsh-next/dsh-next-skills": patch\n---\n\ntest\n')
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('fails when the change file names a different package', () => {
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    write('.changeset/wrong.md', '---\n"@dsh-next/dsh-next-notifier": minor\n---\n\ntest\n')
    const result = runGate()
    assert.equal(result.code, 1)
    assert.match(result.out, /do not name dsh-next-skills/)
  })

  it('passes for docs-only and build-artifact changes', () => {
    write('packages/dsh-next-skills/README.md', '# hi\n')
    write('packages/dsh-next-skills/lib/index.js', 'console.log(1)\n')
    write('docs/publish-prep.md', '# updated\n')
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('passes when nothing changed and ignores untracked non-source files', () => {
    write('scratch-notes.md', 'leftover\n')
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('treats pnpm-lock and manifest churn as non-source', () => {
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
    write('packages/dsh-next-skills/package.json', '{"name":"@dsh-next/dsh-next-skills"}\n')
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('requires a base ref', () => {
    let status = 0
    try {
      execFileSync('node', [SCRIPT], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      status = error.status
    }
    assert.equal(status, 2)
  })

  it('skips cleanly with VERIFY_CHANGESET_SKIP=1', () => {
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    const out = execFileSync('node', [SCRIPT, '--base', base], { cwd: repo, encoding: 'utf8', env: { ...process.env, VERIFY_CHANGESET_SKIP: '1' } })
    assert.match(out, /skipped/)
  })

  it('passes when a package is deleted (no change file needed for removal)', () => {
    rmSync(join(repo, 'packages/dsh-next-cron'), { recursive: true, force: true })
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('passes without a change file when the touched package is ignored', () => {
    write('.changeset/config.json', '{"ignore":["@dsh-next/dsh-next-cron"]}\n')
    write('packages/dsh-next-cron/src/index.ts', 'export const c = 2\n')
    const result = runGate()
    assert.equal(result.code, 0, result.out)
  })

  it('fails when a change file names an ignored package', () => {
    write('.changeset/config.json', '{"ignore":["@dsh-next/dsh-next-cron"]}\n')
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    write('.changeset/ignored.md', '---\n"@dsh-next/dsh-next-cron": patch\n---\n\ntest\n')
    const result = runGate()
    assert.equal(result.code, 1)
    assert.match(result.out, /ignored package/)
  })

  it('fails when a change file mixes an ignored and a released package', () => {
    write('.changeset/config.json', '{"ignore":["@dsh-next/dsh-next-cron"]}\n')
    write('packages/dsh-next-skills/src/index.ts', 'export const a = 2\n')
    write('.changeset/mixed.md', '---\n"@dsh-next/dsh-next-cron": patch\n"@dsh-next/dsh-next-skills": patch\n---\n\ntest\n')
    const result = runGate()
    assert.equal(result.code, 1)
    assert.match(result.out, /ignored package/)
  })
})
