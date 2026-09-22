/** Packed-family composition and short UI mounts only; mutations live in named plugin suites. */
import { type Page } from '@playwright/test'
import { test, expect, BASE_URL, pluginIds } from './browser-fixture.ts'
import { bareId, requireCheckpointsPanel, requirePluginMarkers } from '../../scripts/e2e-guards.mjs'
import { dismissOnboarding, closeDialogs, openWorkspaceSession, unblank } from './checkpoints-helpers.ts'
import { openCcSection, openNotifierCard, openSkillsSection } from './settings-helpers.ts'
import { openGitPanel } from './git-helpers.ts'

/** Every browser bundle needs a visible marker or an explicit non-UI reason. */
const pluginMarkers: Record<string, (page: Page) => Promise<void>> = {
  'dsh-next-cc-plugins': async page => {
    await openCcSection(page)
    await expect(page.getByRole('heading', { name: 'Claude Plugins', exact: true })).toBeVisible()
    await expect(page.getByTestId('cc-search')).toBeVisible()
  },
  'dsh-next-skills': async page => {
    await openSkillsSection(page)
    await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
    await expect(page.getByTestId('skills-search')).toBeVisible()
  },
  'dsh-next-notifier': async page => {
    await openNotifierCard(page)
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('Test browser notification')).toBeVisible()
  },
  'dsh-next-oauth-providers': async page => {
    await dismissOnboarding(page)
    await page.getByText('Settings', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Models', exact: true }).first().click()
    await expect(page.getByTestId('dsh-next-oauth-providers')).toBeVisible()
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

for (const pkg of pluginIds) {
  const marker = pluginMarkers[bareId(pkg)]
  if (marker) test(`mount: ${bareId(pkg)}`, async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await marker(page)
  })
}
