import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/** Exercise the real settings/HTTP path without starting external OAuth. */
export async function verifyOauthProviders(page: Page): Promise<void> {
  const modelsNav = page.getByRole('button', { name: 'Models', exact: true }).first()
  if (!(await modelsNav.isVisible().catch(() => false))) {
    await page.getByText('Settings', { exact: true }).first().click()
  }
  await expect(modelsNav).toBeVisible()
  await modelsNav.click()
  const footer = page.getByTestId('dsh-next-oauth-providers')
  await expect(footer).toBeVisible()

  const rpcUrl = new URL('/dsh-next-oauth-providers/rpc', page.url()).toString()
  const invalid = await page.request.post(rpcUrl, { data: 'null', headers: { 'content-type': 'application/json' } })
  expect(invalid.status()).toBe(400)
  expect(await invalid.json()).toEqual({ ok: false, error: { code: 'bad-request' } })

  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH_HOME is required for OAuth settings persistence assertions')
  const settings = () => readFileSync(join(home, 'settings.yaml'), 'utf8')
  const customized = () => footer.locator('summary').filter({ hasText: 'Customized settings' })
  const openModels = async () => {
    if (!(await footer.getByTestId('oauth-add-model').isVisible())) await customized().click()
  }

  await footer.getByTestId('oauth-add-provider').click()
  await expect(footer.getByTestId('oauth-sign-in')).toBeVisible()
  await openModels()
  await footer.getByTestId('oauth-add-model').click()
  const initialId = footer.getByRole('textbox', { name: 'Model ID 1', exact: true })
  await initialId.pressSequentially('kimi-draft')
  await expect(initialId).toHaveValue('kimi-draft')
  await expect(initialId).toBeFocused()

  await footer.getByTestId('oauth-provider-select').selectOption('grok')
  await openModels()
  await expect(footer.getByRole('textbox', { name: 'Model ID 1', exact: true })).toHaveCount(0)
  for (const [index, id, capacity] of [[1, 'oauth-smoke-first', '111K'], [2, 'oauth-smoke-second', '222K']] as const) {
    await footer.getByTestId('oauth-add-model').click()
    await footer.getByRole('textbox', { name: `Model ID ${index}`, exact: true }).fill(id)
    await footer.getByRole('button', { name: `Capacities ${index}`, exact: true }).click()
    await footer.getByRole('textbox', { name: `Context window ${index}`, exact: true }).fill(capacity)
  }
  await footer.getByRole('button', { name: 'Delete model 1', exact: true }).click()
  await expect(footer.getByRole('textbox', { name: 'Model ID 1', exact: true })).toHaveValue('oauth-smoke-second')
  await expect(footer.getByRole('textbox', { name: 'Context window 1', exact: true })).toHaveValue('222K')
  await footer.getByTestId('oauth-apply').click()
  const row = footer.getByTestId('dsh-next-oauth-providers-grok')
  await expect(row).toBeVisible()
  await expect.poll(settings).toContain('oauth-smoke-second')
  await expect.poll(settings).toContain('222000')
  expect(settings()).not.toContain('oauth-smoke-first')
  expect(settings()).not.toContain('kimi-draft')

  await row.getByRole('button', { name: 'Edit Grok', exact: true }).click()
  await openModels()
  await footer.getByRole('button', { name: 'Capacities 1', exact: true }).click()
  await footer.getByRole('textbox', { name: 'Context window 1', exact: true }).fill('invalid')
  await expect(footer.getByTestId('oauth-apply')).toBeDisabled()
  await footer.getByRole('button', { name: 'Restore defaults', exact: true }).click()
  await expect(footer.getByTestId('oauth-apply')).toBeEnabled()
  await expect(footer.getByRole('textbox', { name: 'Model ID 1', exact: true })).not.toHaveValue('oauth-smoke-second')
  const capacities = footer.getByRole('button', { name: 'Capacities 1', exact: true })
  if (await capacities.getAttribute('aria-expanded') !== 'true') await capacities.click()
  await expect(footer.getByRole('textbox', { name: 'Context window 1', exact: true })).not.toHaveValue('invalid')
  const screenshot = test.info().outputPath('oauth-editor-restored-defaults.png')
  await footer.screenshot({ path: screenshot })
  await test.info().attach('oauth-editor-restored-defaults', { path: screenshot, contentType: 'image/png' })
  await footer.getByTestId('oauth-apply').click()
  await expect.poll(settings).not.toContain('oauth-smoke-second')

  await row.getByRole('button', { name: 'Delete Grok', exact: true }).click()
  await page.getByTestId('oauth-delete-confirm').click()
  await expect(row).toHaveCount(0)
  const state = await page.request.post(rpcUrl, { data: { method: 'getState' } })
  expect(await state.json()).toEqual({ ok: true, value: { writable: true, providers: [] } })
  expect(settings()).not.toContain('id: xai')
}
