import type { Page } from '@playwright/test'
import { dismissOnboarding } from './checkpoints-helpers.ts'

export async function openPluginCard(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      const card = page.locator('[data-plugin-item]').filter({ hasText: title }).first()
      // The global Plugins button is always visible, so the requested card is
      // the state signal for whether its management page is already open.
      if (!(await card.isVisible().catch(() => false))) {
        await page.getByRole('navigation', { name: 'Global panels' })
          .getByRole('button', { name: 'Plugins', exact: true }).click({ force: true })
      }
      await card.waitFor({ state: 'visible', timeout: 4000 })
      await card.getByRole('button').first().click({ force: true })
      return
    } catch {
      // A dialog may have re-appeared on a cold load; dismiss and retry.
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`could not open the ${title} card after retries`)
}

export async function openNotifierCard(page: Page): Promise<void> {
  await openPluginCard(page, 'Notifier')
}

export async function openSkillsSection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      const nav = page.getByRole('button', { name: 'Skills', exact: true }).first()
      if (!(await nav.isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
      }
      await nav.waitFor({ state: 'visible', timeout: 4000 })
      await nav.click({ force: true })
      await page.waitForTimeout(400)
      if (await page.getByTestId('skills-search').first().isVisible().catch(() => false)) return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error('could not open the Skills settings section after retries')
}
