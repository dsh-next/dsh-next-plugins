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
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
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

export async function openWorktreeMenu(page: Page, slug: string): Promise<void> {
  const nestedRow = page.locator('[role="treeitem"]').filter({
    has: page.locator(`[data-dshx-worktree="${slug}"]`),
  })
  await nestedRow.hover()
  await expect(nestedRow.locator('button').first()).toBeVisible({ timeout: 20_000 })
  await nestedRow.locator('button').last().click({ force: true })
}

export async function unblankCurrentSession(page: Page, text: string): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click({ timeout: 15_000 })
  await composer.fill(text)
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


