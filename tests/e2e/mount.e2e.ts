/**
 * Mount smoke: prove the packed @dsh-next/dsh-next-* plugin tarballs mount
 * into a real `dsh web` instance and render without crash markers.
 *
 * The server is booted by `scripts/e2e-mount.sh`; the base URL arrives via
 * `DSH_E2E_URL` and the plugin list via `DSH_E2E_PLUGINS` (comma-separated
 * npm package names `@dsh-next/dsh-next-<slug>`) so the same spec works as
 * packages gain UI. The script also preseeds two scratch workspaces into
 * the home's registry (reusable `scripts/e2e-seed-workspaces.sh`) and
 * exports their canonical paths as `DSH_E2E_WORKSPACE_A` / `_B` so any
 * marker can drive workspace-scoped flows without machine-specific paths.
 *
 * Two layers:
 *   1. Every plugin: the shell renders, the client bundle is served, and no
 *      pageerror / plugin-prefixed console error occurs.
 *   2. Per-plugin DOM markers (`pluginMarkers`): a plugin that ships UI can
 *      register a closure that navigates to the UI and asserts it works. This
 *      is what catches "mounts without crashing but renders nothing" bugs
 *      that the crash-marker layer cannot (e.g. a silent payload-shape
 *      mismatch between a Host RPC and its card). Add an entry per plugin as
 *      they gain UI.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { verifyOauthProviders } from './oauth-helpers.ts'
import { bareId, assertMountHealthy, runGuardedMarker, requireCheckpointsPanel } from '../../scripts/e2e-guards.mjs'
import { closeDialogs, openWorkspaceSession, unblank } from './checkpoints-helpers.ts'
import { verifyNotifier, registerNotifierTurnTest } from './notifier-marker.ts'
import { verifySkillFolderOpener } from './skills-folder.ts'
import {
  commitFile,
  git,
  gitOk,
  initGitRepo,
  runSlashCommand,
  unblankCurrentSession,
  waitForTurnIdle,
} from './git-helpers.ts'
import { createFixture } from '../../packages/dsh-next-git/tests/git-fixture.ts'

/** Live-model lane: the official DeepSeek route has a real DEEPSEEK_API_KEY. */
const LIVE = process.env.DSH_E2E_LIVE === '1'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — boot a DSH web instance with the plugin family mounted and point this lane at it (see scripts/e2e-mount.sh)')
}

const pluginIds = (process.env.DSH_E2E_PLUGINS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

// A fresh scratch home walks a first-run onboarding flow (an "Internal Testing
// Notice", then an "Add an API key to get started" modal) whose masks intercept
// pointer events on the sidebar. Click EVERY visible dismissal button in order,
// repeatedly until no dialog remains. force:true sidesteps the modal mask that
// can still be animating at click time. Each test() gets a fresh context, so
// the dialog is re-shown every run and must be dismissed again.
async function dismissOnboarding(page: Page): Promise<void> {
  const names = ['Continue', 'Configure later', 'Skip'] as const
  for (let round = 0; round < 12; round++) {
    let clicked = false
    for (const name of names) {
      const btn = page.getByRole('button', { name })
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true })
        clicked = true
        await page.waitForTimeout(300)
      }
    }
    await page.waitForTimeout(300)
    const remaining = await page.locator('[role="dialog"]').count().catch(() => 0)
    if (!clicked || remaining === 0) break
  }
}

// Navigate to a plugin's settings card, dismissing onboarding first. Returns
// once the card's body is open. force:true sidesteps the onboarding modal masks.
// The fresh scratch home can re-show a dialog on a cold load, so retry the whole
// dismiss-and-open sequence a bounded number of times.
async function openPluginCard(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      // A previous marker may have left the Settings -> Plugins view open; in
      // that case clicking "Settings" again toggles it closed. Only navigate
      // when the Plugins tab is not already visible.
      if (!(await page.getByText('Plugins', { exact: true }).first().isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
        await page.getByText('Plugins', { exact: true }).first().click({ force: true })
      }
      const card = page.getByText(title).first()
      await card.waitFor({ state: 'visible', timeout: 4000 })
      await card.click({ force: true })
      return
    } catch {
      // A dialog may have re-appeared on a cold load; dismiss and retry.
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`could not open the ${title} card after retries`)
}

