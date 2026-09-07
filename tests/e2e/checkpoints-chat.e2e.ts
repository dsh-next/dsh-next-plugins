/**
 * Live-model checkpoints e2e: the agent Write tool creates a file, then
 * Changes + Session-start rewind are asserted against that turn.
 *
 * Requires DSH_E2E_LIVE=1 and a real DEEPSEEK_API_KEY (scripts/e2e-mount.sh
 * otherwise uses a fake key and sends fail at API auth).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  clickWriteApprovals,
  dismissOnboarding,
  closeDialogs,
  expectComposerChromeHidden,
  listCheckpoints,
  openChangesTab,
  openWorkspaceSession,
  sendComposer,
  sessionIdOf,
  waitForTurnIdleAllowingWrites,
} from './checkpoints-helpers.ts'

const LIVE = process.env.DSH_E2E_LIVE === '1'
const workspaceA = process.env.DSH_E2E_WORKSPACE_A
if (!process.env.DSH_E2E_URL) {
  throw new Error('DSH_E2E_URL is not set — run through scripts/e2e-mount.sh')
}
if (!workspaceA) {
  throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh')
}

const MARKER = `LIVE-CHECKPOINT-${Date.now()}`
const FILE = `dsh-next-checkpoints-live-${Date.now()}.txt`

function abs(): string {
  return join(workspaceA, FILE)
}

function row(page: Page, turn: number) {
  return page.locator(`[data-testid="dsh-next-checkpoints-row"][data-turn="${turn}"]`)
}

test('live chat Write is captured, listed, and undone by Session start rewind', async ({ page }) => {
  test.skip(!LIVE, 'set DSH_E2E_LIVE=1 and a real DEEPSEEK_API_KEY')
  test.setTimeout(300_000)
  try {
    await page.goto(process.env.DSH_E2E_URL!, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
    await dismissOnboarding(page)
    await closeDialogs(page)
    await openWorkspaceSession(page, 'workspace-a')
    await clickWriteApprovals(page)

    await sendComposer(page, [
      `Create a new file named ${FILE} in the workspace root.`,
      `Write exactly this single line as the file contents: ${MARKER}`,
      'Use the Write tool. Do not modify any other files.',
    ].join(' '))
    await waitForTurnIdleAllowingWrites(page, 180_000)

    await expect.poll(() => existsSync(abs()) ? readFileSync(abs(), 'utf8') : '', {
      timeout: 30_000,
    }).toContain(MARKER)

    await openChangesTab(page)
    await expectComposerChromeHidden(page)
    const sessionId = await sessionIdOf(page)
    const listed = await listCheckpoints(page, sessionId)
    expect(listed.checkpoints.some((item) => item.turn === 0)).toBe(true)
    expect(listed.checkpoints.some((item) => item.turn >= 1)).toBe(true)

    await expect(row(page, 0)).toBeVisible()
    await expect(row(page, 0)).toContainText('Session start')
    const later = listed.checkpoints.filter((item) => item.turn >= 1)
    const last = later[later.length - 1]!
    await row(page, last.turn).click()
    const liveFile = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: FILE })
    await expect(liveFile).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('dsh-next-checkpoints-file-kind')).toHaveText('Created')
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toHaveCount(0)
    await liveFile.click()
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText(MARKER)
    await page.keyboard.press('Escape')

    await row(page, 0).getByTestId('dsh-next-checkpoints-rewind').click()
    const modal = page.getByTestId('dsh-next-checkpoints-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('session start')
    const confirm = page.getByTestId('dsh-next-checkpoints-confirm')
    await confirm.click()
    await expect(confirm).toHaveText('Restore this checkpoint')
    await confirm.click()
    await expect(modal).toHaveCount(0, { timeout: 15_000 })
    await openChangesTab(page)
    await expect(page.getByTestId('dsh-next-checkpoints-banner')).toBeVisible()
    await expect.poll(() => existsSync(abs()) ? 'present' : 'missing', { timeout: 15_000 }).toBe('missing')
    await expect(row(page, last.turn)).toHaveCount(0)
    await expect(row(page, 0)).toBeVisible()
  } finally {
    rmSync(abs(), { force: true })
  }
})
