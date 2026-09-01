/**
 * Full functional pass over the Skills settings section against the running
 * isolated DSH smoke (boot it first with scripts/skills-e2e-boot.sh).
 *
 * Drives the settings-backed model in the real browser over real network:
 *   - Skills tab: card grid over seeded skills + provider catalog, search,
 *     provider filter, installed-only, Show more paging, detail markdown
 *   - Scope modal: Add (global), re-scope to a workspace whitelist and back,
 *     presence badges, two-step remove with trash on disk
 *   - Settings.yaml: providers/installed/scopes round-trip on disk
 *   - Providers: default seed + auto-sync, add by URL and by bare spec,
 *     refresh all, remove (defaults survive)
 *   - Update: tampered manifest -> Update button -> update clears it
 *   - Composer: after a remove, a NEW session's "/" menu must not list the
 *     removed skill (client cache invalidation)
 *
 * Screenshots land in test-results/skills/ (or argv[3]). Exits non-zero on
 * the first failed check; prints a PASS/FAIL summary either way.
 *
 * Usage: node scripts/skills-full-verify.mjs <baseUrl> <scratchHome> [outDir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
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
const SETTINGS_YAML = join(SCRATCH, 'home', 'settings.yaml')

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

/** Read the plugin section of the seeded settings.yaml (crude but stable:
 *  the seed writes plain `key: value` lines under dsh-next-skills:). */
function settingsSection() {
  const raw = readFileSync(SETTINGS_YAML, 'utf8')
  const start = raw.indexOf('dsh-next-skills:')
  if (start === -1) return ''
  return raw.slice(start)
}

// The panel's tabs carry role="tab" (not the implicit button role), so the
// locator must query the tab role explicitly.
const tab = (name) => page.getByRole('tab', { name, exact: true }).first()
async function openTab(name) {
  await tab(name).click({ force: true })
  await page.waitForTimeout(700)
}
const skillCard = (name) => page.locator('[data-testid="skills-card"]', { hasText: name }).first()
const providerCard = (name) => page.locator('[data-testid="skills-provider"]', { hasText: name }).first()
const cardButton = (card, testId) => card.locator(`[data-testid="${testId}"]`).first()
async function noErrorShown() {
  const count = await page.locator('[data-testid="skills-message"][class*="noticeErr"]').count()
  if (count > 0) throw new Error('error banner visible: ' + (await page.locator('[data-testid="skills-message"]').first().textContent()))
}

/** Like noErrorShown, but tolerates GitHub rate-limit banners: unauthenticated
 *  API quota is environmental (60 req/hr shared across every boot this
 *  machine makes), not a product regression. Any other banner still fails. */
async function noErrorExceptRateLimit() {
  const count = await page.locator('[data-testid="skills-message"][class*="noticeErr"]').count()
  if (count === 0) return
  const text = await page.locator('[data-testid="skills-message"]').first().textContent()
  if (!text.includes('rate limit')) throw new Error('error banner visible: ' + text)
  console.log('  (tolerated environmental rate limit)')
}
const manifestPath = (base, name) => join(base, name, '.dsh-next-provider.json')

/** Open the scope modal for a skill and return its root element. */
async function openScopeModal(name, action = 'skills-manage') {
  const card = skillCard(name)
  await card.locator(`[data-testid="${action}"]`).first().click({ force: true })
  const modal = page.getByTestId('skills-scope-modal')
  await until('scope modal', async () => await modal.isVisible())
  return modal
}

/** Make re-runs idempotent: if the skill is installed (Manage button), remove
 *  it through the modal's two-step confirm so the Add flow can run again. */
async function ensureUninstalled(name) {
  const card = skillCard(name)
  if (await card.locator('[data-testid="skills-add"]').first().isVisible().catch(() => false)) return
  const modal = await openScopeModal(name)
  await modal.getByTestId('skills-remove').click({ force: true })
  await modal.getByTestId('skills-remove-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal.isVisible().catch(() => false)))
  await until('card uninstalled', async () =>
    await card.locator('[data-testid="skills-add"]').first().isVisible())
}

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
  await until('Skills tab visible', async () => await page.getByTestId('skills-tab-skills').isVisible())
  await until('grid rendered', async () => (await page.locator('[data-testid="skills-card"]').count()) > 0)
})
await shot('01-skills-initial')

