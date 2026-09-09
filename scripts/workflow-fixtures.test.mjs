import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedRuntime, validateProfile } from './workflow-fixtures.mjs'

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-fixtures-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = { root, home: join(root, 'home'), agentsHome: join(root, 'agents'), workspaceA: join(root, 'workspace a'), workspaceB: join(root, 'workspace b') }
  await Promise.all(Object.values(paths).slice(1).map(path => mkdir(path)))
  return paths
}
const json = async path => JSON.parse(await readFile(path, 'utf8'))

test('default fixtures seed only fresh private profile data and realpath workspaces', async t => {
  const paths = await scratch(t)
  const result = await seedRuntime(paths)
  const profile = await json(join(result.profileDir, 'package.json'))
  assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const settings = await json(join(paths.home, 'settings.yaml'))
  assert.equal(settings['agent-default-model'].model, 'deepseek-v4-flash')
  assert.deepEqual(settings['dsh-next-skills'].installations, [])
  assert.equal(JSON.stringify(settings).includes('API_KEY'), false)
  const registry = await json(join(paths.home, 'storages', 'workspace.json'))
  assert.equal(Object.keys(registry.tables.workspaces).length, 2)
  assert.equal((await stat(join(paths.home, 'settings.yaml'))).mode & 0o777, 0o600)
})

test('smoke fixture uses current managed-installations schema and matching catalog files', async t => {
  const paths = await scratch(t)
  await seedRuntime(paths, { profile: 'smoke', fixtures: true })
  const settings = await json(join(paths.home, 'settings.yaml'))
  assert.equal(settings['dsh-next-skills'].installations[0].name, 'e2e-test-skill')
  assert.equal(settings['dsh-next-skills'].installed, undefined)
  const catalog = await json(join(paths.home, 'skills-market', 'catalog.json'))
  assert.equal(catalog.providers[0].skills.length, 2)
  const installed = await readFile(join(paths.agentsHome, 'skills', 'e2e-test-skill', 'SKILL.md'), 'utf8')
  const cached = await readFile(join(paths.home, 'skills-market', 'files', 'e2e-local', 'e2e__test', 'SKILL.md'), 'utf8')
  assert.equal(installed, cached)
})

test('repeated seeding refuses overwriting an existing profile', async t => {
  const paths = await scratch(t)
  await seedRuntime(paths)
  const before = await readFile(join(paths.home, 'settings.yaml'), 'utf8')
  await assert.rejects(seedRuntime(paths), { code: 'EEXIST' })
  assert.equal(await readFile(join(paths.home, 'settings.yaml'), 'utf8'), before)
})

test('invalid profiles and outside fixture paths fail before seeding', async t => {
  const paths = await scratch(t)
  for (const name of ['', '../web', 'a/b', 'a b', 'x'.repeat(65)]) assert.throws(() => validateProfile(name), /Profile/)
  await assert.rejects(seedRuntime({ ...paths, home: tmpdir() }), /belong to the scratch/)
})
