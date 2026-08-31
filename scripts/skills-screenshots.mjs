/**
 * Headless Playwright screenshots of the Skills settings section in the
 * running isolated DSH smoke: Settings -> Skills nav item, then the three
 * tabs (Installed / Search / Providers), the Configuration block, and
 * the two-step Remove confirmation. Text assertions live in
 * scripts/skills-providers-verify.mjs and skills-full-verify.mjs; this script
 * only captures visual evidence.
 *
 * Usage: node scripts/skills-screenshots.mjs <baseUrl> [outDir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import process from 'node:process'

const BASE_URL = process.argv[2]
const OUT = process.argv[3] || 'test-results/skills'
if (!BASE_URL) {
  console.error('usage: node scripts/skills-screenshots.mjs <baseUrl> [outDir]')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
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

async function openSkillsSection() {
  await page.getByText('Settings', { exact: true }).first().click({ force: true })
  await page.waitForTimeout(900)
  const nav = page.getByRole('button', { name: 'Skills', exact: true }).first()
  await nav.waitFor({ state: 'visible', timeout: 10_000 })
  await nav.click({ force: true })
  await page.waitForTimeout(1000)
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
await page.waitForTimeout(1500)
await dismissOnboarding()
await page.screenshot({ path: `${OUT}/00-home.png` })

await openSkillsSection()
await page.screenshot({ path: `${OUT}/02-section-installed.png` })

// Two-step Remove confirmation (then Cancel to keep the seeded skills).
await page.getByRole('button', { name: 'Remove', exact: true }).first().click({ force: true })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/05-confirm-remove.png` })
await page.getByRole('button', { name: 'Cancel', exact: true }).first().click({ force: true }).catch(() => {})
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'Providers', exact: true }).first().click({ force: true })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/03-section-providers.png` })

await page.getByRole('button', { name: 'Search', exact: true }).first().click({ force: true })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/04-section-search.png` })

console.log('pageErrors:', JSON.stringify(pageErrors, null, 2))
console.log('Screenshots written to', OUT)
await browser.close()
