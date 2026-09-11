/**
 * Focused per-copy delete repro against a RUNNING isolated smoke server.
 * Real clicks without force expose actionability issues: Delete -> cancel
 * preserves the copy; Delete -> confirm removes only the selected copy.
 * Destructive: consumes the boot-seeded grill-me copy; use a fresh seed.
 *
 * Usage: node scripts/skills-remove-repro.mjs <baseUrl> [outDir]
 */
import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const BASE_URL = process.argv[2]
const OUT = process.argv[3] || 'test-results/skills/repro'
if (!BASE_URL) {
  console.error('usage: node scripts/skills-remove-repro.mjs <baseUrl> [outDir]')
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

await page.screenshot({ path: join(OUT, 'r1-grid.png') })

// ---- Cancel leaves the selected copy intact -------------------------------
const target = 'grill-me'
await expect(skillCard(target)).toBeVisible()
await expect(page.locator('[data-testid^="skills-scope"], [data-testid="skills-modal"], [data-testid="skills-presence"], [data-testid="skills-workspace"]')).toHaveCount(0)
async function state() {
  const response = await page.request.post(BASE_URL + '/dsh-next-skills/rpc', { data: { method: 'getState', args: {} } })
  expect(response.ok()).toBe(true)
  const value = await response.json()
  expect(Object.keys(value).sort()).toEqual(['catalog', 'installed', 'providers'])
  return value
}
const before = await state()
await skillCard(target).getByTestId('skills-delete').click()
const modal = page.getByTestId('skills-delete-confirm')
await expect(modal).toBeVisible()
const copyPath = await modal.getByTestId('skills-delete-path').textContent()
expect(before.installed.some((row) => row.name === target && row.path === copyPath)).toBe(true)
await page.screenshot({ path: join(OUT, 'r2-delete-confirm.png') })
await modal.getByTestId('skills-delete-cancel').click()
await expect(modal).toBeHidden()
expect((await state()).installed.some((row) => row.path === copyPath)).toBe(true)
log('cancel preserved copy:', copyPath)

// ---- Confirm removes this exact copy, leaving other copies untouched -------
await skillCard(target).getByTestId('skills-delete').click()
await expect(modal).toBeVisible()
await expect(modal.getByTestId('skills-delete-path')).toHaveText(copyPath)
await modal.getByTestId('skills-delete-confirm-btn').click()
await expect(modal).toBeHidden()
await expect.poll(async () => (await state()).installed.some((row) => row.path === copyPath)).toBe(false)
const after = await state()
for (const row of before.installed.filter((row) => row.path !== copyPath)) {
  expect(after.installed.some((remaining) => remaining.path === row.path)).toBe(true)
}
await page.screenshot({ path: join(OUT, 'r3-copy-deleted.png') })
log('deleted copy:', copyPath)

log('\nerrors captured:', errors.length)
for (const e of errors) log(' ', e)
log('failed requests:', requests.length)
for (const r of requests) log(' ', r)
await browser.close()
if (errors.length || requests.length) process.exitCode = 1
