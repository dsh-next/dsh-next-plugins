/**
 * GUI helpers for the checkpoints Playwright lane.
 */
import { expect, type Page } from '@playwright/test'

export async function dismissOnboarding(page: Page): Promise<void> {
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

export async function closeDialogs(page: Page): Promise<void> {
  for (let round = 0; round < 4; round++) {
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

export async function openWorkspaceSession(page: Page, title: string): Promise<void> {
  const hero = page.getByRole('textbox', { name: 'Choose workspace' })
  if (await hero.isVisible().catch(() => false)) {
    await hero.click({ force: true })
    const option = page.getByRole('option', { name: title }).first()
    if (await option.isVisible().catch(() => false)) {
      await option.click({ force: true })
    } else {
      await page.getByText(title, { exact: true }).last().click({ force: true })
    }
  }
  const row = page.locator('[role="treeitem"]').filter({ hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.hover({ force: true })
  const neu = page.getByRole('button', { name: new RegExp(`New session in ${title}`) })
  await expect(neu).toBeVisible({ timeout: 15_000 })
  await neu.click({ force: true })
  const conversation = page.locator('[contenteditable="true"]').or(page.getByRole('tab')).first()
  await expect(conversation).toBeVisible({ timeout: 20_000 })
}

export async function unblank(page: Page, text: string): Promise<void> {
  const composer = page.locator('[contenteditable="true"]')
    .or(page.getByRole('textbox', { name: /Describe what you want/ }))
    .first()
  await composer.click({ timeout: 15_000 })
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')
  await composer.pressSequentially(text, { delay: 8 })
  const send = page.getByRole('button', { name: 'Send message' })
  if (await send.isEnabled().catch(() => false)) {
    await send.click({ timeout: 8_000 }).catch(async () => {
      await composer.press('Enter')
    })
  } else {
    await composer.press('Enter')
  }
  const stop = page.getByRole('button', { name: /Stop/i })
  const started = await stop.first().isVisible().catch(() => false)
  if (started) {
    await expect(stop.first()).toBeHidden({ timeout: 20_000 })
  } else {
    await page.waitForTimeout(1_200)
  }
}

/** Composer chrome is hidden; the seat stays for Trajectory's bottom fade. */
export async function expectComposerChromeHidden(page: Page): Promise<void> {
  await expect(page.locator('[data-composer-seat] > *').first()).toBeHidden({ timeout: 10_000 })
}

export async function openChangesTab(page: Page): Promise<void> {
  const tab = page.getByRole('tablist').getByRole('tab', { name: 'Checkpoints' })
  await expect(tab).toBeVisible({ timeout: 45_000 })
  for (let attempt = 0; attempt < 4; attempt++) {
    await tab.click({ force: true })
    if (await page.getByTestId('dsh-next-checkpoints').isVisible().catch(() => false)) return
    await page.waitForTimeout(500)
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('dsh-next-checkpoints')).toBeVisible({ timeout: 15_000 })
}

export async function sessionIdOf(page: Page): Promise<string> {
  const root = page.getByTestId('dsh-next-checkpoints')
  await expect(root).toBeVisible()
  const id = await root.getAttribute('data-session-id')
  if (id === null || id === '') throw new Error('Changes view has no data-session-id')
  return id
}

/** Click tool-approval controls that block a live Write. Do not toggle Access mode. */
export async function clickWriteApprovals(page: Page): Promise<void> {
  const names = ['Approve', 'Allow', 'Allow this', 'Run', 'Accept']
  for (const name of names) {
    const btn = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true })
      await page.waitForTimeout(200)
    }
  }
}

/** Wait until Stop appears then disappears, approving prompts along the way. */
export async function waitForTurnIdleAllowingWrites(page: Page, timeoutMs = 180_000): Promise<void> {
  const stop = page.getByRole('button', { name: /Stop/i })
  await expect(stop.first()).toBeVisible({ timeout: Math.min(timeoutMs, 45_000) })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await clickWriteApprovals(page)
    if (!(await stop.first().isVisible().catch(() => false))) return
    await page.waitForTimeout(400)
  }
  throw new Error('turn did not become idle')
}

export async function sendComposer(page: Page, text: string): Promise<void> {
  const hero = page.getByRole('textbox', { name: /Describe what you want to build/ })
  const composer = (await hero.isVisible().catch(() => false))
    ? hero
    : page.locator('[contenteditable="true"]').first()
  await composer.click({ timeout: 15_000 })
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')
  await composer.pressSequentially(text, { delay: 8 })
  const send = page.getByRole('button', { name: 'Send message' })
  await expect(send).toBeEnabled({ timeout: 15_000 })
  await send.click()
}

export async function startChangesSession(page: Page): Promise<string> {
  const base = process.env.DSH_E2E_URL
  if (!base) throw new Error('DSH_E2E_URL is not set')
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
  await dismissOnboarding(page)
  await closeDialogs(page)
  await openWorkspaceSession(page, 'workspace-a')
  await unblank(page, `hello checkpoints ${Date.now()}`)
  await openChangesTab(page)
  const sessionId = await sessionIdOf(page)
  const listed = await listCheckpoints(page, sessionId)
  const workspaceA = process.env.DSH_E2E_WORKSPACE_A
  if (workspaceA !== undefined && listed.cwd !== null && !listed.cwd.endsWith('workspace-a') && !listed.cwd.includes(workspaceA)) {
    throw new Error(`session cwd ${listed.cwd} is not workspace-a (${workspaceA})`)
  }
  return sessionId
}

export interface CheckpointsRpcResult {
  readonly status: number
  readonly body: unknown
}

export async function checkpointsRpcRaw(
  page: Page,
  method: string,
  args: unknown,
): Promise<CheckpointsRpcResult> {
  return page.evaluate(async ({ method, args }) => {
    const res = await fetch('/dsh-next-checkpoints/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args }),
    })
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text) as unknown
    } catch {
      // keep raw text
    }
    return { status: res.status, body }
  }, { method, args })
}

