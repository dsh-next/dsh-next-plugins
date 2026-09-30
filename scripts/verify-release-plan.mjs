#!/usr/bin/env node
/** Reject unintended stable graduation before validation or publishing. */
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import semver from 'semver'

export function verifyPre1ReleasePlan(plan, manifests) {
  if (!plan || !Array.isArray(plan.releases) || !Array.isArray(plan.changesets)) {
    throw new Error('Changesets returned an invalid release plan')
  }
  if (!Array.isArray(manifests)) throw new Error('Package manifests must be an array')
  const packages = new Map()
  for (const manifest of manifests) {
    if (!manifest || typeof manifest.name !== 'string' || !/^@dsh-next\/dsh-next-[a-z0-9-]+$/.test(manifest.name) || !semver.valid(manifest.version)) {
      throw new Error('Cannot validate a package with an invalid name or version')
    }
    if (packages.has(manifest.name)) throw new Error('Duplicate package identity: ' + manifest.name)
    packages.set(manifest.name, manifest)
    if (manifest.private !== true && semver.major(manifest.version) !== 0) {
      throw new Error(manifest.name + ' has left 0.x; stable graduation needs an explicitly reviewed policy change')
    }
  }
  const seen = new Set()
  for (const release of plan.releases) {
    if (!release || !packages.has(release.name)) throw new Error('Release plan names an unknown package')
    const manifest = packages.get(release.name)
    if (manifest.private === true) throw new Error('Release plan names private package: ' + release.name)
    if (seen.has(release.name)) throw new Error('Release plan repeats package: ' + release.name)
    seen.add(release.name)
    if (release.oldVersion !== manifest.version || !semver.valid(release.newVersion)) {
      throw new Error('Release version does not match its manifest: ' + release.name)
    }
    if (!['patch', 'minor'].includes(release.type) || semver.major(release.newVersion) !== 0 || release.newVersion !== semver.inc(release.oldVersion, release.type)) {
      throw new Error(release.name + ' must use an increasing minor/patch 0.x release; major/stable releases are not approved')
    }
  }
  for (const changeset of plan.changesets) {
    if (!changeset || !Array.isArray(changeset.releases)) throw new Error('Changeset has an invalid release list')
    for (const intent of changeset.releases) {
      const manifest = intent && packages.get(intent.name)
      if (!manifest || manifest.private === true || !['patch', 'minor'].includes(intent.type) || !seen.has(intent.name)) {
        throw new Error('Changeset must name a planned public package with a minor/patch intent')
      }
    }
  }
  return plan.releases.map(release => ({ name: release.name, version: release.newVersion, type: release.type }))
}

export async function readPluginManifests(root) {
  const directories = await readdir(join(root, 'packages'), { withFileTypes: true })
  return Promise.all(directories.filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-next-'))
    .map(async entry => JSON.parse(await readFile(join(root, 'packages', entry.name, 'package.json'), 'utf8'))))
}

export async function checkReleasePlan({ root, run = execFileSync, createTemporary = mkdtemp, read = readFile, remove = rm } = {}) {
  root = await realpath(root ?? fileURLToPath(new URL('../', import.meta.url)))
  // All generated status data belongs to this checkout's ignored artifact area.
  const parent = join(root, 'artifacts', 'testing')
  for (const directory of [join(root, 'artifacts'), parent]) {
    try {
      if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) {
        throw new Error('Release-plan artifact parent is not a real owned directory')
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await mkdir(directory)
    }
    if (await realpath(directory) !== directory) throw new Error('Release-plan artifact parent is not a real owned directory')
  }
  const temporary = await createTemporary(join(parent, 'release-plan-'))
  const absolute = resolve(temporary)
  if (!absolute.startsWith(parent + '/release-plan-') || await realpath(absolute) !== absolute) {
    throw new Error('Refusing an unexpected release-plan scratch path')
  }
  try {
    const output = join(absolute, 'status.json')
    run('pnpm', ['exec', 'changeset', 'status', '--output', output], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
    const plan = JSON.parse(await read(output, 'utf8'))
    return verifyPre1ReleasePlan(plan, await readPluginManifests(root))
  } finally {
    // Check the resolved owned child before removing anything. No repository
    // state or Changesets input file is ever modified by this checker.
    if (!absolute.startsWith(parent + '/release-plan-') || await realpath(parent) !== parent || await realpath(absolute) !== absolute) {
      throw new Error('Unsafe release-plan cleanup')
    }
    await remove(absolute, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const releases = await checkReleasePlan()
    console.log('release policy passed: ' + (releases.length ? releases.map(release => `${release.name} -> ${release.version}`).join(', ') : 'no pending release'))
  } catch (error) {
    // Command output can contain arbitrary change summaries; avoid forwarding
    // subprocess stdout/stderr or credentials through a generic failure object.
    console.error('release policy failed: ' + (error?.status ? 'Changesets status could not be generated' : error.message))
    process.exitCode = 1
  }
}
