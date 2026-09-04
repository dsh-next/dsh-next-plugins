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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — boot a DSH web instance with the plugin family mounted and point this lane at it (see scripts/e2e-mount.sh)')
}

const pluginIds = (process.env.DSH_E2E_PLUGINS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

// Each entry is the npm package name (`@dsh-next/dsh-next-<slug>`). The client
// bundle is served at /plugins/<package-name>/client.js; the log crash-marker
// prefix is the bare `dsh-next-<slug>` (the cordis `id` field).
function bareId(pkg: string): string {
  return pkg.startsWith('@dsh-next/') ? pkg.slice('@dsh-next/'.length) : pkg
}

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
  await openPluginCard(page, 'DSH Next Notifier')
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
  // The notifier's settings card lives under Settings -> Plugins; opening it
  // must reveal the settings body (the regression this guards: a Host RPC that
  // returned raw config instead of the card's envelope, so the header toggled
  // open but the body never rendered).
  'dsh-next-notifier': async (page) => {
    // A fresh scratch home shows the sequential onboarding dialogs (testing
    // notice, API-key prompt) whose masks intercept pointer events; dismiss
    // them before driving the sidebar.
    await openNotifierCard(page)
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('Test browser notification')).toBeVisible()
  },

  // The skills manager registers its own Settings -> Skills section (the same
  // nav level as General/Models/Plugins) with Skills and Providers tabs over
  // a card grid, backed by the settings.yaml configuration. Opening it must
  // reveal the tab bar and the seeded throwaway skill's card; the card's
  // scope modal must offer Global vs the workspaces checklist and the red
  // Delete must remove the skill end-to-end through the two-step confirm
  // (guards a client-side state-refresh regression the "section renders"
  // check cannot see). No network: providers are only added manually.
  'dsh-next-skills': async (page) => {
    await openSkillsSection(page)
    // The harness page scaffold: the section draws its own title heading
    // above the tab strip (the shell's settings-section pattern).
    await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
    await expect(page.getByText('Providers', { exact: true })).toBeVisible()
    const card = page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' }).first()
    await expect(card).toBeVisible()
    await card.locator('[data-testid="skills-manage"]').click()
    const modal = page.getByTestId('skills-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('skills-scope-global').locator('input')).toBeChecked()
    // The workspaces radio reveals the checklist, listing the workspaces
    // e2e-mount.sh preseeded into the home's registry (canonical paths via
    // env — the same reusable seeding every marker can drive). Scoped to
    // the checklist: the preseeded workspaces also show in the sidebar.
    await page.getByTestId('skills-scope-workspaces').click()
    const wsList = page.getByTestId('skills-workspaces')
    await expect(wsList).toContainText('workspace-a')
    await expect(wsList).toContainText('workspace-b')
    await modal.locator('[data-testid="skills-modal-confirm"]').click()
    // Two-step delete drives the real host service; the confirm modal shows
    // the copy path, and confirming removes the card.
    await card.locator('[data-testid="skills-delete"]').click()
    const confirm = page.getByTestId('skills-delete-confirm')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByTestId('skills-delete-path')).toContainText('e2e-test-skill')
    await confirm.getByTestId('skills-delete-confirm-btn').click()
    await expect(page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' })).toHaveCount(0)
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
    // the workspaces checklist stays hidden, and Add installs globally.
    await demoCard.locator('[data-testid="cc-add"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await expect(page.getByTestId('cc-scope-global').locator('input')).toBeChecked()
    await expect(page.getByTestId('cc-workspaces')).toHaveCount(0)
    await page.getByTestId('cc-modal-confirm').click()
    await expect(page.getByTestId('cc-modal')).toHaveCount(0)
    await expect(demoCard).toContainText('Manage', { useInnerText: false })
    await expect(demoCard.getByTestId('cc-installed-version')).toBeVisible()
    // Manage re-opens the modal on the current scope; uninstall is a
    // two-step confirm and removes the plugin again.
    await demoCard.locator('[data-testid="cc-add"]').click()
    await expect(page.getByTestId('cc-scope-global').locator('input')).toBeChecked()
    await page.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(demoCard).not.toContainText('Manage')
    // The parity fixture plugin drives the three newest bridges through
    // the real host service: dependency auto-install, user_config MCP
    // expansion, and plugin-level reference rewriting. Seed the user
    // configuration first so the token expands instead of staying literal.
    const ccRoot = join(process.env.DSH_HOME ?? '', 'cc-plugins')
    mkdirSync(ccRoot, { recursive: true })
    writeFileSync(join(ccRoot, 'user-config.json'), JSON.stringify({ parity_token: 'e2e-parity-token' }))
    const parityCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("parity-tools"))').first()
    await parityCard.locator('[data-testid="cc-add"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await page.getByTestId('cc-modal-confirm').click()
    await expect(parityCard).toContainText('Manage')
    // The declared dependency auto-installed alongside, and the outcome
    // surfaced in the mutation message.
    const depCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("dep-provider"))').first()
    await expect(depCard).toContainText('Manage')
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
    await parityCard.locator('[data-testid="cc-add"]').click()
    await page.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(parityCard).not.toContainText('Manage')
    await depCard.locator('[data-testid="cc-add"]').click()
    await page.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(depCard).not.toContainText('Manage')
    // The Workspaces radio path, against the workspaces e2e-mount.sh
    // preseeded into the scratch home's registry (canonical paths arrive
    // via env — never machine-specific literals). Install demo-tools into
    // workspace-a only: skills are global-only, so the copy lands in the
    // global skill root and the workspace scope is enablement, not placement.
    const workspaceA = process.env.DSH_E2E_WORKSPACE_A
    if (!workspaceA) throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh, which preseeds the workspaces')
    const workspaceB = process.env.DSH_E2E_WORKSPACE_B ?? ''
    await demoCard.locator('[data-testid="cc-add"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await page.getByTestId('cc-scope-workspaces').locator('input').click()
    const checklist = page.getByTestId('cc-workspaces')
    await expect(checklist).toBeVisible()
    // Both preseeded workspaces offer themselves in the checklist.
    await expect(checklist).toContainText('workspace-a')
    if (workspaceB !== '') await expect(checklist).toContainText('workspace-b')
    await checklist.locator('[data-testid="cc-workspace"]').filter({ hasText: 'workspace-a' }).first().locator('input[type="checkbox"]').click()
    await page.getByTestId('cc-modal-confirm').click()
    await expect(demoCard).toContainText('Manage')
    await expect(demoCard).toContainText('in workspace-a')
    // The skill copy landed in the GLOBAL root — skills never install into
    // projects; the workspace scope is enablement, not physical placement.
    await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')).toContain('demo')
    expect(existsSync(join(workspaceA, '.agents', 'skills', 'demo-skill'))).toBe(false)
    // Manage re-opens on the workspace scope; Save scope to global clears the
    // enablement restriction (the global copy stays put).
    await demoCard.locator('[data-testid="cc-add"]').click()
    await expect(page.getByTestId('cc-scope-workspaces').locator('input')).toBeChecked()
    await page.getByTestId('cc-scope-global').locator('input').click()
    await page.getByTestId('cc-modal-confirm').click()
    await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    await expect(demoCard).toContainText('in global')
    // Full uninstall from the global scope; the marketplace can go after.
    await demoCard.locator('[data-testid="cc-add"]').click()
    await page.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(demoCard).not.toContainText('Manage')
    // Remove the fixture marketplace; the seeded official one remains
    // (the Remove button inside the tiny-tools row, not a foreign one).
    await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
    // Refresh all runs one marketplace at a time (the active row's Remove
    // swaps for a spinner): wait for the label to revert and the summary.
    await page.getByTestId('cc-marketplace-refresh-all').click()
    await expect(page.getByTestId('cc-marketplace-refresh-all')).toContainText('Refresh all')
    await expect(page.getByTestId('cc-message')).toContainText(/Refreshed \d+ marketplace|Refresh failed/)
    await page.locator('[data-testid="cc-marketplace"]:has-text("tiny-tools")').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('tiny-tools', { exact: false })).toHaveCount(0)
    await expect(page.getByText('anthropics/claude-plugins-official', { exact: false }).first()).toBeVisible()
    // The Models tab offers alias pickers over the runtime's live models.
    await settings.getByRole('tab', { name: 'Models' }).click({ force: true })
    await expect(page.getByTestId('cc-model-row').first()).toBeVisible()
    await expect(page.getByTestId('cc-model-select').first()).toBeVisible()
    await settings.getByRole('button', { name: 'Close' }).click({ force: true })
    await page.waitForTimeout(300)
  },
}

test('plugin family mounts the dsh-next plugins without crash markers', async ({ page }) => {
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

  // No plugin crash strips or page errors anywhere.
  for (const pkg of pluginIds) {
    const id = bareId(pkg)
    await expect(page.getByText(new RegExp(`^dsh-next-${id}:|^\\[dsh-next-${id}\\]`))).toHaveCount(0)
  }
  expect(pageErrors, 'page errors').toEqual([])
  expect(pluginConsoleErrors, 'plugin console errors').toEqual([])

  // Per-plugin DOM markers: drive to each plugin's UI and assert it works.
  for (const pkg of pluginIds) {
    const marker = pluginMarkers[bareId(pkg)]
    if (marker) await marker(page)
  }
})
