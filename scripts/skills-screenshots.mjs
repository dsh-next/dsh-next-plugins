/**
 * Headless Playwright screenshots of the Skills settings section in the
 * running isolated DSH smoke: Settings -> Skills nav item, the Skills tab
 * card grid, the scope modal (Everywhere vs the workspaces checklist), the
 * detail modal, and the Providers tab. Text assertions live in
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
await page.screenshot({ path: `${OUT}/02-skills-grid.png` })

// The scope modal (Manage): Everywhere radio, workspaces checklist, and the
// two-step Remove reveal. Cancel keeps everything untouched.
const manage = page.locator('[data-testid="skills-add"]').first()
if (await manage.isVisible().catch(() => false)) {
  await manage.click({ force: true })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/05-scope-modal.png` })
  await page.getByTestId('skills-scope-workspaces').click({ force: true }).catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/06-scope-workspaces.png` })
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click({ force: true }).catch(() => {})
  await page.waitForTimeout(500)
}

await page.getByTestId('skills-tab-providers').first().click({ force: true })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/03-section-providers.png` })

await page.getByTestId('skills-tab-skills').first().click({ force: true })
await page.waitForTimeout(800)
// Detail modal of the first card's name button.
const nameButton = page.locator('[data-testid="skills-detail"]').first()
if (await nameButton.isVisible().catch(() => false)) {
  await nameButton.click({ force: true })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/04-detail-modal.png` })
  await page.getByTestId('skills-detail-close').click({ force: true }).catch(() => {})
}

console.log('pageErrors:', JSON.stringify(pageErrors, null, 2))
console.log('Screenshots written to', OUT)
await browser.close()
