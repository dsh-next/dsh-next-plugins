/**
 * Focused live repro for the Remove flow against the RUNNING smoke server
 * (no reboot, real clicks without force so actionability issues surface).
 *
 * Usage: node scripts/skills-remove-repro.mjs <baseUrl> [outDir]
 */
import { chromium } from '@playwright/test'
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

const skillRow = (name) =>
  page.getByText(name, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"skill")][1]')

await page.screenshot({ path: join(OUT, 'r0-installed.png') })

// ---- Step 1: click Remove on a seeded skill (normal click, no force) ------
const target = 'grill-me'
const row = skillRow(target)
log('row visible:', await row.isVisible().catch(() => false))
const removeBtn = row.getByRole('button', { name: 'Remove', exact: true })
log('Remove button visible:', await removeBtn.isVisible().catch(() => false))
await removeBtn.click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'r1-after-remove-click.png') })

const dialog = page.getByRole('dialog', { name: `Remove skill "${target}"?` })
const popupVisible = await dialog.isVisible().catch(() => false)
log('popup visible after click:', popupVisible)
log('dialog count on page:', await page.locator('[role="dialog"]').count())

if (popupVisible) {
  await page.screenshot({ path: join(OUT, 'r2-popup.png') })
  const confirmBtn = dialog.getByRole('button', { name: 'Remove', exact: true })
  log('confirm Remove visible:', await confirmBtn.isVisible().catch(() => false))
  await confirmBtn.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(OUT, 'r3-after-confirm.png') })
  log('popup still visible:', await dialog.isVisible().catch(() => false))
  log('row still visible:', await skillRow(target).isVisible().catch(() => false))
}

// error/warning status text
const statusErr = await page.locator('[class*="statusErr"]').allTextContents()
log('statusErr:', JSON.stringify(statusErr))
const status = await page.locator('[class*="status"]').allTextContents()
log('all status:', JSON.stringify(status))

// ---- Step 2: same on the Providers tab ------------------------------------
const provTab = page.getByRole('button', { name: 'Providers', exact: true }).first()
await provTab.click()
await page.waitForTimeout(1000)
await page.screenshot({ path: join(OUT, 'r4-providers.png') })
const provRow = skillRow('anthropics/skills')
log('provider row visible:', await provRow.isVisible().catch(() => false))
const provRemove = provRow.getByRole('button', { name: 'Remove', exact: true })
log('provider Remove visible:', await provRemove.isVisible().catch(() => false))
await provRemove.click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'r5-provider-popup.png') })
const provDialog = page.getByRole('dialog', { name: 'Remove provider "anthropics/skills"?' })
log('provider popup visible:', await provDialog.isVisible().catch(() => false))
if (await provDialog.isVisible().catch(() => false)) {
  // Cancel — we do not actually want to remove a default in the user's env.
  await provDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForTimeout(400)
  log('provider popup closed by Cancel:', !(await provDialog.isVisible().catch(() => false)))
}
await page.screenshot({ path: join(OUT, 'r6-final.png') })

log('\nerrors captured:', errors.length)
for (const e of errors) log(' ', e)
log('failed requests:', requests.length)
for (const r of requests) log(' ', r)
await browser.close()
