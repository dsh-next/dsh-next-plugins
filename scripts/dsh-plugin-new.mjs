import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(ROOT, 'scripts', 'plugin-template')

function idFromName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

async function render(file, vars) {
  const source = await readFile(join(TEMPLATE, file), 'utf8')
  return source.replace(/__NAME__/g, vars.name)
}

async function copyTemplate(name) {
  const id = idFromName(name)
  if (!id) {
    console.error('usage: node scripts/dsh-plugin-new.mjs <name>')
    console.error('  name is the kebab-case plugin slug, e.g. "slack".')
    process.exit(1)
  }
  const dir = join(ROOT, 'packages', `dsh-next-${id}`)
  if (existsSync(dir)) {
    console.error(`package already exists: ${dir}`)
    process.exit(1)
  }
  const vars = { name: id }
  const files = [
    'package.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'tsconfig.vitest.json',
    'tsdown.config.ts',
    'vitest.config.ts',
    'cordis.patch.yml',
    'README.md',
    'README.zh.md',
    'README.i18n.yaml',
    '.gitignore',
    'src/index.ts',
    'src/client/index.ts',
    'src/client/css-modules.d.ts',
    'src/host/.gitkeep',
    'src/core/.gitkeep',
    'tests/plugin.spec.ts',
  ]
  await mkdir(dir, { recursive: true })
  for (const file of files) {
    const out = join(dir, file)
    await mkdir(dirname(out), { recursive: true })
    let content = await render(file, vars)
    if (file === 'package.json') {
      const json = JSON.parse(content)
      json.name = `@dsh-next/dsh-next-${id}`
      json.description = `DeepSeek Harness plugin: ${id} (description pending).`
      content = JSON.stringify(json, null, 2) + '\n'
    }
    await writeFile(out, content, 'utf8')
  }
  // Record the bilingual README pairing hashes (docs/i18n.md) so a fresh
  // scaffold passes `pnpm docs:check` immediately.
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'verify-docs.mjs'), '--write', id], { stdio: 'inherit' })
  console.log(`created packages/dsh-next-${id}/`)
}

const name = process.argv[2]
copyTemplate(name)
