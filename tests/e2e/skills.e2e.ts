import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { test, expect, BASE_URL, requireMountedPlugin } from './browser-fixture.ts'
import { openSkillsSection } from './settings-helpers.ts'
import { verifySkillFolderOpener } from './skills-folder.ts'
import { dismissOnboarding, closeDialogs, openWorkspaceSession, unblank } from './checkpoints-helpers.ts'

test.beforeEach(async ({ page }) => {
  requireMountedPlugin('skills')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  // Repair only a missing/detached seed through the live service. Leave a correct
  // fresh seed untouched: its stale scope config is deliberate regression input.
  // Every test also works when selected on its own.
  await page.evaluate(async () => {
    const rpc = async (method: string, args?: unknown) => {
      const response = await fetch('/dsh-next-skills/rpc', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      })
      const result = await response.json()
      if (!response.ok || result.ok === false) throw new Error(JSON.stringify(result))
      return result
    }
    const state = await rpc('getState')
    const row = state.installed.find((skill: { name: string }) => skill.name === 'e2e-test-skill')
    const source = { providerId: 'e2e-local', skillPath: 'skills/e2e-test-skill' }
    if (!row) await rpc('installSkill', source)
    else if (row.provider !== 'e2e/local') await rpc('updateSkill', { ...source, name: row.name, directory: row.directory })
  })
})

