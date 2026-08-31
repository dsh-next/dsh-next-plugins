import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:3931'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })
for (let i = 0; i < 5; i++) {
  const skip = page.getByRole('button', { name: /skip|start/i }).first()
  if (await skip.isVisible().catch(() => false)) { await skip.click({ force: true }).catch(() => {}) }
  await page.waitForTimeout(400)
  const nav = page.getByRole('button', { name: 'Claude Plugins', exact: true }).first()
  if (await nav.isVisible().catch(() => false)) break
  const settings = page.getByText('Settings', { exact: true }).first()
  if (await settings.isVisible().catch(() => false)) { await settings.click({ force: true }); await page.waitForTimeout(600) }
}
await page.getByRole('button', { name: 'Claude Plugins', exact: true }).first().click({ force: true })
// getState TTL-refreshes the marketplaces (snapshot older than 24h) — give it room.
await page.waitForTimeout(3000)

const card = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("episodic-memory"))').first()
await card.waitFor({ state: 'visible', timeout: 15000 })
const summary = await card.locator('.desc').nth(1).textContent().catch(() => '')
console.log('card summary before:', summary)

// Open the Manage modal and run Update everywhere.
await card.locator('[data-testid="cc-add"]').click()
await page.getByRole('dialog').getByRole('button', { name: 'Update everywhere' }).click()

// The update re-syncs the marketplace then re-downloads the plugin tarball.
const msg = page.getByTestId('cc-message')
await msg.waitFor({ state: 'visible', timeout: 60000 })
console.log('panel message:', await msg.textContent())

// Card state after: notes chip + summary.
await page.waitForTimeout(600)
const chip = card.locator('[data-testid="cc-notes-chip"]')
if (await chip.count() > 0) {
  console.log('notes chip:', await chip.first().textContent())
  console.log('notes title:', await chip.first().getAttribute('title'))
} else {
  console.log('notes chip: none (record carries no notes)')
}

// Detail modal: components + persisted notes.
await card.locator('[data-testid="cc-detail"]').click()
await page.waitForTimeout(400)
const detail = page.getByTestId('cc-plugin-detail')
console.log('detail version line:', (await detail.locator('p').nth(1).textContent())?.trim())
const components = page.getByTestId('cc-detail-components')
if (await components.isVisible().catch(() => false)) {
  console.log('components:', (await components.textContent())?.replace(/\s+/g, ' ').slice(0, 400))
}
const notesEl = page.getByTestId('cc-detail-notes')
if (await notesEl.isVisible().catch(() => false)) {
  console.log('record notes:', (await notesEl.textContent())?.replace(/\s+/g, ' ').slice(0, 400))
}
await page.getByTestId('cc-detail-close').click()

await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click({ force: true }).catch(() => {})
const relevant = errors.filter((e) => e.includes('cc-plugins'))
console.log('cc-plugins errors:', relevant.length ? relevant : 'none')
await browser.close()
