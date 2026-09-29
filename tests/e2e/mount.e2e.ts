/** Packed-family composition and short UI mounts only; mutations live in named plugin suites. */
import { type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, BASE_URL, pluginIds } from './browser-fixture.ts'
import { bareId, requireCheckpointsPanel, requirePluginMarkers } from '../../scripts/e2e-guards.mjs'
import { dismissOnboarding, closeDialogs, openWorkspaceSession, unblank } from './checkpoints-helpers.ts'
import { openNotifierCard, openSkillsSection } from './settings-helpers.ts'
import { openGitPanel } from './git-helpers.ts'

/** Every browser bundle needs a visible marker or an explicit non-UI reason. */
const pluginMarkers: Record<string, (page: Page) => Promise<void>> = {
  'dsh-next-skills': async page => {
    await openSkillsSection(page)
    await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
    await expect(page.getByTestId('skills-search')).toBeVisible()
  },
  'dsh-next-notifier': async page => {
    await openNotifierCard(page)
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('System notifications', { exact: true })).toBeVisible()
    await expect(page.locator('[data-plugin-detail="@dsh-next/dsh-next-notifier"]').getByTestId('dsh-next-notifier-settings')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  },
  'dsh-next-oauth-providers': async page => {
    await dismissOnboarding(page)
    await page.getByText('Settings', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Models', exact: true }).first().click()
    await expect(page.getByTestId('dsh-next-oauth-providers')).toBeVisible()
  },
  'dsh-next-decisions': async page => {
    await dismissOnboarding(page)
    await page.getByText('Settings', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Models', exact: true }).first().click()
    const section = page.getByTestId('dsh-next-decisions')
    await expect(section.getByRole('heading', { name: 'Decision models', exact: true })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Add decision model provider', exact: true })).toBeEnabled()
  },
  'dsh-next-git': async page => {
    await dismissOnboarding(page)
    await closeDialogs(page)
    await openWorkspaceSession(page, 'workspace-a')
    await openGitPanel(page)
    // A plain workspace still has an explicit non-repository state, never an empty seat.
    await expect(page.locator('[data-dsh-git="body"]')).toContainText(/\S/)
    await expect(page.locator('[data-slot-error="sidebar.right.pane.tab"]')).toHaveCount(0)
  },
  'dsh-next-checkpoints': async page => {
    await requireCheckpointsPanel(page, async () => {
      await dismissOnboarding(page)
      await closeDialogs(page)
      await openWorkspaceSession(page, 'workspace-b')
      await unblank(page, 'checkpoint mount marker')
    }, expect)
  },
}

const nonUiClients: Record<string, string> = {
  'dsh-next-opencode-session-patch': 'Host-only behavior with an empty browser entry.',
}

test('plugin family composes every client bundle without crash markers', async ({ page }) => {
  requirePluginMarkers(pluginIds, pluginMarkers, nonUiClients)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  const entryIds = await page.evaluate(() => {
    const boot = (globalThis as { __DSH_BOOT__?: { entries?: Array<{ id?: string }> } }).__DSH_BOOT__
    return (boot?.entries ?? []).map(entry => entry.id).filter((id): id is string => id !== undefined)
  })
  for (const pkg of pluginIds) expect(entryIds, `${pkg} client bundle should be in the boot graph`).toContain(pkg)
})

test('installed plugins show localized names and decoded package artwork', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  const plugins = page.getByRole('navigation', { name: 'Global panels' })
    .getByRole('button', { name: 'Plugins', exact: true })
  await expect(plugins).toBeVisible()
  await expect(async () => {
    await dismissOnboarding(page)
    await closeDialogs(page)
    await plugins.click({ timeout: 2000 })
    await expect(page.locator('[data-plugin-package]').first()).toBeVisible()
  }).toPass({ timeout: 20_000 })
  for (const pkg of pluginIds) {
    const directory = bareId(pkg)
    const { meta } = JSON.parse(readFileSync(resolve(__dirname, '../../packages', directory, 'locale/en.json'), 'utf8'))
    const card = page.locator(`[data-plugin-package="${pkg}"]`)
    await expect(card.getByRole('button', { name: `View ${meta.title}`, exact: true })).toBeVisible()
    await expect(card).toContainText(meta.description)
    const image = card.locator('img')
    await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  }
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.screenshot({ path: testInfo.outputPath(`plugin-display-metadata-${theme}.png`), fullPage: true })
  }
})

for (const pkg of pluginIds) {
  const marker = pluginMarkers[bareId(pkg)]
  if (marker) test(`mount: ${bareId(pkg)}`, async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await marker(page)
  })
}
