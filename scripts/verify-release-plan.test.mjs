import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyPre1ReleasePlan, readPluginManifests, checkReleasePlan } from './verify-release-plan.mjs'

const publicPackage = { name: '@dsh-next/dsh-next-example', version: '0.2.0' }
const privatePackage = { name: '@dsh-next/dsh-next-private', version: '0.1.0', private: true }
const release = { name: publicPackage.name, type: 'minor', oldVersion: '0.2.0', newVersion: '0.3.0' }
const plan = () => ({ releases: [{ ...release }], changesets: [{ id: 'sample', releases: [{ name: release.name, type: 'minor' }] }] })

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'release-policy-test-')))
  const temporaryParent = await realpath(tmpdir())
  t.after(async () => {
    if (!root.startsWith(temporaryParent + '/release-policy-test-')) throw new Error('Unexpected fixture cleanup')
    await rm(root, { recursive: true, force: true })
  })
  for (const [directory, manifest] of [['dsh-next-example', publicPackage], ['dsh-next-private', privatePackage]]) {
    await mkdir(join(root, 'packages', directory), { recursive: true })
    await writeFile(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

test('release policy accepts normal minor and patch plans and no pending release', () => {
  assert.deepEqual(verifyPre1ReleasePlan(plan(), [publicPackage, privatePackage]), [{ name: release.name, version: '0.3.0', type: 'minor' }])
  const patch = plan()
  patch.releases[0] = { ...release, type: 'patch', newVersion: '0.2.1' }
  patch.changesets[0].releases[0].type = 'patch'
  assert.deepEqual(verifyPre1ReleasePlan(patch, [publicPackage]), [{ name: release.name, version: '0.2.1', type: 'patch' }])
  assert.deepEqual(verifyPre1ReleasePlan({ releases: [], changesets: [] }, [publicPackage, { ...privatePackage, version: '2.0.0' }]), [])
})

test('release policy rejects malformed plan roots and invalid or duplicate manifests', () => {
  for (const value of [null, {}, { releases: [], changesets: null }, { releases: {}, changesets: [] }]) {
    assert.throws(() => verifyPre1ReleasePlan(value, [publicPackage]), /invalid release plan/)
  }
  for (const value of [null, {}, { name: 3, version: '0.1.0' }, { name: 'example', version: 'invalid' }]) {
    assert.throws(() => verifyPre1ReleasePlan(plan(), [value]), /invalid name or version/)
  }
  assert.throws(() => verifyPre1ReleasePlan(plan(), [publicPackage, publicPackage]), /Duplicate package/)
  assert.throws(() => verifyPre1ReleasePlan({ releases: [], changesets: [] }, [{ ...publicPackage, version: '1.0.0' }]), /stable graduation/)
})

test('release policy rejects unknown/private/repeated releases and stale versions', () => {
  for (const item of [null, { ...release, name: 'missing' }, { ...release, name: privatePackage.name }]) {
    assert.throws(() => verifyPre1ReleasePlan({ ...plan(), releases: [item] }, [publicPackage, privatePackage]), /unknown|private/)
  }
  assert.throws(() => verifyPre1ReleasePlan({ ...plan(), releases: [release, release] }, [publicPackage]), /repeats/)
  for (const item of [{ ...release, oldVersion: '0.1.0' }, { ...release, newVersion: 'invalid' }]) {
    assert.throws(() => verifyPre1ReleasePlan({ ...plan(), releases: [item] }, [publicPackage]), /does not match/)
  }
})

test('release policy cannot graduate to 1.x or accept a mismatched/downgraded bump', () => {
  for (const item of [
    { ...release, type: 'major', newVersion: '1.0.0' },
    { ...release, type: 'minor', newVersion: '1.0.0' },
    { ...release, type: 'unknown' },
    { ...release, newVersion: '0.1.0' },
    { ...release, newVersion: '0.2.0' },
    { ...release, newVersion: '0.2.1' },
  ]) assert.throws(() => verifyPre1ReleasePlan({ ...plan(), releases: [item] }, [publicPackage]), /minor\/patch 0.x/)
})

test('every intent must name a planned public package with a minor/patch bump', () => {
  for (const entry of [null, {}, { releases: null }]) {
    assert.throws(() => verifyPre1ReleasePlan({ ...plan(), changesets: [entry] }, [publicPackage]), /invalid release list/)
  }
  for (const intent of [null, { name: 'missing', type: 'minor' }, { name: privatePackage.name, type: 'minor' }, { name: publicPackage.name, type: 'major' }]) {
    assert.throws(() => verifyPre1ReleasePlan({ ...plan(), changesets: [{ releases: [intent] }] }, [publicPackage, privatePackage]), /planned public package/)
  }
  assert.throws(() => verifyPre1ReleasePlan({ releases: [], changesets: plan().changesets }, [publicPackage]), /planned public package/)
})

test('manifest discovery includes all plugin directories, not unrelated files/directories', async t => {
  const root = await fixture(t)
  await mkdir(join(root, 'packages', 'unrelated'))
  await writeFile(join(root, 'packages', 'notes.txt'), 'not a manifest')
  const manifests = await readPluginManifests(root)
  assert.deepEqual(manifests.map(item => item.name).sort(), [publicPackage.name, privatePackage.name].sort())
})

test('release-plan command only creates temporary status output and cleans it', async t => {
  const root = await fixture(t)
  const before = await readFile(join(root, 'packages', 'dsh-next-example', 'package.json'), 'utf8')
  const releases = await checkReleasePlan({ root, run(command, args, options) {
    assert.equal(command, 'pnpm')
    assert.deepEqual(args.slice(0, 4), ['exec', 'changeset', 'status', '--output'])
    assert.equal(options.cwd, root)
    assert.equal(options.timeout, 60000)
    writeFileSync(args[4], JSON.stringify(plan()))
  } })
  assert.equal(releases.length, 1)
  assert.equal(await readFile(join(root, 'packages', 'dsh-next-example', 'package.json'), 'utf8'), before)
  assert.deepEqual(await readdir(join(root, 'artifacts', 'testing')), [])
})

test('status producer errors and malformed JSON fail closed with cleanup', async t => {
  const root = await fixture(t)
  await assert.rejects(checkReleasePlan({ root, run() { throw new Error('status failed') } }), /status failed/)
  await assert.rejects(checkReleasePlan({ root, run() {}, read: async () => 'not-json' }), SyntaxError)
  await assert.rejects(checkReleasePlan({ root, run() {}, read: async () => JSON.stringify({ releases: [], changesets: null }) }), /invalid release plan/)
  assert.deepEqual(await readdir(join(root, 'artifacts', 'testing')), [])
})

test('scratch path outside owned prefix is never removed', async t => {
  const root = await fixture(t)
  const sentinel = join(root, 'do-not-delete')
  await mkdir(sentinel)
  let removed = false
  await assert.rejects(checkReleasePlan({ root, createTemporary: async () => sentinel, remove: async () => { removed = true } }), /unexpected release-plan scratch/)
  assert.equal(removed, false)
  assert.deepEqual(await readdir(sentinel), [])
})

test('symlinked artifact parents and scratch paths are refused before execution or removal', async t => {
  const root = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await mkdir(join(root, 'artifacts'))
  await symlink(outside, join(root, 'artifacts', 'testing'), 'dir')
  await assert.rejects(checkReleasePlan({ root }), /not a real owned directory/)
  await rm(join(root, 'artifacts', 'testing'))
  let removed = false
  await assert.rejects(checkReleasePlan({ root, createTemporary: async prefix => {
    const link = prefix + 'link'
    await symlink(outside, link, 'dir')
    return link
  }, remove: async () => { removed = true } }), /unexpected release-plan scratch/)
  assert.equal(removed, false)
})

test('an artifact ancestor symlink is rejected before creating any target child', async t => {
  const root = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(root, 'artifacts'), 'dir')
  await assert.rejects(checkReleasePlan({ root }), /not a real owned directory/)
  assert.deepEqual(await readdir(outside), [])
})

test('real Changesets status works detached with only origin/main and inspects older pending intents', async t => {
  const root = await fixture(t)
  const repoConfig = JSON.parse(readFileSync(new URL('../.changeset/config.json', import.meta.url), 'utf8'))
  assert.equal(repoConfig.baseBranch, 'origin/main')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'detached-release-fixture', version: '0.1.0', private: true, packageManager: 'pnpm@11.24.0' }))
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await writeFile(join(root, '.gitignore'), '/artifacts/\nfiltered-status.json\n')
  await mkdir(join(root, '.changeset'))
  await writeFile(join(root, '.changeset', 'config.json'), JSON.stringify({ ...repoConfig, changelog: false }))
  const intent = join(root, '.changeset', 'older-intent.md')
  await writeFile(intent, `---\n"${publicPackage.name}": major\n---\n\nExisting pending intent.\n`)
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CEILING_DIRECTORIES: dirname(root) }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GITHUB_TOKEN']) delete environment[key]
  const git = args => execFileSync('git', args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim()
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Test User'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'core.hooksPath', '/dev/null'])
  git(['add', '.'])
  git(['commit', '-q', '-m', 'fixture: pending intent already on main'])
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  git(['checkout', '--detach', '-q', 'HEAD'])
  git(['branch', '-D', 'main'])
  assert.equal(git(['branch', '--list', 'main']), '')
  const before = git(['rev-parse', 'HEAD'])
  const cli = fileURLToPath(new URL('../node_modules/@changesets/cli/bin.js', import.meta.url))
  const produceStatus = (_command, args, options) => execFileSync(process.execPath, [cli, ...args.slice(2)], { ...options, env: environment })
  await assert.rejects(checkReleasePlan({ root, run: produceStatus }), /major\/stable/)
  // Filtering by the base would hide this already-committed major intent.
  const filteredOutput = join(root, 'filtered-status.json')
  try {
    execFileSync(process.execPath, [cli, 'status', '--since', 'origin/main', '--output', filteredOutput], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error('Filtered status probe failed: ' + String(error.stdout) + String(error.stderr))
  }
  assert.deepEqual(JSON.parse(await readFile(filteredOutput, 'utf8')).changesets, [])
  await writeFile(intent, `---\n"${publicPackage.name}": minor\n---\n\nExisting pending intent.\n`)
  assert.deepEqual(await checkReleasePlan({ root, run: produceStatus }), [{ name: publicPackage.name, version: '0.3.0', type: 'minor' }])
  assert.equal(git(['rev-parse', 'HEAD']), before)
  assert.equal(git(['branch', '--list', 'main']), '')
})
