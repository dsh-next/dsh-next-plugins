/** Real packed-sidebar regression: search navigation reveals nested and stock sessions. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeDialogs, dismissOnboarding, openWorkspaceSession, unblank } from './checkpoints-helpers.ts'
import { commitFile, confirmCreateName, initGitRepo, readRegistry, waitForCreateIdle } from './worktrees-helpers.ts'

test.use({ actionTimeout: 15_000 })

const baseUrl = process.env.DSH_E2E_URL
const workspaceA = process.env.DSH_E2E_WORKSPACE_A
if (!baseUrl || !workspaceA) throw new Error('Run through scripts/e2e-mount.sh with E2E_SPECS=tests/e2e/worktrees-sidebar.e2e.ts')

function sessionRow(page: Page, title: string): Locator {
  return page.locator('[role="treeitem"][aria-selected]').filter({ hasText: title })
}

async function renameCurrentSession(page: Page, title: string): Promise<void> {
  const current = page.locator('[role="treeitem"][aria-selected="true"]')
  await expect(current).toHaveCount(1)
  await current.hover()
  await current.getByRole('button', { name: /^Session actions for / }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename session' })
  await dialog.getByRole('textbox', { name: 'Session name' }).fill(title)
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(sessionRow(page, title)).toHaveAttribute('aria-selected', 'true')
}

async function searchAndReveal(page: Page, title: string): Promise<Locator> {
  const search = page.getByRole('button', { name: 'Search sessions', exact: true })
  await search.click()
  const input = page.getByPlaceholder('Search sessions...', { exact: true })
  await input.fill(title)
  const results = page.getByRole('tree', { name: 'Search results' })
  await expect(results).toBeVisible()
  await results.getByRole('treeitem').filter({ hasText: title }).click()
  await expect(input).toHaveValue('')
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(results).toHaveCount(0)
  const selected = sessionRow(page, title)
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toBeInViewport({ ratio: 0.5 })
  return selected
}

async function pickView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'View options', exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

test('search reveals collapsed worktree overflow and preserves stock grouped/flat navigation', async ({ page }) => {
  test.setTimeout(240_000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  initGitRepo(workspaceA)
  commitFile(workspaceA, 'seed.txt', 'sidebar reveal fixture\n', 'sidebar fixture')
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.emulateMedia({ colorScheme: 'dark' })
  // Onboarding can arrive after the sidebar; dismiss it even during actionability checks.
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' })
  await page.addLocatorHandler(notice, async () => {
    await notice.getByRole('button', { name: 'Continue', exact: true }).click()
  })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await closeDialogs(page)

  // Create through the plugin's real modal and stock workspace/session services.
  const create = page.locator('[data-dshx-create$="workspace-a"]')
  const harbor = page.getByRole('treeitem').filter({ has: create })
  await expect(harbor).toBeVisible({ timeout: 20_000 })
  await harbor.hover()
  await create.click()
  await confirmCreateName(page, 'aurora-search')
  await waitForCreateIdle(page)
  const cluster = page.getByRole('treeitem').filter({
    has: page.locator('[data-dshx-worktree="aurora-search"]'),
  })
  await expect(cluster).toBeVisible({ timeout: 20_000 })
  const targetTitle = 'Aurora hidden search target'
  for (let index = 0; index < 8; index += 1) {
    if (index > 0) {
      await cluster.hover()
      await cluster.getByRole('button', { name: 'New session in aurora-search', exact: true }).click()
    }
    // Keyless sends still record a turn, avoiding blank-session replacement/sweep.
    await unblank(page, `sidebar fixture turn ${index}`)
    await renameCurrentSession(page, index === 0 ? targetTitle : `Aurora review ${index}`)
  }
  // The registry owns one worktree claim; extra chats share its workspace.
  await expect.poll(() => readRegistry(workspaceA).bindings.length).toBe(1)
  await expect(sessionRow(page, targetTitle)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show 3 more sessions', exact: true })).toBeVisible()

  // Explicitly closed groups must reopen for search, unlike ordinary navigation.
  await cluster.click()
  await expect(cluster).toHaveAttribute('aria-expanded', 'false')
  await harbor.click()
  await expect(harbor).toHaveAttribute('aria-expanded', 'false')
  await searchAndReveal(page, targetTitle)
  await expect(harbor).toHaveAttribute('aria-expanded', 'true')
  await expect(cluster).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Show less', exact: true })).toBeVisible()
  await expect(page.locator('[role="treeitem"].dshx-clusterSession')).toHaveCount(8)

  mkdirSync(join('docs', 'screenshots'), { recursive: true })
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '')
  await page.screenshot({ path: join('docs', 'screenshots', 'worktrees-search-reveal-dark.png'), animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme')
  await page.screenshot({ path: join('docs', 'screenshots', 'worktrees-search-reveal-light.png'), animations: 'disabled' })

  // The revealed row is a normal stock session: its menu is unchanged.
  const selected = sessionRow(page, targetTitle)
  await selected.hover()
  await selected.getByRole('button', { name: `Session actions for ${targetTitle}`, exact: true }).click()
  for (const label of ['Rename', 'Fork session', 'Archive session']) {
    await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')

  // Stock (non-worktree) groups and the flat view retain upstream reveal behavior.
  await openWorkspaceSession(page, 'workspace-b')
  await unblank(page, 'ordinary workspace search fixture')
  const ordinaryTitle = 'Harbor ordinary search target'
  await renameCurrentSession(page, ordinaryTitle)
  const ordinary = page.getByRole('treeitem').filter({
    has: page.locator('button[aria-label="New session in workspace-b"]'),
  })
  await ordinary.click()
  await expect(ordinary).toHaveAttribute('aria-expanded', 'false')
  await searchAndReveal(page, ordinaryTitle)
  await expect(ordinary).toHaveAttribute('aria-expanded', 'true')

  await pickView(page, 'In one list')
  await expect(cluster).toHaveCount(0)
  await searchAndReveal(page, targetTitle)
  await searchAndReveal(page, ordinaryTitle)
  await pickView(page, 'WorkSpace')
  await searchAndReveal(page, targetTitle)
  await expect(cluster).toBeVisible()
  expect(pageErrors).toEqual([])
})
