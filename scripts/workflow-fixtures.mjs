/** Shared data-only seeding for newly owned, stopped DSH test runtimes. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { seedWorkspaces } from './e2e-seed-workspaces.mjs'

export function validateProfile(profile) {
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
    throw new Error('Profile must be a simple name of up to 64 letters, digits, underscores, or hyphens')
  }
  return profile
}

function owned(root, path) {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Fixture paths must belong to the scratch run')
}

async function put(path, content) {
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

async function json(path, value) {
  await put(path, JSON.stringify(value, null, 2) + '\n')
}

const SKILL = '---\nname: e2e-test-skill\ndescription: |\n  Throwaway skill for the skills marker.\n  Multi-line to exercise block-scalar descriptions.\n---\n# Test\n'
const OFFERING = '---\nname: aaa-offering\ndescription: Mentions e2e-test in its description to exercise search ranking.\n---\n# Test\n'

/** Refuses to overwrite settings or profile files; never use against a running home. */
export async function seedRuntime(scratch, { profile = 'smoke', fixtures = false } = {}) {
  validateProfile(profile)
  for (const path of [scratch.home, scratch.agentsHome, scratch.workspaceA, scratch.workspaceB]) owned(scratch.root, path)
  const profileDir = join(scratch.home, 'profiles', profile)
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  await json(join(profileDir, 'package.json'), {
    name: 'dsh-profile-' + profile,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  })
  await put(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await json(join(profileDir, 'pnpm-workspace.yaml'), {
    packages: ['.'],
    nodeLinker: 'hoisted',
    autoInstallPeers: false,
    allowBuilds: { '@google/genai': false, protobufjs: false },
  })
  const settings = {
    'ui-onboarding': { welcomeNoticeVersion: '2099-01-01.1' },
    'agent-default-model': { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    'dsh-next-notifier': { enabled: true, suppressFocused: true, volume: 70 },
    'dsh-next-skills': { providers: [], installations: [], scopes: {} },
  }
  if (fixtures) {
    settings['dsh-next-skills'] = {
      providers: [{ id: 'e2e-local', spec: 'e2e/local', addedAt: '2026-01-01T00:00:00.000Z' }],
      installations: [{ name: 'e2e-test-skill', providerId: 'e2e-local', providerSpec: 'e2e/local', skillPath: 'skills/e2e-test-skill' }],
      scopes: {},
    }
  }
  await json(join(scratch.home, 'settings.yaml'), settings)
  await seedWorkspaces(scratch.home, [scratch.workspaceA, scratch.workspaceB])
  if (fixtures) await seedSkills(scratch)
  return { profile, profileDir }
}

async function seedSkills(scratch) {
  const installed = join(scratch.agentsHome, 'skills', 'e2e-test-skill')
  const cache = join(scratch.home, 'skills-market')
  const first = join(cache, 'files', 'e2e-local', 'e2e__test')
  const second = join(cache, 'files', 'e2e-local', 'aaa__offering')
  for (const dir of [installed, first, second]) await mkdir(dir, { recursive: true, mode: 0o700 })
  await put(join(installed, 'SKILL.md'), SKILL)
  await put(join(first, 'SKILL.md'), SKILL)
  await put(join(second, 'SKILL.md'), OFFERING)
  await json(join(cache, 'catalog.json'), {
    providers: [{
      id: 'e2e-local', spec: 'e2e/local', lastRefresh: '2026-01-01T00:00:00.000Z',
      skills: [
        { name: 'e2e-test-skill', description: 'Throwaway skill for the skills marker.', cacheDir: 'e2e__test', skillPath: 'skills/e2e-test-skill', version: 'seed-v1', files: [{ path: 'SKILL.md', sha: 'seed' }] },
        { name: 'aaa-offering', description: 'Mentions e2e-test in its description to exercise search ranking.', cacheDir: 'aaa__offering', skillPath: 'skills/aaa-offering', version: 'seed-v1', files: [{ path: 'SKILL.md', sha: 'seed' }] },
      ],
    }],
  })
}
