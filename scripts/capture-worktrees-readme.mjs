/**
 * Drive a dark-theme DSH with dsh-next-worktrees and write framed README PNGs.
 *
 * Env: DSH_README_URL, DSH_README_WORKSPACE, DSH_README_OUT
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const REFRAME_ONLY = process.argv.includes('--reframe')
const DSH_URL = process.env.DSH_README_URL
const WORKSPACE = process.env.DSH_README_WORKSPACE
const OUT = process.env.DSH_README_OUT
  ?? join(dirname(fileURLToPath(import.meta.url)), '../packages/dsh-next-worktrees/media')
if (!REFRAME_ONLY && (!DSH_URL || !WORKSPACE)) {
  throw new Error('DSH_README_URL and DSH_README_WORKSPACE are required')
}

const RAW = join(OUT, '.raw')
mkdirSync(RAW, { recursive: true })
mkdirSync(OUT, { recursive: true })

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function commitFile(cwd, relative, contents, message) {
  const full = join(cwd, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
  git(cwd, ['add', '--', relative])
  git(cwd, ['commit', '-q', '-m', message])
}

function worktreeDir(slug) {
  return join(WORKSPACE, '.dsh', 'worktrees', slug)
}

function readRegistry() {
  return JSON.parse(readFileSync(join(WORKSPACE, '.dsh', 'worktrees', 'registry.json'), 'utf8'))
}

async function dismissOnboarding(page) {
  const names = ['Continue', 'Configure later', 'Skip']
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
    await page.waitForTimeout(250)
    const remaining = await page.locator('[role="dialog"]').count().catch(() => 0)
    if (!clicked && remaining === 0) return
  }
}

async function refreshWorktrees(page) {
  await page.evaluate(() => { window.dispatchEvent(new Event('dsh-next-worktrees:refresh')) })
}

async function unblank(page, text) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click({ timeout: 15_000 })
  await composer.fill(text)
  await composer.press('Enter')
  await page.waitForTimeout(1200)
}

async function createWorktree(page) {
  const createButton = page.locator('[data-dshx-create$="harbor"]')
  const repoRow = page.locator('[role="treeitem"]').filter({ has: createButton })
  await repoRow.hover()
  await createButton.waitFor({ state: 'visible', timeout: 15_000 })
  const before = new Set(readRegistrySafe().map((row) => row.slug))
  await createButton.click({ force: true })
  const started = Date.now()
  while (Date.now() - started < 25_000) {
    const bindings = readRegistrySafe()
    const created = bindings.find((row) => !before.has(row.slug) && row.sessionId)
    if (created) return created.slug
    await page.waitForTimeout(200)
  }
  throw new Error('worktree create did not claim a session')
}

function readRegistrySafe() {
  const path = join(WORKSPACE, '.dsh', 'worktrees', 'registry.json')
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')).bindings ?? []
  } catch {
    return []
  }
}

async function openMenu(page, slug) {
  const row = page.locator('[role="treeitem"]').filter({
    has: page.locator(`[data-dshx-worktree="${slug}"]`),
  })
  await row.hover({ force: true })
  await row.locator('button').last().click({ force: true })
  await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 10_000 })
  return row
}

async function closeMenus(page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

async function waitState(page, slug, state) {
  await page.locator(`[data-dshx-worktree="${slug}"]`).waitFor({ timeout: 15_000 })
  const started = Date.now()
  while (Date.now() - started < 15_000) {
    const value = await page.locator(`[data-dshx-worktree="${slug}"]`).getAttribute('data-dshx-state')
    if (value === state) return
    await page.waitForTimeout(200)
  }
  throw new Error(`worktree ${slug} never reached state ${state}`)
}

const CANVAS = '#0E0F12'
const BORDER = 'rgba(255,255,255,0.10)'

function framePage(innerHtml) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: ${CANVAS}; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #E8E8EA;
      padding: 28px;
      width: max-content;
    }
    .shot {
      display: inline-block;
      border-radius: 12px;
      border: 1px solid ${BORDER};
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48), 0 2px 0 rgba(255,255,255,0.04) inset;
      overflow: hidden;
      background: #151517;
      vertical-align: top;
    }
    .shot img { display: block; }
    .grid .shot img { width: 340px; height: auto; }
    .row {
      display: inline-flex;
      gap: 16px;
      align-items: stretch;
    }
    .grid {
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 18px;
    }
    .cell { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .label {
      font-size: 11px;
      line-height: 16px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #8B8B90;
      font-weight: 500;
      text-align: center;
    }
    .stack {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      background: #16171B;
      border-radius: 14px;
      border: 1px solid ${BORDER};
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
    }
    .stack img { display: block; border-radius: 8px; width: 336px; height: auto; }
    .legend {
      display: inline-flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      background: #16171B;
      border-radius: 14px;
      border: 1px solid ${BORDER};
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
    }
    .legend-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .legend-row img { display: block; border-radius: 8px; width: 300px; height: auto; }
    .legend-row .label { text-align: left; min-width: 7.5em; }
    .loop {
      width: 720px;
      margin: 0 auto;
      padding: 28px 24px 20px;
      border-radius: 16px;
      border: 1px solid ${BORDER};
      background: linear-gradient(180deg, #17181C 0%, #121316 100%);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
    }
    .loop-title {
      font-size: 13px;
      line-height: 18px;
      color: #8B8B90;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 500;
      margin: 0 0 18px;
      text-align: center;
    }
    .steps {
      display: flex;
      align-items: stretch;
      gap: 0;
    }
    .step {
      flex: 1;
      background: #1C1D22;
      border: 1px solid ${BORDER};
      border-radius: 10px;
      padding: 14px 12px;
      text-align: center;
    }
    .step strong {
      display: block;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      color: #F2F2F4;
    }
    .step span {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      line-height: 18px;
      color: #9A9AA0;
    }
    .arrow {
      width: 28px;
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #5C5C62;
      font-size: 18px;
    }
    .note {
      margin: 14px 0 0;
      text-align: center;
      font-size: 12px;
      line-height: 18px;
      color: #9A9AA0;
    }
    .note em { color: #8AB4FF; font-style: normal; }
  </style>
</head>
<body>${innerHtml}</body>
</html>`
}

function imgTag(path, alt = '') {
  const b64 = readFileSync(path).toString('base64')
  return `<img alt="${alt}" src="data:image/png;base64,${b64}" />`
}

async function renderHtml(browser, html, outPath, selector = 'body > *', scale = 2) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1400 },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
  })
  await page.setContent(html, { waitUntil: 'load' })
  const target = page.locator(selector).first()
  await target.waitFor({ state: 'visible' })
  await target.screenshot({ path: outPath, type: 'png' })
  await page.close()
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.goto(DSH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(1500)
  await dismissOnboarding(page)

  const dark = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  if (!dark) {
    throw new Error('harness did not boot in dark theme (body[data-ds-dark-theme] missing)')
  }

  await refreshWorktrees(page)
  const createButton = page.locator('[data-dshx-create$="harbor"]')
  const repoRow = page.locator('[role="treeitem"]').filter({ has: createButton })
  await repoRow.waitFor({ state: 'visible', timeout: 20_000 })
  await repoRow.hover()
  await createButton.waitFor({ state: 'visible', timeout: 10_000 })
  await repoRow.screenshot({ path: join(RAW, 'create-row.png') })

  // Three worktrees in different states, each unblanked so the sweeper keeps them.
  console.log('creating ahead worktree')
  const slugAhead = await createWorktree(page)
  console.log('ahead slug', slugAhead)
  await unblank(page, 'Fix checkout timeout')
  commitFile(
    worktreeDir(slugAhead),
    'src/checkout.ts',
    'export async function charge(orderId: string): Promise<void> {\n  await fetch(`/checkout/${orderId}/retry`)\n}\n',
    'retry timed-out charges',
  )
  await refreshWorktrees(page)
  await waitState(page, slugAhead, 'ahead')

  console.log('creating dirty worktree')
  const slugDirty = await createWorktree(page)
  console.log('dirty slug', slugDirty)
  await unblank(page, 'Promo banner copy')
  writeFileSync(join(worktreeDir(slugDirty), 'src/banner.ts'), 'export const banner = "summer sale"\n')
  await refreshWorktrees(page)
  await waitState(page, slugDirty, 'dirty')

  console.log('creating clean worktree')
  const slugClean = await createWorktree(page)
  console.log('clean slug', slugClean)
  await unblank(page, 'Refunds API')
  await refreshWorktrees(page)
  await waitState(page, slugClean, 'clean')

  const tree = page.locator('[role="tree"]').first()
  await tree.waitFor({ state: 'visible' })
  const rowAhead = page.locator('[role="treeitem"]').filter({ has: page.locator(`[data-dshx-worktree="${slugAhead}"]`) })
  const rowDirty = page.locator('[role="treeitem"]').filter({ has: page.locator(`[data-dshx-worktree="${slugDirty}"]`) })
  const rowClean = page.locator('[role="treeitem"]').filter({ has: page.locator(`[data-dshx-worktree="${slugClean}"]`) })
  await rowAhead.hover({ force: true })
  await page.waitForTimeout(400)
  await tree.screenshot({ path: join(RAW, 'tree.png') })
  await page.screenshot({ path: join(RAW, 'app.png') })
  await page.locator(`[data-dshx-worktree="${slugAhead}"]`).screenshot({ path: join(RAW, 'icon-ahead.png') })
  await page.locator(`[data-dshx-worktree="${slugDirty}"]`).screenshot({ path: join(RAW, 'icon-dirty.png') })
  await page.locator(`[data-dshx-worktree="${slugClean}"]`).screenshot({ path: join(RAW, 'icon-clean.png') })
  await rowAhead.screenshot({ path: join(RAW, 'row-ahead.png') })
  await rowDirty.screenshot({ path: join(RAW, 'row-dirty.png') })
  await rowClean.screenshot({ path: join(RAW, 'row-clean.png') })

  await rowAhead.hover({ force: true })
  const facts = page.getByText('Branch:', { exact: false }).first()
  try {
    await facts.waitFor({ state: 'visible', timeout: 4000 })
    const card = facts.locator('xpath=ancestor::div[contains(@class,"hover") or contains(@class,"Hover") or contains(@class,"card")][1]')
    if (await card.count()) {
      await card.screenshot({ path: join(RAW, 'hover.png') })
    } else {
      await page.locator('body').screenshot({ path: join(RAW, 'hover-page.png') })
      const box = await facts.boundingBox()
      if (box) {
        await page.screenshot({
          path: join(RAW, 'hover.png'),
          clip: {
            x: Math.max(0, box.x - 16),
            y: Math.max(0, box.y - 48),
            width: Math.min(360, box.width + 80),
            height: Math.min(180, box.height + 80),
          },
        })
      }
    }
  } catch {
    await page.screenshot({ path: join(RAW, 'hover-miss.png') })
  }

  await closeMenus(page)
  await openMenu(page, slugAhead)
  const menu = page.locator('[role="menu"]').last()
  await menu.screenshot({ path: join(RAW, 'menu.png') })
  await menu.getByText('Merge…').click()
  const mergeModal = page.locator('[data-dshx-modal="merge"] .dshx-modal')
  await mergeModal.waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('[data-dshx-merge="summary"], [data-dshx-merge="shape"], [data-dshx-blocker]').first()
    .waitFor({ timeout: 10_000 })
  await mergeModal.screenshot({ path: join(RAW, 'merge-ff.png') })
  await page.locator('[data-dshx-button="merge"]').click()
  await page.getByText('Remove the worktree?').waitFor({ timeout: 15_000 })
  await mergeModal.screenshot({ path: join(RAW, 'merged.png') })
  await page.locator('[data-dshx-button="keep"]').click()
  await mergeModal.waitFor({ state: 'hidden', timeout: 10_000 })
  await refreshWorktrees(page)
  await waitState(page, slugAhead, 'merged')
  await page.locator(`[data-dshx-worktree="${slugAhead}"]`).screenshot({ path: join(RAW, 'icon-merged.png') })
  await rowAhead.screenshot({ path: join(RAW, 'row-merged.png') })

  // Conflict on the dirty tree: commit its dirty file, then diverge checkout.ts.
  commitFile(worktreeDir(slugDirty), 'src/banner.ts', 'export const banner = "summer sale"\n', 'promo banner')
  commitFile(WORKSPACE, 'src/checkout.ts', 'export function charge(orderId: string): Promise<void> {\n  throw new Error("not charged")\n}\n', 'main rejects unpaid charges')
  commitFile(worktreeDir(slugDirty), 'src/checkout.ts', 'export function charge(orderId: string): Promise<void> {\n  console.log(orderId)\n  return Promise.resolve()\n}\n', 'log checkout attempts')
  await refreshWorktrees(page)
  await closeMenus(page)
  await openMenu(page, slugDirty)
  await page.getByText('Merge…').last().click()
  await mergeModal.waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('[data-dshx-blocker="conflict"]').waitFor({ timeout: 10_000 })
  await mergeModal.screenshot({ path: join(RAW, 'conflict.png') })
  await page.locator('[data-dshx-button="update-from-merge"]').click()
  const updateModal = page.locator('[data-dshx-modal="update"] .dshx-modal')
  await updateModal.waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('[data-dshx-update="would-conflict"]').waitFor({ timeout: 10_000 })
  await updateModal.screenshot({ path: join(RAW, 'update.png') })
  await page.locator('[data-dshx-button="update"]').click()
  await page.locator('[data-dshx-update="handoff"]').waitFor({ timeout: 15_000 })
  await updateModal.screenshot({ path: join(RAW, 'in-progress.png') })
  await waitState(page, slugDirty, 'conflict')
  await page.locator(`[data-dshx-worktree="${slugDirty}"]`).screenshot({ path: join(RAW, 'icon-conflict.png') })
  await rowDirty.screenshot({ path: join(RAW, 'row-conflict.png') })
  await page.locator('[data-dshx-button="abort-update"]').click()
  await updateModal.waitFor({ state: 'hidden', timeout: 15_000 })

  await closeMenus(page)
  writeFileSync(join(worktreeDir(slugClean), 'notes.txt'), 'wip\n')
  await refreshWorktrees(page)
  await waitState(page, slugClean, 'dirty')
  await openMenu(page, slugClean)
  await page.getByText('Delete worktree…').last().click()
  const deleteModal = page.locator('[data-dshx-modal="delete"] .dshx-modal')
  await deleteModal.waitFor({ state: 'visible', timeout: 10_000 })
  await deleteModal.screenshot({ path: join(RAW, 'delete.png') })
  await closeMenus(page)

  await repoRow.hover()
  await createButton.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(RAW, 'app-final.png') })
  await tree.screenshot({ path: join(RAW, 'tree-final.png') })

  await context.close()

  await frameAll(browser)
  await browser.close()
}

async function frameAll(browser) {
  const loopHtml = framePage(`
    <div class="loop">
      <p class="loop-title">One worktree, start to finish</p>
      <div class="steps">
        <div class="step"><strong>Create</strong><span>New checkout beside the repo</span></div>
        <div class="arrow">→</div>
        <div class="step"><strong>Work</strong><span>The session runs only there</span></div>
        <div class="arrow">→</div>
        <div class="step"><strong>Merge</strong><span>Land onto your current branch</span></div>
        <div class="arrow">→</div>
        <div class="step"><strong>Clean up</strong><span>Keep the tree or remove it</span></div>
      </div>
      <p class="note">If Merge would conflict: <em>Resolve in this session</em>, then Merge is a fast-forward.</p>
    </div>`)
  await renderHtml(browser, loopHtml, join(OUT, 'loop.png'), '.loop', 1)

  const stackFiles = ['create-row.png', 'row-ahead.png', 'row-dirty.png', 'row-clean.png']
  if (stackFiles.every((file) => existsSync(join(RAW, file)))) {
    const stack = stackFiles.map((file) => imgTag(join(RAW, file))).join('')
    await renderHtml(browser, framePage(`<div class="stack">${stack}</div>`), join(OUT, 'sidebar.png'), '.stack', 1)
  }
  if (existsSync(join(RAW, 'create-row.png'))) {
    await renderHtml(browser, framePage(`<div class="shot">${imgTag(join(RAW, 'create-row.png'), 'Create')}</div>`), join(OUT, 'create.png'), '.shot', 1)
  }
  if (existsSync(join(RAW, 'menu.png'))) {
    await renderHtml(browser, framePage(`<div class="shot">${imgTag(join(RAW, 'menu.png'), 'Menu')}</div>`), join(OUT, 'menu.png'), '.shot', 1)
  }
  if (existsSync(join(RAW, 'hover.png'))) {
    await renderHtml(browser, framePage(`<div class="shot">${imgTag(join(RAW, 'hover.png'), 'Hover')}</div>`), join(OUT, 'hover.png'), '.shot', 1)
  }

  const statusParts = [
    ['Clean', 'row-clean.png'],
    ['Uncommitted', 'row-dirty.png'],
    ['Ahead', 'row-ahead.png'],
    ['Merged', 'row-merged.png'],
    ['Conflict', 'row-conflict.png'],
  ].filter(([, file]) => existsSync(join(RAW, file)))
  if (statusParts.length > 0) {
    const rows = statusParts.map(([label, file]) =>
      `<div class="legend-row"><div class="label">${label}</div>${imgTag(join(RAW, file), label)}</div>`).join('')
    await renderHtml(browser, framePage(`<div class="legend">${rows}</div>`), join(OUT, 'status.png'), '.legend', 1)
  }

  const flowParts = [
    ['Conflict', 'conflict.png'],
    ['Resolve', 'update.png'],
    ['In progress', 'in-progress.png'],
    ['Landed', 'merged.png'],
  ].filter(([, file]) => existsSync(join(RAW, file)))
  if (flowParts.length > 0) {
    const cells = flowParts.map(([label, file]) =>
      `<div class="cell"><div class="shot">${imgTag(join(RAW, file), label)}</div><div class="label">${label}</div></div>`).join('')
    await renderHtml(browser, framePage(`<div class="grid">${cells}</div>`), join(OUT, 'merge-flow.png'), '.grid', 1)
  }

  if (existsSync(join(RAW, 'delete.png'))) {
    await renderHtml(browser, framePage(`<div class="shot">${imgTag(join(RAW, 'delete.png'), 'Delete')}</div>`), join(OUT, 'delete.png'), '.shot', 1)
  }

  const includeHtml = framePage(`
    <div class="loop" style="width:400px;text-align:left">
      <p class="loop-title" style="text-align:left">Optional · .worktreeinclude</p>
      <pre style="margin:0;padding:14px 16px;background:#121316;border-radius:8px;border:1px solid ${BORDER};font:13px/20px ui-monospace, SFMono-Regular, Menlo, monospace;color:#D7D7DC">.env
.env.local</pre>
      <p class="note" style="text-align:left">Copied into each new worktree when the file is present. Skip it if you do not need local secrets there.</p>
    </div>`)
  await renderHtml(browser, includeHtml, join(OUT, 'worktreeinclude.png'), '.loop', 1)
  compressReadmeImages()
}

/** README column is ~888px. Each file is 1x of the width it will display at. */
const DISPLAY_WIDTH = {
  loop: 720,
  'merge-flow': 720,
  sidebar: 360,
  status: 420,
  create: 360,
  menu: 220,
  hover: 280,
  delete: 400,
  worktreeinclude: 400,
}

function compressReadmeImages() {
  for (const [name, maxWidth] of Object.entries(DISPLAY_WIDTH)) {
    const png = join(OUT, `${name}.png`)
    const webp = join(OUT, `${name}.webp`)
    if (!existsSync(png)) continue
    const width = Number(execFileSync('magick', ['identify', '-format', '%w', png], { encoding: 'utf8' }).trim())
    const args = ['-quiet', '-q', '80', '-m', '6', '-metadata', 'all']
    if (Number.isFinite(width) && width > maxWidth) args.push('-resize', String(maxWidth), '0')
    args.push(png, '-o', webp)
    execFileSync('cwebp', args)
    unlinkSync(png)
    console.log('webp', name, execFileSync('magick', ['identify', '-format', '%wx%h %b', webp], { encoding: 'utf8' }).trim())
  }
}

if (REFRAME_ONLY) {
  const browser = await chromium.launch({ headless: true })
  await frameAll(browser)
  await browser.close()
} else {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
