import { expect, type Page, type Route } from '@playwright/test'

/** Drive the real mounted UI without launching applications on the test machine. */
export async function verifySkillFolderOpener(page: Page, directory: string): Promise<void> {
  let apps: string[] = ['finder', 'vscode']
  let available = true
  let launchFails = false
  const launches: Array<{ app: string; path: string }> = []
  const appsRoute = (route: Route) => route.fulfill({ status: available ? 200 : 404, contentType: 'application/json', body: JSON.stringify({ apps }) })
  const launchRoute = async (route: Route) => {
    launches.push(route.request().postDataJSON())
    await route.fulfill({ status: launchFails ? 502 : 200, contentType: 'application/json', body: JSON.stringify({ ok: !launchFails }) })
  }
  await page.route('**/open-in-app/apps', appsRoute)
  await page.route('**/open-in-app/open', launchRoute)
  const card = page.getByTestId('skills-card').filter({ has: page.getByTestId('skills-detail').filter({ hasText: 'e2e-test-skill' }) }).first()
  const detail = page.getByTestId('skills-skill-detail')
  const open = () => card.getByTestId('skills-detail').click()
  const close = () => detail.getByTestId('skills-detail-close').click()
  try {
    await open()
    await expect(detail.getByTestId('skills-open-folder')).toBeVisible()
    await detail.getByTestId('skills-open-folder-menu').focus()
    await page.keyboard.press('Enter')
    const vscode = page.getByRole('menuitem', { name: 'VS Code', exact: true })
    await expect(vscode).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Finder', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(vscode).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('skills-open-folder-menu')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(page.getByTestId('skills-search')).toBeVisible()
    await open()
    await detail.getByTestId('skills-open-folder-menu').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('menuitem', { name: 'Finder', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(vscode).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => launches).toEqual([{ app: 'vscode', path: directory }])
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('skills-open-folder')).toBeFocused()
    await close()
    await open()
    await expect(detail.getByTestId('skills-open-folder')).toHaveAttribute('aria-label', /VS Code/)
    launchFails = true
    await detail.getByTestId('skills-open-folder').click()
    await expect(detail.getByTestId('skills-open-folder-error')).toBeVisible()
    await expect(detail).toBeVisible()
    launchFails = false
    await detail.getByTestId('skills-open-folder').click()
    await expect(detail.getByTestId('skills-open-folder-error')).toHaveCount(0)
    await expect.poll(() => launches.length).toBe(3)
    await close()

    for (const state of ['empty', 'unavailable'] as const) {
      apps = []
      available = state !== 'unavailable'
      const response = page.waitForResponse((r) => r.url().endsWith('/open-in-app/apps'))
      await open()
      await response
      await expect(detail.getByTestId('skills-detail-body')).toBeVisible()
      await expect(detail.getByTestId('skills-folder-opener')).toHaveCount(0)
      await close()
    }

    // A centered modal must keep every application reachable in a short viewport.
    available = true
    apps = ['finder', 'vscode', 'cursor', 'vscodeinsiders', 'windsurf', 'zed', 'sublimetext', 'xcode', 'androidstudio', 'intellij', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rider', 'rustrover', 'fork', 'sourcetree', 'github', 'tower', 'gitkraken', 'smartgit', 'sublimemerge', 'ghostty', 'warp', 'iterm', 'kitty', 'terminal', 'windowsterminal', 'gitbash', 'gnometerminal', 'konsole', 'explorer', 'filemanager']
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: viewport.width, height: 500 })
    await open()
    await detail.getByTestId('skills-open-folder-menu').click()
    const lastApp = page.getByRole('menuitem', { name: 'Files', exact: true })
    await lastApp.scrollIntoViewIfNeeded()
    const lastBox = await lastApp.boundingBox()
    expect(lastBox).not.toBeNull()
    expect(lastBox!.y).toBeGreaterThanOrEqual(0)
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(500)
    await lastApp.click()
    await expect.poll(() => launches.at(-1)).toEqual({ app: 'filemanager', path: directory })
    await close()
    await page.setViewportSize(viewport)

    const offering = page.getByTestId('skills-card').filter({ has: page.getByTestId('skills-detail').filter({ hasText: 'aaa-offering' }) })
    await offering.getByTestId('skills-detail').click()
    await expect(detail.getByTestId('skills-detail-body')).toBeVisible()
    await expect(detail.getByTestId('skills-folder-opener')).toHaveCount(0)
    await close()
  } finally {
    await page.unroute('**/open-in-app/apps', appsRoute)
    await page.unroute('**/open-in-app/open', launchRoute)
  }
}
