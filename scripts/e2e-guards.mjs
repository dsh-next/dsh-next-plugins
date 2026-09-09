// Browser-independent orchestration; the real lane supplies Playwright assertions.
// Crash strips use the Cordis ID, not the scoped npm package name.
export function bareId(pkg) {
  return pkg.startsWith('@dsh-next/') ? pkg.slice('@dsh-next/'.length) : pkg
}

export function crashPattern(pkg) {
  const id = [...bareId(pkg)].map((ch) => '.+*?^$()[]{}|\\'.includes(ch) ? '\\' + ch : ch).join('')
  return new RegExp('^' + id + ':|^\\[' + id + '\\]')
}

export async function assertMountHealthy(page, pluginIds, pageErrors, pluginConsoleErrors, expect) {
  for (const pkg of pluginIds) {
    await expect(page.getByText(crashPattern(pkg))).toHaveCount(0)
  }
  expect(pageErrors, 'page errors').toEqual([])
  expect(pluginConsoleErrors, 'plugin console errors').toEqual([])
}

export async function runGuardedMarker(marker, assertHealthy) {
  try {
    await marker()
  } finally {
    // Include errors emitted by the interaction, even when its assertion fails.
    await assertHealthy()
  }
}

export async function requireCheckpointsPanel(page, prepareSession, expect) {
  await prepareSession()
  const tab = page.getByRole('tablist').getByRole('tab', { name: 'Checkpoints' })
  await expect(tab).toBeVisible({ timeout: 45_000 })
  await tab.click({ force: true })
  await expect(page.getByTestId('dsh-next-checkpoints')).toBeVisible({ timeout: 15_000 })
}
