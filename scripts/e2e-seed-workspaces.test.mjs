import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { seedWorkspaces } from './e2e-seed-workspaces.mjs'

const script = join(import.meta.dirname, 'e2e-seed-workspaces.sh')
const helper = join(import.meta.dirname, 'e2e-seed-workspaces.mjs')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'seed workspaces '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'scratch home')
  const workspace = join(root, 'workspace one')
  mkdirSync(workspace)
  const file = join(home, 'storages', 'workspace.json')
  return { root, home, workspace, file }
}

function cli(args, options = {}) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, NODE_OPTIONS: '' },
    ...options,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}

function put(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}

function registry() {
  return { unit: { name: 'workspace', version: 2 }, global: { workspaceIds: [] }, tables: { workspaces: {} } }
}

function failsPreserving(f, pattern, options) {
  const before = readFileSync(f.file)
  const result = cli([f.home, f.workspace], options)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, pattern)
  assert.equal(result.stdout, '')
  assert.deepEqual(readFileSync(f.file), before)
  assert.deepEqual(readdirSync(dirname(f.file)), ['workspace.json'])
}

test('CLI keeps spaces, tabs, newlines, quotes and glob characters lossless', (t) => {
  const f = fixture(t)
  const names = [' leading and trailing ', 'two\twords', 'line\nbreak', `quotes '" and * [glob] $value`]
  const dirs = names.map((name) => { const path = join(f.root, name); mkdirSync(path); return path })
  const result = cli([f.home, f.workspace, ...dirs], { cwd: f.root })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /5 added, 5 registered/)
  const doc = JSON.parse(readFileSync(f.file, 'utf8'))
  const records = Object.values(doc.tables.workspaces)
  assert.deepEqual(records.map((record) => record.path), [f.workspace, ...dirs].map((path) => realpathSync(path)))
  assert.deepEqual(records.map((record) => record.title), [basename(f.workspace), ...names])
  assert.equal(doc.global.initialized, true)
  assert.deepEqual(doc.global.archivedSessionIds, [])
  for (const [id, record] of Object.entries(doc.tables.workspaces)) {
    const h = createHash('sha1').update(`dsh-next-e2e-workspace:${record.path}`).digest('hex')
    assert.equal(id, `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`)
    assert.ok(doc.global.workspaceIds.includes(id))
    assert.deepEqual(record.sessionIds, [])
    assert.equal(record.createdAt, record.updatedAt)
    assert.ok(Number.isFinite(Date.parse(record.createdAt)))
  }
})

test('CLI deduplicates realpaths and leaves repeat invocations byte-for-byte unchanged', (t) => {
  const f = fixture(t)
  const alias = join(f.root, 'alias workspace')
  symlinkSync(f.workspace, alias, 'dir')
  assert.equal(cli([f.home, f.workspace, alias, f.workspace]).status, 0)
  const doc = JSON.parse(readFileSync(f.file, 'utf8'))
  put(f.file, JSON.stringify(doc)) // No-op must preserve formatting as well as ids/timestamps.
  const before = readFileSync(f.file)
  const metadata = statSync(f.file)
  const result = cli([f.home, alias, f.workspace])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /0 added, 1 registered/)
  assert.deepEqual(readFileSync(f.file), before)
  assert.equal(statSync(f.file).ino, metadata.ino)
  assert.equal(statSync(f.file).mtimeMs, metadata.mtimeMs)
})

test('CLI merges while preserving existing records, optional fields, and unknown data', (t) => {
  const f = fixture(t)
  const doc = registry()
  doc.extra = { untouched: true }
  doc.unit.extra = 42
  doc.global.workspaceIds = ['existing']
  doc.global.archivedSessionIds = ['archived']
  doc.global.extra = 'keep'
  doc.tables.other = { keep: ['data'] }
  doc.tables.workspaces.existing = { path: '/old/workspace', title: 'Custom', sessionIds: ['session'], extra: 'keep' }
  put(f.file, doc)
  chmodSync(f.file, 0o640)
  const oldInode = statSync(f.file).ino
  assert.equal(cli([f.home, f.workspace]).status, 0)
  const result = JSON.parse(readFileSync(f.file, 'utf8'))
  assert.deepEqual(result.tables.workspaces.existing, doc.tables.workspaces.existing)
  delete result.tables.workspaces[result.global.workspaceIds.pop()]
  assert.deepEqual(result, doc)
  assert.notEqual(statSync(f.file).ino, oldInode, 'publishes a replacement inode')
  assert.equal(statSync(f.file).mode & 0o777, 0o640)
  assert.deepEqual(readdirSync(dirname(f.file)), ['workspace.json'])
})

