import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

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
  page.on('console', (message) => { if (message.text().startsWith('oauth-')) console.log('DEBUG console', message.text()) })
  const invalid = await page.request.post(rpcUrl, { data: 'null', headers: { 'content-type': 'application/json' } })
  expect(invalid.status()).toBe(400)
  expect(await invalid.json()).toEqual({ ok: false, error: { code: 'bad-request' } })

  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH_HOME is required for OAuth settings persistence assertions')
  // DSH 0.1.7 retired settings.yaml: a plugin's settings are its own Loader
  // entry config, persisted as an id-targeted row in the profile patch.
  const profile = readdirSync(join(home, 'profiles'))[0]
  if (profile === undefined) throw new Error('DSH_HOME has no profile to persist into')
  const settings = () => readFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), 'utf8')

  /** The editor fold is collapsed until a model row is touched. */
  const openModels = async (scope: Locator) => {
    if (!(await scope.getByTestId('oauth-add-model').isVisible())) {
      await scope.locator('summary').filter({ hasText: 'Customized settings' }).click()
    }
  }

  // 1. The footer is the one Add entry; the stock page owns the row afterwards.
  await footer.getByTestId('oauth-add-provider').click()
  await expect(footer.getByTestId('oauth-sign-in')).toBeVisible()
  await openModels(footer)
  await footer.getByTestId('oauth-add-model').click()
  const initialId = footer.getByRole('textbox', { name: 'Model ID 1', exact: true })
  await initialId.pressSequentially('kimi-draft')
  await expect(initialId).toHaveValue('kimi-draft')
  await expect(initialId).toBeFocused()

  await footer.getByTestId('oauth-provider-select').selectOption('grok')
  await openModels(footer)
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
  // The Add card closed and the family left the addable set.
  await expect(footer.getByTestId('oauth-provider-select')).toHaveCount(0)
  await expect.poll(settings).toContain('oauth-smoke-second')
  await expect.poll(settings).toContain('222000')
  expect(settings()).not.toContain('oauth-smoke-first')
  expect(settings()).not.toContain('kimi-draft')

  // 2. The subscription is a native row now; the stock page owns Edit/Delete.
  const nativeRow = (action: 'Edit' | 'Delete') => page.getByRole('button', { name: `${action} Grok (xai-oauth)`, exact: true })
  await expect(nativeRow('Edit')).toBeVisible()

  await nativeRow('Edit').click()
  const card = page.getByTestId('dsh-next-oauth-providers-card-grok')
  await expect(card).toBeVisible()
  await openModels(card)
  await card.getByRole('button', { name: 'Capacities 1', exact: true }).click()
  await card.getByRole('textbox', { name: 'Context window 1', exact: true }).fill('invalid')
  await expect(card.getByTestId('oauth-apply')).toBeDisabled()
  await card.getByRole('button', { name: 'Restore defaults', exact: true }).click()
  await expect(card.getByTestId('oauth-apply')).toBeEnabled()
  await expect(card.getByRole('textbox', { name: 'Model ID 1', exact: true })).not.toHaveValue('oauth-smoke-second')
  const capacities = card.getByRole('button', { name: 'Capacities 1', exact: true })
  if (await capacities.getAttribute('aria-expanded') !== 'true') await capacities.click()
  await expect(card.getByRole('textbox', { name: 'Context window 1', exact: true })).not.toHaveValue('invalid')
  const screenshot = test.info().outputPath('oauth-card-restored-defaults.png')
  await card.screenshot({ path: screenshot })
  await test.info().attach('oauth-card-restored-defaults', { path: screenshot, contentType: 'image/png' })
  await card.getByTestId('oauth-apply').click()
  await expect.poll(settings).not.toContain('oauth-smoke-second')

  // 3. Deleting the native row removes the profile; the host drops the grant.
  await nativeRow('Delete').click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Delete Grok (xai-oauth)', exact: true }).click()
  await expect(nativeRow('Edit')).toHaveCount(0)
  await expect(card).toHaveCount(0)
  const state = await page.request.post(rpcUrl, { data: { method: 'getState' } })
  expect(await state.json()).toEqual({ ok: true, value: { writable: true, providers: [] } })
  expect(settings()).not.toContain('xai')
}