// ---- Skills tab: seeded skills + grid ------------------------------------
await check('Skills: seeded skills render as cards with the custom chip', async () => {
  for (const name of ['e2e-test-skill', 'grill-me', 'opentofu', 'hand-made']) {
    await until(`${name} card`, async () => await skillCard(name).isVisible())
  }
  // The boot records e2e-test-skill/grill-me/opentofu as managed, so they
  // show the e2e/local provider chip; hand-made carries no record and shows
  // the orange custom chip, painted from a real theme token.
  const managed = skillCard('grill-me')
  await until('provider chip on grill-me', async () => (await managed.textContent()).includes('e2e/local'))
  const card = skillCard('hand-made')
  const badge = card.locator('[class*="installedChip"]').first()
  await until('custom chip on hand-made', async () => await badge.isVisible())
  const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
  const m = bg.match(/rgba?\((\d+), (\d+), (\d+)/)
  if (!m || Number(m[1]) < 200 || Number(m[2]) < 80 || Number(m[2]) > 160) {
    throw new Error('custom chip background is not orange: ' + bg)
  }
  const fg = await badge.evaluate((el) => getComputedStyle(el).color)
  const f = fg.match(/rgba?\((\d+), (\d+), (\d+)/)
  if (!f || ![f[1], f[2], f[3]].every((v) => Number(v) >= 240)) throw new Error('custom chip text is not white: ' + fg)
})
await check('Skills: two tabs only (Skills / Providers); old tabs gone', async () => {
  for (const name of ['Skills', 'Providers']) {
    if (!(await tab(name).isVisible())) throw new Error(`tab "${name}" not visible`)
  }
  for (const old of ['Installed', 'Search']) {
    if ((await tab(old).count()) !== 0) throw new Error(`old "${old}" tab still present`)
  }
})
await check('Skills: presence badge defaults to Everywhere for seeded skills', async () => {
  const badge = skillCard('grill-me').locator('[data-testid="skills-presence"]').first()
  await until('Everywhere badge', async () => (await badge.textContent()) === 'Everywhere')
})

// ---- Providers: defaults + URL form --------------------------------------
await openTab('Providers')
await check('Providers: default providers are seeded and auto-sync after boot', async () => {
  for (const spec of ['anthropics/skills', 'openclaw/openclaw', 'mattpocock/skills', 'Leonxlnx/taste-skill']) {
    await until(`${spec} row`, async () => await providerCard(spec).isVisible())
  }
  // The host seeds defaults and syncs them shortly after boot; every default
  // must end up either synced (lastRefresh set) or with a surfaced error.
  await until('defaults synced or errored', async () => {
    const s = await rpc('getState')
    const defaults = s.config.providers.filter((p) => p.id !== 'vercel-labs-skills')
    const rows = s.providers
    const settled = (id) => {
      const row = rows.find((p) => p.id === id)
      return row !== undefined && (row.lastRefresh !== '' || (row.error !== undefined && row.error !== 'never synced'))
    }
    return defaults.length >= 8 && defaults.every((p) => settled(p.id))
  }, 240_000)
  const s = await rpc('getState')
  if (!s.providers.some((p) => typeof p.stars === 'number')) throw new Error('no provider carries a star count')
})
await check('Providers: settings.yaml holds the provider records', async () => {
  const section = settingsSection()
  if (!section.includes('dsh-next-skills:')) throw new Error('no dsh-next-skills section')
  for (const spec of ['anthropics/skills', 'openclaw/openclaw']) {
    if (!section.includes(`spec: ${spec}`)) throw new Error(`provider ${spec} missing from settings.yaml`)
  }
})
await check('Providers: add https://github.com/vercel-labs/skills', async () => {
  const input = page.getByTestId('skills-provider-input').first()
  await input.fill('https://github.com/vercel-labs/skills')
  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click({ force: true })
  await until('provider row synced', async () => {
    const row = providerCard('vercel-labs/skills')
    if (!(await row.isVisible().catch(() => false))) throw new Error('row not visible yet')
    const s = await rpc('getState')
    const vp = s.providers.find((p) => p.id === 'vercel-labs-skills')
    if (!vp || vp.lastRefresh === '') throw new Error('not synced yet')
    if (typeof vp.stars !== 'number') throw new Error('no stars in state payload')
    if (!vp.description) throw new Error('no repo description in state payload')
    const text = await row.textContent()
    if (!text.includes('1 skill')) throw new Error('skill count not 1 yet: ' + text)
    if (!text.includes(vp.description)) throw new Error(`row missing repo description "${vp.description}"`)
    return true
  }, 45_000)
  await shot('03-provider-added-url')
})
await check('Providers: Refresh all succeeds', async () => {
  await page.getByTestId('skills-provider-refresh-all').first().click({ force: true })
  // The panel stays busy until the host finishes the whole refresh queue;
  // later interactions must wait for it or their buttons are disabled.
  await until('refresh settled (controls re-enabled)', async () =>
    await page.getByTestId('skills-provider-refresh-all').isEnabled(), 180_000)
  await until('row still synced', async () => await providerCard('vercel-labs/skills').isVisible())
  await noErrorExceptRateLimit()
})

// ---- Skills tab: search, filter, detail ----------------------------------
await openTab('Skills')
await check('Skills: search narrows the catalog and surfaces find-skills', async () => {
  const search = page.getByTestId('skills-search').first()
  if (!(await search.getAttribute('placeholder')).includes('Search skills')) throw new Error('search placeholder wrong')
  await search.fill('find')
  await until('find-skills card', async () => await skillCard('find-skills').isVisible())
})
await check('Skills: provider filter and installed-only render; old install picker gone', async () => {
  const providerSelect = page.getByTestId('skills-provider-filter').first()
  const options = await providerSelect.locator('option').allTextContents()
  if (!options.includes('All providers') || !options.includes('vercel-labs/skills')) {
    throw new Error('provider filter options wrong: ' + JSON.stringify(options))
  }
  const installSelects = await page.locator('select[aria-label="Install into"]').count()
  if (installSelects !== 0) throw new Error('old Install-into dropdown still present')
  await providerSelect.selectOption('vercel-labs-skills')
  await page.waitForTimeout(400)
  await until('find-skills still visible', async () => await skillCard('find-skills').isVisible())
  await providerSelect.selectOption('')
  await page.waitForTimeout(400)
})
await check('Skills: Show more pages the catalog (30 per page)', async () => {
  const s = await rpc('getState')
  const total = s.catalog.length + s.installed.length
  if (total <= 30) throw new Error(`catalog too small to page: ${total}`)
  // The previous check left 'find' in the search box; clear it so the whole
  // catalog renders and paging applies.
  await page.getByTestId('skills-search').first().fill('')
  await until('first page rendered', async () => (await page.locator('[data-testid="skills-card"]').count()) === 30)
  const more = page.getByTestId('skills-show-more')
  await until('show-more enabled (panel idle)', async () => await more.isEnabled())
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await until('second page rendered', async () => (await page.locator('[data-testid="skills-card"]').count()) > 30)
  await shot('05-skills-paged')
  // Narrow again for the flows below.
  await page.getByTestId('skills-search').first().fill('find')
  await until('find-skills card', async () => await skillCard('find-skills').isVisible())
})
await check('Skills: detail modal shows name and rendered markdown body', async () => {
  await page.locator('[data-testid="skills-detail-open"]').first().click({ force: true })
  const detail = page.getByTestId('skills-detail')
  await until('detail modal', async () => await detail.isVisible())
  const bodyEl = detail.locator('[data-testid="skills-detail-body"]')
  await until('rendered body elements', async () => (await bodyEl.locator('h1, h2, h3, p, li, pre').count()) > 0)
  const body = await bodyEl.textContent()
  if (!body || body.trim() === '') throw new Error('detail body is empty')
  const text = await detail.textContent()
  if (!text.includes('model invocable') || !text.includes('user invocable')) throw new Error('invocation flags missing')
  await shot('05-skill-detail')
  await detail.getByRole('button', { name: 'Close', exact: true }).click({ force: true })
  await until('modal closed', async () => !(await detail.isVisible().catch(() => false)))
})
await check('Skills: empty state on a non-matching search', async () => {
  await page.getByTestId('skills-search').first().fill('zzz-no-match')
  await until('empty message', async () =>
    await page.getByText('No skills match this search.').isVisible())
  await shot('04-skills-no-match')
  await page.getByTestId('skills-search').first().fill('find')
  await until('find-skills back', async () => await skillCard('find-skills').isVisible())
})
await shot('05-skills')

// ---- Scope modal: Add + presence + settings round-trip --------------------
await check('Scope modal: Add installs globally and records settings', async () => {
  await ensureUninstalled('find-skills')
  const card = skillCard('find-skills')
  await cardButton(card, 'skills-add').click({ force: true })
  const modal = page.getByTestId('skills-scope-modal')
  await until('scope modal visible', async () => await modal.isVisible())
  // Global is the default radio; the seeded workspace appears in the
  // checklist under the workspaces mode.
  if (!(await page.getByTestId('skills-scope-global').locator('input').isChecked())) {
    throw new Error('Global radio is not the default')
  }
  await page.getByTestId('skills-scope-workspaces').click()
  await until('workspace checklist', async () => await modal.locator('[data-testid="skills-workspace"]').first().isVisible())
  await page.getByTestId('skills-scope-global').click()
  await modal.getByTestId('skills-modal-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal.isVisible().catch(() => false)))
  await until('find-skills managed card', async () => {
    const text = await skillCard('find-skills').textContent()
    return text.includes('vercel-labs/skills') && text.includes('Everywhere')
  })
  // The settings.yaml section now records the install.
  await until('settings install record', async () => settingsSection().includes('- name: find-skills'))
  await noErrorShown()
  await shot('06-scope-added')
})
await check('Scope modal: re-scope to a workspace whitelist and back', async () => {
  const modal = await openScopeModal('find-skills')
  await page.getByTestId('skills-scope-workspaces').click()
  const wsBox = modal.locator('[data-testid="skills-workspace"]', { hasText: 'Alpha' }).first().locator('input')
  await wsBox.check({ force: true })
  await modal.getByTestId('skills-modal-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal.isVisible().catch(() => false)))
  await until('presence badge shows one workspace', async () =>
    (await skillCard('find-skills').locator('[data-testid="skills-presence"]').textContent()) === '1 workspace')
  const s = await rpc('getState')
  const scope = s.config.scopes['find-skills']
  if (!scope || scope.kind !== 'workspaces' || scope.workspacePaths.length !== 1) {
    throw new Error('whitelist scope not recorded: ' + JSON.stringify(scope))
  }
  await shot('07-scope-whitelisted')
  // Back to Everywhere: the scope entry clears from settings.
  const modal2 = await openScopeModal('find-skills')
  await page.getByTestId('skills-scope-global').click()
  await modal2.getByTestId('skills-modal-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal2.isVisible().catch(() => false)))
  await until('presence badge back to Everywhere', async () =>
    (await skillCard('find-skills').locator('[data-testid="skills-presence"]').textContent()) === 'Everywhere')
  const s2 = await rpc('getState')
  if (s2.config.scopes['find-skills'] !== undefined) throw new Error('scope entry not cleared')
})

// ---- Update flow ----------------------------------------------------------
await check('Update: tampered manifest enables the Update button', async () => {
  const manifest = JSON.parse(readFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), 'utf8'))
  manifest.version = 'tampered000000'
  writeFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), JSON.stringify(manifest, null, 2))
  await openTab('Providers') // switching tabs refreshes state
  await openTab('Skills')
  await until('update button visible', async () => await cardButton(skillCard('find-skills'), 'skills-update').isVisible())
  await shot('08-update-available')
})
await check('Update: Update overwrites and clears the flag', async () => {
  await cardButton(skillCard('find-skills'), 'skills-update').click({ force: true })
  await until('update finished', async () => {
    const manifest = JSON.parse(readFileSync(manifestPath(AGENT_SKILLS, 'find-skills'), 'utf8'))
    if (manifest.version === 'tampered000000') throw new Error('manifest not rewritten yet')
    if (await cardButton(skillCard('find-skills'), 'skills-update').isVisible().catch(() => false)) {
      throw new Error('Update still visible')
    }
    return true
  }, 30_000)
  await noErrorShown()
})

// ---- Remove: two-step confirm + composer staleness ------------------------
await check('Remove: two-step confirm trashes recoverably and the composer refreshes', async () => {
  const modal = await openScopeModal('find-skills')
  await modal.getByTestId('skills-remove').click({ force: true })
  // The first click only reveals the confirmation button.
  if ((await modal.getByTestId('skills-remove-confirm').count()) === 0) throw new Error('confirm button missing')
  await shot('09-remove-confirm')
  await modal.getByTestId('skills-remove-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal.isVisible().catch(() => false)))
  // The skill leaves the installed set but stays a catalog offering: the
  // card flips back to the uninstalled (Add) state.
  await until('card back to catalog-only', async () =>
    await skillCard('find-skills').locator('[data-testid="skills-add"]').isVisible())
  const trash = join(AGENT_SKILLS, '.trash')
  if (!existsSync(trash) || !readdirSync(trash).some((d) => d.endsWith('-find-skills'))) {
    throw new Error('no trash entry for find-skills')
  }
  // The settings record and scope entry are dropped with the files.
  const s = await rpc('getState')
  if (s.config.installed.some((r) => r.name === 'find-skills')) throw new Error('install record not dropped')
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

// ---- Reinstall + scope RPC pass ------------------------------------------
await check('Skills: reinstall find-skills with a workspace-restricted scope', async () => {
  await openTab('Skills')
  await page.getByTestId('skills-search').first().fill('find')
  await until('find-skills card', async () => await skillCard('find-skills').isVisible())
  await ensureUninstalled('find-skills')
  const card = skillCard('find-skills')
  await cardButton(card, 'skills-add').click({ force: true })
  const modal = page.getByTestId('skills-scope-modal')
  await until('scope modal visible', async () => await modal.isVisible())
  await page.getByTestId('skills-scope-workspaces').click()
  const wsBox = modal.locator('[data-testid="skills-workspace"]', { hasText: 'Alpha' }).first().locator('input')
  await wsBox.check({ force: true })
  await modal.getByTestId('skills-modal-confirm').click({ force: true })
  await until('modal closed', async () => !(await modal.isVisible().catch(() => false)))
  await until('presence badge one workspace', async () =>
    (await skillCard('find-skills').locator('[data-testid="skills-presence"]').textContent()) === '1 workspace')
})
await check('Scope RPC: installs are global-only even with a workspace scope', async () => {
  // The workspace registry stores canon (realpath) paths — on macOS /tmp is
  // a symlink to /private/tmp, so compare against the resolved form.
  const WS_A = realpathSync(join(SCRATCH, 'ws-alpha'))
  const state = await rpc('getState')
  const record = state.config.installed.find((r) => r.name === 'find-skills')
  if (!record) throw new Error('install record missing')
  // The files landed in the global root only.
  if (!existsSync(join(AGENT_SKILLS, 'find-skills', 'SKILL.md'))) throw new Error('global copy missing')
  if (existsSync(join(WS_A, '.agents', 'skills', 'find-skills'))) throw new Error('a workspace copy exists — installs must be global-only')
  // The scope whitelist names the workspace in settings.
  const scope = state.config.scopes['find-skills']
  if (!scope || scope.kind !== 'workspaces' || !scope.workspacePaths.includes(WS_A)) {
    throw new Error('whitelist not recorded: ' + JSON.stringify(scope))
  }
  // Reset to the everywhere default for a clean final state.
  const reset = await rpc('setScope', { name: 'find-skills', scope: { kind: 'global' } })
  if (reset.ok !== true) throw new Error('setScope reset failed: ' + reset.error)
  if (reset.state.config.scopes['find-skills'] !== undefined) throw new Error('scope not cleared')
})
await check('Scope RPC: setScope refuses invalid input without writing', async () => {
  const bad = await rpc('setScope', { name: 'not a name', scope: { kind: 'global' } })
  if (bad.ok !== false) throw new Error('invalid name accepted')
  const rel = await rpc('setScope', { name: 'find-skills', scope: { kind: 'workspaces', workspacePaths: ['relative'] } })
  if (rel.ok !== false) throw new Error('relative path accepted')
  const s = await rpc('getState')
  if (s.config.scopes['find-skills'] !== undefined) throw new Error('a refused write still landed')
})

// ---- Providers: remove, then bare spec re-add ----------------------------
await openTab('Providers')
await check('Providers: remove the URL-form provider (defaults survive)', async () => {
  await providerCard('vercel-labs/skills').locator('[data-testid="skills-provider-remove"]').first().click({ force: true })
  await until('row gone', async () => !(await providerCard('vercel-labs/skills').isVisible().catch(() => false)))
  await until('defaults still present', async () => await providerCard('anthropics/skills').isVisible())
  // The settings section drops the provider record too.
  await until('settings provider dropped', async () => !settingsSection().includes('spec: vercel-labs/skills'))
})
await check('Providers: bare vercel-labs/skills works and defaults to GitHub', async () => {
  const input = page.getByTestId('skills-provider-input').first()
  await input.fill('vercel-labs/skills')
  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click({ force: true })
  await until('canonical row present', async () => {
    const row = providerCard('vercel-labs/skills')
    if (!(await row.isVisible().catch(() => false))) throw new Error('row not visible yet')
    const text = await row.textContent()
    // Synced (count) or rate-limited (surfaced error) both prove the bare
    // spec parsed, the record landed in settings, and the row renders.
    if (!text.includes('1 skill') && !text.includes('rate limit')) {
      throw new Error('row neither synced nor rate-limited: ' + text)
    }
    if (!settingsSection().includes('spec: vercel-labs/skills')) throw new Error('settings record missing')
    return true
  }, 45_000)
  await shot('10-provider-bare')
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
