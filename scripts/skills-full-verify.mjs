/**
 * Full functional pass over the Skills settings section against the running
 * isolated DSH smoke (boot it first with scripts/skills-e2e-boot.sh).
 *
 * Drives every tab and control in the real browser over real network:
 *   - Installed: seeded skills, toggle on/off, two-step remove, trash on disk
 *   - Providers: add https://github.com/vercel-labs/skills, per-row Refresh,
 *                remove, re-add as bare "vercel-labs/skills" (defaults to GitHub)
 *   - Search:    search bar, provider filter dropdown, install + presence badges
 *   - Update:    tampered manifest -> Update button -> update clears it
 *   - Config:    refresh interval, master switch, GitHub token (masked)
 *   - Workspace RPC pass: install/toggle/updateAllCopies/remove across two
 *                workspace paths (the GUI selector needs real workspaces)
 *
 * Screenshots land in test-results/skills/ (or argv[3]). Exits non-zero on
 * the first failed check; prints a PASS/FAIL summary either way.
 *
 * Usage: node scripts/skills-full-verify.mjs <baseUrl> <scratchHome> [outDir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const BASE_URL = process.argv[2]
const SCRATCH = process.argv[3]
const OUT = process.argv[4] || 'test-results/skills'
if (!BASE_URL || !SCRATCH) {
  console.error('usage: node scripts/skills-full-verify.mjs <baseUrl> <scratchHome> [outDir]')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const results = []
let page
const pageErrors = []
const AGENT_SKILLS = join(SCRATCH, 'home', 'agents', 'skills')

function ok(name) { results.push(['PASS', name]); console.log('  PASS', name) }
function fail(name, error) {
  results.push(['FAIL', name])
  console.error('  FAIL', name, '->', error?.message ?? error)
  throw error instanceof Error ? error : new Error(String(error))
}
async function check(name, fn) {
  try { await fn(); ok(name) } catch (error) { fail(name, error) }
}
async function until(label, fn, timeout = 20_000) {
  const start = Date.now()
  let last
  for (;;) {
    let result
    try { result = await fn() } catch (error) { last = error }
    if (result) return result
    if (Date.now() - start > timeout) {
      throw new Error(`timeout after ${timeout}ms: ${label}${last ? ' (last: ' + (last.message ?? last) + ')' : ''}`)
    }
    await page.waitForTimeout(250)
  }
}
async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png` }) }

async function rpc(method, args = {}) {
  const res = await fetch(BASE_URL + '/dsh-next-skills/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  if (!res.ok) throw new Error(`rpc ${method} -> HTTP ${res.status}`)
  return res.json()
}

const tab = (name) => page.getByRole('button', { name, exact: true }).first()
async function openTab(name) {
  await tab(name).click({ force: true })
  await page.waitForTimeout(700)
}
const skillRow = (name) =>
  page.getByText(name, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"skill")][1]')
const rowButton = (row, name) => row.getByRole('button', { name, exact: true }).first()
async function noErrorShown() {
  const count = await page.locator('[class*="statusErr"]').count()
  if (count > 0) throw new Error('error status visible: ' + (await page.locator('[class*="statusErr"]').first().textContent()))
}
const manifestPath = (base, name) => join(base, name, '.dsh-next-provider.json')

const browser = await chromium.launch({ headless: true })
page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && /dsh-next/.test(m.text())) pageErrors.push('[console] ' + m.text()) })

// ---- boot ----------------------------------------------------------------
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })
await page.waitForTimeout(1500)
await check('onboarding dismissed', async () => {
  const names = ['Continue', 'Configure later', 'Skip']
  for (let round = 0; round < 12; round++) {
    let clicked = false
    for (const name of names) {
      const btn = page.getByRole('button', { name })
      if (await btn.isVisible().catch(() => false)) { await btn.click({ force: true }); clicked = true; await page.waitForTimeout(300) }
    }
    await page.waitForTimeout(300)
    const remaining = await page.locator('[role="dialog"]').count().catch(() => 0)
    if (!clicked || remaining === 0) return
  }
})
await check('Skills section opens from Settings nav', async () => {
  await page.getByText('Settings', { exact: true }).first().click({ force: true })
  await page.waitForTimeout(900)
  const nav = page.getByRole('button', { name: 'Skills', exact: true }).first()
  await nav.waitFor({ state: 'visible', timeout: 10_000 })
  await nav.click({ force: true })
  await until('Installed tab visible', async () => await tab('Installed').isVisible())
  // The boot seeds one workspace, and the panel defaults to the first one;
  // pin "Global only" so the Installed-tab flows below keep their global
  // semantics (a workspace-selected disable would write a shadow instead).
  const wsSelect = page.locator('select').first()
  if (await wsSelect.isVisible().catch(() => false)) {
    await wsSelect.selectOption('')
    await page.waitForTimeout(700)
  }
})
await shot('01-installed-initial')

// ---- Installed tab -------------------------------------------------------
await check('Installed: seeded skills render', async () => {
  for (const name of ['e2e-test-skill', 'grill-me', 'opentofu']) {
    await until(`${name} visible`, async () => await skillRow(name).isVisible())
  }
  // No provider yet: every seeded skill shows the orange custom chip. The
  // theme tokens apply on the app's wrapper (not <html>), so read them from
  // the badge element itself and require a painted background.
  const badge = skillRow('grill-me').locator('[class*="customBadge"]').first()
  await until('custom badge on grill-me', async () => await badge.isVisible())
  const warn = await badge.evaluate((el) => getComputedStyle(el).getPropertyValue('--dsw-alias-state-warn-secondary').trim())
  if (warn === '') throw new Error('--dsw-alias-state-warn-secondary does not resolve on the badge')
  const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
  if (bg === 'rgba(0, 0, 0, 0)') throw new Error('custom badge background is transparent (token missing)')
  // White text on the orange chip.
  const fg = await badge.evaluate((el) => getComputedStyle(el).color)
  const m = fg.match(/rgba?\((\d+), (\d+), (\d+)/)
  if (!m || ![m[1], m[2], m[3]].every((v) => Number(v) >= 240)) {
    throw new Error('custom badge text is not white: ' + fg)
  }
  const bgRgb = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
  const b = bgRgb.match(/rgba?\((\d+), (\d+), (\d+)/)
  if (!b || Number(b[1]) < 200 || Number(b[2]) < 80 || Number(b[2]) > 160 || Number(b[3]) < 0) {
    throw new Error('custom badge background is not orange: ' + bgRgb)
  }
})
await check('Installed: opentofu reflects its disabled frontmatter', async () => {
  const row = skillRow('opentofu')
  if (!(await rowButton(row, 'Enable').isVisible())) throw new Error('disabled skill should offer Enable')
  if ((await rowButton(row, 'Disable').count()) !== 0) throw new Error('disabled skill should not offer Disable')
  // Only the title/description dim; the row itself and its actions stay crisp.
  const text = row.locator('[class*="hint"]').first()
  const rowOpacity = await row.evaluate((el) => getComputedStyle(el).opacity)
  const textOpacity = await text.evaluate((el) => getComputedStyle(el).opacity)
  if (rowOpacity !== '1') throw new Error('the whole row is dimmed: opacity ' + rowOpacity)
  if (textOpacity === '1') throw new Error('the title/description are not dimmed')
  // Update stays visible but disabled for a current custom skill.
  if (!(await rowButton(row, 'Update').isDisabled())) throw new Error('Update should be disabled without an update')
})
await check('Installed: toggle disables then re-enables a skill', async () => {
  const row = skillRow('e2e-test-skill')
  const disable = rowButton(row, 'Disable')
  // The enabled skill's Disable button must be danger-red (a defined theme
  // token), distinct from the plain ghost Remove button beside it.
  const token = await disable.evaluate((el) => getComputedStyle(el).getPropertyValue('--dsw-alias-state-error-primary').trim())
  if (token === '') throw new Error('--dsw-alias-state-error-primary is not defined in the theme')
  const disableColor = await disable.evaluate((el) => getComputedStyle(el).color)
  const removeColor = await rowButton(row, 'Remove').evaluate((el) => getComputedStyle(el).color)
  if (disableColor === removeColor) throw new Error(`Disable is not colored: ${disableColor} == Remove ${removeColor}`)
  await disable.click({ force: true })
  await until('reads Enable', async () => await rowButton(row, 'Enable').isVisible())
  await shot('02-installed-toggled-off')
  await rowButton(row, 'Enable').click({ force: true })
  await until('reads Disable', async () => await rowButton(row, 'Disable').isVisible())
})
await check('Installed: three tabs plus Search rename', async () => {
  for (const name of ['Installed', 'Search', 'Providers']) {
    if (!(await tab(name).isVisible())) throw new Error(`tab "${name}" not visible`)
  }
  const old = await page.getByRole('button', { name: 'Marketplace', exact: true }).count()
  if (old !== 0) throw new Error('old Marketplace tab still present')
})

// ---- Providers: defaults + URL form --------------------------------------
await openTab('Providers')
await check('Providers: default providers are seeded', async () => {
  for (const spec of ['anthropics/skills', 'openclaw/openclaw', 'mattpocock/skills', 'Leonxlnx/taste-skill']) {
    await until(`${spec} row`, async () => await skillRow(spec).isVisible())
  }
})
await check('Providers: defaults auto-sync after boot', async () => {
  // The host seeds defaults and syncs them shortly after boot; every default
  // must end up either synced (lastRefresh set) or with a surfaced error —
  // the initial 'never synced' marker does not count as settled.
  await until('defaults synced or errored', async () => {
    const m = await rpc('marketplace')
    const defaults = m.providers.filter((p) => p.id !== 'vercel-labs-skills')
    const settled = (p) => p.lastRefresh !== '' || (p.error !== undefined && p.error !== 'never synced')
    return defaults.length >= 8 && defaults.every(settled)
  }, 240_000)
  const m = await rpc('marketplace')
  const withStars = m.providers.filter((p) => typeof p.stars === 'number')
  if (withStars.length === 0) throw new Error('no provider carries a star count: ' + JSON.stringify(m.providers))
})
await check('Providers: add https://github.com/vercel-labs/skills', async () => {
  const input = page.locator('input[placeholder*="github.com"]').first()
  await input.fill('https://github.com/vercel-labs/skills')
  await rowButton(page.locator('body'), 'Add').click({ force: true })
  await until('provider row synced with description and stars', async () => {
    const row = skillRow('vercel-labs/skills')
    if (!(await row.isVisible().catch(() => false))) throw new Error('row not visible yet')
    const m = await rpc('marketplace')
    const vp = m.providers.find((p) => p.id === 'vercel-labs-skills')
    if (!vp || vp.lastRefresh === '') throw new Error('not synced yet')
    if (typeof vp.stars !== 'number') throw new Error('no stars in marketplace payload')
    if (!vp.description) throw new Error('no repo description in marketplace payload')
    const text = await row.textContent()
    if (!text.includes('1 skill')) throw new Error('skill count not 1 yet: ' + text)
    if (!text.includes('★')) throw new Error('row missing star count: ' + text)
    if (!text.includes(vp.description)) throw new Error(`row missing repo description "${vp.description}"`)
    return true
  }, 45_000)
  await shot('03-provider-added-url')
})
await check('Providers: per-row Refresh succeeds', async () => {
  await rowButton(skillRow('vercel-labs/skills'), 'Refresh').click({ force: true })
  await page.waitForTimeout(2500)
  await until('row still synced', async () => await skillRow('vercel-labs/skills').isVisible())
  await noErrorShown()
})

// ---- Search tab ----------------------------------------------------------
await openTab('Search')
await check('Search: search bar and provider filter render; target picker moved into Add', async () => {
  const search = page.locator('input[type="search"]').first()
  if (!(await search.isVisible())) throw new Error('search input missing')
  if (!(await search.getAttribute('placeholder')).includes('Search skills')) throw new Error('search placeholder wrong')
  const providerSelect = page.locator('select[aria-label="Provider"]').first()
  const options = await providerSelect.locator('option').allTextContents()
  if (!options.includes('All providers') || !options.includes('vercel-labs/skills')) {
    throw new Error('provider filter options wrong: ' + JSON.stringify(options))
  }
  // The old "Install into" dropdown is gone; targets are picked in the Add modal.
  const installSelects = await page.locator('select[aria-label="Install into"]').count()
  if (installSelects !== 0) throw new Error('old Install-into dropdown still present')
  const addButtons = await page.getByRole('button', { name: 'Add', exact: true }).count()
  if (addButtons === 0) throw new Error('no Add buttons on catalog rows')
})
await check('Search: infinite scroll pages the catalog', async () => {
  const m = await rpc('marketplace')
  const total = m.skills.length
  if (total <= 30) throw new Error(`catalog too small to page: ${total}`)
  const rowLocator = page.locator('[class*="market"] > div[class*="skill"]')
  await until('first page rendered', async () => (await rowLocator.count()) === 30)
  const more = page.getByRole('button', { name: 'Load more skills', exact: true })
  if (!(await more.isVisible())) throw new Error('Load more button missing')
  await more.scrollIntoViewIfNeeded()
  await until('second page rendered', async () => (await rowLocator.count()) > 30)
  await shot('05-search-paged')
})
await check('Search: search bar narrows the catalog and surfaces find-skills', async () => {
  await page.locator('input[type="search"]').first().fill('find')
  await until('find-skills row', async () => await skillRow('find-skills').isVisible())
})
await check('Search: skill detail modal shows name and rendered markdown body', async () => {
  await page.locator('[aria-label="View find-skills"]').first().click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Skill find-skills' })
  await until('detail modal', async () => await dialog.isVisible())
  // Markdown preview: the body renders into real elements (headings, lists,
  // paragraphs, code blocks), not a raw <pre> dump.
  const bodyEl = dialog.locator('[class*="modalBody"]').first()
  await until('rendered body elements', async () => (await bodyEl.locator('h1, h2, h3, p, li, pre').count()) > 0)
  const body = await bodyEl.textContent()
  if (!body || body.trim() === '') throw new Error('detail body is empty')
  const text = await dialog.textContent()
  if (!text.includes('model invocable') || !text.includes('user invocable')) throw new Error('invocation flags missing')
  await shot('05-skill-detail')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click({ force: true })
  await until('modal closed', async () => !(await dialog.isVisible().catch(() => false)))
})
await check('Search: empty state on a non-matching search', async () => {
  await page.locator('input[type="search"]').first().fill('zzz-no-match')
  await until('empty message', async () =>
    await page.getByText('No skills match this search.').isVisible())
  await shot('04-search-no-match')
  await page.locator('input[type="search"]').first().fill('find')
  await until('find-skills back', async () => await skillRow('find-skills').isVisible())
})
await check('Search: provider filter dropdown filters by provider', async () => {
  const providerSelect = page.locator('select[aria-label="Provider"]').first()
  await providerSelect.selectOption('vercel-labs-skills')
  await page.waitForTimeout(400)
  await until('find-skills still visible', async () => await skillRow('find-skills').isVisible())
  await providerSelect.selectOption('')
  await page.waitForTimeout(400)
})
await shot('05-search')
await check('Search: Add modal installs into global and shows presence badges', async () => {
  // The search term keeps find-skills within the paged view.
  await page.locator('input[type="search"]').first().fill('find')
  await until('find-skills visible', async () => await skillRow('find-skills').isVisible())
  const row = skillRow('find-skills')
  await rowButton(row, 'Add').click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Add skill "find-skills"' })
  await until('add modal visible', async () => await dialog.isVisible())
  // Global + seeded workspace targets; nothing locked yet.
  const boxes = dialog.locator('input[type="checkbox"]')
  if ((await boxes.count()) < 2) throw new Error('add modal does not list global + workspaces')
  await boxes.first().check({ force: true })
  await dialog.getByRole('button', { name: 'Add', exact: true }).click({ force: true })
  await until('popup closed', async () => !(await dialog.isVisible().catch(() => false)))
  await until('in global badge', async () =>
    (await page.locator('body').textContent()).includes('in global'))
  await noErrorShown()
  await shot('06-search-installed')
})

// ---- Installed: provider badge + Update flow -----------------------------
await openTab('Installed')
await check('Installed: find-skills shows the provider badge under the title', async () => {
  await until('provider badge', async () =>
    (await skillRow('find-skills').textContent()).includes('vercel-labs/skills'))
})
await check('Installed: tampered manifest enables the Update button', async () => {
  const manifest = JSON.parse(readFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), 'utf8'))
  manifest.version = 'tampered000000'
  writeFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), JSON.stringify(manifest, null, 2))
  await openTab('Search') // switching tabs refreshes state
  await openTab('Installed')
  await until('Update enabled', async () => !(await rowButton(skillRow('find-skills'), 'Update').isDisabled()))
  await shot('07-update-available')
})
await check('Installed: Update overwrites and clears the flag', async () => {
  await rowButton(skillRow('find-skills'), 'Update').click({ force: true })
  // The button is also disabled while busy, so wait for the real completion
  // signal: the manifest rewritten and the flag cleared for good.
  await until('update finished', async () => {
    const manifest = JSON.parse(readFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), 'utf8'))
    if (manifest.version === 'tampered000000') throw new Error('manifest not rewritten yet')
    if (!(await rowButton(skillRow('find-skills'), 'Update').isDisabled())) throw new Error('Update still enabled')
    return true
  }, 30_000)
  await noErrorShown()
})
await check('Installed: remove shows a confirmation popup and trashes recoverably', async () => {
  const row = skillRow('find-skills')
  await rowButton(row, 'Remove').click({ force: true })
  // The Settings shell itself is a role="dialog"; scope by the popup's name.
  const dialog = page.getByRole('dialog', { name: 'Remove skill "find-skills"?' })
  await until('popup visible', async () => await dialog.isVisible())
  // The scrim behind the dialog must dim the page (user-tuned alpha of 0.5).
  const scrim = await dialog.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor)
  const alpha = Number((scrim.match(/, ([\d.]+)\)$/) ?? [])[1] ?? '0')
  if (alpha < 0.45 || alpha > 0.55) throw new Error(`overlay scrim alpha is not ~0.5: ${scrim}`)
  await shot('08-remove-popup')
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click({ force: true })
  await until('popup closed', async () => !(await dialog.isVisible().catch(() => false)))
  await until('row gone', async () => !(await skillRow('find-skills').isVisible().catch(() => false)))
  const trash = join(AGENT_SKILLS, '.trash')
  if (!existsSync(trash) || !readdirSync(trash).some((d) => d.endsWith('-find-skills'))) {
    throw new Error('no trash entry for find-skills')
  }
  // The chat composer caches each session's skill catalog, so without the
  // panel's post-mutation invalidation a NEW chat in the SAME page would
  // still offer the removed skill until a full browser reload.
  await page.locator('button', { hasText: 'New Session' }).first().click({ force: true })
  await page.waitForTimeout(800)
  const composer = page.locator('textarea').first()
  if ((await composer.getAttribute('readonly')) !== null) {
    // Empty state: the composer doubles as the workspace menu trigger — pick
    // the seeded workspace with the keyboard (real item clicks do not land).
    await composer.click({ force: true })
    await page.waitForTimeout(700)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
  }
  await composer.click()
  await composer.fill('')
  await composer.pressSequentially('/')
  await page.waitForTimeout(1000)
  const menuText = await page.locator('[role="listbox"], [role="menu"]').first().textContent().catch(() => '') ?? ''
  if (menuText.includes('find-skills')) throw new Error('composer / menu still lists the removed skill (stale client cache)')
  if (!menuText.includes('e2e-test-skill')) throw new Error('composer / menu did not list the remaining skill: ' + JSON.stringify(menuText.slice(0, 200)))
  await shot('09b-composer-after-remove')
  await page.keyboard.press('Escape')
  // Back to Settings > Skills for the provider checks below (Settings
  // reopens on the last section, so navigate to Skills explicitly).
  await page.getByText('Settings', { exact: true }).first().click({ force: true })
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Skills', exact: true }).first().click({ force: true })
  await page.waitForTimeout(900)
  await shot('09-after-remove')
})

// ---- Providers: remove, then bare spec re-add ----------------------------
await openTab('Providers')
await check('Providers: remove the URL-form provider via the popup', async () => {
  await rowButton(skillRow('vercel-labs/skills'), 'Remove').click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Remove provider "vercel-labs/skills"?' })
  await until('popup visible', async () => await dialog.isVisible())
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click({ force: true })
  await until('row gone', async () => !(await skillRow('vercel-labs/skills').isVisible().catch(() => false)))
  // The shipped defaults must survive the removal.
  await until('defaults still present', async () => await skillRow('anthropics/skills').isVisible())
})
await check('Providers: bare vercel-labs/skills works and defaults to GitHub', async () => {
  const input = page.locator('input[placeholder*="github.com"]').first()
  await input.fill('vercel-labs/skills')
  await rowButton(page.locator('body'), 'Add').click({ force: true })
  await until('canonical row synced', async () => {
    const row = skillRow('vercel-labs/skills')
    if (!(await row.isVisible().catch(() => false))) throw new Error('row not visible yet')
    const text = await row.textContent()
    if (!text.includes('1 skill')) throw new Error('skill count not 1 yet: ' + text)
    await noErrorShown()
    return true
  }, 45_000)
  await shot('10-provider-bare')
})
await check('Search: catalog refilled by the bare provider', async () => {
  await openTab('Search')
  await page.locator('input[type="search"]').first().fill('find')
  await until('find-skills row', async () => await skillRow('find-skills').isVisible())
})
await check('Search: reinstall find-skills for the final state', async () => {
  const row = skillRow('find-skills')
  await rowButton(row, 'Add').click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Add skill "find-skills"' })
  await until('add modal visible', async () => await dialog.isVisible())
  const boxes = dialog.locator('input[type="checkbox"]')
  await boxes.first().check({ force: true })
  await dialog.getByRole('button', { name: 'Add', exact: true }).click({ force: true })
  await until('popup closed', async () => !(await dialog.isVisible().catch(() => false)))
  await until('in global badge', async () =>
    (await page.locator('body').textContent()).includes('in global'))
})

// ---- Workspace RPC pass (GUI selector needs real workspaces) -------------
const WS_A = join(SCRATCH, 'ws-alpha')
const WS_B = join(SCRATCH, 'ws-beta')
await check('Workspace RPC: install the same skill into two workspaces', async () => {
  for (const ws of [WS_A, WS_B]) {
    const r = await rpc('installSkill', { providerId: 'vercel-labs-skills', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: ws })
    if (r.ok !== true) throw new Error(`install into ${ws} failed: ${r.error}`)
  }
  const map = await rpc('getInstalledMap', { workspacePaths: [WS_A, WS_B] })
  if (!map.global.some((s) => s.name === 'find-skills')) throw new Error('global copy missing')
  for (const w of map.workspaces) {
    if (!w.installed.some((s) => s.name === 'find-skills')) throw new Error(`copy missing in ${w.workspacePath}`)
  }
})
await check('Workspace RPC: updateAllCopies refreshes global + both workspaces', async () => {
  const catalog = await rpc('marketplace')
  const version = catalog.skills.find((s) => s.name === 'find-skills')?.version
  if (!version) throw new Error('catalog has no find-skills version')
  for (const base of [AGENT_SKILLS, join(WS_A, '.agents', 'skills'), join(WS_B, '.agents', 'skills')]) {
    const manifest = JSON.parse(readFileSync(manifestPath(base, 'find-skills'), 'utf8'))
    manifest.version = 'stale' + base.length
    writeFileSync(manifestPath(base, 'find-skills'), JSON.stringify(manifest, null, 2))
  }
  const r = await rpc('updateAllCopies', { name: 'find-skills', workspacePaths: [WS_A, WS_B] })
  if (r.ok !== true) throw new Error('updateAllCopies failed: ' + r.error)
  if (r.warning !== undefined) throw new Error('unexpected warning: ' + r.warning)
  for (const base of [AGENT_SKILLS, join(WS_A, '.agents', 'skills'), join(WS_B, '.agents', 'skills')]) {
    const manifest = JSON.parse(readFileSync(manifestPath(base, 'find-skills'), 'utf8'))
    if (manifest.version !== version) throw new Error(`manifest at ${base} not refreshed`)
  }
})
await check('Workspace RPC: per-workspace shadow disable and re-enable', async () => {
  // e2e-test-skill is global-only, so disabling it in ws-alpha must drop a
  // workspace shadow (a skill with a real workspace copy would just toggle).
  const off = await rpc('setEnabled', { name: 'e2e-test-skill', scope: 'workspace', enabled: false, workspacePath: WS_A, description: 'e2e-test-skill' })
  if (off.ok !== true) throw new Error('shadow disable failed: ' + off.error)
  const map = await rpc('getInstalledMap', { workspacePaths: [WS_A] })
  const shadow = map.workspaces[0].installed.find((s) => s.name === 'e2e-test-skill')
  if (!shadow || shadow.enabled !== false || shadow.shadow !== true) throw new Error('shadow flag missing: ' + JSON.stringify(shadow))
  const on = await rpc('setEnabled', { name: 'e2e-test-skill', scope: 'workspace', enabled: true, workspacePath: WS_A, description: 'e2e-test-skill' })
  if (on.ok !== true) throw new Error('re-enable failed: ' + on.error)
  const map2 = await rpc('getInstalledMap', { workspacePaths: [WS_A] })
  if (map2.workspaces[0].installed.some((s) => s.name === 'e2e-test-skill')) throw new Error('shadow not removed on re-enable')
})
await check('Workspace RPC: a real workspace copy toggles without a shadow', async () => {
  const off = await rpc('setEnabled', { name: 'find-skills', scope: 'workspace', enabled: false, workspacePath: WS_B })
  if (off.ok !== true) throw new Error('disable failed: ' + off.error)
  const map = await rpc('getInstalledMap', { workspacePaths: [WS_B] })
  const copy = map.workspaces[0].installed.find((s) => s.name === 'find-skills')
  if (!copy || copy.enabled !== false || copy.shadow === true) throw new Error('real copy toggled wrong: ' + JSON.stringify(copy))
  const on = await rpc('setEnabled', { name: 'find-skills', scope: 'workspace', enabled: true, workspacePath: WS_B })
  if (on.ok !== true) throw new Error('re-enable failed: ' + on.error)
})
await check('Workspace RPC: remove trashes only the target copy', async () => {
  const r = await rpc('remove', { name: 'find-skills', scope: 'workspace', workspacePath: WS_A })
  if (r.ok !== true) throw new Error('remove failed: ' + r.error)
  if (!existsSync(join(WS_A, '.agents', 'skills', '.trash'))) throw new Error('no trash in ws-alpha')
  if (!existsSync(join(WS_B, '.agents', 'skills', 'find-skills', 'SKILL.md'))) throw new Error('ws-beta copy lost')
  const r2 = await rpc('remove', { name: 'find-skills', scope: 'workspace', workspacePath: WS_B })
  if (r2.ok !== true) throw new Error('remove ws-beta failed: ' + r2.error)
})

// ---- summary -------------------------------------------------------------
await shot('11-final')
console.log('\n=== summary ===')
const failed = results.filter(([s]) => s === 'FAIL')
for (const [s, name] of results) console.log(`${s}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log('pageErrors:', JSON.stringify(pageErrors))
console.log('screenshots:', OUT)
await browser.close()
if (failed.length > 0 || pageErrors.length > 0) process.exit(1)
