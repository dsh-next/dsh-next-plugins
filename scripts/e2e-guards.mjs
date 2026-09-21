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

/** Capture initial and secondary-page errors; disposal removes only owned listeners. */
export function watchBrowserErrors(context) {
  const pageErrors = []
  const pluginConsoleErrors = []
  const watched = new Set()
  const onError = error => { pageErrors.push(error.message) }
  const onConsole = message => {
    if (message.type() === 'error' && /dsh-next[-/]/.test(message.text())) pluginConsoleErrors.push(message.text())
  }
  const watch = page => {
    if (watched.has(page)) return
    watched.add(page)
    page.on('pageerror', onError)
    page.on('console', onConsole)
  }
  context.pages().forEach(watch)
  context.on('page', watch)
  return {
    pageErrors,
    pluginConsoleErrors,
    dispose() {
      context.off('page', watch)
      for (const page of watched) {
        page.off('pageerror', onError)
        page.off('console', onConsole)
      }
      watched.clear()
    },
  }
}

export async function runGuardedMarker(marker, assertHealthy) {
  try {
    await marker()
  } finally {
    // Include errors emitted by the interaction, even when its assertion fails.
    await assertHealthy()
  }
}

/** Reject silent smoke coverage gaps, including an empty selected roster. */
export function requirePluginMarkers(pluginIds, markers, nonUiClients = {}) {
  if (pluginIds.length === 0) throw new Error('No client plugins selected for the family smoke')
  for (const pkg of pluginIds) {
    const id = bareId(pkg)
    const marker = Object.hasOwn(markers, id) && typeof markers[id] === 'function'
    const reason = Object.hasOwn(nonUiClients, id) && nonUiClients[id]
    if (!marker && !(typeof reason === 'string' && reason.trim())) {
      throw new Error(`${pkg} needs a mount marker or an explicit non-UI reason`)
    }
  }
}

export async function requireCheckpointsPanel(page, prepareSession, expect) {
  await prepareSession()
  const tab = page.getByRole('tablist').getByRole('tab', { name: 'Checkpoints' })
  await expect(tab).toBeVisible({ timeout: 45_000 })
  await tab.click({ force: true })
  await expect(page.getByTestId('dsh-next-checkpoints')).toBeVisible({ timeout: 15_000 })
}
