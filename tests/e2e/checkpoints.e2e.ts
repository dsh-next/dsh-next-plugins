/**
 * Detailed checkpoints e2e against the real DSH mount (scripts/e2e-mount.sh).
 *
 * No live model: `capture` snapshots the session cwd. One shared DSH server,
 * Playwright workers: 1. Each test opens a new session and uses unique files.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { commitFile, git, gitOk, initGitRepo } from './worktrees-helpers.ts'
import {
  captureCheckpoint,
  checkpointsRpc,
  checkpointsRpcRaw,
  listCheckpoints,
  openChangesTab,
  sessionIdOf,
  startChangesSession,
  expectComposerChromeHidden,
} from './checkpoints-helpers.ts'

const workspaceA = process.env.DSH_E2E_WORKSPACE_A
if (!process.env.DSH_E2E_URL) {
  throw new Error('DSH_E2E_URL is not set — run through scripts/e2e-mount.sh')
}
if (!workspaceA) {
  throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh')
}

const KEEP = 'dsh-next-checkpoints-e2e-keep.txt'
const ALPHA = 'dsh-next-checkpoints-e2e.txt'
const BETA = 'dsh-next-checkpoints-e2e-extra.txt'
const ZETA = 'dsh-next-checkpoints-e2e-zeta.txt'
const DELTA = 'dsh-next-checkpoints-e2e-delta.bin'
const EPSILON = 'dsh-next-checkpoints-e2e-crlf.txt'
const SLASH = 'dsh-next-checkpoints-e2e-slash.txt'
const MODAL_A = 'dsh-next-checkpoints-e2e-modal-a.txt'
const MODAL_B = 'dsh-next-checkpoints-e2e-modal-b.txt'
const RPC_A = 'dsh-next-checkpoints-e2e-rpc-a.txt'
const RPC_B = 'dsh-next-checkpoints-e2e-rpc-b.txt'
const GONE = 'dsh-next-checkpoints-e2e-gone.txt'
const PAIR_A = 'dsh-next-checkpoints-e2e-pair-a.txt'
const PAIR_B = 'dsh-next-checkpoints-e2e-pair-b.txt'

function abs(name: string): string {
  return join(workspaceA, name)
}

function cleanupFiles(...names: string[]): void {
  for (const name of names) rmSync(abs(name), { force: true })
}

function restoreTracked(...names: string[]): void {
  for (const name of names) {
    try {
      git(workspaceA, ['checkout', '-q', '--', name])
    } catch {
      cleanupFiles(name)
    }
  }
}

function readUtf(name: string): string {
  return readFileSync(abs(name), 'utf8')
}

function writeUtf(name: string, contents: string): void {
  writeFileSync(abs(name), contents)
}

function row(page: Page, turn: number): Locator {
  return page.locator(`[data-testid="dsh-next-checkpoints-row"][data-turn="${turn}"]`)
}

function rowById(page: Page, checkpointId: string): Locator {
  return page.locator(`[data-testid="dsh-next-checkpoints-row"][data-checkpoint-id="${checkpointId}"]`)
}

function existsGit(cwd: string): boolean {
  try {
    git(cwd, ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

function ensureRepo(): void {
  if (!existsGit(workspaceA)) initGitRepo(workspaceA)
  if (!gitOk(workspaceA, ['rev-parse', 'HEAD'])) {
    commitFile(workspaceA, KEEP, 'keep\n', 'checkpoints e2e keep')
  }
}

test('deleted files show Deleted; switching files updates the diff', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => {
    restoreTracked(GONE)
    cleanupFiles(PAIR_A, PAIR_B)
  }
  try {
    ensureRepo()
    commitFile(workspaceA, GONE, 'doomed\n', 'checkpoints e2e gone')
    const sessionId = await startChangesSession(page)
    rmSync(abs(GONE), { force: true })
    const deleted = await captureCheckpoint(page, sessionId)
    const deletedDiffs = await checkpointsRpc<{ files: readonly { displayPath: string; kind: string }[] }>(
      page,
      'diffs',
      { sessionId, checkpointId: deleted.checkpointId },
    )
    expect(deletedDiffs.files.some((file) => file.displayPath.includes(GONE) && file.kind === 'delete')).toBe(true)
    await expect(rowById(page, deleted.checkpointId)).toBeVisible({ timeout: 15_000 })
    await rowById(page, deleted.checkpointId).click()
    const goneRow = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: GONE })
    await expect(goneRow).toBeVisible({ timeout: 15_000 })
    await goneRow.click()
    await expect(goneRow).toHaveAttribute('data-kind', 'delete')
    await expect(goneRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveText('Deleted')
    await expect(goneRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveAttribute('data-status', 'delete')
    await expect(goneRow.locator('[data-deleted="true"]')).toHaveText(new RegExp(GONE))
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText('doomed')
    await page.keyboard.press('Escape')

    writeUtf(PAIR_A, 'alpha-line\n')
    writeUtf(PAIR_B, 'beta-line\n')
    const pair = await captureCheckpoint(page, sessionId)
    await rowById(page, pair.checkpointId).click()
    const a = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: PAIR_A })
    const b = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: PAIR_B })
    await expect(a).toBeVisible()
    await expect(b).toBeVisible()
    await a.click()
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText('alpha-line')
    await page.keyboard.press('Escape')
    await b.click()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText('beta-line')
  } finally {
    cleanup()
  }
})

test('inspects a checkpoint, refuses silent restore, and rewind restores files', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => {
    restoreTracked(ALPHA)
    cleanupFiles(BETA, ZETA)
  }
  try {
    ensureRepo()
    const headBefore = git(workspaceA, ['rev-parse', 'HEAD']).trim()
    const sessionId = await startChangesSession(page)
    await expectComposerChromeHidden(page)

    writeUtf(ALPHA, 'v1\n')
    const first = await captureCheckpoint(page, sessionId)
    await expect(row(page, first.turn)).toBeVisible({ timeout: 15_000 })
    await row(page, first.turn).click()
    const alphaRow = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: ALPHA })
    await expect(alphaRow).toBeVisible({ timeout: 15_000 })
    await expect(alphaRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveText('Created')
    await expect(alphaRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveAttribute('data-status', 'create')
    await expect(page.getByTestId('dsh-next-checkpoints-files-total-added')).toHaveText('+1')
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toHaveCount(0)
    await alphaRow.click()
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText('v1')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toHaveCount(0)

    commitFile(workspaceA, ALPHA, 'v1\n', 'checkpoints e2e alpha')
    const headAfterCommit = git(workspaceA, ['rev-parse', 'HEAD']).trim()
    expect(headAfterCommit).not.toBe(headBefore)
    await row(page, first.turn).getByTestId('dsh-next-checkpoints-rewind').click()
    await expect(page.getByTestId('dsh-next-checkpoints-modal')).toContainText('HEAD has moved')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('dsh-next-checkpoints-modal')).toHaveCount(0)

    writeUtf(ALPHA, 'v2\n')
    writeUtf(BETA, 'extra\n')
    const second = await captureCheckpoint(page, sessionId)
    await expect(row(page, second.turn)).toBeVisible({ timeout: 15_000 })

    await row(page, first.turn).click()
    await expect(row(page, first.turn)).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('dsh-next-checkpoints-modal')).toHaveCount(0)
    expect(readUtf(ALPHA)).toBe('v2\n')
    expect(readUtf(BETA)).toBe('extra\n')
    await expect(page.getByTestId('dsh-next-checkpoints-file')).toContainText(ALPHA)
    await expect(page.getByTestId('dsh-next-checkpoints-file')).not.toContainText(BETA)

    await row(page, first.turn).getByTestId('dsh-next-checkpoints-rewind').click()
    const modal = page.getByTestId('dsh-next-checkpoints-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Please confirm')
    await expect(modal).toContainText('any changes up to this selected checkpoint will be lost')
    await expect(modal).not.toContainText('primary checkout')
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    expect(readUtf(ALPHA)).toBe('v2\n')

    await row(page, first.turn).getByTestId('dsh-next-checkpoints-rewind').click()
    await expect(modal).toBeVisible()
    const confirm = page.getByTestId('dsh-next-checkpoints-confirm')
    await expect(confirm).toHaveText('Rewind')
    await confirm.click()
    expect(readUtf(ALPHA)).toBe('v2\n')
    await expect(confirm).toHaveText('Restore this checkpoint')
    await confirm.click()
    await expect(modal).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => readUtf(ALPHA)).toBe('v1\n')
    await expect.poll(() => existsSync(abs(BETA)) ? readUtf(BETA) : 'missing').toBe('missing')
    await openChangesTab(page)
    await expect(page.getByTestId('dsh-next-checkpoints-banner')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('dsh-next-checkpoints-banner')).toContainText('Later messages are not sent to the model')
    await expect(row(page, first.turn)).toBeVisible()
    await expect(row(page, second.turn)).toHaveCount(0)
    expect(git(workspaceA, ['rev-parse', 'HEAD']).trim()).toBe(headAfterCommit)

    writeUtf(ZETA, 'after\n')
    const continued = await sessionIdOf(page)
    const third = await captureCheckpoint(page, continued)
    await expect(rowById(page, third.checkpointId)).toBeVisible({ timeout: 15_000 })
    await expect(rowById(page, second.checkpointId)).toHaveCount(0)
    await rowById(page, third.checkpointId).click()
    await expect(page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: ZETA })).toBeVisible()
  } finally {
    cleanup()
  }
})

test('binary rows, multi-file inspect, and CRLF-identical tracked files', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => {
    restoreTracked(KEEP)
    cleanupFiles(DELTA, EPSILON, `${EPSILON}.b`)
  }
  try {
    ensureRepo()
    const sessionId = await startChangesSession(page)

    writeFileSync(abs(DELTA), Buffer.from([65, 0, 66]))
    const binary = await captureCheckpoint(page, sessionId)
    await expect(row(page, binary.turn)).toBeVisible({ timeout: 15_000 })
    await row(page, binary.turn).click()
    await expect(page.getByTestId('dsh-next-checkpoints-file')).toContainText(DELTA)
    await expect(page.getByTestId('dsh-next-checkpoints-kind')).toHaveCount(0)
    await page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: DELTA }).click()
    await expect(page.getByTestId('dsh-next-checkpoints-kind')).toContainText('Binary')
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toHaveCount(0)
    await page.keyboard.press('Escape')
    rmSync(abs(DELTA), { force: true })

    writeUtf(EPSILON, 'one\n')
    writeUtf(`${EPSILON}.b`, 'two\n')
    const both = await captureCheckpoint(page, sessionId)
    await row(page, both.turn).click()
    const extra = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: `${EPSILON}.b` })
    await expect(page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: EPSILON })).toHaveCount(2)
    await extra.click()
    await expect(page.getByTestId('dsh-next-checkpoints-preview')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toBeVisible()
    await expect(page.getByTestId('dsh-next-checkpoints-diff')).toContainText('two')
    await page.keyboard.press('Escape')

    writeUtf(KEEP, 'keep\r\n')
    const crlf = await captureCheckpoint(page, sessionId)
    await row(page, crlf.turn).click()
    await expect(page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: KEEP })).toHaveCount(0)
    writeUtf(KEEP, 'keep-mod\n')
    const modified = await captureCheckpoint(page, sessionId)
    await row(page, modified.turn).click()
    const keepRow = page.getByTestId('dsh-next-checkpoints-file').filter({ hasText: KEEP })
    await expect(keepRow).toBeVisible()
    await expect(keepRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveText('Modified')
    await expect(keepRow.getByTestId('dsh-next-checkpoints-file-kind')).toHaveAttribute('data-status', 'modify')
    writeUtf(KEEP, 'keep\n')
  } finally {
    cleanup()
  }
})

test('Cancel leaves files on disk', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => { cleanupFiles(SLASH) }
  try {
    ensureRepo()
    const sessionId = await startChangesSession(page)
    writeUtf(SLASH, 'slash-v1\n')
    const first = await captureCheckpoint(page, sessionId)
    await expect(row(page, first.turn)).toBeVisible({ timeout: 15_000 })
    writeUtf(SLASH, 'slash-v2\n')
    await captureCheckpoint(page, sessionId)

    await row(page, first.turn).getByTestId('dsh-next-checkpoints-rewind').click()
    const modal = page.getByTestId('dsh-next-checkpoints-modal')
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).toHaveCount(0)
    expect(readUtf(SLASH)).toBe('slash-v2\n')
  } finally {
    cleanup()
  }
})

test('confirm modal lists deletes and later turns, not writes or primary checkout', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => { cleanupFiles(MODAL_A, MODAL_B) }
  try {
    ensureRepo()
    const sessionId = await startChangesSession(page)
    writeUtf(MODAL_A, 'm1\n')
    const first = await captureCheckpoint(page, sessionId)
    await expect(row(page, first.turn)).toBeVisible({ timeout: 15_000 })
    writeUtf(MODAL_A, 'm2\n')
    writeUtf(MODAL_B, 'gone-later\n')
    const second = await captureCheckpoint(page, sessionId)
    await expect(row(page, second.turn)).toBeVisible({ timeout: 15_000 })

    const preview = await checkpointsRpc<{
      filesWritten: string[]
      filesDeleted: string[]
      turnsShadowed: number
      dirtyNonAgent: string[]
      headMoved: boolean
      blockers: string[]
      openTurn: boolean
    }>(page, 'preview', { sessionId, checkpointId: first.checkpointId })
    expect(preview.blockers).toEqual([])
    expect(preview.openTurn).toBe(false)
    expect(preview.filesWritten.some((path) => path.includes(MODAL_A))).toBe(true)
    expect(preview.filesDeleted.some((path) => path.includes(MODAL_B))).toBe(true)
    expect(preview.turnsShadowed).toBeGreaterThan(0)
    expect(preview.dirtyNonAgent).toEqual([])

    await row(page, first.turn).getByTestId('dsh-next-checkpoints-rewind').click()
    const modal = page.getByTestId('dsh-next-checkpoints-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Please confirm')
    await expect(modal).toContainText('any changes up to this selected checkpoint will be lost')
    await expect(modal).not.toContainText('Files that will be written')
    await expect(modal).not.toContainText('primary checkout')
    await expect(modal).toContainText('Files that will be deleted')
    await expect(modal).toContainText(MODAL_B)
    await expect(modal).toContainText('will no longer be sent to the model')
    await expect(modal).not.toContainText('Non-agent dirty paths')
    await page.keyboard.press('Escape')
    expect(readUtf(MODAL_A)).toBe('m2\n')
    expect(readUtf(MODAL_B)).toBe('gone-later\n')
  } finally {
    cleanup()
  }
})

test('browser RPC list, diffs, preview, rewind, and error envelopes', async ({ page }) => {
  test.setTimeout(180_000)
  const cleanup = (): void => { cleanupFiles(RPC_A, RPC_B) }
  try {
    ensureRepo()
    const sessionId = await startChangesSession(page)
    writeUtf(RPC_A, 'rpc-v1\n')
    const first = await captureCheckpoint(page, sessionId)
    writeUtf(RPC_A, 'rpc-v2\n')
    writeUtf(RPC_B, 'rpc-extra\n')
    const second = await captureCheckpoint(page, sessionId)

    const listed = await listCheckpoints(page, sessionId)
    expect(listed.sessionId).toBe(sessionId)
    expect(listed.cwd).toBeTruthy()
    expect(listed.openTurn).toBe(false)
    expect(listed.rewoundTo).toBeNull()
    expect(listed.checkpoints.map((item) => item.id)).toEqual(
      expect.arrayContaining([first.checkpointId, second.checkpointId]),
    )

    const diffs = await checkpointsRpc<{
      checkpointId: string
      files: { displayPath: string; kind: string; hunks: { newText: string }[] }[]
    }>(page, 'diffs', { sessionId, checkpointId: first.checkpointId })
    expect(diffs.checkpointId).toBe(first.checkpointId)
    const rpcFile = diffs.files.find((file) => file.displayPath.includes(RPC_A))
    expect(rpcFile?.kind).toBe('create')
    expect(rpcFile?.hunks.some((hunk) => hunk.newText.includes('rpc-v1'))).toBe(true)
    expect(diffs.files.some((file) => file.displayPath.includes(RPC_B))).toBe(false)

    const missing = await checkpointsRpcRaw(page, 'diffs', { sessionId, checkpointId: 'no-such-checkpoint' })
    expect(missing.status).toBe(200)
    expect(missing.body).toMatchObject({ error: { code: 'checkpoint-not-found' } })

    const bad = await checkpointsRpcRaw(page, 'list', {})
    expect(bad.status).toBe(200)
    expect(bad.body).toMatchObject({ error: { code: 'bad-request' } })

    const nope = await checkpointsRpcRaw(page, 'nope', { sessionId })
    expect(nope.status).toBe(404)

    const rewound = await checkpointsRpc<{
      ok: true
      rewoundTo: string
      filesWritten: number
      filesDeleted: number
    }>(page, 'rewind', { sessionId, checkpointId: first.checkpointId })
    expect(rewound.ok).toBe(true)
    expect(rewound.rewoundTo.split(':').slice(-2)).toEqual(first.checkpointId.split(':').slice(-2))
    expect(rewound.filesWritten).toBeGreaterThan(0)
    expect(rewound.filesDeleted).toBeGreaterThan(0)
    await expect.poll(() => readUtf(RPC_A)).toBe('rpc-v1\n')
    await expect.poll(() => existsSync(abs(RPC_B)) ? 'present' : 'missing').toBe('missing')

    const after = await listCheckpoints(page, sessionId)
    expect(after.rewoundTo).toBe(first.checkpointId)
    expect(after.checkpoints.map((item) => item.id)).toContain(first.checkpointId)
    expect(after.checkpoints.map((item) => item.id)).not.toContain(second.checkpointId)
  } finally {
    cleanup()
  }
})

