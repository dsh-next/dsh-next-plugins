import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { test, expect, BASE_URL, requireMountedPlugin } from './browser-fixture.ts'
import { dismissOnboarding, closeDialogs, openWorkspaceSession } from './checkpoints-helpers.ts'
import { git, gitOk, openGitPanel } from './git-helpers.ts'
import { createFixture } from '../../packages/dsh-next-git/tests/git-fixture.ts'

test.beforeEach(async ({ page }) => {
  requireMountedPlugin('git')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
})

test('Git history, changes, worktrees and conflict recovery reflect real repository state', async ({ page }) => {
  test.setTimeout(360_000)
  // Deterministic drafting UI coverage, without paid provider calls. Host stream
  // and repository-context contracts are exercised separately by unit tests.
  let historyReads = 0
  await page.route('**/dsh-next-git/rpc', async route => {
    const request = route.request().postDataJSON()
    if (request.method === 'getHistory') historyReads += 1
    if (request.method !== 'draftInput') return route.continue()
    await route.fulfill({ json: { ok: true, value: 'Generated summary\n\nGenerated description' } })
  })
  const workspaceA = process.env.DSH_E2E_WORKSPACE_A
  if (!workspaceA) {
    throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh')
  }
  // The same deterministic fixture the unit suites use, seeded into the
  // workspace the smoke already registered as a session root.
  const fixture = createFixture('untracked', { dir: workspaceA })
  try {
    // Rewrite previews select two non-root commits; the base fixture has only two
    // commits total. Own that prerequisite instead of selecting its root commit.
    fixture.commit('history-seed.txt', 'history preview fixture\n', 'feat: history preview seed')
    fixture.write('src/git-panel/store.ts', [
      'export interface PanelState {',
      '  readonly branch: string',
      '}',
      '',
      'export function branchOf(state: PanelState): string {',
      '  return state.branch',
      '}',
      '',
    ].join('\n'))
    fixture.write('src/app.ts', 'export const app = 2\n')
    await dismissOnboarding(page)
    await closeDialogs(page)
    await openWorkspaceSession(page, 'workspace-a')

    await openGitPanel(page)
    const panel = page.locator('[data-dsh-git="panel"]')
    await expect(page.locator('[data-dsh-git="branch-button"]')).toContainText('main', { timeout: 20_000 })
    // The tab chip never goes blank, however early the seat renders.
    await expect(page.locator('[data-dsh-git="chip-title"]')).toHaveText(/\S/, { timeout: 20_000 })
    // A registered seat that renders nothing is an empty pane, and a crash
    // that escapes the plugin retires the registration for the rest of the
    // page's life. The body must always say something, and the seat must
    // never be left as a dead cell.
    await expect
      .poll(async () => (await page.locator('[data-dsh-git="body"]').textContent())?.trim() ?? '', {
        timeout: 20_000,
      })
      .not.toBe('')
    await expect(page.locator('[data-slot-error="sidebar.right.pane.tab"]')).toHaveCount(0)

    const syncShortcut = panel.locator('[data-dsh-git="sync"]')
    await expect(syncShortcut).toBeEnabled()
    const syncBox = (await syncShortcut.boundingBox())!
    const branchBox = (await panel.locator('[data-dsh-git="branch-button"]').boundingBox())!
    expect(syncBox.x + syncBox.width).toBeLessThanOrEqual(branchBox.x)
    await page.emulateMedia({ colorScheme: 'dark' })
    await panel.locator('header').screenshot({ path: test.info().outputPath('git-header-sync.png') })
    await syncShortcut.click()
    await expect(page.locator('[data-dsh-git="repository-command"][data-command="sync"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The branch chip opens a ref quick pick rather than a dropdown: one
    // filter over grouped rows, each carrying its tip commit's detail.
    await panel.locator('[data-dsh-git="branch-button"]').click()
    const picker = page.locator('[data-dsh-git="ref-picker"]')
    await expect(picker).toBeVisible()
    const refFilter = picker.locator('[data-dsh-git="ref-filter"]')
    await expect(refFilter).toHaveAttribute('placeholder', 'Select a branch or tag to checkout')
    const mainRow = picker.locator('[data-dsh-git="ref-row"][data-ref="branch:main"]')
    await expect(mainRow).toBeVisible()
    await expect(mainRow).toContainText('branches')
    // The current marker is a check glyph labelled for assistive technology.
    await expect(mainRow.locator('[aria-label="Current branch"]')).toHaveCount(1)
    // Two lines per row: the name with its drift and age, then the tip
    // commit's author, hash and subject, dot-separated.
    await expect(mainRow).toContainText('·')
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('git-branch-picker-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('git-branch-picker-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    // No dropdown menu survives behind the card.
    await expect(page.getByRole('menu')).toHaveCount(0)
    await refFilter.fill('zzz-no-such-ref')
    await expect(picker.locator('[data-dsh-git="ref-row"]')).toHaveCount(0)
    await expect(picker.locator('[data-dsh-git="ref-action"][data-action="create-query"]')).toBeVisible()
    await refFilter.fill('')
    await picker.locator('[data-dsh-git="ref-action"][data-action="create"]').click()
    // The name step is the card's second page, not a stacked dialog.
    await expect(page.locator('[data-dsh-git="branch-create"] [data-dsh-git="branch-name"]')).toBeVisible()
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('git-branch-create-step.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Picking the checked-out branch is a no-op that closes the card, so the
    // fixture's checkout never moves mid-run.
    await panel.locator('[data-dsh-git="branch-button"]').click()
    await expect(picker).toBeVisible()
    await mainRow.click()
    await expect(picker).toHaveCount(0)
    // The composer carries the same branch: one compact chip in its tool row
    // that opens the very same picker.
    const composerChip = page.locator('[data-dsh-git="composer-branch"]')
    await expect(composerChip).toBeVisible({ timeout: 20_000 })
    await expect(composerChip).toHaveText('main')
    await composerChip.click()
    await expect(page.locator('[data-dsh-git="ref-picker"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-dsh-git="ref-picker"]')).toHaveCount(0)
    // Repository commands use the native nested menu, never a tabbed workspace.
    const repositoryTrigger = panel.locator('[data-dsh-git="repository-menu"]')
    await repositoryTrigger.click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.locator('[data-dsh-git="repository-workspace"]')).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Branches', exact: true }).hover()
    await expect(page.getByRole('menuitem', { name: 'Create branch', exact: true })).toBeVisible()
    const submenu = page.getByRole('menuitem', { name: 'Create branch', exact: true }).locator('..')
    // The nested panel is positioned a frame after it becomes visible, so read the
    // settled box — the same wait the command-sample loop below relies on.
    await expect.poll(async () => {
      const bounds = await submenu.boundingBox()
      return bounds !== null
        && bounds.x >= 0
        && bounds.x + bounds.width <= page.viewportSize()!.width
    }, { timeout: 5_000 }).toBe(true)
    await page.screenshot({ path: test.info().outputPath('repository-menu.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: test.info().outputPath('repository-menu-dark.png') })
    const branchAction = page.getByRole('menuitem', { name: 'Create branch', exact: true })
    const receivesPointer = await branchAction.evaluate(node => {
      const bounds = node.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      return hit !== null && node.contains(hit)
    })
    expect(receivesPointer, 'nested menu action should receive pointer events at its center').toBe(true)
    await branchAction.click()
    const repositoryDialog = page.locator('[data-dsh-git="repository-workspace"]')
    await expect(repositoryDialog).toHaveAttribute('data-action', 'branch-create')
    await expect(repositoryDialog.getByRole('tab')).toHaveCount(0)
    await expect(repositoryDialog.getByRole('textbox')).toHaveCount(1)
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('repository-create.png') })
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await repositoryTrigger.click()
    await page.getByRole('menuitem', { name: 'Stash', exact: true }).and(page.locator('[aria-haspopup]')).hover()
    await page.getByRole('menuitem', { name: 'Apply stash', exact: true }).click()
    await expect(repositoryDialog).toHaveAttribute('data-action', 'stash-apply')
    await expect(repositoryDialog.getByRole('textbox')).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    // The rename dialog has aligned fields and just one compact action.
    await repositoryTrigger.click()
    await page.getByRole('menuitem', { name: 'Branches', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Rename branch', exact: true }).click()
    await expect(repositoryDialog).toHaveAttribute('data-action', 'branch-rename')
    await expect(repositoryDialog).not.toContainText('workspace-a')
    await expect(repositoryDialog.getByRole('button')).toHaveCount(1)
    const renameDialog = page.getByRole('dialog')
    await renameDialog.getByRole('textbox', { name: 'New name' }).fill('feature/navigation')
    await expect(renameDialog.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled()
    const fields = await repositoryDialog.locator('select, input').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x, width: rect.width }
    }))
    expect(fields[0]).toEqual(fields[1])
    await renameDialog.screenshot({ path: test.info().outputPath('repository-rename-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
    await renameDialog.screenshot({ path: test.info().outputPath('repository-rename-light.png') })
    await page.keyboard.press('Escape')
    await expect(repositoryDialog).toHaveCount(0)

    // Every group opens a focused dialog, and long nested cards stay on screen.
    const commandSamples = [
      ['Commit', 'Commit all (signed off)', 'commit-command-dialog'],
      ['Changes', 'Discard all changes', 'local-command'],
      ['Pull, push', 'Push (force with lease)', 'repository-command'],
      ['Branches', 'Merge…', 'repository-command'],
      ['Remote', 'Add remote…', 'repository-command'],
      ['Stash', 'View stash…', 'repository-command'],
      ['Tags', 'Create tag…', 'repository-command'],
    ] as const
    for (const [group, command, marker] of commandSamples) {
      await repositoryTrigger.click()
      await page.getByRole('menuitem', { name: group, exact: true }).and(page.locator('[aria-haspopup]')).hover()
      const leaf = page.getByRole('menuitem', { name: command, exact: true })
      await expect(leaf).toBeVisible()
      await expect.poll(async () => {
        const bounds = await leaf.locator('..').boundingBox()
        return bounds !== null
          && bounds.x >= 0
          && bounds.y >= 0
          && bounds.x + bounds.width <= page.viewportSize()!.width
          && bounds.y + bounds.height <= page.viewportSize()!.height
      }, { timeout: 5_000 }).toBe(true)
      const card = await leaf.locator('..').boundingBox()
      expect(card!.x).toBeGreaterThanOrEqual(0)
      expect(card!.y).toBeGreaterThanOrEqual(0)
      expect(card!.x + card!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      expect(card!.y + card!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      await leaf.click()
      await expect(page.locator(`[data-dsh-git="${marker}"]`)).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('tab')).toHaveCount(0)
      if (group === 'Commit') {
        await expect(page.getByRole('dialog')).toContainText('Commit all (signed off)')
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.getByRole('dialog').screenshot({ path: test.info().outputPath('repository-commit-signoff.png') })
        await page.emulateMedia({ colorScheme: 'light' })
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    // Mutations below touch only this isolated fixture; prove the UI RPC wiring.
    await repositoryTrigger.click()
    await page.getByRole('menuitem', { name: 'Remote', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Add remote…', exact: true }).click()
    await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill('backup')
    await page.getByRole('dialog').getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://example.test/repository.git')
    await page.getByRole('dialog').getByRole('button', { name: 'Preview action', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'Completed' })).toBeVisible()
    await expect(page.locator('[data-dsh-git="repository-command"] > p[role="status"]')).toHaveCount(0)
    expect(git(workspaceA, ['remote', 'get-url', 'backup']).trim()).toBe('https://example.test/repository.git')
    await page.keyboard.press('Escape')
    await repositoryTrigger.click()
    await page.getByRole('menuitem', { name: 'Tags', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Create tag…', exact: true }).click()
    await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill('menu-check')
    await page.getByRole('dialog').getByRole('button', { name: 'Preview action', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'Completed' })).toBeVisible()
    await expect(page.locator('[data-dsh-git="repository-command"] > p[role="status"]')).toHaveCount(0)
    expect(git(workspaceA, ['tag', '--list', 'menu-check']).trim()).toBe('menu-check')
    await page.keyboard.press('Escape')
    // Restore the fixture's remote/tag inventory for the remaining existing checks.
    gitOk(workspaceA, ['remote', 'remove', 'backup'])
    gitOk(workspaceA, ['tag', '-d', 'menu-check'])

    // A tab restored after a harness restart reads state before the host has
    // loaded its session. That condition must arrive named and retryable, not
    // as a terminal "not a git repository" the panel latches forever.
    const sessionless = await page.evaluate(async () => {
      const response = await fetch('/dsh-next-git/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getState', args: { sessionId: 'e2e-session-that-was-never-opened' } }),
      })
      return (await response.json()) as { ok?: boolean; failure?: { code?: string }; degraded?: unknown }
    })
    expect(sessionless.ok).toBe(false)
    expect(sessionless.failure?.code).toBe('session-not-ready')
    expect(sessionless.degraded).toBeNull()

    // The three sections ship collapsed, and none of the work above should pay
    // for commit history. Opening History is the demand-load trigger.
    expect(historyReads).toBe(0)
    const sectionNames = ['changes', 'worktrees', 'history'] as const
    await expect(page.locator('[data-dsh-git="section-toggle"]')).toHaveCount(3)
    for (const section of sectionNames) {
      await expect(page.locator(`[data-dsh-git="section-toggle"][data-section="${section}"]`)).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    }
    const openSection = async (section: typeof sectionNames[number]): Promise<void> => {
      const toggle = page.locator(`[data-dsh-git="section-toggle"][data-section="${section}"]`)
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
      for (const other of sectionNames) {
        await expect(page.locator(`[data-dsh-git="section-toggle"][data-section="${other}"]`))
          .toHaveAttribute('aria-expanded', String(other === section))
      }
      await expect(panel.locator('[data-dsh-git="section-body"]')).toHaveCount(1)
    }
    for (const section of sectionNames) await openSection(section)
    await expect.poll(() => historyReads).toBeGreaterThan(0)

    const history = panel.locator('[data-dsh-git="history"]')
    const commitRows = history.locator('[data-dsh-git="commit-row"]')
    await expect(commitRows.first()).toBeVisible()
    await expect(history.locator('select, input')).toHaveCount(0)
    const reloadHistory = history.locator('[data-dsh-git="history-refresh"]')
    await expect(reloadHistory).toHaveAccessibleName('Refresh history')
    await expect(reloadHistory).toHaveText('')
    await reloadHistory.click()
    await expect(reloadHistory).toBeEnabled()
    await expect(commitRows.first()).toBeVisible()

    // Ordinary clicks build the selection, and a row's checkout icon reveals
    // on hover or keyboard focus rather than sitting on screen at all times.
    const selects = history.locator('[data-dsh-git="commit-select"]')
    const rowActions = commitRows.nth(0).locator('[data-dsh-git="commit-checkout"]').locator('..')
    await expect(rowActions).toHaveCSS('opacity', '0')
    await commitRows.nth(0).hover()
    await expect(rowActions).toHaveCSS('opacity', '1')
    // Reading a commit is the Inspect command's job, not a second row icon.
    await expect(history.locator('[data-dsh-git="commit-details"]')).toHaveCount(0)
    await selects.nth(0).click()
    await expect(selects.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(commitRows.nth(0)).toHaveAttribute('data-selected', 'true')
    await expect(history).not.toContainText('1 selected')
    await expect(history.getByRole('button', { name: 'Inspect', exact: true })).toBeEnabled()
    const commands = ['Squash', 'Fixup', 'Reorder', 'Reword', 'Cherry-pick', 'Revert'] as const
    for (const name of commands) await expect(history.getByRole('button', { name, exact: true })).toBeVisible()
    // A single commit cannot be squashed, and the disabled control says why.
    await expect(history.getByRole('button', { name: 'Squash', exact: true })).toBeDisabled()

    // Inspect opens the read-only details modal: file list beside the diff.
    await history.getByRole('button', { name: 'Inspect', exact: true }).click()
    const detailsModal = page.locator('[data-dsh-git="commit-details-modal"]')
    await expect(detailsModal).toBeVisible({ timeout: 20_000 })
    const commitFiles = detailsModal.locator('[data-dsh-git="commit-file"]')
    await expect(commitFiles.first()).toHaveAttribute('aria-current', 'true')
    await expect(detailsModal.locator('[data-dsh-git="commit-diff"]')).toBeVisible()
    if (await commitFiles.count() > 1) {
      await commitFiles.nth(1).click()
      await expect(commitFiles.nth(1)).toHaveAttribute('aria-current', 'true')
      await expect(commitFiles.nth(0)).not.toHaveAttribute('aria-current', 'true')
    }
    await page.getByRole('button', { name: 'Close commit details', exact: true }).click()
    await expect(detailsModal).toHaveCount(0)

    // Compare needs exactly two commits and renders its own modal.
    await expect(history.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled()
    await selects.nth(1).click()
    await expect(history).not.toContainText('2 selected')
    await history.getByRole('button', { name: 'Compare', exact: true }).click()
    const compareModal = page.locator('[data-dsh-git="compare-modal"]')
    await expect(compareModal).toBeVisible({ timeout: 20_000 })
    await expect(compareModal.locator('select')).toHaveCount(2)
    await page.getByRole('button', { name: 'Close comparison', exact: true }).click()
    await expect(compareModal).toHaveCount(0)

    // Each command opens its own small modal that previews the exact plan and
    // only writes when its primary button is pressed. The smoke never applies.
    await expect(history.getByRole('button', { name: 'Fixup', exact: true })).toBeEnabled()
    await history.getByRole('button', { name: 'Fixup', exact: true }).click()
    const actionModal = page.locator('[data-dsh-git="history-action-modal"][data-action="fixup"]')
    await expect(actionModal).toBeVisible({ timeout: 20_000 })
    await expect(actionModal.locator('[data-dsh-git="action-order"] li')).toHaveCount(2)
    await expect(actionModal.getByRole('button', { name: 'Fixup 2 commits', exact: true })).toBeVisible()
    await expect(actionModal.locator('code')).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(actionModal).toHaveCount(0)
    await history.getByRole('button', { name: 'Squash', exact: true }).click()
    const squashModal = page.locator('[data-dsh-git="history-action-modal"][data-action="squash"]')
    await expect(squashModal.getByLabel('Summary', { exact: true })).toBeEnabled()
    await expect(squashModal.getByLabel('Description', { exact: true })).toBeVisible()
    await expect(squashModal.locator('[data-dsh-git="action-order"]')).toHaveCount(0)
    const ai = squashModal.locator('[data-dsh-git="inline-message-ai"]')
    await squashModal.getByLabel('Summary', { exact: true }).fill('Old summary')
    await squashModal.getByLabel('Description', { exact: true }).fill('Old description')
    await expect(ai.getByRole('button')).toBeEnabled()
    await ai.getByRole('button').click()
    await expect(squashModal.getByLabel('Summary', { exact: true })).toHaveValue('Generated summary')
    await expect(squashModal.getByLabel('Description', { exact: true })).toHaveValue('Generated description')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('history-inline-draft.png') })
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(squashModal).toHaveCount(0)
    // The selection survives the modal, and clearing it disables every command.
    await expect(selects.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await history.getByRole('button', { name: 'Clear selection', exact: true }).click()
    await expect(selects.nth(0)).toHaveAttribute('aria-pressed', 'false')
    await expect(history.getByRole('button', { name: 'Revert', exact: true })).toBeDisabled()

    // Capture only the column, cropped to the control the README shows, in
    // the dark theme the package READMEs use.
    await page.emulateMedia({ colorScheme: 'dark' })
    const capture = async (name: string): Promise<void> => {
      const box = await panel.boundingBox()
      if (box === null) return
      await page.screenshot({
        path: test.info().outputPath(`git-${name}.png`),
        clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 860) },
      })
    }

    // Changes: the modified and untracked files are listed, and opening one
    // renders a native diff.
    await openSection('changes')
    const row = page.locator('[data-dsh-git="row"][data-path="src/git-panel/store.ts"]')
    await expect(row).toBeVisible({ timeout: 20_000 })
    await capture('changes')
    // A row opens the change view in a tab of its own: the whole file,
    // highlighted, with the changed lines marked and its own refresh action.
    await row.click()
    const changeTab = page.locator('[data-dsh-git="change-file"]')
    await expect(changeTab).toBeVisible({ timeout: 20_000 })
    await expect(changeTab).toHaveAttribute('data-side', 'unstaged')
    await expect(changeTab.locator('[data-dsh-git="change-file-path"]')).toContainText('store.ts')
    await expect(changeTab.locator('[data-dsh-git="change-file-code"] span.line').first()).toBeVisible({ timeout: 20_000 })
    // The view opens on the changes: the summary strip is gone, unchanged
    // stretches are hidden, and the toggle reveals the whole file.
    // The chip carries the branch glyph, so the tab reads as Source control's
    // own view of the change rather than a plain file preview.
    const changeChip = page.locator('[data-dsh-git="change-file-chip"]')
    await expect(changeChip).toHaveText('store.ts')
    await expect(changeChip.locator('xpath=preceding-sibling::*[1][name()="svg"]')).toHaveCount(1)
    await expect(changeTab.locator('[data-dsh-git="change-file-summary"]')).toHaveCount(0)
    await expect(changeTab.locator('span.line[data-change="added"]').first()).toBeVisible()
    await expect(changeTab.locator('[data-dsh-git="change-file-changed-only"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(changeTab.locator('[data-dsh-git="change-file-hunks"]')).toBeEnabled()
    // This file is new, so every line changed and none is hidden; the toggle
    // still reports the mode it is in.
    await changeTab.locator('[data-dsh-git="change-file-changed-only"]').click()
    await expect(changeTab.locator('[data-dsh-git="change-file-changed-only"]')).toHaveAttribute('aria-pressed', 'false')
    await changeTab.locator('[data-dsh-git="change-file-changed-only"]').click()
    await expect(changeTab.locator('[data-dsh-git="change-file-changed-only"]')).toHaveAttribute('aria-pressed', 'true')

    // A change inside a long file is where the default view earns its keep: the
    // unchanged stretches are hidden, and the toggle brings the file back.
    const longLines = Array.from({ length: 400 }, (_, index) => `export const value${index + 1} = ${index + 1}`)
    fixture.write('src/long.ts', longLines.join('\n') + '\n')
    fixture.gitOk(['add', '--', 'src/long.ts'])
    fixture.gitOk(['commit', '-q', '-m', 'feat: long file'])
    fixture.write('src/long.ts', [...longLines.slice(0, 14), 'export const value15 = 150', ...longLines.slice(15)].join('\n') + '\n')
    // Back to the panel's own tab before touching its rows.
    await page.getByRole('tab', { name: /Source control/ }).first().click()
    await page.locator('[data-dsh-git="refresh"]').click()
    const longRow = page.locator('[data-dsh-git="row"][data-path="src/long.ts"]')
    await expect(longRow).toBeVisible({ timeout: 20_000 })
    await longRow.click()
    const longTab = page.locator('[data-dsh-git="change-file"]')
    await expect(longTab.locator('[data-dsh-git="change-file-path"]')).toContainText('long.ts', { timeout: 20_000 })
    await expect(longTab.locator('span.line[data-hidden]').first()).toBeAttached({ timeout: 20_000 })
    const visibleBefore = await longTab.locator('span.line:not([data-hidden])').count()
    expect(visibleBefore).toBe(7)
    await expect(longTab.locator('span.line[data-gap]')).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('change-file-changes-only.png') })
    await longTab.locator('[data-dsh-git="change-file-changed-only"]').click()
    await expect(longTab.locator('span.line[data-hidden]')).toHaveCount(0)
    expect(await longTab.locator('span.line').count()).toBe(400)
    await page.screenshot({ path: test.info().outputPath('change-file-whole.png') })
    // The whole file is taller than the pane, so the code surface scrolls
    // inside the tab: the language banner stays put and the lines move.
    const scrolls = await page.evaluate(() => {
      const content = document.querySelector('[data-dsh-git="change-file-code"] [data-code-block-content]')
      if (content === null) return null
      const before = content.scrollTop
      content.scrollTop = 400
      return { before, after: content.scrollTop, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight }
    })
    expect(scrolls?.scrollHeight ?? 0).toBeGreaterThan(scrolls?.clientHeight ?? 0)
    expect(scrolls?.after).toBeGreaterThan(0)
    await page.screenshot({ path: test.info().outputPath('change-file-scrolled.png') })

    // File review already opens a dedicated tab; rows keep only write actions.
    await page.getByRole('tab', { name: /Source control/ }).first().click()
    await expect(page.locator('[data-dsh-git="panel"]')).toBeVisible({ timeout: 20_000 })
    const rowAgain = page.locator('[data-dsh-git="row"][data-path="src/git-panel/store.ts"]')
    await expect(rowAgain).toBeVisible({ timeout: 20_000 })
    await rowAgain.hover()
    await expect(panel.locator('[data-dsh-git="row-hunks"]')).toHaveCount(0)
    await rowAgain.screenshot({ path: test.info().outputPath('change-row-actions.png') })

    // Stage through the panel, then read the index back from disk.
    await row.hover()
    await row.locator('button[aria-label="Stage"]').click()
    await expect.poll(() => git(workspaceA, ['diff', '--cached', '--name-only']), { timeout: 15_000 })
      .toContain('src/git-panel/store.ts')

    // With a staged entry the header's unstage action appears beside the two
    // writes; capture it so the stage/unstage glyph pair is on record.
    await page.screenshot({ path: test.info().outputPath('changes-staged.png') })

    // Both writes are buttons that open their own dialog; nothing is written
    // until the dialog's own action is pressed.
    const commitOpen = page.locator('[data-dsh-git="commit-open"]')
    const stashOpen = page.locator('[data-dsh-git="stash-open"]')
    await expect(commitOpen).toBeEnabled()
    await expect(stashOpen).toBeEnabled()
    await commitOpen.click()
    const commitDialog = page.locator('[data-dsh-git="commit-dialog"]')
    await expect(commitDialog).toBeVisible({ timeout: 20_000 })
    const message = commitDialog.getByRole('textbox', { name: 'Commit message', exact: true })
    await expect(commitDialog.getByRole('textbox')).toHaveCount(1)
    await message.fill('Existing summary\n\nExisting description')
    const draftButton = commitDialog.locator('[data-dsh-git="draft-message"]')
    const inputBounds = (await message.boundingBox())!
    const buttonBounds = (await draftButton.boundingBox())!
    expect(buttonBounds.y).toBeGreaterThanOrEqual(inputBounds.y)
    expect(buttonBounds.y - inputBounds.y).toBeLessThan(12)
    expect(buttonBounds.x + buttonBounds.width).toBeLessThan(inputBounds.x + inputBounds.width)
    expect(buttonBounds.x).toBeGreaterThan(inputBounds.x + inputBounds.width - 48)
    expect(await message.evaluate(node => parseFloat(getComputedStyle(node).paddingRight))).toBeGreaterThanOrEqual(44)
    await draftButton.click()
    await expect(message).toHaveValue('Generated summary\n\nGenerated description')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await message.hover()
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('commit-inline-draft.png') })
    const subject = `feat: add the git panel store`
    await message.fill(subject + '\n\nThrough the commit dialog.')
    await page.screenshot({ path: test.info().outputPath('commit-dialog.png') })
    await page.locator('[data-dsh-git="commit-submit"]').click()
    await expect(commitDialog).toHaveCount(0)
    await expect.poll(() => git(workspaceA, ['log', '-1', '--pretty=%s']).trim(), { timeout: 20_000 })
      .toBe(subject)
    expect(git(workspaceA, ['log', '-1', '--pretty=%b']).trim()).toBe('Through the commit dialog.')

    // Stash: stage a change of its own, name it in the dialog, then read git's
    // own list. A dedicated file keeps the change assertions below intact.
    fixture.write('src/stash-me.ts', 'export const stashMe = 1\n')
    await page.locator('[data-dsh-git="refresh"]').click()
    const stashRow = page.locator('[data-dsh-git="row"][data-path="src/stash-me.ts"]')
    await expect(stashRow).toBeVisible({ timeout: 20_000 })
    await stashRow.hover()
    await stashRow.locator('button[aria-label="Stage"]').click()
    await expect.poll(() => git(workspaceA, ['diff', '--cached', '--name-only']), { timeout: 15_000 })
      .toContain('src/stash-me.ts')
    await stashOpen.click()
    await expect(page.locator('[data-dsh-git="stash-dialog"]')).toBeVisible({ timeout: 20_000 })
    await page.locator('[data-dsh-git="stash-name"]').fill('wip: e2e stash')
    await page.screenshot({ path: test.info().outputPath('stash-dialog.png') })
    await page.locator('[data-dsh-git="stash-submit"]').click()
    await expect(page.locator('[data-dsh-git="stash-dialog"]')).toHaveCount(0)
    await expect.poll(() => git(workspaceA, ['stash', 'list']), { timeout: 20_000 }).toContain('wip: e2e stash')
    // Both buttons need staged work again.
    await expect(commitOpen).toBeDisabled()
    await expect(stashOpen).toBeDisabled()
    fixture.gitOk(['stash', 'drop'])
    // A stash takes every tracked modification, so restore the fixture change
    // the later assertions read.
    fixture.write('src/app.ts', 'export const app = 2\n')
    await page.locator('[data-dsh-git="refresh"]').click()

    // Worktree lifecycle: create one through the panel, then assert the
    // checkout, its branch and the local-only exclude entry on disk.
    await openSection('worktrees')
    const slug = `panel-${Date.now().toString(36)}`
    await page.locator('[data-dsh-git="worktree-name"]').fill(slug)
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => existsSync(join(workspaceA, '.worktrees', slug)), { timeout: 30_000 }).toBe(true)
    expect(gitOk(workspaceA, ['rev-parse', '--verify', `dsh-git/${slug}`])).toBe(true)
    expect(readFileSync(join(workspaceA, '.git', 'info', 'exclude'), 'utf8')).toContain('.worktrees/')
    const worktreeRow = page.locator('[data-dsh-git="worktree"]').filter({ hasText: slug })
    await expect(worktreeRow).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[role="treeitem"]').filter({ hasText: slug }).first()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: test.info().outputPath('created-worktree-sidebar.png') })
    // The row is named by the branch git reports, and its facts are measured
    // against a base the panel shows rather than an invisible default.
    await expect(worktreeRow).toContainText(`dsh-git/${slug}`)
    await expect(worktreeRow.locator('[data-dsh-git="worktree-meta"]')).toContainText('Merged into')
    await expect(page.locator('[data-dsh-git="worktree-base"]')).toContainText('main')
    await expect(page.locator('[data-dsh-git="worktree-source"]')).toBeVisible()

    // Every trailing control shares one right line: the section pill, a row's
    // status letter and a row's action button must land within 2px of each
    // other (the regression this guards: 100%-wide rows padding themselves
    // past the section bands).
    const rightInset = async (selector: string): Promise<number | null> => {
      const panelBox = await panel.boundingBox()
      const box = await page.locator(selector).first().boundingBox()
      return panelBox === null || box === null ? null : panelBox.x + panelBox.width - (box.x + box.width)
    }
    // The anchor row has to still be in the list when it is measured: the
    // file committed above is gone from the change list by now, so the
    // measurement uses the modified file that stays.
    await openSection('changes')
    const anchorRow = page.locator('[data-dsh-git="row"][data-path="src/app.ts"]')
    await expect(anchorRow).toBeVisible({ timeout: 20_000 })
    const insets = [
      await rightInset('[data-dsh-git="changes"] [data-dsh-git="section-count"]'),
      await rightInset('[data-dsh-git="row"][data-path="src/app.ts"] [data-dsh-git="status"]'),
    ]
    await openSection('history')
    insets.push(await rightInset('[data-dsh-git="commit-checkout"]'))
    expect(insets.every((inset) => inset !== null)).toBe(true)
    expect(Math.max(...insets.map((inset) => inset ?? 0)) - Math.min(...insets.map((inset) => inset ?? 0)))
      .toBeLessThanOrEqual(2)

    // Only one accordion opens at a time; closing it leaves all three folded.
    await openSection('worktrees')
    const worktreesToggle = page.locator('[data-dsh-git="section-toggle"][data-section="worktrees"]')
    await worktreesToggle.click()
    await expect(worktreesToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-dsh-git="worktree"]')).toHaveCount(0)
    await expect(panel.locator('[data-dsh-git="section-body"]')).toHaveCount(0)
    await worktreesToggle.click()
    await expect(worktreesToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(worktreeRow).toBeVisible()

    await worktreeRow.scrollIntoViewIfNeeded()
    await capture('worktrees')
    await worktreeRow.hover()
    await worktreeRow.getByRole('button', { name: 'Delete worktree', exact: true }).click()
    await page.locator('[data-dsh-git="confirm-proceed"]').click()
    await expect(worktreeRow).toHaveCount(0, { timeout: 20_000 })
    await expect(page.locator('[role="treeitem"]').filter({ hasText: slug })).toHaveCount(0, { timeout: 20_000 })
    expect(existsSync(join(workspaceA, '.worktrees', slug))).toBe(false)

    // History: the commit made above is listed with its actions, without a
    // remount (the panel re-reads the section after a commit).
    await openSection('history')
    await expect(page.locator('[data-dsh-git="commit-row"]').filter({ hasText: subject })).toBeVisible({ timeout: 20_000 })
    await page.locator('[data-dsh-git="history"]').scrollIntoViewIfNeeded()
    await capture('history')

    // Recovery state: leave a real conflicted merge behind, refresh the panel
    // and assert the banner names the operation.
    fixture.gitOk(['checkout', '-q', '-b', 'e2e-conflict'])
    fixture.commit('src/app.ts', 'export const app = 100\n', 'feat: conflict side')
    fixture.gitOk(['checkout', '-q', 'main'])
    fixture.commit('src/app.ts', 'export const app = 200\n', 'feat: main side')
    fixture.git(['merge', '--no-edit', 'e2e-conflict'])
    await page.locator('[data-dsh-git="refresh"]').click()
    await expect(page.locator('[data-dsh-git="operation"]')).toBeVisible({ timeout: 20_000 })
    await page.locator('[data-dsh-git="body"]').evaluate((element) => {
      element.scrollTop = 0
    })
    await capture('conflict')
    // Abort through the panel, then prove the merge state is gone on disk.
    await page.getByRole('button', { name: 'Abort', exact: true }).click()
    await expect.poll(() => gitOk(workspaceA, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']), { timeout: 20_000 })
      .toBe(false)
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.locator('[data-plugin-package="@dsh-next/dsh-next-git"]')
      .getByRole('button', { name: 'View Git', exact: true }).click()
    const settings = page.locator('[data-dsh-git="settings-card"]')
    await expect(settings).toBeVisible()
    const settingsReads = await page.evaluate(async () => Promise.all(['getConfig', 'draftingModelCatalog'].map(async method => {
      const response = await fetch('/dsh-next-git/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args: {} }) })
      return { method, status: response.status, body: await response.json() }
    })))
    expect(settingsReads.every(result => result.status === 200 && (result.body as { ok?: boolean }).ok), JSON.stringify(settingsReads)).toBe(true)
    await expect(settings.getByRole('combobox')).toBeEnabled()
    await expect(settings.getByRole('combobox')).toHaveValue('')
    await expect(settings.getByRole('option', { name: 'Default (session model)', exact: true })).toHaveCount(1)
    const instructions = settings.getByRole('textbox', { name: /Commit message instructions/ })
    await expect(instructions).toHaveValue('')
    const preference = 'Use Conventional Commits. Keep the subject under 72 characters. Write in English.'
    await instructions.fill(preference)
    const saveResponse = page.waitForResponse(response => response.url().endsWith('/dsh-next-git/rpc') && response.request().postDataJSON()?.method === 'setConfig')
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    const saved = await (await saveResponse).json() as { ok?: boolean; error?: unknown }
    expect(saved.ok, JSON.stringify(saved)).toBe(true)
    await page.getByRole('button', { name: 'Back to plugins', exact: true }).click()
    await page.locator('[data-plugin-package="@dsh-next/dsh-next-git"]')
      .getByRole('button', { name: 'View Git', exact: true }).click()
    await expect(instructions).toHaveValue(preference)
    await expect(settings.getByRole('combobox')).toHaveValue('')
    await page.emulateMedia({ colorScheme: 'dark' })
    await settings.screenshot({ path: test.info().outputPath('git-drafting-settings-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
    await settings.screenshot({ path: test.info().outputPath('git-drafting-settings-light.png') })
    // Restore the shell's own theme for any marker that runs after this one.
    await page.emulateMedia({ colorScheme: 'light' })

    // A session that has not started yet still names its branch, and a
    // workspace that is not a repository shows no chip at all — the control is
    // an addition to the composer, never a state of it.
    await openWorkspaceSession(page, 'workspace-a')
    await expect(page.locator('[data-dsh-git="composer-branch"]')).toBeVisible({ timeout: 25_000 })
    await expect(page.locator('[data-dsh-git="composer-branch"]')).toHaveText('main')
    // The chip shares the composer's control row with the attach, permission
    // and model controls, so the row is the honest crop for the README.
    const composerRow = page.locator('[data-dsh-git="composer-branch"]').locator('xpath=ancestor::div[3]')
    await page.emulateMedia({ colorScheme: 'dark' })
    await composerRow.screenshot({ path: test.info().outputPath('composer-branch-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
    await composerRow.screenshot({ path: test.info().outputPath('composer-branch-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    // A narrow composer keeps only the glyph, like the access selector beside
    // it: the label is hidden by the same container query, and the chip is
    // still there to name and open.
    const wideBox = (await composerChip.boundingBox())!
    expect(wideBox.width).toBeGreaterThan(60)
    let collapsedAt = 0
    for (const width of [1100, 900, 700, 560, 460, 420, 390]) {
      await page.setViewportSize({ width, height: 800 })
      if (await composerChip.locator('span').isHidden().catch(() => false)) {
        collapsedAt = width
        break
      }
    }
    expect(collapsedAt).toBeGreaterThan(0)
    await expect(composerChip).toBeVisible()
    // Glyph and chevron only: the chip is still the picker's trigger, and the
    // branch name is still its accessible name.
    await expect(composerChip.locator('svg')).toHaveCount(2)
    await expect(composerChip).toHaveAttribute('aria-label', 'main')
    const narrowBox = (await composerChip.boundingBox())!
    expect(narrowBox.width).toBeLessThan(wideBox.width)
    await page.screenshot({ path: test.info().outputPath('composer-branch-narrow.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openWorkspaceSession(page, 'workspace-b')
    await expect(page.locator('[data-dsh-git="composer-branch"]')).toHaveCount(0)
  } finally {
    fixture.dispose()
  }
})
