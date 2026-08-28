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
async function openNotifierCard(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      await page.getByText('Settings', { exact: true }).first().click({ force: true })
      await page.waitForTimeout(600)
      await page.getByText('Plugins', { exact: true }).first().click({ force: true })
      const card = page.getByText('DSH Next Notifier').first()
      await card.waitFor({ state: 'visible', timeout: 4000 })
      await card.click({ force: true })
      return
    } catch {
      // A dialog may have re-appeared on a cold load; dismiss and retry.
      await page.waitForTimeout(500)
    }
  }
  throw new Error('could not open the DSH Next Notifier card after retries')
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

  // Install a Notification spy BEFORE navigation so the behavioral assert can
  // measure the auto-dismiss cadence (the page loads once and stays loaded).
  if (pluginIds.includes('@dsh-next/dsh-next-notifier')) {
    await page.addInitScript(installNotificationSpy)
  }

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

  // Notifier-specific behavioral check: the notification auto-dismiss must honor
  // the configured "Notification duration" value, not the hardcoded 12s default.
  // The marker above already opened the notifier card (onboarding dismissed), so
  // we drive it here to avoid a fresh context re-showing the onboarding modal.
  // We spy on Notification, set a distinct duration, click the Test button, and
  // assert the close fires near the configured value.
  if (pluginIds.includes('@dsh-next/dsh-next-notifier')) {
    await assertNotifierBehavior(page)
  }
})

// Installs a Notification spy that records each creation/close with timestamps,
// so the behavioral assert can measure the auto-dismiss cadence. Runs as an
// init script before the page loads.
function installNotificationSpy(): void {
  const events: { created: number; closed: number | null; title: string }[] = []
  ;(window as unknown as { __notifEvents: typeof events }).__notifEvents = events
  class SpyNotification {
    static permission = 'granted'
    static requestPermission() { return Promise.resolve('granted') }
    private created = Date.now()
    private closed: number | null = null
    close() { this.closed = Date.now(); events.push({ created: this.created, closed: this.closed, title: this.title }) }
    onclose: (() => void) | null = null
    onclick: (() => void) | null = null
    constructor(public title: string, public opts?: Record<string, unknown>) {}
  }
  Object.defineProperty(window, 'Notification', { value: SpyNotification, configurable: true, writable: true })
}

// Behavioral check for the auto-dismiss duration: set the "Notification
// duration" slider to a distinct value, click the Test button (which uses it),
// and assert the notification closes near that value — not the hardcoded 12s.
// Runs against the already-open notifier card from the mount marker.
async function assertNotifierBehavior(page: Page): Promise<void> {
  // Set the duration to a distinct 5s and confirm the host persisted it.
  const range = page.locator('input[type="range"][min="3"]')
  await range.fill('5')
  await expect(page.getByText('5s')).toBeVisible()

  // Trigger the Test browser notification (uses the configured duration).
  await page.getByRole('button', { name: 'Test' }).click()

  // Poll the recorded close events for up to ~8s. A correct build closes at
  // ~5s; a default-12s regression would not close within this window.
  const started = Date.now()
  let elapsed: number | null = null
  while (elapsed === null && Date.now() - started < 8000) {
    const events = await page.evaluate(() => {
      return (window as unknown as { __notifEvents: { created: number; closed: number | null; title: string }[] }).__notifEvents
    })
    const closed = events.find((e) => e.closed !== null)
    if (closed) elapsed = closed.closed - closed.created
    else await page.waitForTimeout(200)
  }

  expect(elapsed, 'notification auto-dismiss should fire near the configured 5s').not.toBeNull()
  // Allow ~1.5s tolerance for scheduling/round-trip jitter.
  expect(Math.abs(elapsed! - 5000)).toBeLessThan(1500)
}
