/**
 * Text-based verification of the provider + install flow (DOM assertions, no
 * screenshots): adds a real provider, asserts the state payload lists its
 * skills, installs one globally, and asserts the Skills tab shows the card
 * with its provider/global source chips and no scope controls. Prints text
 * content at each step. Use an isolated smoke server: update overwrites the
 * selected global copy with its provider content.
 *
 * Usage: node scripts/skills-providers-verify.mjs <baseUrl>
 */
import { chromium, expect } from '@playwright/test'
import process from 'node:process'
import assert from 'node:assert/strict'

const BASE_URL = process.argv[2]
if (!BASE_URL) { console.error('usage: node scripts/skills-providers-verify.mjs <baseUrl>'); process.exit(1) }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()) })

async function dismissOnboarding() {
  const names = ['Continue', 'Configure later', 'Skip']
  for (let round = 0; round < 12; round++) {
    let clicked = false
    for (const name of names) {
      const btn = page.getByRole('button', { name })
      if (await btn.isVisible().catch(() => false)) { await btn.click({ force: true }); clicked = true; await page.waitForTimeout(300) }
    }
    await page.waitForTimeout(300)
    const remaining = await page.locator('[role="dialog"]').count().catch(() => 0)
    if (!clicked || remaining === 0) break
  }
}

function assertState(response) {
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(response.body).sort(), ['catalog', 'installed', 'providers'])
  for (const row of response.body.installed) {
    assert.ok(!('scope' in row) && !('configScope' in row))
    assert.ok(['user-agents', 'user-dsh'].includes(row.source))
  }
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
await page.waitForTimeout(1500)
await dismissOnboarding()
await page.getByText('Settings', { exact: true }).first().click({ force: true })
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Skills', exact: true }).first().click({ force: true })
await page.waitForTimeout(1200)

// Direct RPC probe: the host side of the contract.
const rpc = async (method, args) => {
  const res = await page.evaluate(async ({ method, args }) => {
    const r = await fetch('/dsh-next-skills/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { method, args })
  return res
}

console.log('--- getState envelope ---')
const state1 = await rpc('getState', {})
console.log('status:', state1.status)
assertState(state1)
console.log('envelope:', Object.keys(state1.body))
console.log('installed names:', JSON.stringify(state1.body?.installed?.map((s) => s.name)))
console.log('providers:', JSON.stringify(state1.body?.providers?.map((p) => `${p.spec} (${p.skillCount})`)))

console.log('\n--- addProvider vercel-labs/skills ---')
const add = await rpc('addProvider', { spec: 'https://github.com/vercel-labs/skills' })
console.log('status:', add.status, 'ok:', add.body?.ok, 'error:', add.body?.error)
assert.equal(add.body?.ok, true, add.body?.error)

console.log('\n--- state after sync ---')
const state2 = await rpc('getState', {})
assertState(state2)
console.log('providers:', JSON.stringify(state2.body?.providers?.map((p) => `${p.spec} lastRefresh=${p.lastRefresh !== '' ? 'yes' : 'no'}`)))
console.log('catalog:', JSON.stringify(state2.body?.catalog?.map((s) => `${s.name} (${s.providerSpec})`)))

const first = state2.body.catalog.find((s) => s.providerId === 'vercel-labs-skills')
assert.ok(first, 'added provider has no catalog skills')
console.log('\n--- installSkill ' + first.name + ' globally ---')
// A rerun can reuse an existing managed copy; first installs send no scope.
if (!state2.body.installed.some((s) => s.name === first.name)) {
  const install = await rpc('installSkill', { providerId: first.providerId, skillPath: first.skillPath })
  assert.equal(install.body?.ok, true, install.body?.error)
}
const state3 = await rpc('getState', {})
assertState(state3)
const row = state3.body.installed.find((s) => s.name === first.name && s.source === 'user-agents')
assert.ok(row, 'global installed copy missing')
console.log('installed row:', JSON.stringify(row))
const upd = await rpc('updateSkill', { name: first.name, directory: row.directory, providerId: first.providerId, skillPath: first.skillPath })
assert.equal(upd.body?.ok, true, upd.body?.error)

// Remount the panel after direct RPC probes; tabs do not refetch state.
await page.locator('button', { hasText: 'New Session' }).first().click()
await page.getByText('Settings', { exact: true }).first().click()
await page.getByRole('button', { name: 'Skills', exact: true }).first().click()
await page.getByTestId('skills-search').fill(first.name)
const card = page.getByTestId('skills-card').filter({ has: page.getByTestId('skills-detail').filter({ hasText: first.name }) }).first()
await expect(card).toContainText(first.providerSpec)
await expect(card).toContainText('user .agents')
await expect(card.getByTestId('skills-delete')).toBeVisible()
await expect(page.locator('[data-testid^="skills-scope"], [data-testid="skills-modal"], [data-testid="skills-presence"], [data-testid="skills-workspace"], select[aria-label="Install into"]')).toHaveCount(0)

console.log('\n--- UI text: Skills tab (grid) ---')
const grid = page.locator('[data-testid="skills-grid"]').first()
console.log(((await grid.textContent().catch(() => '<no grid>')) ?? '').slice(0, 600))

console.log('\n--- UI text: Providers tab ---')
await page.getByTestId('skills-tab-providers').first().click({ force: true })
await page.waitForTimeout(800)
console.log(((await page.locator('[data-testid="skills-provider"]').first().textContent().catch(() => '<no rows>')) ?? '').slice(0, 800))

console.log('\npageErrors:', JSON.stringify(pageErrors, null, 2))
await browser.close()
assert.deepEqual(pageErrors, [])
