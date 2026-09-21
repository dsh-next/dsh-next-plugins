import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test, expect, BASE_URL, requireMountedPlugin } from './browser-fixture.ts'
import { openCcSection } from './settings-helpers.ts'

test.beforeEach(async ({ page }) => {
  requireMountedPlugin('cc-plugins')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
})

test('Claude marketplace installs, scopes, updates and removes real fixture plugins', async ({ page }) => {
  await openCcSection(page)
  // The section label is a locale-service function label; under the
  // default (en) locale it must still read exactly "Claude Plugins".
  await expect(page.getByRole('button', { name: 'Claude Plugins', exact: true }).first()).toBeVisible()
  // The harness page scaffold: the section draws its own title heading
  // above the tab strip (the shell's settings-section pattern).
  await expect(page.getByRole('heading', { name: 'Claude Plugins', exact: true })).toBeVisible()
  // Tab clicks stay scoped to the Settings dialog: the app's own sidebar
  // also has "Plugins" and "Models" pages an unscoped text locator hits.
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(page.getByText('Plugins', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Marketplaces', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('cc-search').first()).toBeVisible()
  await expect(page.getByTestId('cc-installed-only').first()).toBeVisible()
  await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
  await expect(page.locator('input[placeholder*="owner/repo"]').first()).toBeVisible()
  await expect(page.getByText('refresh automatically', { exact: false }).first()).toBeVisible()
  // A fresh install seeds the official Anthropic marketplace; the row
  // renders from the registry alone, so this holds even when its sync
  // cannot reach GitHub from the test environment.
  await expect(page.getByText('anthropics/claude-plugins-official', { exact: false }).first()).toBeVisible()
  // A local-fixture marketplace drives the real add -> card -> detail ->
  // scope-modal install -> manage/uninstall flow offline: the panel lists
  // its plugins, the detail modal shows the component inventory (including
  // the not-bridged LSP family), and the radio modal installs globally and
  // uninstalls through the real host service. The parity fixture plugin
  // additionally proves dependency auto-install, user_config MCP
  // expansion, and plugin-level reference rewriting end to end — asserted
  // on the scratch home's real filesystem, not just the DOM.
  const fixture = join(process.cwd(), 'tests/e2e/fixtures/tiny-marketplace')
  await page.getByTestId('cc-add-input').first().fill(fixture)
  await page.getByRole('button', { name: 'Add marketplace' }).first().click()
  await expect(page.getByText('tiny-tools', { exact: false }).first()).toBeVisible()
  // Plugin cards live on the Plugins tab. The fixture card is located by
  // name: the seeded official marketplace contributes cards of its own
  // whenever its sync reaches GitHub.
  await settings.getByRole('tab', { name: 'Plugins' }).click({ force: true })
  // Large catalogs (the official marketplace whenever its sync reaches
  // GitHub) paginate 30 cards per page: exhaust the Show more pager so
  // the fixture cards are on the page before this marker locates them.
  for (let i = 0; i < 20 && await page.getByTestId('cc-show-more').isVisible().catch(() => false); i++) {
    await page.getByTestId('cc-show-more').click({ force: true })
    await page.waitForTimeout(200)
  }
  const demoCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("demo-tools"))').first()
  await expect(demoCard).toBeVisible()
  await demoCard.locator('[data-testid="cc-detail"]').click()
  await expect(page.getByTestId('cc-plugin-detail')).toBeVisible()
  await expect(page.getByTestId('cc-detail-components')).toContainText('skills: demo-skill')
  await expect(page.getByTestId('cc-detail-components')).toContainText('commands: hello')
  await expect(page.getByTestId('cc-detail-components')).toContainText('LSP server')
  await page.getByTestId('cc-detail-close').click()
  await expect(page.getByTestId('cc-plugin-detail')).toHaveCount(0)
  // The scope modal drives a real install: Global is the default radio,
  // the workspaces checklist stays hidden (indented under its radio when
  // shown), and Install installs globally.
  await demoCard.locator('[data-testid="cc-install"]').click()
  await expect(page.getByTestId('cc-modal')).toBeVisible()
  await expect(page.getByTestId('cc-scope-global').locator('input')).toBeChecked()
  await expect(page.getByTestId('cc-workspaces')).toHaveCount(0)
  await page.getByTestId('cc-modal-confirm').click()
  await expect(page.getByTestId('cc-modal')).toHaveCount(0)
  // Installed cards flip to Scopes + Uninstall (plus Update when offered).
  await expect(demoCard.getByTestId('cc-scopes')).toBeVisible()
  await expect(demoCard.getByTestId('cc-uninstall')).toBeVisible()
  await expect(demoCard.getByTestId('cc-installed-version')).toBeVisible()
  // Uninstall is a two-step confirm modal opened from the card; it
  // removes the plugin again.
  await demoCard.getByTestId('cc-uninstall').click()
  await expect(page.getByTestId('cc-uninstall-modal')).toBeVisible()
  await page.getByTestId('cc-uninstall-confirm').click()
  await expect(demoCard.getByTestId('cc-scopes')).toHaveCount(0)
  await expect(demoCard.getByTestId('cc-install')).toBeVisible()
  // The parity fixture plugin drives the three newest bridges through
  // the real host service: dependency auto-install, user_config MCP
  // expansion, and plugin-level reference rewriting. Seed the user
  // configuration first so the token expands instead of staying literal.
  const ccRoot = join(process.env.DSH_HOME ?? '', 'cc-plugins')
  mkdirSync(ccRoot, { recursive: true })
  writeFileSync(join(ccRoot, 'user-config.json'), JSON.stringify({ parity_token: 'e2e-parity-token' }))
  const parityCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("parity-tools"))').first()
  await parityCard.locator('[data-testid="cc-install"]').click()
  await expect(page.getByTestId('cc-modal')).toBeVisible()
  await page.getByTestId('cc-modal-confirm').click()
  await expect(parityCard.getByTestId('cc-scopes')).toBeVisible()
  // The declared dependency auto-installed alongside, and the outcome
  // surfaced in the mutation message.
  const depCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("dep-provider"))').first()
  await expect(depCard.getByTestId('cc-scopes')).toBeVisible()
  await expect(depCard.getByTestId('cc-installed-version')).toBeVisible()
  await expect(page.getByTestId('cc-message')).toContainText('auto-installed dependency "dep-provider"')
  // On-disk effects through the real filesystem: the installed skill
  // copy carries the rewritten absolute path into the materialized
  // copy, and the managed MCP row carries the expanded user_config
  // token (not the literal template).
  const agentsHome = process.env.DSH_AGENTS_HOME ?? ''
  const readerSkill = readFileSync(join(agentsHome, 'skills', 'reader', 'SKILL.md'), 'utf8')
  expect(readerSkill).toContain('/references/guide.md')
  expect(readerSkill).toContain(join(ccRoot, 'plugins'))
  expect(readerSkill).not.toContain('../../references')
  const patchYml = readFileSync(join(process.env.DSH_HOME ?? '', 'cordis.patch.yml'), 'utf8')
  expect(patchYml).toContain('e2e-parity-token')
  expect(patchYml).not.toContain('${user_config.parity_token}')
  // Uninstall both: dependencies stay independent of their parent, so
  // each card carries its own two-step uninstall.
  await parityCard.getByTestId('cc-uninstall').click()
  await page.getByTestId('cc-uninstall-confirm').click()
  await expect(parityCard.getByTestId('cc-scopes')).toHaveCount(0)
  await depCard.getByTestId('cc-uninstall').click()
  await page.getByTestId('cc-uninstall-confirm').click()
  await expect(depCard.getByTestId('cc-scopes')).toHaveCount(0)
  // The Workspaces radio path, against the workspaces e2e-mount.sh
  // preseeded into the scratch home's registry (canonical paths arrive
  // via env — never machine-specific literals). Install demo-tools into
  // workspace-a only: skills are global-only, so the copy lands in the
  // global skill root, independently of the plugin workspace scope.
  const workspaceA = process.env.DSH_E2E_WORKSPACE_A
  if (!workspaceA) throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh, which preseeds the workspaces')
  const workspaceB = process.env.DSH_E2E_WORKSPACE_B ?? ''
  await demoCard.locator('[data-testid="cc-install"]').click()
  await expect(page.getByTestId('cc-modal')).toBeVisible()
  await page.getByTestId('cc-scope-workspaces').locator('input').click()
  const checklist = page.getByTestId('cc-workspaces')
  await expect(checklist).toBeVisible()
  // Both preseeded workspaces offer themselves in the checklist.
  await expect(checklist).toContainText('workspace-a')
  if (workspaceB !== '') await expect(checklist).toContainText('workspace-b')
  await checklist.locator('[data-testid="cc-workspace"]').filter({ hasText: 'workspace-a' }).first().locator('input[type="checkbox"]').click()
  await page.getByTestId('cc-modal-confirm').click()
  await expect(demoCard.getByTestId('cc-scopes')).toBeVisible()
  await expect(demoCard).toContainText('in workspace-a')
  // The skill copy landed in the GLOBAL root — skills never install into
  // projects, and the plugin warns that its scope does not restrict skills.
  await expect(page.getByTestId('cc-message')).toContainText('globally')
  await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
  expect(readFileSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')).toContain('demo')
  expect(existsSync(join(workspaceA, '.agents', 'skills', 'demo-skill'))).toBe(false)
  // Scopes still controls the Claude plugin composition, not skill visibility.
  // Saving global leaves the global skill copy in place.
  await demoCard.getByTestId('cc-scopes').click()
  await expect(page.getByTestId('cc-scope-workspaces').locator('input')).toBeChecked()
  await page.getByTestId('cc-scope-global').locator('input').click()
  await page.getByTestId('cc-modal-confirm').click()
  await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
  await expect(demoCard).toContainText('in global')
  // Full uninstall from the global scope; the marketplace can go after.
  await demoCard.getByTestId('cc-uninstall').click()
  await expect(page.getByTestId('cc-uninstall-modal')).toBeVisible()
  await page.getByTestId('cc-uninstall-confirm').click()
  await expect(demoCard.getByTestId('cc-scopes')).toHaveCount(0)
  // Remove the fixture marketplace; the seeded official one remains
  // (the Remove button inside the tiny-tools row, not a foreign one).
  await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
  // Refresh all runs one marketplace at a time (the active row's Remove
  // swaps for a spinner): wait for the label to revert and the summary.
  await page.getByTestId('cc-marketplace-refresh-all').click()
  await expect(page.getByTestId('cc-marketplace-refresh-all')).toContainText('Refresh all')
  await expect(page.getByTestId('cc-message')).toContainText(/Refreshed \d+ marketplace|Refresh failed/)
  await page.locator('[data-testid="cc-marketplace"]:has-text("tiny-tools")').getByRole('button', { name: 'Remove', exact: true }).click()
  // Removal confirms through a modal before the RPC.
  await expect(page.getByTestId('cc-marketplace-remove-modal')).toBeVisible()
  await page.getByTestId('cc-marketplace-remove-confirm').click()
  await expect(page.getByText('tiny-tools', { exact: false })).toHaveCount(0)
  await expect(page.getByText('anthropics/claude-plugins-official', { exact: false }).first()).toBeVisible()
  // The Models tab offers alias pickers over the runtime's live models.
  await settings.getByRole('tab', { name: 'Models' }).click({ force: true })
  await expect(page.getByTestId('cc-model-row').first()).toBeVisible()
  await expect(page.getByTestId('cc-model-select').first()).toBeVisible()
  await settings.getByRole('button', { name: 'Close' }).click({ force: true })
  await page.waitForTimeout(300)
})
