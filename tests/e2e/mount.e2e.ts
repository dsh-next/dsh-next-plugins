/**
 * Mount smoke: prove the packed @dsh-next/dsh-next-* plugin tarballs mount
 * into a real `dsh web` instance and render without crash markers.
 *
 * The server is booted by `scripts/e2e-mount.sh`; the base URL arrives via
 * `DSH_E2E_URL` and the plugin list via `DSH_E2E_PLUGINS` (comma-separated
 * npm package names `@dsh-next/dsh-next-<slug>`) so the same spec works as
 * packages gain UI. The script also preseeds two scratch workspaces into
 * the home's registry (reusable `scripts/e2e-seed-workspaces.sh`) and
 * exports their canonical paths as `DSH_E2E_WORKSPACE_A` / `_B` so any
 * marker can drive workspace-scoped flows without machine-specific paths.
 *
 * Two layers:
 *   1. Every plugin: the shell renders, the client bundle is served, and no
 *      pageerror / plugin-prefixed console error occurs.
 *   2. Per-plugin DOM markers (`pluginMarkers`): a plugin that ships UI can
 *      register a closure that navigates to the UI and asserts it works. This
 *      is what catches "mounts without crashing but renders nothing" bugs
 *      that the crash-marker layer cannot (e.g. a silent payload-shape
 *      mismatch between a Host RPC and its card). Add an entry per plugin as
 *      they gain UI.
 */
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — boot a DSH web instance with the plugin family mounted and point this lane at it (see scripts/e2e-mount.sh)')
}

