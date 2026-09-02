/**
 * Focused live repro for the scope-modal flows against the RUNNING smoke
 * server (no reboot, real clicks without force so actionability issues
 * surface): Manage -> workspaces whitelist -> off-everywhere -> back to
 * Everywhere, with the presence badge checked after each step.
 *
 * Usage: node scripts/skills-uninstall-repro.mjs <baseUrl> [outDir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const BASE_URL = process.argv[2]
const OUT = process.argv[3] || 'test-results/skills/repro'
if (!BASE_URL) {
  console.error('usage: node scripts/skills-uninstall-repro.mjs <baseUrl> [outDir]')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
const requests = []
page.on('response', (r) => {
  if (r.url().includes('dsh-next-skills') && r.status() >= 400) {
    requests.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`)
  }
})

const log = (...a) => console.log(...a)

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
await page.waitForTimeout(1500)

// dismiss onboarding: click skip-style buttons, force-click even odd ones,
// and fall back to Escape; keep going while any dialog is open
for (let round = 0; round < 15; round++) {
  await page.waitForTimeout(400)
  const dialogs = page.locator('[role="dialog"]')
  if ((await dialogs.count()) === 0) break
  await page.screenshot({ path: join(OUT, `r0-onboarding-${round}.png`) })
  let clicked = false
  for (const name of ['Skip', 'Configure later', 'Not now', 'Cancel', 'Continue', 'Save and continue', 'Next', 'Done']) {
    const btn = page.getByRole('button', { name })
    for (let i = 0; i < await btn.count(); i++) {
      const b = btn.nth(i)
      if (await b.isVisible().catch(() => false)) {
        await b.click({ force: true, timeout: 2000 }).catch(() => {})
        clicked = true
        await page.waitForTimeout(300)
      }
    }
  }
  if (!clicked) await page.keyboard.press('Escape')
}

await page.getByText('Settings', { exact: true }).first().click()
await page.waitForTimeout(900)
const nav = page.getByRole('button', { name: 'Skills', exact: true }).first()
await nav.waitFor({ state: 'visible', timeout: 10_000 })
await nav.click()
await page.waitForTimeout(800)

const skillCard = (name) => page.locator('[data-testid="skills-card"]', { hasText: name }).first()
const presence = (name) => skillCard(name).locator('[data-testid="skills-presence"]').first()

await page.screenshot({ path: join(OUT, 'r1-grid.png') })

// ---- Step 1: Manage on a seeded skill -> scope modal ----------------------
const target = 'grill-me'
log('card visible:', await skillCard(target).isVisible().catch(() => false))
await skillCard(target).locator('[data-testid="skills-add"]').first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'r2-scope-modal.png') })
const modal = page.getByTestId('skills-modal')
log('scope modal visible:', await modal.isVisible().catch(() => false))

// ---- Step 2: off-everywhere (workspaces radio with nothing checked) -------
await page.getByTestId('skills-scope-workspaces').click()
await page.waitForTimeout(400)
await page.screenshot({ path: join(OUT, 'r3-workspaces-mode.png') })
await modal.getByRole('button', { name: 'Save scope', exact: true }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: join(OUT, 'r4-off-everywhere.png') })
log('modal closed:', !(await modal.isVisible().catch(() => false)))
log('presence badge now:', await presence(target).textContent().catch(() => '<gone>'))

// ---- Step 3: back to Everywhere -------------------------------------------
await skillCard(target).locator('[data-testid="skills-add"]').first().click()
await page.waitForTimeout(600)
await page.getByTestId('skills-scope-global').click()
await page.waitForTimeout(200)
await modal.getByRole('button', { name: 'Save scope', exact: true }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: join(OUT, 'r5-back-to-global.png') })
log('presence badge restored:', await presence(target).textContent().catch(() => '<gone>'))

// ---- Step 4: Providers tab (screenshot only; remove is destructive) -------
await page.getByTestId('skills-tab-providers').first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: join(OUT, 'r6-providers.png') })
log('provider row visible:', await skillCard('anthropics/skills').isVisible().catch(() => false))

log('\nerrors captured:', errors.length)
for (const e of errors) log(' ', e)
log('failed requests:', requests.length)
for (const r of requests) log(' ', r)
await browser.close()
