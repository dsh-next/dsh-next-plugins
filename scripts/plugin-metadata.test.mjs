import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, cp, mkdir, writeFile, rm, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))

async function checkMetadata(dir) {
  const manifest = await json(join(dir, 'package.json'))
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  for (const language of ['en', 'zh']) {
    const data = await json(join(dir, 'locale', `${language}.json`))
    assert.deepEqual(Object.keys(data.meta).sort(), ['description', 'title'])
    for (const value of Object.values(data.meta)) {
      assert.equal(typeof value, 'string')
      assert.ok(value.trim().length > 0)
      assert.doesNotMatch(value, /__NAME__|__TITLE__|@dsh-next\//)
    }
  }
  assert.ok(manifest.files.includes('locale'))
  assert.ok(manifest.files.includes('assets'))
  assert.equal(manifest.icon, './assets/icon.svg')
  const iconPath = await realpath(resolve(dir, manifest.icon))
  const local = relative(await realpath(dir), iconPath)
  assert.ok(!local.startsWith(`..${sep}`) && local !== '..')
  assert.ok((await stat(iconPath)).size <= 256 * 1024)
  const svg = await readFile(iconPath, 'utf8')
  assert.match(svg, /<svg[^>]+viewBox="0 0 36 36"/)
  assert.doesNotMatch(svg, /<script|<foreignObject|\bon\w+=|\bhref=|var\(--|currentColor/i)
  return svg
}

for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('dsh-next-')) continue
  test(`${entry.name}: shipped localized metadata and standalone artwork`, async () => {
    await checkMetadata(join(root, 'packages', entry.name))
  })
}

test('each plugin has distinct artwork', async () => {
  const icons = []
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('dsh-next-')) {
      icons.push(await readFile(join(root, 'packages', entry.name, 'assets/icon.svg'), 'utf8'))
    }
  }
  assert.equal(new Set(icons).size, icons.length)
})

test('scaffolding copies and renders exported display resources', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-plugin-metadata-'))
  try {
    await mkdir(join(sandbox, 'scripts'), { recursive: true })
    await cp(join(root, 'scripts/plugin-template'), join(sandbox, 'scripts/plugin-template'), { recursive: true })
    await cp(join(root, 'scripts/dsh-plugin-new.mjs'), join(sandbox, 'scripts/dsh-plugin-new.mjs'))
    // README pairing is independently tested; isolate the generator's resource copying here.
    await writeFile(join(sandbox, 'scripts/verify-docs.mjs'), '')
    execFileSync(process.execPath, [join(sandbox, 'scripts/dsh-plugin-new.mjs'), 'sample-plugin'])
    execFileSync(process.execPath, [join(sandbox, 'scripts/dsh-plugin-new.mjs'), 'sample--plugin'])
    const repeatedHyphenDir = join(sandbox, 'packages/dsh-next-sample--plugin')
    await checkMetadata(repeatedHyphenDir)
    assert.equal((await json(join(repeatedHyphenDir, 'locale/en.json'))).meta.title, 'Sample Plugin')
    const dir = join(sandbox, 'packages/dsh-next-sample-plugin')
    await checkMetadata(dir)
    assert.equal((await json(join(dir, 'locale/en.json'))).meta.title, 'Sample Plugin')
    const consumer = join(sandbox, 'consumer')
    await mkdir(join(consumer, 'node_modules/@dsh-next'), { recursive: true })
    await cp(dir, join(consumer, 'node_modules/@dsh-next/dsh-next-sample-plugin'), { recursive: true })
    const probe = join(consumer, 'resolve.mjs')
    await writeFile(probe, `import { readFileSync } from 'node:fs';\nfor (const resource of ['package.json', 'locale/en.json', 'locale/zh.json']) JSON.parse(readFileSync(new URL(import.meta.resolve('@dsh-next/dsh-next-sample-plugin/' + resource)), 'utf8'));\n`)
    execFileSync(process.execPath, [probe])
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
