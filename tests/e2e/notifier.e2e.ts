import { test, expect, BASE_URL, pluginIds, requireMountedPlugin } from './browser-fixture.ts'
import { dismissOnboarding, closeDialogs, openWorkspaceSession } from './checkpoints-helpers.ts'
import { openNotifierCard } from './settings-helpers.ts'
import { verifyNotifier, registerNotifierTurnTest } from './notifier-marker.ts'

test.beforeEach(() => { requireMountedPlugin('notifier') })

test('Notifier settings, client identity and keyboard dismissal use the real host', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  // The sidebar button is always visible; the Notifier card itself determines
  // whether the Plugins management page is already open.
  await expect(page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins' })).toBeVisible()
  await expect(page.locator('[data-plugin-item="dsh-next-notifier"]')).toHaveCount(0)
  await verifyNotifier(page, openNotifierCard)
})

registerNotifierTurnTest(BASE_URL, pluginIds, async page => {
  await dismissOnboarding(page)
  await closeDialogs(page)
  await openWorkspaceSession(page, 'workspace-a')
})