test('Skills source selection, search, deletion and installation use the real host', async ({ page }) => {
  await openSkillsSection(page)
  // The harness page scaffold: the section draws its own title heading
  // above the tab strip (the shell's settings-section pattern).
  await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
  await expect(page.getByText('Providers', { exact: true })).toBeVisible()
  const card = page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' }).first()
  await expect(card).toBeVisible()
  await expect(page.getByTestId('skills-scopes')).toHaveCount(0)
  await expect(page.getByTestId('skills-presence')).toHaveCount(0)
  await expect(page.getByTestId('skills-modal')).toHaveCount(0)
  // Folder keyboard/error behavior has its own independently reported test below.
  // Source switcher: the seeded provider offers the same name with a
  // catalog version that never matches the local fingerprint, so the card
  // shows the recorded-provider Update button plus the Providers switcher.
  // The modal lists Local and the provider (marked Current, Replace
  // disabled as a no-op); detaching applies directly (config-only: the
  // provider chip's Update disappears, files stay), and re-adopting goes
  // through the overwrite confirm (updateSkill re-pins provenance).
  await expect(card.locator('[data-testid="skills-update"]')).toBeVisible()
  const providersButton = card.locator('[data-testid="skills-providers"]')
  await expect(providersButton).toContainText('Providers (1)')
  await providersButton.click()
  const sourcesModal = page.getByTestId('skills-sources-modal')
  await expect(sourcesModal).toBeVisible()
  await expect(sourcesModal.getByTestId('skills-source-local')).toContainText('Local (hand-managed)')
  const sourceOption = sourcesModal.getByTestId('skills-source-option')
  await expect(sourceOption).toContainText('e2e/local')
  await expect(sourceOption).toContainText('Current')
  await expect(sourcesModal.getByTestId('skills-source-apply')).toBeDisabled()
  await sourcesModal.getByTestId('skills-source-local').locator('input').click()
  await sourcesModal.getByTestId('skills-source-apply').click()
  await expect(sourcesModal).toHaveCount(0)
  // Detached: the provenance-pinned Update goes (no recorded provider);
  // the switcher now marks Local as the current source.
  await expect(card.locator('[data-testid="skills-update"]')).toHaveCount(0)
  await providersButton.click()
  await expect(sourcesModal.getByTestId('skills-source-local-hint')).toHaveText('Current')
  // Re-adopt the provider: Replace demands the overwrite confirm first,
  // whose body states the real semantics (permanent removal, no trash).
  await sourceOption.locator('input').click()
  await sourcesModal.getByTestId('skills-source-apply').click()
  await expect(sourcesModal.getByTestId('skills-source-confirm-body')).toContainText('e2e/local version')
  await expect(sourcesModal.getByTestId('skills-source-confirm-body')).toContainText('not moved to trash')
  await sourcesModal.getByTestId('skills-source-confirm-btn').click()
  await expect(sourcesModal).toHaveCount(0)
  // Re-pinned: the Update button returns (the seed version still differs).
  await expect(card.locator('[data-testid="skills-update"]')).toBeVisible()
  // Search wiring + relevance: the box drives the grid; a name match ranks
  // above a description-only match even when that match sorts earlier
  // alphabetically (aaa-offering exists to make that order adversarial);
  // a no-hit query lands on the empty state; clearing restores the grid.
  const searchBox = page.getByTestId('skills-search').first()
  const gridCards = page.locator('[data-testid="skills-card"]')
  await searchBox.fill('e2e-test')
  await expect(gridCards).toHaveCount(2)
  await expect(gridCards.first()).toContainText('e2e-test-skill')
  await expect(gridCards.nth(1)).toContainText('aaa-offering')
  await searchBox.fill('zzz-nothing-matches-this')
  await expect(page.getByTestId('skills-empty')).toBeVisible()
  await searchBox.fill('')
  await expect(gridCards).toHaveCount(2)
  // Two-step delete drives the real host service; the confirm modal shows
  // the copy path, and confirming removes the card.
  await card.locator('[data-testid="skills-delete"]').click()
  const confirm = page.getByTestId('skills-delete-confirm')
  await expect(confirm).toBeVisible()
  await expect(confirm.getByTestId('skills-delete-path')).toContainText('e2e-test-skill')
  await confirm.getByTestId('skills-delete-confirm-btn').click()
  // The managed card goes; the seeded provider still offers the name, so
  // its card correctly flips to a catalog-only Use card (nothing managed
  // remains: no Delete, no Providers switcher).
  await expect(page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' }).locator('[data-testid="skills-delete"]')).toHaveCount(0)
  const remaining = page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' })
  await expect(remaining.getByTestId('skills-use')).toBeVisible()
  await expect(remaining.getByTestId('skills-providers')).toHaveCount(0)
  // Install is direct and global-only; no workspace selection or scope RPC.
  const installRequest = page.waitForRequest((request) =>
    request.url().endsWith('/dsh-next-skills/rpc') && request.postDataJSON()?.method === 'installSkill')
  await remaining.getByTestId('skills-use').click()
  expect((await installRequest).postDataJSON()).toEqual({
    method: 'installSkill',
    args: { providerId: 'e2e-local', skillPath: 'skills/e2e-test-skill' },
  })
  await expect(remaining.getByTestId('skills-delete')).toBeVisible()
  await expect(page.getByTestId('skills-modal')).toHaveCount(0)
  const agentsHome = process.env.DSH_AGENTS_HOME
  if (!agentsHome) throw new Error('DSH_AGENTS_HOME is required for isolated skill installation')
  expect(existsSync(join(agentsHome, 'skills', 'e2e-test-skill', 'SKILL.md'))).toBe(true)
  for (const workspace of [process.env.DSH_E2E_WORKSPACE_A, process.env.DSH_E2E_WORKSPACE_B]) {
    if (workspace) expect(existsSync(join(workspace, '.agents', 'skills', 'e2e-test-skill'))).toBe(false)
  }
  // Providers tab renders with the add-provider control; the host seeds its
  // default providers shortly after boot, so rows may already be present —
  // never assert emptiness here.
  await page.getByTestId('skills-tab-providers').click({ force: true })
  await expect(page.getByTestId('skills-add-input').first()).toBeVisible()
  await expect(page.getByTestId('skills-provider-refresh-all').first()).toBeVisible()
})

test('Skills folder-opener supports keyboard, empty-app and error states', async ({ page }) => {
  const agentsHome = process.env.DSH_AGENTS_HOME
  if (!agentsHome) throw new Error('DSH_AGENTS_HOME is required for isolated folder-opener checks')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await openSkillsSection(page)
  await verifySkillFolderOpener(page, join(agentsHome, 'skills', 'e2e-test-skill'))
})

test('Skills global-only page renders real repository skills', async ({ page }, testInfo) => {
  const agentsHome = process.env.DSH_AGENTS_HOME
  if (!agentsHome) throw new Error('DSH_AGENTS_HOME is required for isolated screenshots')
  const names = ['dsh-next-agent-coding', 'dsh-next-code-review', 'dsh-next-documentation']
  const created: string[] = []
  try {
    for (const name of names) {
      const directory = join(agentsHome, 'skills', name)
      expect(existsSync(directory), 'screenshot seed must never overwrite a skill').toBe(false)
      mkdirSync(directory, { recursive: true })
      created.push(directory)
      writeFileSync(join(directory, 'SKILL.md'), readFileSync(join('.agents', 'skills', name, 'SKILL.md'), 'utf8'))
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await openSkillsSection(page)
    await page.getByTestId('skills-search').fill('dsh-next')
    await expect(page.getByTestId('skills-card')).toHaveCount(names.length)
    await expect(page.getByTestId('skills-scopes')).toHaveCount(0)
    await expect(page.getByTestId('skills-presence')).toHaveCount(0)
    await expect(page.getByTestId('skills-delete')).toHaveCount(names.length)
    const panel = page.getByRole('heading', { name: 'Skills', exact: true }).locator('..')
    const screenshot = testInfo.outputPath('skills-global-only.png')
    await panel.screenshot({ path: screenshot })
    await testInfo.attach('global-only Skills page', { path: screenshot, contentType: 'image/png' })
    // Native app detection/icons are not mocked for visual evidence. No launch is
    // clicked here: the interaction marker above intercepts launches separately.
    const nativeApps = await page.request.get(new URL('/open-in-app/apps', BASE_URL).href)
    if (nativeApps.ok() && (await nativeApps.json()).apps?.length > 0) {
      await page.getByTestId('skills-card').filter({ has: page.getByTestId('skills-detail').filter({ hasText: 'dsh-next-agent-coding' }) }).getByTestId('skills-detail').click()
      const detail = page.getByTestId('skills-skill-detail')
      await expect(detail.getByTestId('skills-open-folder')).toBeVisible()
      await expect(detail.getByTestId('skills-detail-body')).toContainText('plugin development')
      await detail.getByTestId('skills-open-folder-menu').click()
      await expect(page.getByRole('menu')).toBeVisible()
      const captureMenu = async (path: string) => {
        const dialogBox = (await detail.boundingBox())!
        const menuBox = (await page.getByRole('menu').boundingBox())!
        const x = Math.min(dialogBox.x, menuBox.x)
        const y = Math.min(dialogBox.y, menuBox.y)
        const width = Math.max(dialogBox.x + dialogBox.width, menuBox.x + menuBox.width) - x
        const height = Math.max(dialogBox.y + dialogBox.height, menuBox.y + menuBox.height) - y
        await page.screenshot({ path, clip: { x, y, width, height } })
      }
      const folderShot = testInfo.outputPath('skills-folder-dark.png')
      await captureMenu(folderShot)
      await testInfo.attach('native skill folder opener dark', { path: folderShot, contentType: 'image/png' })
      await page.keyboard.press('Escape')
      await expect(detail).toBeVisible()
      const darkBackground = await detail.evaluate((element) => getComputedStyle(element).backgroundColor)
      await page.emulateMedia({ colorScheme: 'light' })
      await expect.poll(() => detail.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(darkBackground)
      await detail.getByTestId('skills-open-folder-menu').click()
      await expect(page.getByRole('menu')).toBeVisible()
      const lightShot = testInfo.outputPath('skills-folder-light.png')
      await captureMenu(lightShot)
      await testInfo.attach('native skill folder opener light', { path: lightShot, contentType: 'image/png' })
      await page.keyboard.press('Escape')
      await detail.getByTestId('skills-detail-close').click()
    }
  } finally {
    for (const directory of created) rmSync(directory, { recursive: true, force: true })
  }
})

test('Skills mutations immediately refresh the native catalog', async ({ page }) => {
  await dismissOnboarding(page)
  await closeDialogs(page)
  await openWorkspaceSession(page, 'workspace-b')
  // The shell can reuse its empty draft. Capture the identity of this test's
  // actual prompt rather than expecting a new registry id or a previous marker.
  const prompt = 'skills catalog refresh verification'
  const submitted = page.waitForRequest(
    request => request.url().endsWith('/api/session/prompt') && request.method() === 'POST',
    { timeout: 20_000 },
  )
  await unblank(page, prompt)
  const request = (await submitted).postDataJSON().payload.args.request
  expect(request.content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', text: expect.stringMatching(/catalog refresh verification$/) }),
  ]))
  const sessionId = request.sessionId
  expect(sessionId).toEqual(expect.any(String))
  const snapshots = await page.evaluate(async (sessionId) => {
    const nativeSkills = async (): Promise<string[]> => {
      const response = await fetch('/api/skills/list', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'skills/list', payload: { args: { request: { sessionId } } } }),
      })
      if (!response.ok) throw new Error('native skill list HTTP ' + response.status)
      const envelope = await response.json()
      if (envelope.result?.ok !== true) throw new Error(JSON.stringify(envelope))
      return envelope.result.value.skills.map((skill: { name: string }) => skill.name)
    }
    const rpc = async (method: string, args?: unknown) => {
      const response = await fetch('/dsh-next-skills/rpc', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      })
      const result = await response.json()
      if (!response.ok || result.ok === false) throw new Error(JSON.stringify(result))
      return result
    }
    const state = await rpc('getState')
    const row = state.installed.find((skill: { name: string }) => skill.name === 'e2e-test-skill')
    if (!row) throw new Error('skills setup must install the seeded skill')
    // Deliberately no sleep, polling, or page reload: a warm native snapshot must
    // be invalidated before each successful mutation response reaches the caller.
    const before = await nativeSkills()
    await rpc('deleteSkill', { name: row.name, directory: row.directory, kind: row.kind, path: row.path })
    const afterDelete = await nativeSkills()
    await rpc('installSkill', { providerId: 'e2e-local', skillPath: 'skills/e2e-test-skill' })
    const afterInstall = await nativeSkills()
    return { before, afterDelete, afterInstall }
  }, sessionId!)
  expect(snapshots.before).toContain('e2e-test-skill')
  expect(snapshots.afterDelete).not.toContain('e2e-test-skill')
  expect(snapshots.afterInstall).toContain('e2e-test-skill')
})
