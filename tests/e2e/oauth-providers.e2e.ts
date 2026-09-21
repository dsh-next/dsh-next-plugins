import { test, BASE_URL, requireMountedPlugin } from './browser-fixture.ts'
import { dismissOnboarding } from './checkpoints-helpers.ts'
import { verifyOauthProviders } from './oauth-helpers.ts'

test('OAuth provider editing, validation and deletion persist through the real host', async ({ page }) => {
  requireMountedPlugin('oauth-providers')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await verifyOauthProviders(page)
})
