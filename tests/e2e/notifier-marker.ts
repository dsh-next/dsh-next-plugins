import { expect, test, type Page } from '@playwright/test'
import { unblankCurrentSession } from './worktrees-helpers.ts'

/** Real packed-plugin smoke for settings, client identity, RPC safety and keyboard dismissal. */
export async function verifyNotifier(page: Page, openCard: (page: Page) => Promise<void>): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' })
  const endpoint = new URL('/dsh-next-notifier/rpc', page.url()).href
  const rpc = async (method: string, args?: unknown) => {
    const response = await page.request.post(endpoint, { data: { method, args: args ?? null } })
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const original = (await rpc('getState')).config
  // Test previews must never play audible sounds on the developer's machine.
  await rpc('setConfig', { volume: 0 })
  try {
    await openCard(page)
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('Test browser notification')).toBeVisible()
    const slider = page.getByRole('slider')
    await expect(slider).toHaveValue('0')
    await slider.focus()
    await slider.press('End')
    await slider.press('Home')
    await expect.poll(async () => (await rpc('getState')).config.volume).toBe(0)
    await expect(slider).toHaveValue('0')
    await slider.evaluate(el => el.blur())
    const card = slider.locator('xpath=ancestor::li[1]')
    await card.evaluate(el => el.scrollIntoView({ block: 'start' }))
    const bounds = await card.boundingBox()
    if (!bounds) throw new Error('Notifier card has no bounds')
    const screenshot = await page.screenshot({ path: 'test-results/notifier-settings.png', clip: { x: bounds.x, y: Math.max(0, bounds.y), width: bounds.width, height: 390 } })
    await test.info().attach('notifier-settings', { body: screenshot, contentType: 'image/png' })

    const malformed = await page.request.post(endpoint, { data: 'null', headers: { 'content-type': 'application/json' } })
    expect(malformed.status()).toBe(400)
    const inherited = await page.request.post(endpoint, { data: { method: 'constructor' } })
    expect(inherited.status()).toBe(404)
    expect((await rpc('getState')).config.enabled).toBe(original.enabled)

    const nextIdentity = (target: Page) => target.waitForRequest(request => {
      if (!request.url().endsWith('/dsh-next-notifier/rpc') || request.method() !== 'POST') return false
      return request.postDataJSON()?.method === 'getPendingNotifications'
    }).then(request => request.postDataJSON().args.clientId as string)
    const firstId = await nextIdentity(page)
    const second = await page.context().newPage()
    try {
      const secondIdentity = nextIdentity(second)
      await second.goto(page.url())
      const secondId = await secondIdentity
      expect(secondId).not.toBe(firstId)
    } finally { await second.close() }
    await page.bringToFront()
    await expect.poll(async () => (await rpc('getPresence', { clientId: firstId })).ageMs).not.toBeNull()

    await page.getByRole('button', { name: 'Show', exact: true }).click()
    const toast = page.getByTestId('dsh-next-notifier-toast').first()
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Test toast')
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click({ force: true })
    const close = page.getByTestId('dsh-next-notifier-toast-close').first()
    await close.focus()
    await close.press('Enter')
    await expect(page.getByTestId('dsh-next-notifier-toast')).toHaveCount(0)

  } finally { await rpc('setConfig', original) }
}

/** Keep real agent work in its own page/test, not in other plugins' shared marker state. */
export function registerNotifierTurnTest(baseUrl: string, plugins: string[], preparePage: (page: Page) => Promise<void>): void {
  test('notifier distinguishes an actual failed agent turn', async ({ page }) => {
    test.skip(!plugins.includes('@dsh-next/dsh-next-notifier') || process.env.DSH_E2E_LIVE === '1', 'requires the isolated keyless notifier lane')
    await page.emulateMedia({ colorScheme: 'dark' })
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
      const toast = page.getByTestId('dsh-next-notifier-toast').first()
      await expect(toast).toContainText('Agent error', { timeout: 90000 })
      await toast.screenshot({ path: 'test-results/notifier-error-toast.png' })
      await page.getByTestId('dsh-next-notifier-toast-close').first().click()
    } finally { await rpc('setConfig', original) }
  })
}
