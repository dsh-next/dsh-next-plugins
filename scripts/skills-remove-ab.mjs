/**
 * A/B: is the stale skill served by the HOST registry or cached by the CLIENT?
 * Page A: baseline /-menu -> remove grill-me via Skills UI.
 * Page B (independent browser context, fresh client): /-menu at +2s.
 * Page A again: New Session click (no reload), /-menu.
 * Usage: node scripts/skills-remove-ab.mjs <baseUrl>
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.argv[2]
const OUT = 'test-results/skills/ab'
mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
const at = () => `+${Math.round((Date.now() - t0) / 1000)}s`

const browser = await chromium.launch({ headless: true })

async function boot(ctx, tag) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  for (let round = 0; round < 12; round++) {
    const dialogs = page.locator('[role="dialog"]')
    if ((await dialogs.count()) === 0) break
    let clicked = false
    for (const name of ['Skip', 'Configure later', 'Not now', 'Cancel', 'Continue', 'Save and continue', 'Next', 'Done']) {
      const btn = page.getByRole('button', { name })
      for (let i = 0; i < await btn.count(); i++) {
        const b = btn.nth(i)
        if (await b.isVisible().catch(() => false)) {
          await b.click({ force: true, timeout: 1500 }).catch(() => {})
          clicked = true
          await page.waitForTimeout(200)
        }
      }
    }
    if (!clicked) await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  console.log(at(), `${tag} booted`)
  return page
}

async function newSession(page) {
  const btn = page.locator('button', { hasText: 'New Session' }).first()
  await btn.waitFor({ state: 'attached', timeout: 15_000 })
  await btn.click({ force: true, timeout: 10_000 })
  await page.waitForTimeout(800)
}

async function slashMenuSkills(page, tag) {
  const ta = page.locator('textarea').first()
  if ((await ta.getAttribute('readonly')) !== null) {
    // Empty state: the composer doubles as the workspace menu trigger — pick
    // the seeded workspace with the keyboard (real item clicks do not land).
    await ta.click({ force: true })
    await page.waitForTimeout(700)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
  }
  const box = page.locator('textarea').first()
  await box.click()
  await box.fill('')
  await box.pressSequentially('/')
  await page.waitForTimeout(1000)
  const text = (await page.locator('[role="listbox"], [role="menu"]').first().textContent().catch(() => '')) ?? ''
  const names = ['grill-me', 'e2e-test-skill'].filter((n) => text.includes(n))
  await page.screenshot({ path: join(OUT, `${tag}.png`) })
  await box.fill('')
  return names
}

// ---- Page A: baseline + removal -------------------------------------------
const ctxA = await browser.newContext()
const pageA = await boot(ctxA, 'A')
await newSession(pageA)
console.log(at(), 'A baseline     ', JSON.stringify(await slashMenuSkills(pageA, 'a0-baseline')))

await pageA.getByText('Settings', { exact: true }).first().click()
await pageA.waitForTimeout(900)
await pageA.getByRole('button', { name: 'Skills', exact: true }).first().click()
await pageA.waitForTimeout(900)
const row = pageA.getByText('grill-me', { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"skill")][1]')
await row.getByRole('button', { name: 'Remove', exact: true }).click()
const dialog = pageA.getByRole('dialog', { name: 'Remove skill "grill-me"?' })
await dialog.waitFor({ state: 'visible', timeout: 8000 })
await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
await pageA.waitForTimeout(500)
console.log(at(), 'A removed grill-me, row visible:', await row.isVisible().catch(() => false))

// ---- Page B: independent fresh client, ~2s after removal -------------------
await pageA.waitForTimeout(1500)
const ctxB = await browser.newContext()
const pageB = await boot(ctxB, 'B')
await newSession(pageB)
console.log(at(), 'B fresh client ', JSON.stringify(await slashMenuSkills(pageB, 'b1-fresh-client')))

// ---- Page A: New Session click WITHOUT reload ------------------------------
await newSession(pageA)
console.log(at(), 'A new-session  ', JSON.stringify(await slashMenuSkills(pageA, 'a2-new-session')))

// ---- Page B again a bit later ---------------------------------------------
await pageA.waitForTimeout(4000)
await newSession(pageB)
console.log(at(), 'B again        ', JSON.stringify(await slashMenuSkills(pageB, 'b3-again')))

await browser.close()