async function openNotifierCard(page: Page): Promise<void> {
  await openPluginCard(page, 'Notifier')
}

// Navigate to the skills manager's own settings section (Settings -> Skills),
// dismissing onboarding first. Returns once the section's tab bar is visible.
async function openSkillsSection(page: Page): Promise<void> {
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

// Navigate to the Claude marketplace bridge's settings section
// (Settings -> Claude Plugins), dismissing onboarding first. Returns once the
// section's tab bar is visible.
async function closeOpenDialogs(page: Page): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const dialog = page.locator('[role="dialog"]')
    if (await dialog.count() === 0) break
    const close = dialog.getByRole('button', { name: 'Close' }).first()
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true })
    } else {
      await page.keyboard.press('Escape')
    }
    await page.waitForTimeout(400)
  }
}

interface WorkspaceStorageDoc {
  readonly global: { readonly archivedSessionIds?: readonly string[] }
  readonly tables: { readonly workspaces: Record<string, { path: string; sessionIds: readonly string[] }> }
}

function readWorkspaceStorage(dshHome: string): WorkspaceStorageDoc {
  return JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8')) as WorkspaceStorageDoc
}

async function openCcSection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      const nav = page.getByRole('button', { name: 'Claude Plugins', exact: true }).first()
      if (!(await nav.isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
      }
      await nav.waitFor({ state: 'visible', timeout: 4000 })
      await nav.click({ force: true })
      await page.waitForTimeout(400)
      if (await page.getByText('Marketplaces', { exact: true }).first().isVisible().catch(() => false)) return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error('could not open the Claude Plugins settings section after retries')
}