const malformed = [
  ['truncated JSON', '{'],
  ...[null, [], 4, 'string', {}].map((value) => ['invalid root ' + JSON.stringify(value), JSON.stringify(value)]),
  ...[
    (d) => { delete d.unit },
    (d) => { d.unit = [] },
    (d) => { d.unit.version = 1 },
    (d) => { d.unit.name = 'other' },
    (d) => { delete d.global },
    (d) => { d.global = [] },
    (d) => { delete d.global.workspaceIds },
    (d) => { d.global.workspaceIds = {} },
    (d) => { d.global.workspaceIds = [1] },
    (d) => { d.global.archivedSessionIds = null },
    (d) => { d.global.archivedSessionIds = [false] },
    (d) => { d.global.initialized = 'yes' },
    (d) => { delete d.tables },
    (d) => { d.tables = [] },
    (d) => { delete d.tables.workspaces },
    (d) => { d.tables.workspaces = [] },
    (d) => { d.tables.workspaces.bad = null },
    (d) => { d.tables.workspaces.bad = [] },
    (d) => { d.tables.workspaces.bad = {} },
    (d) => { d.tables.workspaces.bad = { path: 4 } },
    (d) => { d.tables.workspaces.bad = { path: '' } },
    ...['title', 'createdAt', 'updatedAt', 'sessionIds'].map((field) => (d) => { d.tables.workspaces.bad = { path: '/somewhere', [field]: 2 } }),
  ].map((mutate, index) => { const d = registry(); mutate(d); return [`invalid shape ${index}`, JSON.stringify(d)] }),
]
for (const [name, raw] of malformed) {
  test(`CLI fails closed preserving ${name}`, (t) => {
    const f = fixture(t)
    put(f.file, raw)
    failsPreserving(f, /e2e-seed-workspaces:/)
  })
}

for (const kind of ['missing', 'file', 'empty']) {
  test(`CLI rejects ${kind} directory without publishing earlier valid inputs`, (t) => {
    const f = fixture(t)
    put(f.file, registry())
    const bad = kind === 'empty' ? '' : join(f.root, kind)
    if (kind === 'file') writeFileSync(bad, 'not a directory')
    const before = readFileSync(f.file)
    const result = cli([f.home, f.workspace, bad])
    assert.equal(result.status, 1)
    assert.deepEqual(readFileSync(f.file), before)
    const freshHome = join(f.root, 'new home')
    assert.equal(cli([freshHome, f.workspace, bad]).status, 1)
    assert.equal(existsSync(freshHome), false)
  })
}

test('CLI rejects missing arguments and empty home', () => {
  for (const args of [[], ['home'], ['', '.']]) {
    const result = cli(args)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /usage:/)
  }
})

test('CLI rejects symlink and directory registries without changing targets', (t) => {
  const f = fixture(t)
  mkdirSync(dirname(f.file), { recursive: true })
  const target = join(f.root, 'target')
  for (const present of [false, true]) {
    if (present) put(target, registry())
    symlinkSync(target, f.file)
    const result = cli([f.home, f.workspace])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not a regular file/)
    assert.ok(lstatSync(f.file).isSymbolicLink())
    assert.equal(existsSync(target), present)
    if (present) assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), registry())
    rmSync(f.file)
  }
  mkdirSync(f.file)
  assert.equal(cli([f.home, f.workspace]).status, 1)
  assert.ok(statSync(f.file).isDirectory())
})

for (const operation of ['lstatSync', 'readFileSync', 'writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`CLI preserves original and cleans staging after injected ${operation} failure`, (t) => {
    const f = fixture(t)
    put(f.file, registry())
    const preload = join(f.root, 'inject.mjs')
    // Patch builtins in the child only; exercise the real CLI and cleanup without
    // platform-dependent permission failures or a production fault-injection API.
    writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
fs.${operation} = () => { throw new Error('injected ${operation} failure') };
syncBuiltinESMExports();
`)
    failsPreserving(f, /injected .* failure/, {
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    })
  })
}

test('CLI refuses deterministic id collisions without replacing a registration', (t) => {
  const f = fixture(t)
  seedWorkspaces(f.home, [f.workspace])
  const doc = JSON.parse(readFileSync(f.file, 'utf8'))
  doc.tables.workspaces[doc.global.workspaceIds[0]].path = '/different/path'
  put(f.file, doc)
  failsPreserving(f, /id collision/)
})

test('exported API reports additions/no-ops and throws for invalid arguments', (t) => {
  const f = fixture(t)
  assert.deepEqual(seedWorkspaces(f.home, [f.workspace]), { added: 1, registered: 1, file: f.file })
  assert.deepEqual(seedWorkspaces(f.home, [f.workspace]), { added: 0, registered: 1, file: f.file })
  for (const args of [[null, ['.']], [f.home, null], [f.home, []], [f.home, [1]], [f.home, ['']]]) {
    assert.throws(() => seedWorkspaces(...args), /usage:/)
  }
  assert.throws(() => seedWorkspaces(f.home, [join(f.root, 'absent')]), /ENOENT/)
})

test('helper imports without executing CLI or logging', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(helper).href)})`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
