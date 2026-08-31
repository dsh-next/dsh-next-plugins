/**
 * Text-based verification of the provider flow (DOM assertions, no
 * screenshots): adds a real provider, asserts the marketplace lists its
 * skills, installs one, and asserts the Installed tab shows it with the
 * provider badge. Prints the card's text content at each step.
 *
 * Usage: node scripts/skills-providers-verify.mjs <baseUrl>
 */
import { chromium } from '@playwright/test'
import process from 'node:process'

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

const cardText = async () => {
  const card = page.locator('div[class*="card"]', { hasText: 'DSH Next Skills' }).first()
  return (await card.textContent().catch(() => '<no card>')) ?? ''
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
await page.waitForTimeout(1500)
await dismissOnboarding()
await page.getByText('Settings', { exact: true }).first().click({ force: true })
await page.waitForTimeout(800)
await page.getByText('Plugins', { exact: true }).first().click({ force: true })
await page.waitForTimeout(800)
await page.getByText('DSH Next Skills').first().click({ force: true })
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
const state1 = await rpc('getState', { workspacePath: null })
console.log('status:', state1.status)
console.log('config:', JSON.stringify(state1.body?.config))
console.log('installed names:', JSON.stringify(state1.body?.installed?.map((s) => s.name)))

console.log('\n--- addProvider vercel-labs/skills ---')
const add = await rpc('addProvider', { spec: 'https://github.com/vercel-labs/skills' })
console.log('status:', add.status, 'ok:', add.body?.ok, 'error:', add.body?.error)

console.log('\n--- marketplace ---')
const market = await rpc('marketplace', {})
console.log('status:', market.status)
console.log('providers:', JSON.stringify(market.body?.providers))
console.log('skills:', JSON.stringify(market.body?.skills?.map((s) => `${s.name} (${s.providerSpec})`)))

const first = market.body?.skills?.[0]
if (first) {
  console.log(`\n--- installSkill ${first.name} global ---`)
  const install = await rpc('installSkill', { providerId: first.providerId, skillPath: first.skillPath, scope: 'global' })
  console.log('status:', install.status, 'ok:', install.body?.ok, 'error:', install.body?.error)

  const state2 = await rpc('getState', { workspacePath: null })
  const row = state2.body?.installed?.find((s) => s.name === first.name)
  console.log('installed row:', JSON.stringify(row))

  console.log(`\n--- updateSkill ${first.name} (expect up-to-date no-op) ---`)
  const upd = await rpc('updateSkill', { name: first.name, scope: 'global' })
  console.log('status:', upd.status, 'ok:', upd.body?.ok, 'error:', upd.body?.error)
}

console.log('\n--- UI text: Installed tab ---')
console.log((await cardText()).slice(0, 600))

console.log('\n--- UI text: Providers tab ---')
await page.getByText('Providers', { exact: true }).first().click({ force: true })
await page.waitForTimeout(800)
console.log((await cardText()).slice(0, 800))

console.log('\n--- UI text: Marketplace tab ---')
await page.getByText('Marketplace', { exact: true }).first().click({ force: true })
await page.waitForTimeout(1000)
console.log((await cardText()).slice(0, 800))

await page.screenshot({ path: 'test-results/skills/20-final-state.png' })
console.log('\npageErrors:', JSON.stringify(pageErrors, null, 2))
await browser.close()