// Per-plugin DOM markers: a package that ships UI registers a closure that
// drives to its UI and asserts real behavior. Keyed by the bare slug, invoked
// only when the plugin is in DSH_E2E_PLUGINS. Skipped markers make the smoke
// pass trivially, so only add one for a plugin whose UI is genuinely rendered.
const pluginMarkers: Record<string, (page: Page) => Promise<void>> = {
  // Slash command, no settings card. Drives /reset in an ordinary folder
  // (workspace-b) so the reincarnation handshake is proven on a real mount:
  // polluted transcript vanishes, the workspace keeps both session ids, and
  // the old id is archived.
  'dsh-next-reset': async (page) => {
    const workspaceB = process.env.DSH_E2E_WORKSPACE_B
    const dshHome = process.env.DSH_HOME
    if (!workspaceB) {
      throw new Error('DSH_E2E_WORKSPACE_B is not set — run through scripts/e2e-mount.sh')
    }
    await dismissOnboarding(page)
    await closeOpenDialogs(page)
    const plainRow = page.locator('[role="treeitem"]').filter({ hasText: 'workspace-b' }).first()
    await expect(plainRow).toBeVisible({ timeout: 15_000 })
    await plainRow.hover()
    await plainRow.locator('button[aria-label*="New session in workspace-b"]').click({ force: true })
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
    await page.screenshot({ path: join('test-results', 'reset-after.png') })
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
  },

  // The notifier's settings card lives under Settings -> Plugins; opening it
  // must reveal the settings body (the regression this guards: a Host RPC that
  // returned raw config instead of the card's envelope, so the header toggled
  // open but the body never rendered).
  'dsh-next-notifier': (page) => verifyNotifier(page, openNotifierCard),

  'dsh-next-oauth-providers': async (page) => {
    await dismissOnboarding(page)
    await verifyOauthProviders(page)
  },

  // nav level as General/Models/Plugins) with Skills and Providers tabs over
  // a card grid, backed by the settings.yaml configuration. Opening it must
  // reveal the tab bar and the seeded throwaway skill's card; the card's
  // controls must offer global-only installation with no scope modal; the source
  // switcher must detach (config-only) and re-adopt (overwrite confirm) the
  // seeded same-name provider; and the red Delete must remove the skill
  // end-to-end through the two-step confirm (guards client-side state-refresh
  // regressions the "section renders" check cannot see). No network: the
  // provider and its catalog are seeded into the scratch home only.
  'dsh-next-skills': async (page) => {
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
    const folderRoot = process.env.DSH_AGENTS_HOME
    if (!folderRoot) throw new Error('DSH_AGENTS_HOME is required for isolated folder-opener checks')
    await verifySkillFolderOpener(page, join(folderRoot, 'skills', 'e2e-test-skill'))
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
  },

  // The cc-plugins bridge registers its own Settings -> Claude Plugins
  // section with Marketplaces and Installed tabs backed by the Host RPC over
  // the plugin data root. Opening it must reveal the tab bar, the empty
  // marketplaces state, and the add-marketplace control; switching to the
  // Installed tab must render its empty state (guards a silent payload-shape
  // mismatch the crash-marker layer cannot see). The official Anthropic
  // marketplace is seeded on the fresh scratch home (its GitHub sync is best
  // effort; assertions never depend on it). The marker closes the Settings
  // dialog afterwards:
  // this package sorts before dsh-next-notifier, whose openPluginCard only
  // handles a closed or Plugins-view Settings shell.
  'dsh-next-cc-plugins': async (page) => {
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
  },

  // The Git tab is a right-sidebar tab type, so the marker drives the real
  // seat: the Start guide capsule opens it, and every operation it performs is
  // read back from disk with git afterwards (a DOM-only assertion could pass
  // while the host quietly did nothing).
  'dsh-next-git': async (page) => {
    const workspaceA = process.env.DSH_E2E_WORKSPACE_A
    if (!workspaceA) {
      throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh')
    }
    // The same deterministic fixture the unit suites use, seeded into the
    // workspace the smoke already registered as a session root.
    const fixture = createFixture('untracked', { dir: workspaceA })
    fixture.write('src/git-panel/store.ts', [
      'export interface PanelState {',
      "  readonly branch: string",
      '}',
      '',
      'export function branchOf(state: PanelState): string {',
      '  return state.branch',
      '}',
      '',
    ].join('\n'))
    fixture.write('src/app.ts', 'export const app = 2\n')
    try {
      await dismissOnboarding(page)
      await closeDialogs(page)
      await openWorkspaceSession(page, 'workspace-a')

      // The right column can start collapsed; reveal it before looking for the
      // Start guide capsule. Wait for whichever control mounts first (the
      // expand button or the capsule itself) instead of sampling once.
      const expand = page.getByRole('button', { name: /Open right sidebar/i }).first()
      const capsule = page.getByRole('button', { name: /Source control/ }).first()
      // The column starts collapsed and paints a beat after the conversation
      // frame; the control that opens it can appear after the first paint, and
      // a click landing mid-mount does nothing. Retry until the guide shows.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (await capsule.isVisible().catch(() => false)) break
        if ((await expand.count()) > 0) {
          await expand.click({ force: true }).catch(() => {})
        }
        await page.waitForTimeout(600)
      }
      await expect(capsule).toBeVisible({ timeout: 25_000 })

      // The guide lists one capsule per registered tab type; picking ours opens
      // the Git tab in the guide's place.
      await capsule.click({ force: true })

      const panel = page.locator('[data-dsh-git="panel"]')
      await expect(panel).toBeVisible({ timeout: 20_000 })
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

      // Capture only the column, cropped to the control the README shows, in
      // the dark theme the package READMEs use.
      await page.emulateMedia({ colorScheme: 'dark' })
      const capture = async (name: string): Promise<void> => {
        const box = await panel.boundingBox()
        if (box === null) return
        await page.screenshot({
          path: join('test-results', `git-${name}.png`),
          clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 860) },
        })
      }

      // Changes: the modified and untracked files are listed, and opening one
      // renders a native diff.
      const row = page.locator('[data-dsh-git="row"][data-path="src/git-panel/store.ts"]')
      await expect(row).toBeVisible({ timeout: 20_000 })
      await capture('changes')
      await row.click()
      await expect(page.locator('[data-dsh-git="diff"]')).toBeVisible({ timeout: 15_000 })
      await page.locator('[data-dsh-git="diff-back"]').click()

      // Stage through the panel, then read the index back from disk.
      await row.hover()
      await row.locator('button[aria-label="Stage"]').click()
      await expect.poll(() => git(workspaceA, ['diff', '--cached', '--name-only']), { timeout: 15_000 })
        .toContain('src/git-panel/store.ts')

      // Commit through the panel and assert the subject on disk.
      const subject = `feat: add the git panel store`
      await page.locator('[data-dsh-git="commit-message"]').fill(subject)
      await page.getByRole('button', { name: 'Commit', exact: true }).click()
      await expect.poll(() => git(workspaceA, ['log', '-1', '--pretty=%s']).trim(), { timeout: 20_000 })
        .toBe(subject)

      // Worktree lifecycle: create one through the panel, then assert the
      // checkout, its branch and the local-only exclude entry on disk.
      const slug = `panel-${Date.now().toString(36)}`
      await page.locator('[data-dsh-git="worktree-name"]').fill(slug)
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await expect.poll(() => existsSync(join(workspaceA, '.worktrees', slug)), { timeout: 30_000 }).toBe(true)
      expect(gitOk(workspaceA, ['rev-parse', '--verify', `dsh-git/${slug}`])).toBe(true)
      expect(readFileSync(join(workspaceA, '.git', 'info', 'exclude'), 'utf8')).toContain('.worktrees/')
      const worktreeRow = page.locator('[data-dsh-git="worktree"]').filter({ hasText: slug })
      await expect(worktreeRow).toBeVisible({ timeout: 20_000 })
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
      const anchorRow = page.locator('[data-dsh-git="row"][data-path="src/app.ts"]')
      await expect(anchorRow).toBeVisible({ timeout: 20_000 })
      const insets = [
        await rightInset('[data-dsh-git="changes"] [data-dsh-git="section-count"]'),
        await rightInset('[data-dsh-git="row"][data-path="src/app.ts"] [data-dsh-git="status"]'),
        await rightInset('[data-dsh-git="commit-row"] button'),
      ]
      expect(insets.every((inset) => inset !== null)).toBe(true)
      expect(Math.max(...insets.map((inset) => inset ?? 0)) - Math.min(...insets.map((inset) => inset ?? 0)))
        .toBeLessThanOrEqual(2)

      // The sections are accordion headers: collapsing one hides its body and
      // leaves the others alone, and expanding brings it back.
      const worktreesToggle = page.locator('[data-dsh-git="section-toggle"][data-section="worktrees"]')
      await worktreesToggle.click()
      await expect(worktreesToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('[data-dsh-git="worktree"]')).toHaveCount(0)
      await expect(page.locator('[data-dsh-git="row"][data-path="src/app.ts"]')).toBeVisible()
      await worktreesToggle.click()
      await expect(worktreesToggle).toHaveAttribute('aria-expanded', 'true')
      await expect(worktreeRow).toBeVisible()

      await worktreeRow.scrollIntoViewIfNeeded()
      await capture('worktrees')

      // History: the commit made above is listed with its actions, without a
      // remount (the panel re-reads the section after a commit).
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
      // Restore the shell's own theme for any marker that runs after this one.
      await page.emulateMedia({ colorScheme: 'light' })
    } finally {
      fixture.dispose()
    }
  },

  // provider and its catalog are seeded into the scratch home only.
  // Establish a known session; a missing tab or panel must fail, not skip.
  // Detailed capture/rewind and Git mutations live in checkpoints.e2e.ts.
  'dsh-next-checkpoints': async (page) => {
    await requireCheckpointsPanel(page, async () => {
      await dismissOnboarding(page)
      await closeDialogs(page)
      await openWorkspaceSession(page, 'workspace-a')
      await unblank(page, 'checkpoint mount marker')
    }, expect)
  },
}

