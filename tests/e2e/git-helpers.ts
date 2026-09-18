/**
 * Git + GUI helpers shared by the Playwright lanes (checkpoints, notifier,
 * mount markers).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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
 * Live-model lanes need this before a write; keyless auth failures never show
 * Stop, so this no-ops after a short wait.
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