export async function checkpointsRpc<T>(page: Page, method: string, args: unknown): Promise<T> {
  const result = await checkpointsRpcRaw(page, method, args)
  if (result.status !== 200) {
    throw new Error(`${method} HTTP ${result.status}: ${JSON.stringify(result.body)}`)
  }
  if (result.body !== null && typeof result.body === 'object' && 'error' in result.body) {
    throw new Error(`${method} failed: ${JSON.stringify(result.body)}`)
  }
  return result.body as T
}

export async function listCheckpoints(page: Page, sessionId: string): Promise<{
  sessionId: string
  checkpoints: readonly { id: string; turn: number; seq: number; fileCount: number }[]
  rewoundTo: string | null
  openTurn: boolean
  cwd: string | null
}> {
  return checkpointsRpc(page, 'list', { sessionId })
}

export async function captureCheckpoint(page: Page, sessionId: string): Promise<{ checkpointId: string; turn: number }> {
  let last = ''
  for (let attempt = 0; attempt < 25; attempt++) {
    const payload = await page.evaluate(async (id) => {
      const res = await fetch('/dsh-next-checkpoints/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'capture', args: { sessionId: id } }),
      })
      return res.json() as Promise<{ checkpointId?: string; turn?: number; error?: { code?: string; message?: string } }>
    }, sessionId)
    if (payload.error?.code === 'turn-open') {
      last = JSON.stringify(payload)
      await page.waitForTimeout(400)
      continue
    }
    if (payload.error !== undefined || typeof payload.checkpointId !== 'string' || typeof payload.turn !== 'number') {
      throw new Error(`capture failed: ${JSON.stringify(payload)}`)
    }
    return { checkpointId: payload.checkpointId, turn: payload.turn }
  }
  throw new Error(`capture failed: ${last}`)
}
