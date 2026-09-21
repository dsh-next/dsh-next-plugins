import { test as base, expect } from '@playwright/test'
import { assertMountHealthy, runGuardedMarker, watchBrowserErrors } from '../../scripts/e2e-guards.mjs'

export { expect }

function requiredBaseUrl(): string {
  const url = process.env.DSH_E2E_URL
  if (!url) throw new Error('DSH_E2E_URL is not set; run pnpm run test:e2e with a named suite')
  return url
}
export const BASE_URL = requiredBaseUrl()
export const pluginIds = (process.env.DSH_E2E_PLUGINS ?? '').split(',').map(id => id.trim()).filter(Boolean)

/** A focused suite must fail rather than silently skip an unmounted subject. */
export function requireMountedPlugin(slug: string): void {
  expect(pluginIds, `${slug} must be mounted by the suite runner`).toContain(`@dsh-next/dsh-next-${slug}`)
}

/** Keep guards active during setup, every interaction, and test teardown. */
export const test = base.extend<{ mountHealth: void }>({
  mountHealth: [async ({ page, context }, use) => {
    const errors = watchBrowserErrors(context)
    try {
      await runGuardedMarker(use, () =>
        assertMountHealthy(page, pluginIds, errors.pageErrors, errors.pluginConsoleErrors, expect))
    } finally {
      errors.dispose()
    }
  }, { auto: true }],
})