test('plugin family mounts the dsh-next plugins without crash markers', async ({ page }) => {
  test.setTimeout(LIVE ? 420_000 : 360_000)
  const pageErrors: string[] = []
  const pluginConsoleErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/dsh-next[-/]/.test(text)) pluginConsoleErrors.push(text)
  })

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  // The shell rendered: wait for the DSH app root to exist in the DOM.
  await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })

  // Every plugin's client bundle is composed into the boot graph. A missing
  // entry means the profile patch failed to register the row (the exact class
  // of bug only a real-mount smoke can catch). 0.1.2 serves bundles through
  // the rev-hashed combo route, not a stable singular URL, so the composed
  // graph is the authoritative signal.
  const entryIds = await page.evaluate(() => {
    const boot = (globalThis as { __DSH_BOOT__?: { entries?: Array<{ id?: string }> } }).__DSH_BOOT__
    return (boot?.entries ?? []).map((entry) => entry.id).filter((id): id is string => id !== undefined)
  })
  for (const pkg of pluginIds) {
    expect(entryIds, `${pkg} client bundle should be in the boot graph`).toContain(pkg)
  }

  const assertHealthy = () => assertMountHealthy(page, pluginIds, pageErrors, pluginConsoleErrors, expect)
  await assertHealthy()

  // Preserve the supplied order; each interaction has its own named evidence.
  for (const pkg of pluginIds) {
    const marker = pluginMarkers[bareId(pkg)]
    if (marker) {
      await test.step(`marker: ${bareId(pkg)}`, () =>
        runGuardedMarker(() => marker(page), assertHealthy))
    }
  }
  await assertHealthy()
})

