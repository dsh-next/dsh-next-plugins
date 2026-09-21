import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { test, expect, BASE_URL, requireMountedPlugin } from './browser-fixture.ts'
import { dismissOnboarding, closeDialogs as closeOpenDialogs, openWorkspaceSession } from './checkpoints-helpers.ts'
import { unblankCurrentSession, waitForTurnIdle, runSlashCommand } from './git-helpers.ts'

interface WorkspaceStorageDoc {
  readonly global: { readonly archivedSessionIds?: readonly string[] }
  readonly tables: { readonly workspaces: Record<string, { path: string; sessionIds: readonly string[] }> }
}

function readWorkspaceStorage(dshHome: string): WorkspaceStorageDoc {
  return JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8')) as WorkspaceStorageDoc
}


test.beforeEach(async ({ page }) => {
  requireMountedPlugin('reset')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
})

test('reset replaces the transcript and archives the old session', async ({ page }) => {
  const workspaceB = process.env.DSH_E2E_WORKSPACE_B
  const dshHome = process.env.DSH_HOME
  if (!workspaceB) {
    throw new Error('DSH_E2E_WORKSPACE_B is not set — run through scripts/e2e-mount.sh')
  }
  await dismissOnboarding(page)
  await closeOpenDialogs(page)
  await openWorkspaceSession(page, 'workspace-b')
  const pollution = `reset-e2e-${Date.now()}`
  await unblankCurrentSession(page, pollution)
  await waitForTurnIdle(page)
  await expect(page.getByText(pollution).first()).toBeVisible({ timeout: 15_000 })
  const archivedBefore = dshHome === undefined
    ? 0
    : (readWorkspaceStorage(dshHome).global.archivedSessionIds ?? []).length
  await runSlashCommand(page, 'reset')
  await expect(page.getByText(pollution)).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: test.info().outputPath('reset-after.png') })
  if (dshHome !== undefined) {
    await expect.poll(() => (readWorkspaceStorage(dshHome).global.archivedSessionIds ?? []).length, {
      timeout: 15_000,
    }).toBeGreaterThan(archivedBefore)
    const doc = readWorkspaceStorage(dshHome)
    const row = Object.values(doc.tables.workspaces).find((workspace) => workspace.path === workspaceB)
    expect(row, 'workspace-b should still be registered').toBeDefined()
    expect(row!.sessionIds.length).toBeGreaterThanOrEqual(2)
    const archived = new Set(doc.global.archivedSessionIds ?? [])
    expect(row!.sessionIds.some((id) => archived.has(id))).toBe(true)
  }
})
