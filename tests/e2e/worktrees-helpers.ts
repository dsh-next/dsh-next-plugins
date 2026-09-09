/**
 * Git + GUI helpers for the worktrees Playwright marker.
 *
 * Disk helpers mirror packages/dsh-next-worktrees/tests/git-fixture.ts so
 * e2e and host fixture tests set up the same states. GUI helpers keep the
 * marker from re-implementing menu/refresh/unblank.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'

export function git(cwd: string, args: readonly string[]): string {
  let last: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8' })
    } catch (error) {
      last = error
      const message = error instanceof Error ? error.message : String(error)
      if (!/index\.lock/.test(message)) throw error
      execFileSync('sleep', ['0.15'])
    }
  }
  throw last
}

export function gitOk(cwd: string, args: readonly string[]): boolean {
  try {
    git(cwd, args)
    return true
  } catch {
    return false
  }
}

export function hasMergeHead(cwd: string): boolean {
  return gitOk(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
}

export function initGitRepo(cwd: string, branch = 'main'): void {
  git(cwd, ['init', '-q', '-b', branch])
  git(cwd, ['config', 'user.email', 'e2e@example.com'])
  git(cwd, ['config', 'user.name', 'e2e'])
  git(cwd, ['config', 'commit.gpgsign', 'false'])
}

export function commitFile(cwd: string, relative: string, contents: string, message: string): void {
  const full = join(cwd, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
  git(cwd, ['add', '--', relative])
  git(cwd, ['commit', '-q', '-m', message])
}

/**
 * Finish an in-progress merge as the bound session's agent would: write a
 * resolution, add, commit. Used by the keyless smoke (no live model).
 */
export function completeConflictedMerge(
  cwd: string,
  relative: string,
  contents: string,
  message: string,
): void {
  const full = join(cwd, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
  git(cwd, ['add', '--', relative])
  git(cwd, ['-c', 'core.editor=true', 'commit', '-q', '-m', message])
}

export interface WorktreeRegistry {
  readonly bindings: readonly { slug: string; sessionId: string }[]
}

export function registryPath(workspace: string): string {
  return join(workspace, '.dsh', 'worktrees', 'registry.json')
}

export function readRegistry(workspace: string): WorktreeRegistry {
  return JSON.parse(readFileSync(registryPath(workspace), 'utf8')) as WorktreeRegistry
}

export function worktreeDir(workspace: string, slug: string): string {
  return join(workspace, '.dsh', 'worktrees', slug)
}

export async function refreshWorktrees(page: Page): Promise<void> {
  await page.evaluate(() => { window.dispatchEvent(new Event('dsh-next-worktrees:refresh')) })
}

/** Wait until the named create flow is idle (re-entry guard is off). */
export async function waitForCreateIdle(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-dshx-creating', 'false', {
    timeout: 20_000,
  })
}

/**
 * Occupy every unsuffixed suggestion with a retained plugin branch, without
 * creating a checkout or registry row. The current picker couples adjective
 * index `seed % 10` with noun index `(seed + 3) % 10`: ten pairs, not 100.
 * Keep this fixture independent of the product generator so its old,
 * collision-unaware implementation must fail the browser regression.
 */
export function occupySuggestionBranches(workspace: string): readonly string[] {
  const names = [
    'quiet-harbor', 'brisk-meadow', 'steady-lantern', 'clever-compass',
    'polished-pebble', 'focused-cinder', 'tidy-juniper', 'bold-otter',
    'nimble-falcon', 'patient-cedar',
  ] as const
  for (const name of names) {
    git(workspace, ['branch', `dsh-worktrees/${name}`])
  }
  return names
}

/** Confirm the name modal. Omit `name` to accept the real host suggestion. */
export async function confirmCreateName(page: Page, name?: string): Promise<void> {
  const modal = page.locator('[data-dshx-modal="create"]')
  await expect(modal).toBeVisible({ timeout: 10_000 })
  if (name !== undefined) {
    await modal.locator('[data-dshx-create-name]').fill(name)
  }
  await modal.locator('[data-dshx-button="create"]').click()
}

export async function openWorktreeMenu(page: Page, slug: string): Promise<void> {
  const icon = page.locator(`[data-dshx-worktree="${slug}"]`)
  const nestedRow = page.locator('[role="treeitem"]').filter({ has: icon })
  // The stock row hides its identity icon while hovered; the row stays usable.
  await expect(nestedRow).toBeVisible({ timeout: 20_000 })
  await nestedRow.scrollIntoViewIfNeeded()
  await nestedRow.hover({ force: true })
  await nestedRow.getByRole('button', { name: /Workspace actions/ }).click({ force: true, timeout: 20_000 })
}

/** Open the first session under a cluster (the identity lives on the folder). */
export async function openWorktreeSession(page: Page, slug: string): Promise<void> {
  const items = page.locator('[role="treeitem"]')
  const cluster = items.filter({ has: page.locator(`[data-dshx-worktree="${slug}"]`) })
  await expect(cluster).toBeVisible({ timeout: 20_000 })
  if (await cluster.getAttribute('aria-expanded') !== 'true') {
    await cluster.click({ force: true })
  }
  const clusterHandle = await cluster.elementHandle()
  if (clusterHandle === null) throw new Error(`cluster for ${slug} is gone`)
  const count = await items.count()
  for (let i = 0; i < count; i += 1) {
    const handle = await items.nth(i).elementHandle()
    if (handle === null) continue
    const same = await clusterHandle.evaluate((a, b) => a === b, handle)
    if (!same) continue
    for (let j = i + 1; j < count; j += 1) {
      const row = items.nth(j)
      if (await row.locator('[data-dshx-worktree]').count() > 0) break
      await row.click({ force: true })
      return
    }
    throw new Error(`no session under worktree ${slug}`)
  }
  throw new Error(`cluster for ${slug} not in the tree`)
}

export async function unblankCurrentSession(page: Page, text: string): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click({ timeout: 15_000 })
  await composer.fill(text)
  await composer.press('Enter')
}

/** Submit a slash command (name without the leading slash). */
export async function runSlashCommand(page: Page, name: string): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click({ timeout: 15_000 })
  await composer.fill(`/${name}`)
  await composer.press('Enter')
}

/**
 * Wait until a generation that started after send is no longer running.
 * Live-model lanes need this before Update (running-session is a blocker).
 * Keyless auth failures never show Stop; we then no-op after a short wait.
 */
export async function waitForTurnIdle(page: Page, timeoutMs = 120_000): Promise<void> {
  const stop = page.getByRole('button', { name: /Stop/i })
  const started = await stop.first().isVisible().catch(() => false)
  if (!started) {
    await page.waitForTimeout(1_500)
    if (!(await stop.first().isVisible().catch(() => false))) return
  }
  await expect(stop.first()).toBeHidden({ timeout: timeoutMs })
}


