import { type Page } from '@playwright/test'
import { expect, test } from './browser-fixture.ts'
import { unblankCurrentSession } from './git-helpers.ts'

/** Exercise the real configuration owner, native primitives, and delivery route. */
export async function verifyNotifier(page: Page, openCard: (page: Page) => Promise<void>): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1400 })
  const endpoint = new URL('/dsh-next-notifier/rpc', page.url()).href
  const rpc = async (method: string, args?: unknown) => {
    const response = await page.request.post(endpoint, { data: { method, args: args ?? null } })
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const original = (await rpc('getState')).config
  await rpc('setConfig', { volume: 0 })
  try {
    await openCard(page)
    const card = page.getByTestId('dsh-next-notifier-settings')
    await expect(card.getByRole('switch', { name: 'Enable notifications', exact: true })).toBeVisible()
    const slider = card.getByRole('slider')
    await expect(page.locator('[data-plugin-detail="@dsh-next/dsh-next-notifier"]').getByTestId('dsh-next-notifier-settings')).toBeVisible()
    await expect(page.locator('[data-plugin-row-detail]')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(slider).toHaveValue('0')
    await slider.focus()
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('1')
    await expect.poll(async () => (await rpc('getState')).config.volume).toBe(1)
    await expect(card.getByRole('status')).toHaveText('Changes apply automatically.')
    await page.reload()
    await openCard(page)
    await expect(slider).toHaveValue('1')
    await slider.focus()
    await slider.press('Home')
    await expect.poll(async () => (await rpc('getState')).config.volume).toBe(0)
    await expect(card.getByRole('status')).toHaveText('Changes apply automatically.')
    await slider.evaluate(el => el.blur())
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      const screenshot = await card.screenshot({ path: test.info().outputPath(`notifier-settings-${theme}.png`) })
      await test.info().attach(`notifier-settings-${theme}`, { body: screenshot, contentType: 'image/png' })
    }
    const malformed = await page.request.post(endpoint, { data: 'null', headers: { 'content-type': 'application/json' } })
    expect(malformed.status()).toBe(400)
    expect((await page.request.post(endpoint, { data: { method: 'constructor' } })).status()).toBe(404)
    expect((await page.request.post(endpoint, { data: { method: 'preview', args: { id: 'chime' } } })).status()).toBe(404)

    const nextIdentity = (target: Page) => target.waitForRequest(request =>
      request.url().endsWith('/dsh-next-notifier/rpc') && request.method() === 'POST'
      && request.postDataJSON()?.method === 'getPendingNotifications')
      .then(request => request.postDataJSON().args.clientId as string)
    const firstId = await nextIdentity(page)
    const second = await page.context().newPage()
    try {
      const secondIdentity = nextIdentity(second)
      await second.goto(page.url())
      expect(await secondIdentity).not.toBe(firstId)
    } finally { await second.close() }
    await page.bringToFront()
    await expect.poll(async () => (await rpc('getPresence', { clientId: firstId })).ageMs).not.toBeNull()
    // Settings hides the conversation, so it must never suppress that session's alerts.
    await expect.poll(async () => (await rpc('getPresence', { clientId: firstId })).sessionId).toBeNull()
    await card.getByRole('button', { name: 'Show', exact: true }).click()
    const toast = page.getByRole('alert').filter({ hasText: 'Test toast' })
    await expect(toast).toBeVisible()
    await toast.screenshot({ path: test.info().outputPath('notifier-native-toast.png') })
    const close = toast.getByRole('button', { name: 'Dismiss', exact: true })
    await close.focus()
    await close.press('Enter')
    await expect(toast).toHaveCount(0)
  } finally { await rpc('setConfig', original) }
}

/** A real failed agent turn proves host events reach the mounted native toast. */
export function registerNotifierTurnTest(baseUrl: string, plugins: string[], preparePage: (page: Page) => Promise<void>): void {
  test('notifier distinguishes an actual failed agent turn', async ({ page }) => {
    test.skip(!plugins.includes('@dsh-next/dsh-next-notifier') || process.env.DSH_E2E_LIVE === '1', 'requires the isolated keyless notifier lane')
    await page.goto(baseUrl)
    await preparePage(page)
    const endpoint = new URL('/dsh-next-notifier/rpc', baseUrl).href
    const rpc = async (method: string, args?: unknown) => {
      const response = await page.request.post(endpoint, { data: { method, args: args ?? null } })
      expect(response.ok()).toBe(true)
      return response.json()
    }
    const original = (await rpc('getState')).config
    try {
      await rpc('setConfig', { enabled: true, suppressFocused: false, volume: 0 })
      await unblankCurrentSession(page, 'Notifier verification without model credentials.')
      const toast = page.getByRole('alert').filter({ hasText: 'Agent encountered an error' })
      await expect(toast).toBeVisible({ timeout: 90000 })
      await toast.screenshot({ path: test.info().outputPath('notifier-error-toast.png') })
      await toast.getByRole('button', { name: 'Open session', exact: true }).click()
      await expect(toast).toHaveCount(0)
    } finally { await rpc('setConfig', original) }
  })
}