registerNotifierTurnTest(BASE_URL, pluginIds, dismissOnboarding)

test('Skills folder-opener supports keyboard, empty-app and error states', async ({ page }) => {
  test.skip(!pluginIds.includes('@dsh-next/dsh-next-skills'), 'Skills plugin is not mounted')
  const agentsHome = process.env.DSH_AGENTS_HOME
  if (!agentsHome) throw new Error('DSH_AGENTS_HOME is required for isolated folder-opener checks')
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await openSkillsSection(page)
  await verifySkillFolderOpener(page, join(agentsHome, 'skills', 'e2e-test-skill'))
})

test('Skills global-only page renders real repository skills', async ({ page }, testInfo) => {
  test.skip(!pluginIds.includes('@dsh-next/dsh-next-skills'), 'Skills plugin is not mounted')
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
  test.skip(!pluginIds.includes('@dsh-next/dsh-next-skills'), 'Requires the family session fixture')
  const home = process.env.DSH_HOME
  const workspaceB = process.env.DSH_E2E_WORKSPACE_B
  if (!home || !workspaceB) throw new Error('Run through the isolated family mount smoke')
  const registry = JSON.parse(readFileSync(join(home, 'storages', 'workspace.json'), 'utf8')) as {
    global: { archivedSessionIds: string[] }
    tables: { workspaces: Record<string, { path: string; sessionIds: string[] }> }
  }
  const active = (workspace: { sessionIds: string[] } | undefined) =>
    workspace?.sessionIds.find((id) => !registry.global.archivedSessionIds.includes(id))
  const sessionId = active(Object.values(registry.tables.workspaces).find((workspace) => workspace.path === workspaceB))
    ?? active(Object.values(registry.tables.workspaces).find((workspace) => workspace.path !== workspaceB))
  expect(sessionId, 'the smoke lane must leave an active session to query the catalog with').toBeTruthy()
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
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
    if (!row) throw new Error('family marker must leave the seeded skill installed')
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
