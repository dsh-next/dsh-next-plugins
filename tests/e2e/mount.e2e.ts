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

// A fresh scratch home walks a first-run onboarding flow, each step a modal
// whose mask intercepts pointer events on the sidebar. Dismiss every known
// step (in order) so later markers can drive the app UI.
async function dismissOnboarding(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later', 'Skip']) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(300)
    }
  }
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
    await dismissOnboarding(page)
    await page.getByText('Settings', { exact: true }).first().click()
    await page.getByText('Plugins', { exact: true }).first().click()
    await expect(page.getByText('DSH Next Notifier').first()).toBeVisible()
    await page.getByText('DSH Next Notifier').first().click()
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('Notification duration')).toBeVisible()
    await expect(page.getByText('Test browser notification')).toBeVisible()
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
