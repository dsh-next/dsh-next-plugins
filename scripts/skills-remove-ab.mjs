/**
 * A/B: is the stale skill served by the HOST registry or cached by the CLIENT?
 * Page A: baseline /-menu -> remove grill-me via Skills UI.
 * Page B (independent browser context, fresh client): /-menu at +2s.
 * Page A again: New Session click (no reload), /-menu.
 * Destructive: use a fresh boot seed (grill-me must initially be present).
 * Usage: node scripts/skills-remove-ab.mjs <baseUrl>
 */
import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.argv[2]
if (!BASE_URL) { console.error('usage: node scripts/skills-remove-ab.mjs <baseUrl>'); process.exit(2) }
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
  expect(text, 'native discovery must respect user-invocable: false').not.toContain('opentofu')
  expect(text, 'remaining seeded skill proves the menu loaded').toContain('e2e-test-skill')
  const names = ['grill-me', 'e2e-test-skill'].filter((n) => text.includes(n))
  await page.screenshot({ path: join(OUT, `${tag}.png`) })
  await box.fill('')
  return names
}

// ---- Page A: baseline + removal -------------------------------------------
const ctxA = await browser.newContext()
const pageA = await boot(ctxA, 'A')
await newSession(pageA)
const baseline = await slashMenuSkills(pageA, 'a0-baseline')
console.log(at(), 'A baseline     ', JSON.stringify(baseline))
expect(baseline, 'fresh seed required').toContain('grill-me')

await pageA.getByText('Settings', { exact: true }).first().click()
await pageA.waitForTimeout(900)
await pageA.getByRole('button', { name: 'Skills', exact: true }).first().click()
await pageA.waitForTimeout(900)
// Per-copy delete goes straight to a confirmation with the selected path.
const card = pageA.locator('[data-testid="skills-card"]', { hasText: 'grill-me' }).first()
await expect(pageA.locator('[data-testid^="skills-scope"], [data-testid="skills-modal"], [data-testid="skills-presence"]')).toHaveCount(0)
await card.getByTestId('skills-delete').click()
const modal = pageA.getByTestId('skills-delete-confirm')
await expect(modal).toBeVisible()
await expect(modal.getByTestId('skills-delete-path')).toContainText('grill-me/SKILL.md')
await modal.getByTestId('skills-delete-confirm-btn').click()
await expect(modal).toBeHidden()
console.log(at(), 'A deleted grill-me')

// ---- Page B: independent fresh client, ~2s after removal -------------------
await pageA.waitForTimeout(1500)
const ctxB = await browser.newContext()
const pageB = await boot(ctxB, 'B')
await newSession(pageB)
const b1_fresh_client = await slashMenuSkills(pageB, 'b1-fresh-client')
console.log(at(), 'B fresh client ', JSON.stringify(b1_fresh_client))
expect(b1_fresh_client, 'deleted skill must disappear').not.toContain('grill-me')

// ---- Page A: New Session click WITHOUT reload ------------------------------
await newSession(pageA)
const a2_new_session = await slashMenuSkills(pageA, 'a2-new-session')
console.log(at(), 'A new-session  ', JSON.stringify(a2_new_session))
expect(a2_new_session, 'deleted skill must disappear').not.toContain('grill-me')

// ---- Page B again a bit later ---------------------------------------------
await pageA.waitForTimeout(4000)
await newSession(pageB)
const b3_again = await slashMenuSkills(pageB, 'b3-again')
console.log(at(), 'B again        ', JSON.stringify(b3_again))
expect(b3_again, 'deleted skill must disappear').not.toContain('grill-me')

await browser.close()