const pluginIds = (process.env.DSH_E2E_PLUGINS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

// Each entry is the npm package name (`@dsh-next/dsh-next-<slug>`). The client
// bundle is served at /plugins/<package-name>/client.js; the log crash-marker
// prefix is the bare `dsh-next-<slug>` (the cordis `id` field).
function bareId(pkg: string): string {
  return pkg.startsWith('@dsh-next/') ? pkg.slice('@dsh-next/'.length) : pkg
}

// A fresh scratch home walks a first-run onboarding flow (an "Internal Testing
// Notice", then an "Add an API key to get started" modal) whose masks intercept
// pointer events on the sidebar. Click EVERY visible dismissal button in order,
// repeatedly until no dialog remains. force:true sidesteps the modal mask that
// can still be animating at click time. Each test() gets a fresh context, so
// the dialog is re-shown every run and must be dismissed again.
async function dismissOnboarding(page: Page): Promise<void> {
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

// Navigate to a plugin's settings card, dismissing onboarding first. Returns
// once the card's body is open. force:true sidesteps the onboarding modal masks.
// The fresh scratch home can re-show a dialog on a cold load, so retry the whole
// dismiss-and-open sequence a bounded number of times.
async function openPluginCard(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      // A previous marker may have left the Settings -> Plugins view open; in
      // that case clicking "Settings" again toggles it closed. Only navigate
      // when the Plugins tab is not already visible.
      if (!(await page.getByText('Plugins', { exact: true }).first().isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
        await page.getByText('Plugins', { exact: true }).first().click({ force: true })
      }
      const card = page.getByText(title).first()
      await card.waitFor({ state: 'visible', timeout: 4000 })
      await card.click({ force: true })
      return
    } catch {
      // A dialog may have re-appeared on a cold load; dismiss and retry.
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`could not open the ${title} card after retries`)
}

async function openNotifierCard(page: Page): Promise<void> {
  await openPluginCard(page, 'Notifier')
}

// Navigate to the skills manager's own settings section (Settings -> Skills),
// dismissing onboarding first. Returns once the section's tab bar is visible.
async function openSkillsSection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      const nav = page.getByRole('button', { name: 'Skills', exact: true }).first()
      if (!(await nav.isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
      }
      await nav.waitFor({ state: 'visible', timeout: 4000 })
      await nav.click({ force: true })
      await page.waitForTimeout(400)
      if (await page.getByTestId('skills-search').first().isVisible().catch(() => false)) return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error('could not open the Skills settings section after retries')
}

// Navigate to the Claude marketplace bridge's settings section
// (Settings -> Claude Plugins), dismissing onboarding first. Returns once the
// section's tab bar is visible.
async function openCcSection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissOnboarding(page)
    try {
      const nav = page.getByRole('button', { name: 'Claude Plugins', exact: true }).first()
      if (!(await nav.isVisible().catch(() => false))) {
        await page.getByText('Settings', { exact: true }).first().click({ force: true })
        await page.waitForTimeout(600)
      }
      await nav.waitFor({ state: 'visible', timeout: 4000 })
      await nav.click({ force: true })
      await page.waitForTimeout(400)
      if (await page.getByText('Marketplaces', { exact: true }).first().isVisible().catch(() => false)) return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error('could not open the Claude Plugins settings section after retries')
}

// Per-plugin DOM markers: a package that ships UI registers a closure that
// drives to its UI and asserts real behavior. Keyed by the bare slug, invoked
// only when the plugin is in DSH_E2E_PLUGINS. Skipped markers make the smoke
// pass trivially, so only add one for a plugin whose UI is genuinely rendered.
const pluginMarkers: Record<string, (page: Page) => Promise<void>> = {
  // The notifier's settings card lives under Settings -> Plugins; opening it
  // must reveal the settings body (the regression this guards: a Host RPC that
  // returned raw config instead of the card's envelope, so the header toggled
  // open but the body never rendered).
  'dsh-next-notifier': async (page) => {
    // A fresh scratch home shows the sequential onboarding dialogs (testing
    // notice, API-key prompt) whose masks intercept pointer events; dismiss
    // them before driving the sidebar.
    await openNotifierCard(page)
    await expect(page.getByText('Enable notifications')).toBeVisible()
    await expect(page.getByText('Test browser notification')).toBeVisible()
    // The in-page toast channel: the Show button enqueues a synthetic toast
    // into the shell overlay; the capsule renders the test title and the
    // close button dismisses it (guards the overlay-slot registration — a
    // silent SlotMap mismatch would leave the layer unrendered). The frame
    // overlay sits under modal masks, so the toast only becomes clickable
    // after the Settings dialog closes; the sequence must beat the 12s TTL.
    await page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(page.getByTestId('dsh-next-notifier-toast').first()).toBeVisible()
    await expect(page.getByTestId('dsh-next-notifier-toast').first()).toContainText('Test toast')
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click({ force: true })
    await page.getByTestId('dsh-next-notifier-toast-close').first().click()
    await expect(page.getByTestId('dsh-next-notifier-toast')).toHaveCount(0)
  },

  // The worktrees plugin drives its full M1 loop plus the edge matrix through
  // the real GUI: preflight gating (toggle hidden for non-git and unborn
  // workspaces), the one-time ignore hint with localStorage persistence across
  // a reload, the confirm modal's cancel path, the create flow (worktree +
  // branch + registry + `.worktreeinclude` copy on the host; workspace +
  // session + bind + focus through the client runtime), the sandbox knob
  // surfacing as a Custom access mode, and — after a first message un-blanks
  // the session — the header chip: derived title, clean dot, panel facts with
  // the session's own worktree excluded from siblings, real clipboard copy
  // actions, the ahead badge after a commit, and the dirty remove flow whose
  // forced removal keeps the branch and its commits while dropping the
  // binding (git worktree list stays the source of truth).
  'dsh-next-worktrees': async (page) => {
    const workspaceA = process.env.DSH_E2E_WORKSPACE_A
    const workspaceB = process.env.DSH_E2E_WORKSPACE_B
    if (!workspaceA || !workspaceB) {
      throw new Error('DSH_E2E_WORKSPACE_A/_B are not set — run through scripts/e2e-mount.sh, which preseeds the workspaces')
    }
    const git = (args: string[], cwd: string = workspaceA): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' })
    // The toggle's preflight needs a repository with a resolvable base ref;
    // turn the preseeded scratch workspace into a committed repo first, and
    // seed a `.worktreeinclude` copy so creation must replicate it.
    git(['init', '-q', '-b', 'main'])
    git(['config', 'user.email', 'e2e@example.com'])
    git(['config', 'user.name', 'E2E'])
    writeFileSync(join(workspaceA, 'base.txt'), 'base\n')
    writeFileSync(join(workspaceA, '.worktreeinclude'), '.env\n')
    writeFileSync(join(workspaceA, '.env'), 'SECRET=1\n')
    git(['add', '.'])
    git(['commit', '-qm', 'base'])

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await dismissOnboarding(page)
    // A prior marker may leave the Settings dialog open; its mask swallows
    // composer interactions. Close it first.
    const settingsClose = page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' })
    if (await settingsClose.isVisible().catch(() => false)) {
      await settingsClose.click({ force: true })
      await page.waitForTimeout(300)
    }
    // The late "Add an API key" nudge can appear after the first keyless send
    // fails; its mask eats every later click, so clear dialogs on demand.
    const clearDialogs = async (): Promise<void> => {
      for (let round = 0; round < 10; round++) {
        if ((await page.locator('[role="dialog"]').count()) === 0) return
        for (const name of ['Continue', 'Configure later', 'Skip']) {
          const btn = page.locator('[role="dialog"] button', { hasText: name }).first()
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ force: true })
            await page.waitForTimeout(300)
          }
        }
        await page.waitForTimeout(300)
      }
    }
    const chooseWorkspace = async (title: string): Promise<void> => {
      await clearDialogs()
      const choose = page.getByRole('button', { name: 'Choose workspace' })
      await choose.click({ force: true })
      const option = page.getByRole('menuitem', { name: title })
      await option.waitFor({ state: 'visible', timeout: 5000 })
      await option.click({ force: true })
      await page.waitForTimeout(200)
    }
    const newSession = async (): Promise<void> => {
      await page.getByRole('button', { name: 'New session', exact: true }).first().click({ force: true })
      await page.waitForTimeout(600)
    }
    const typeIntoComposer = async (text: string): Promise<void> => {
      const editor = page.locator('[contenteditable="true"]').last()
      await editor.click()
      await page.keyboard.type(text)
      await page.waitForTimeout(200)
    }

    // Preflight gating: a non-git workspace never offers the toggle, and a
    // repository without any commit has no base ref to branch from either.
    await chooseWorkspace('workspace-b')
    await newSession()
    await page.waitForTimeout(2500)
    expect(await page.getByTestId('worktrees-toggle-button').count()).toBe(0)
    git(['init', '-q', '-b', 'main'], workspaceB)
    await chooseWorkspace('workspace-b')
    await newSession()
    await page.waitForTimeout(2500)
    expect(await page.getByTestId('worktrees-toggle-button').count()).toBe(0)

    // Happy path preflight in the git workspace: toggle renders, and the
    // one-time ignore hint shows while .dsh/ is not covered by a gitignore.
    await chooseWorkspace('workspace-a')
    await newSession()
    const toggle = page.getByTestId('worktrees-toggle-button')
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    const hint = page.getByTestId('worktrees-ignore-hint')
    await expect(hint).toBeVisible()
    // Dismissal is stored per browser profile and must survive the next
    // session's fresh composer mount: create another blank session through
    // the workspace row's own "+" affordance — the toggle returns, the hint
    // does not.
    await page.getByRole('button', { name: 'Dismiss' }).click({ force: true })
    await expect(hint).toBeHidden()
    await clearDialogs()
    await page.getByRole('treeitem', { name: 'workspace-a' }).hover()
    await page.getByRole('treeitem', { name: 'workspace-a' })
      .getByRole('button', { name: 'New session in workspace-a' }).click({ force: true })
    await expect(page.getByTestId('worktrees-toggle-button')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1000)
    expect(await page.getByTestId('worktrees-ignore-hint').count()).toBe(0)

    // The confirm modal's cancel path returns to the offered state; the draft
    // typed before confirming seeds the registry's display-only title.
    await typeIntoComposer('fix login race in the auth service')
    await toggle.click({ force: true })
    const confirm = page.getByTestId('worktrees-confirm')
    await expect(confirm).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click({ force: true })
    await expect(confirm).toBeHidden()
    await toggle.click({ force: true })
    await confirm.click({ force: true })

    // The create flow ran end to end: the worktree workspace appears (slug
    // row), the composer's picker flips to it (the new session opened inside
    // the worktree), and the access-mode indicator reads Custom — the live
    // signature of the sandbox-knob bind (danger-full-access with approval
    // untouched matches no stock preset).
    const slugRow = page.getByRole('treeitem', { name: /^[a-z]+-\d{2}$/ })
    await expect(slugRow).toBeVisible({ timeout: 30_000 })
    const slug = (await slugRow.first().innerText()).trim()
    const choose = page.getByRole('button', { name: 'Choose workspace' })
    await expect(choose).toContainText(slug, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Access mode, current: Custom/ })).toBeVisible()

    // On-disk effects through the real filesystem: the plugin registry
    // carries the owner binding with the draft-derived title, git records
    // the linked worktree, and `.worktreeinclude` entries were copied in.
    const worktreePath = join(workspaceA, '.dsh', 'worktrees', slug)
    const registryFile = join(workspaceA, '.dsh', 'worktrees', 'registry.json')
    await expect.poll(() => existsSync(registryFile)).toBe(true)
    interface BindingSnapshot {
      slug: string
      title: string
      role: string
      sessionId: string | null
    }
    let entry: BindingSnapshot | undefined
    await expect.poll(() => {
      const doc = JSON.parse(readFileSync(registryFile, 'utf8')) as { bindings: BindingSnapshot[] }
      entry = doc.bindings.find((b) => b.slug === slug)
      return entry?.sessionId ?? null
    }).not.toBeNull()
    expect(entry?.title).toBe('fix login race in')
    expect(entry?.role).toBe('owner')
    expect(git(['worktree', 'list', '--porcelain'])).toContain(worktreePath)
    expect(readFileSync(join(worktreePath, 'base.txt'), 'utf8')).toContain('base')
    expect(readFileSync(join(worktreePath, '.env'), 'utf8')).toContain('SECRET=1')

    // A first message un-blanks the session even when the keyless model call
    // fails, which mounts the session header — and with it the chip, showing
    // the derived title and a clean status dot while the toggle is gone.
    await typeIntoComposer('hello')
    await page.keyboard.press('Enter')
    // the failed turn can raise the API-key nudge; clear its mask before any
    // pointer work
    await clearDialogs()
    const chip = page.getByTestId('worktrees-chip')
    await expect(chip).toBeVisible({ timeout: 30_000 })
    await expect(chip).toHaveAttribute('data-status', 'clean')
    await expect(chip).toContainText('fix login race in')
    expect(await page.getByTestId('worktrees-toggle-button').count()).toBe(0)

    // Panel facts name the branch, base, and path; the session's own worktree
    // is excluded from siblings, so a single worktree shows the empty state.
    const panel = page.getByTestId('worktrees-panel')
    const ensurePanel = async (): Promise<void> => {
      if (!(await panel.isVisible().catch(() => false))) await chip.click({ force: true })
      await expect(panel).toBeVisible()
    }
    await ensurePanel()
    await expect(panel).toContainText(`dsh-worktrees/${slug}`)
    await expect(panel).toContainText('HEAD')
    await expect(panel).toContainText(join('.dsh', 'worktrees'))
    await expect(panel).toContainText('No other worktrees')

    // Copy actions go through the real clipboard with visible feedback.
    await panel.getByRole('button', { name: 'Copy branch name' }).click()
    await expect(panel.getByText('Copied')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`dsh-worktrees/${slug}`)
    await panel.getByRole('button', { name: 'Copy merge command' }).click()
    // the branch button's Copied may have expired (1.5s); the merge button's
    // own feedback is the sync point before the clipboard read
    await expect(panel.getByText('Copied').last()).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`git merge dsh-worktrees/${slug}`)

    // A commit inside the worktree moves the branch ahead of base; Refresh
    // picks it up and the chip carries the ahead count.
    writeFileSync(join(worktreePath, 'notes.md'), 'wip\n')
    git(['add', '.'], worktreePath)
    git(['commit', '-qm', 'wip work'], worktreePath)
    await clearDialogs()
    await ensurePanel()
    await panel.getByRole('button', { name: 'Refresh' }).click()
    await expect(chip.getByText('1 ahead')).toBeVisible({ timeout: 10_000 })

    // Danger grammar: an untracked file flips the dot to dirty, the remove
    // modal names the surviving branch and demands the explicit forced
    // confirm, and forcing removes only the directory — the branch, its
    // commits, and the registry's cleanliness all check out on disk.
    writeFileSync(join(worktreePath, 'scratch.txt'), 'uncommitted\n')
    await clearDialogs()
    await ensurePanel()
    await panel.getByRole('button', { name: 'Refresh' }).click()
    await expect(chip).toHaveAttribute('data-status', 'dirty', { timeout: 10_000 })
    await panel.getByRole('button', { name: 'Remove worktree' }).click()
    const removeDialog = page.locator('[role="dialog"][aria-label="Remove this worktree?"]')
    await expect(removeDialog).toBeVisible()
    await expect(removeDialog).toContainText(`dsh-worktrees/${slug}`)
    await expect(removeDialog).toContainText('uncommitted or untracked changes')
    await expect(page.getByTestId('worktrees-remove-force')).toBeVisible()
    await page.getByTestId('worktrees-remove-force').click()
    await expect(chip).toBeHidden({ timeout: 15_000 })
    await expect.poll(() => existsSync(worktreePath)).toBe(false)
    expect(git(['rev-parse', '--verify', `dsh-worktrees/${slug}`])).not.toBe('')
    expect(git(['log', '--oneline', '-1', `dsh-worktrees/${slug}`])).toContain('wip work')
    const registryAfter = JSON.parse(readFileSync(registryFile, 'utf8')) as { bindings: string[] }
    expect(registryAfter.bindings).toEqual([])
    expect(git(['worktree', 'list', '--porcelain'])).not.toContain(worktreePath)
  },

  // The skills manager registers its own Settings -> Skills section (the same
  // nav level as General/Models/Plugins) with Skills and Providers tabs over
  // a card grid, backed by the settings.yaml configuration. Opening it must
  // reveal the tab bar and the seeded throwaway skill's card; the card's
  // scope modal must offer Global vs the workspaces checklist; the source
  // switcher must detach (config-only) and re-adopt (overwrite confirm) the
  // seeded same-name provider; and the red Delete must remove the skill
  // end-to-end through the two-step confirm (guards client-side state-refresh
  // regressions the "section renders" check cannot see). No network: the
  // provider and its catalog are seeded into the scratch home only.
  'dsh-next-skills': async (page) => {
    await openSkillsSection(page)
    // The harness page scaffold: the section draws its own title heading
    // above the tab strip (the shell's settings-section pattern).
    await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
    await expect(page.getByText('Providers', { exact: true })).toBeVisible()
    const card = page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' }).first()
    await expect(card).toBeVisible()
    await card.locator('[data-testid="skills-scopes"]').click()
    const modal = page.getByTestId('skills-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('skills-scope-global').locator('input')).toBeChecked()
    // The workspaces radio reveals the checklist, listing the workspaces
    // e2e-mount.sh preseeded into the home's registry (canonical paths via
    // env — the same reusable seeding every marker can drive). Scoped to
    // the checklist: the preseeded workspaces also show in the sidebar.
    await page.getByTestId('skills-scope-workspaces').click()
    const wsList = page.getByTestId('skills-workspaces')
    await expect(wsList).toContainText('workspace-a')
    await expect(wsList).toContainText('workspace-b')
    await modal.locator('[data-testid="skills-modal-confirm"]').click()
    // Source switcher: the seeded provider offers the same name with a
    // catalog version that never matches the local fingerprint, so the card
    // shows the recorded-provider Update button plus the Providers switcher.
    // The modal lists Local and the provider (marked Current, Replace
    // disabled as a no-op); detaching applies directly (config-only: the
    // provider chip's Update disappears, files stay), and re-adopting goes
    // through the overwrite confirm (updateSkill re-pins provenance).
    await expect(card.locator('[data-testid="skills-update"]')).toBeVisible()
    const providersButton = card.locator('[data-testid="skills-providers"]')
    await expect(providersButton).toContainText('Providers (1)')
    await providersButton.click()
    const sourcesModal = page.getByTestId('skills-sources-modal')
    await expect(sourcesModal).toBeVisible()
    await expect(sourcesModal.getByTestId('skills-source-local')).toContainText('Local (hand-managed)')
    const sourceOption = sourcesModal.getByTestId('skills-source-option')
    await expect(sourceOption).toContainText('e2e/local')
    await expect(sourceOption).toContainText('Current')
    await expect(sourcesModal.getByTestId('skills-source-apply')).toBeDisabled()
    await sourcesModal.getByTestId('skills-source-local').locator('input').click()
    await sourcesModal.getByTestId('skills-source-apply').click()
    await expect(sourcesModal).toHaveCount(0)
    // Detached: the provenance-pinned Update goes (no recorded provider);
    // the switcher now marks Local as the current source.
    await expect(card.locator('[data-testid="skills-update"]')).toHaveCount(0)
    await providersButton.click()
    await expect(sourcesModal.getByTestId('skills-source-local-hint')).toHaveText('Current')
    // Re-adopt the provider: Replace demands the overwrite confirm first,
    // whose body states the real semantics (permanent removal, no trash).
    await sourceOption.locator('input').click()
    await sourcesModal.getByTestId('skills-source-apply').click()
    await expect(sourcesModal.getByTestId('skills-source-confirm-body')).toContainText('e2e/local version')
    await expect(sourcesModal.getByTestId('skills-source-confirm-body')).toContainText('not moved to trash')
    await sourcesModal.getByTestId('skills-source-confirm-btn').click()
    await expect(sourcesModal).toHaveCount(0)
    // Re-pinned: the Update button returns (the seed version still differs).
    await expect(card.locator('[data-testid="skills-update"]')).toBeVisible()
    // Search wiring + relevance: the box drives the grid; a name match ranks
    // above a description-only match even when that match sorts earlier
    // alphabetically (aaa-offering exists to make that order adversarial);
    // a no-hit query lands on the empty state; clearing restores the grid.
    const searchBox = page.getByTestId('skills-search').first()
    const gridCards = page.locator('[data-testid="skills-card"]')
    await searchBox.fill('e2e-test')
    await expect(gridCards).toHaveCount(2)
    await expect(gridCards.first()).toContainText('e2e-test-skill')
    await expect(gridCards.nth(1)).toContainText('aaa-offering')
    await searchBox.fill('zzz-nothing-matches-this')
    await expect(page.getByTestId('skills-empty')).toBeVisible()
    await searchBox.fill('')
    await expect(gridCards).toHaveCount(2)
    // Two-step delete drives the real host service; the confirm modal shows
    // the copy path, and confirming removes the card.
    await card.locator('[data-testid="skills-delete"]').click()
    const confirm = page.getByTestId('skills-delete-confirm')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByTestId('skills-delete-path')).toContainText('e2e-test-skill')
    await confirm.getByTestId('skills-delete-confirm-btn').click()
    // The managed card goes; the seeded provider still offers the name, so
    // its card correctly flips to a catalog-only Use card (nothing managed
    // remains: no Delete, no Providers switcher).
    await expect(page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' }).locator('[data-testid="skills-delete"]')).toHaveCount(0)
    const remaining = page.locator('[data-testid="skills-card"]', { hasText: 'e2e-test-skill' })
    await expect(remaining.getByTestId('skills-use')).toBeVisible()
    await expect(remaining.getByTestId('skills-providers')).toHaveCount(0)
    // Providers tab renders with the add-provider control; the host seeds its
    // default providers shortly after boot, so rows may already be present —
    // never assert emptiness here.
    await page.getByTestId('skills-tab-providers').click({ force: true })
    await expect(page.getByTestId('skills-add-input').first()).toBeVisible()
    await expect(page.getByTestId('skills-provider-refresh-all').first()).toBeVisible()
  },

  // The cc-plugins bridge registers its own Settings -> Claude Plugins
  // section with Marketplaces and Installed tabs backed by the Host RPC over
  // the plugin data root. Opening it must reveal the tab bar, the empty
  // marketplaces state, and the add-marketplace control; switching to the
  // Installed tab must render its empty state (guards a silent payload-shape
  // mismatch the crash-marker layer cannot see). The official Anthropic
  // marketplace is seeded on the fresh scratch home (its GitHub sync is best
  // effort; assertions never depend on it). The marker closes the Settings
  // dialog afterwards:
  // this package sorts before dsh-next-notifier, whose openPluginCard only
  // handles a closed or Plugins-view Settings shell.
  'dsh-next-cc-plugins': async (page) => {
    await openCcSection(page)
    // The section label is a locale-service function label; under the
    // default (en) locale it must still read exactly "Claude Plugins".
    await expect(page.getByRole('button', { name: 'Claude Plugins', exact: true }).first()).toBeVisible()
    // The harness page scaffold: the section draws its own title heading
    // above the tab strip (the shell's settings-section pattern).
    await expect(page.getByRole('heading', { name: 'Claude Plugins', exact: true })).toBeVisible()
    // Tab clicks stay scoped to the Settings dialog: the app's own sidebar
    // also has "Plugins" and "Models" pages an unscoped text locator hits.
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(page.getByText('Plugins', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Marketplaces', { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('cc-search').first()).toBeVisible()
    await expect(page.getByTestId('cc-installed-only').first()).toBeVisible()
    await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
    await expect(page.locator('input[placeholder*="owner/repo"]').first()).toBeVisible()
    await expect(page.getByText('refresh automatically', { exact: false }).first()).toBeVisible()
    // A fresh install seeds the official Anthropic marketplace; the row
    // renders from the registry alone, so this holds even when its sync
    // cannot reach GitHub from the test environment.
    await expect(page.getByText('anthropics/claude-plugins-official', { exact: false }).first()).toBeVisible()
    // A local-fixture marketplace drives the real add -> card -> detail ->
    // scope-modal install -> manage/uninstall flow offline: the panel lists
    // its plugins, the detail modal shows the component inventory (including
    // the not-bridged LSP family), and the radio modal installs globally and
    // uninstalls through the real host service. The parity fixture plugin
    // additionally proves dependency auto-install, user_config MCP
    // expansion, and plugin-level reference rewriting end to end — asserted
    // on the scratch home's real filesystem, not just the DOM.
    const fixture = join(process.cwd(), 'tests/e2e/fixtures/tiny-marketplace')
    await page.getByTestId('cc-add-input').first().fill(fixture)
    await page.getByRole('button', { name: 'Add marketplace' }).first().click()
    await expect(page.getByText('tiny-tools', { exact: false }).first()).toBeVisible()
    // Plugin cards live on the Plugins tab. The fixture card is located by
    // name: the seeded official marketplace contributes cards of its own
    // whenever its sync reaches GitHub.
    await settings.getByRole('tab', { name: 'Plugins' }).click({ force: true })
    // Large catalogs (the official marketplace whenever its sync reaches
    // GitHub) paginate 30 cards per page: exhaust the Show more pager so
    // the fixture cards are on the page before this marker locates them.
    for (let i = 0; i < 20 && await page.getByTestId('cc-show-more').isVisible().catch(() => false); i++) {
      await page.getByTestId('cc-show-more').click({ force: true })
      await page.waitForTimeout(200)
    }
    const demoCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("demo-tools"))').first()
    await expect(demoCard).toBeVisible()
    await demoCard.locator('[data-testid="cc-detail"]').click()
    await expect(page.getByTestId('cc-plugin-detail')).toBeVisible()
    await expect(page.getByTestId('cc-detail-components')).toContainText('skills: demo-skill')
    await expect(page.getByTestId('cc-detail-components')).toContainText('commands: hello')
    await expect(page.getByTestId('cc-detail-components')).toContainText('LSP server')
    await page.getByTestId('cc-detail-close').click()
    await expect(page.getByTestId('cc-plugin-detail')).toHaveCount(0)
    // The scope modal drives a real install: Global is the default radio,
    // the workspaces checklist stays hidden (indented under its radio when
    // shown), and Install installs globally.
    await demoCard.locator('[data-testid="cc-install"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await expect(page.getByTestId('cc-scope-global').locator('input')).toBeChecked()
    await expect(page.getByTestId('cc-workspaces')).toHaveCount(0)
    await page.getByTestId('cc-modal-confirm').click()
    await expect(page.getByTestId('cc-modal')).toHaveCount(0)
    // Installed cards flip to Scopes + Uninstall (plus Update when offered).
    await expect(demoCard.getByTestId('cc-scopes')).toBeVisible()
    await expect(demoCard.getByTestId('cc-uninstall')).toBeVisible()
    await expect(demoCard.getByTestId('cc-installed-version')).toBeVisible()
    // Uninstall is a two-step confirm modal opened from the card; it
    // removes the plugin again.
    await demoCard.getByTestId('cc-uninstall').click()
    await expect(page.getByTestId('cc-uninstall-modal')).toBeVisible()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(demoCard.getByTestId('cc-scopes')).toHaveCount(0)
    await expect(demoCard.getByTestId('cc-install')).toBeVisible()
    // The parity fixture plugin drives the three newest bridges through
    // the real host service: dependency auto-install, user_config MCP
    // expansion, and plugin-level reference rewriting. Seed the user
    // configuration first so the token expands instead of staying literal.
    const ccRoot = join(process.env.DSH_HOME ?? '', 'cc-plugins')
    mkdirSync(ccRoot, { recursive: true })
    writeFileSync(join(ccRoot, 'user-config.json'), JSON.stringify({ parity_token: 'e2e-parity-token' }))
    const parityCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("parity-tools"))').first()
    await parityCard.locator('[data-testid="cc-install"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await page.getByTestId('cc-modal-confirm').click()
    await expect(parityCard.getByTestId('cc-scopes')).toBeVisible()
    // The declared dependency auto-installed alongside, and the outcome
    // surfaced in the mutation message.
    const depCard = page.locator('[data-testid="cc-plugin"]:has([data-testid="cc-detail"]:text-is("dep-provider"))').first()
    await expect(depCard.getByTestId('cc-scopes')).toBeVisible()
    await expect(depCard.getByTestId('cc-installed-version')).toBeVisible()
    await expect(page.getByTestId('cc-message')).toContainText('auto-installed dependency "dep-provider"')
    // On-disk effects through the real filesystem: the installed skill
    // copy carries the rewritten absolute path into the materialized
    // copy, and the managed MCP row carries the expanded user_config
    // token (not the literal template).
    const agentsHome = process.env.DSH_AGENTS_HOME ?? ''
    const readerSkill = readFileSync(join(agentsHome, 'skills', 'reader', 'SKILL.md'), 'utf8')
    expect(readerSkill).toContain('/references/guide.md')
    expect(readerSkill).toContain(join(ccRoot, 'plugins'))
    expect(readerSkill).not.toContain('../../references')
    const patchYml = readFileSync(join(process.env.DSH_HOME ?? '', 'cordis.patch.yml'), 'utf8')
    expect(patchYml).toContain('e2e-parity-token')
    expect(patchYml).not.toContain('${user_config.parity_token}')
    // Uninstall both: dependencies stay independent of their parent, so
    // each card carries its own two-step uninstall.
    await parityCard.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(parityCard.getByTestId('cc-scopes')).toHaveCount(0)
    await depCard.getByTestId('cc-uninstall').click()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(depCard.getByTestId('cc-scopes')).toHaveCount(0)
    // The Workspaces radio path, against the workspaces e2e-mount.sh
    // preseeded into the scratch home's registry (canonical paths arrive
    // via env — never machine-specific literals). Install demo-tools into
    // workspace-a only: skills are global-only, so the copy lands in the
    // global skill root and the workspace scope is enablement, not placement.
    const workspaceA = process.env.DSH_E2E_WORKSPACE_A
    if (!workspaceA) throw new Error('DSH_E2E_WORKSPACE_A is not set — run through scripts/e2e-mount.sh, which preseeds the workspaces')
    const workspaceB = process.env.DSH_E2E_WORKSPACE_B ?? ''
    await demoCard.locator('[data-testid="cc-install"]').click()
    await expect(page.getByTestId('cc-modal')).toBeVisible()
    await page.getByTestId('cc-scope-workspaces').locator('input').click()
    const checklist = page.getByTestId('cc-workspaces')
    await expect(checklist).toBeVisible()
    // Both preseeded workspaces offer themselves in the checklist.
    await expect(checklist).toContainText('workspace-a')
    if (workspaceB !== '') await expect(checklist).toContainText('workspace-b')
    await checklist.locator('[data-testid="cc-workspace"]').filter({ hasText: 'workspace-a' }).first().locator('input[type="checkbox"]').click()
    await page.getByTestId('cc-modal-confirm').click()
    await expect(demoCard.getByTestId('cc-scopes')).toBeVisible()
    await expect(demoCard).toContainText('in workspace-a')
    // The skill copy landed in the GLOBAL root — skills never install into
    // projects; the workspace scope is enablement, not physical placement.
    await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')).toContain('demo')
    expect(existsSync(join(workspaceA, '.agents', 'skills', 'demo-skill'))).toBe(false)
    // Scopes re-opens on the workspace scope; Save scope to global clears the
    // enablement restriction (the global copy stays put).
    await demoCard.getByTestId('cc-scopes').click()
    await expect(page.getByTestId('cc-scope-workspaces').locator('input')).toBeChecked()
    await page.getByTestId('cc-scope-global').locator('input').click()
    await page.getByTestId('cc-modal-confirm').click()
    await expect.poll(() => existsSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true)
    await expect(demoCard).toContainText('in global')
    // Full uninstall from the global scope; the marketplace can go after.
    await demoCard.getByTestId('cc-uninstall').click()
    await expect(page.getByTestId('cc-uninstall-modal')).toBeVisible()
    await page.getByTestId('cc-uninstall-confirm').click()
    await expect(demoCard.getByTestId('cc-scopes')).toHaveCount(0)
    // Remove the fixture marketplace; the seeded official one remains
    // (the Remove button inside the tiny-tools row, not a foreign one).
    await settings.getByRole('tab', { name: 'Marketplaces' }).click({ force: true })
    // Refresh all runs one marketplace at a time (the active row's Remove
    // swaps for a spinner): wait for the label to revert and the summary.
    await page.getByTestId('cc-marketplace-refresh-all').click()
    await expect(page.getByTestId('cc-marketplace-refresh-all')).toContainText('Refresh all')
    await expect(page.getByTestId('cc-message')).toContainText(/Refreshed \d+ marketplace|Refresh failed/)
    await page.locator('[data-testid="cc-marketplace"]:has-text("tiny-tools")').getByRole('button', { name: 'Remove', exact: true }).click()
    // Removal confirms through a modal before the RPC.
    await expect(page.getByTestId('cc-marketplace-remove-modal')).toBeVisible()
    await page.getByTestId('cc-marketplace-remove-confirm').click()
    await expect(page.getByText('tiny-tools', { exact: false })).toHaveCount(0)
    await expect(page.getByText('anthropics/claude-plugins-official', { exact: false }).first()).toBeVisible()
    // The Models tab offers alias pickers over the runtime's live models.
    await settings.getByRole('tab', { name: 'Models' }).click({ force: true })
    await expect(page.getByTestId('cc-model-row').first()).toBeVisible()
    await expect(page.getByTestId('cc-model-select').first()).toBeVisible()
    await settings.getByRole('button', { name: 'Close' }).click({ force: true })
    await page.waitForTimeout(300)
  },
}

test('plugin family mounts the dsh-next plugins without crash markers', async ({ page }) => {
  const pageErrors: string[] = []
  const pluginConsoleErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/dsh-next[-/]/.test(text)) pluginConsoleErrors.push(text)
  })

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  // The shell rendered: wait for the DSH app root to exist in the DOM.
  await page.waitForSelector('#root, [data-dsh-app], body', { state: 'attached', timeout: 30_000 })

  // Every plugin's client bundle is composed into the boot graph. A missing
  // entry means the profile patch failed to register the row (the exact class
  // of bug only a real-mount smoke can catch). 0.1.2 serves bundles through
  // the rev-hashed combo route, not a stable singular URL, so the composed
  // graph is the authoritative signal.
  const entryIds = await page.evaluate(() => {
    const boot = (globalThis as { __DSH_BOOT__?: { entries?: Array<{ id?: string }> } }).__DSH_BOOT__
    return (boot?.entries ?? []).map((entry) => entry.id).filter((id): id is string => id !== undefined)
  })
  for (const pkg of pluginIds) {
    expect(entryIds, `${pkg} client bundle should be in the boot graph`).toContain(pkg)
  }

  // No plugin crash strips or page errors anywhere.
  for (const pkg of pluginIds) {
    const id = bareId(pkg)
    await expect(page.getByText(new RegExp(`^dsh-next-${id}:|^\\[dsh-next-${id}\\]`))).toHaveCount(0)
  }
  expect(pageErrors, 'page errors').toEqual([])
  expect(pluginConsoleErrors, 'plugin console errors').toEqual([])

  // Per-plugin DOM markers: drive to each plugin's UI and assert it works.
  for (const pkg of pluginIds) {
    const marker = pluginMarkers[bareId(pkg)]
    if (marker) await marker(page)
  }
})
