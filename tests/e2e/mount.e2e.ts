/**
 * Mount smoke: prove the packed @dsh-next/dsh-next-* plugin tarballs mount
 * into a real `dsh web` instance and render without crash markers.
 *
 * The server is booted by `scripts/e2e-mount.sh`; the base URL arrives via
 * `DSH_E2E_URL` and the plugin list via `DSH_E2E_PLUGINS` (comma-separated
 * npm package names `@dsh-next/dsh-next-<slug>`) so the same spec works as
 * packages gain UI.
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
      if (await page.getByText('Installed', { exact: true }).first().isVisible().catch(() => false)) return
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
  // nav level as General/Models/Plugins) with Installed, Search, and Providers
  // tabs backed by a local GitHub-provider cache. Opening it must
  // reveal the tab bar, the seeded throwaway skill must be toggleable and
  // removable end-to-end (guards a client-side state-refresh regression the
  // "section renders" check cannot see), and the empty Providers state must
  // render. No network: providers are only added manually.
  'dsh-next-skills': async (page) => {
    await openSkillsSection(page)
    await expect(page.getByText('Installed', { exact: true })).toBeVisible()
    await expect(page.getByText('Search', { exact: true })).toBeVisible()
    await expect(page.getByText('Providers', { exact: true })).toBeVisible()
    await expect(page.getByText('e2e-test-skill', { exact: true }).first()).toBeVisible()
    const row = page.getByText('e2e-test-skill', { exact: true }).first()
      .locator('xpath=ancestor::div[contains(@class,"skill")][1]')
    const disable = row.locator('button', { hasText: 'Disable' })
    await expect(disable).toBeVisible()
    await disable.click({ force: true })
    await expect(row.locator('button', { hasText: 'Enable' })).toBeVisible()
    await row.locator('button', { hasText: 'Remove' }).click({ force: true })
    // The Settings shell itself is a role="dialog"; scope by the popup's name.
    const dialog = page.getByRole('dialog', { name: 'Remove skill "e2e-test-skill"?' })
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: 'Remove' }).click({ force: true })
    await expect(page.getByText('e2e-test-skill', { exact: true })).toHaveCount(0)
    // Providers tab renders its empty state and the add-provider control.
    await page.getByText('Providers', { exact: true }).first().click({ force: true })
    await expect(page.getByText('No providers', { exact: false }).first()).toBeVisible()
    await expect(page.locator('input[placeholder*="github.com"]').first()).toBeVisible()
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
    // its plugin, the detail modal shows the component inventory (including
    // the not-bridged LSP family), and the radio modal installs globally and
    // uninstalls through the real host service.
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
    // Remove the fixture marketplace; the seeded official one remains
    // (the Remove button inside the tiny-tools row, not a foreign one).
    await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
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

  // Every plugin's client bundle is served at /plugins/<package-name>/client.js.
  // A 404 here means the profile patch failed to register the row (the exact
  // class of bug only a real-mount smoke can catch).
  for (const pkg of pluginIds) {
    const url = `${BASE_URL.replace(/\/$/, '')}/plugins/${pkg}/client.js`
    const res = await page.request.get(url)
    expect(res.status(), `${pkg} client bundle should be served`).toBe(200)
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
