/**
 * The Skills settings panel rendered in the `settings.section` slot: a whole
 * settings page (not a plugin card) with three tabs (Installed, Search,
 * Providers) over the Host JSON RPC, plus a Configuration block exposing the
 * master switch, the refresh interval, and the GitHub token.
 */
import * as React from 'react'
import type {
  CatalogSkillView,
  InstalledMap,
  InstalledSkill,
  MarketplaceView,
  MutationResult,
  ProviderView,
  SkillDetail,
  SkillsState,
  WorkspaceRow,
} from '../core/types.ts'
import styles from './card.module.css'
import { renderMarkdown } from './markdown.tsx'

export interface SkillsPanelDeps {
  rpc: (method: string, args?: unknown) => Promise<unknown>
  getWorkspaces: () => WorkspaceRow[]
  /** Signals the browser that the installed skill catalog changed. */
  notifyInstalledChanged?: () => void
}

type Tab = 'installed' | 'search' | 'providers'

/**
 * The right-aligned scope chip on an installed row's title line: the star
 * marks the global scope, otherwise the owning workspace's title; disabled
 * and shadow markers are appended.
 */
function scopeChipText(skill: InstalledSkill, workspaces: WorkspaceRow[]): string {
  const markers = (skill.enabled ? '' : ' · disabled') + (skill.shadow === true ? ' · shadow' : '')
  if (skill.scope !== 'workspace') return '⭐ Global' + markers
  const match = workspaces.find((w) => skill.directory.startsWith(w.path + '/'))
  return (match?.title ?? 'Workspace') + markers
}

function isMutationError(result: unknown): result is { ok: false; error: string } {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false
}

/** Mutations whose success changes the installed skill set the chat UI surfaces. */
const CATALOG_MUTATIONS = new Set(['installSkill', 'remove', 'updateSkill', 'updateAllCopies', 'setEnabled'])

/** Strip the JavaScript `Error: ` prefix from a caught value for display. */
function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Short human rendering of an ISO timestamp ('' when empty). */
function timeAgo(iso: string): string {
  if (iso === '') return 'never refreshed'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'never refreshed'
  const minutes = Math.floor((Date.now() - t) / 60000)
  if (minutes < 1) return 'refreshed just now'
  if (minutes < 60) return `refreshed ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `refreshed ${hours} h ago`
  const days = Math.floor(hours / 24)
  return `refreshed ${days} d ago`
}

/** Per-target presence of a skill name: the global root and each workspace. */
interface Presence {
  global: Set<string>
  byPath: Map<string, Set<string>>
}

export function SkillsPanel({ rpc, getWorkspaces, notifyInstalledChanged }: SkillsPanelDeps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('installed')
  const [state, setState] = React.useState<SkillsState | null>(null)
  const [market, setMarket] = React.useState<MarketplaceView | null>(null)
  const [presence, setPresence] = React.useState<Presence | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [providerFilter, setProviderFilter] = React.useState('')
  const [addTarget, setAddTarget] = React.useState<CatalogSkillView | null>(null)
  const [addSelection, setAddSelection] = React.useState<Set<string>>(new Set())
  const [providerInput, setProviderInput] = React.useState('')
  // null = untouched (default to the first workspace); '' = explicit Global
  // only. Without the null sentinel the empty string would fall through to
  // the first workspace again and the "Global only" option could never win.
  const [workspacePath, setWorkspacePath] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [warning, setWarning] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState<InstalledSkill | null>(null)
  const [confirmProvider, setConfirmProvider] = React.useState<ProviderView | null>(null)
  const [detail, setDetail] = React.useState<SkillDetail | null>(null)

  const workspaces = React.useMemo(getWorkspaces, [getWorkspaces])

  const selectedWorkspace = React.useMemo(() => {
    const chosen = workspacePath ?? workspaces[0]?.path
    if (chosen === undefined || chosen === '') return undefined
    return workspaces.find((w) => w.path === chosen)
  }, [workspaces, workspacePath])

  const currentPath = selectedWorkspace?.path

  const hydrateState = React.useCallback((v: SkillsState): void => {
    setState(v)
  }, [])

  const loadState = React.useCallback(() => {
    setBusy(true)
    rpc('getState', { workspacePath: currentPath })
      .then((v) => { hydrateState(v as SkillsState); setError(null) })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false))
  }, [rpc, currentPath, hydrateState])

  const loadMarket = React.useCallback(() => {
    setBusy(true)
    rpc('marketplace', {})
      .then((v) => { setMarket(v as MarketplaceView); setError(null) })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false))
  }, [rpc])

  /** Refresh per-target presence (silent: the marketplace treats it as best-effort). */
  const loadPresence = React.useCallback(() => {
    const paths = workspaces.map((w) => w.path)
    rpc('getInstalledMap', { workspacePaths: paths })
      .then((v) => {
        const map = v as InstalledMap
        setPresence({
          global: new Set(map.global.map((s) => s.name)),
          byPath: new Map(map.workspaces.map((w) => [w.workspacePath, new Set(w.installed.map((s) => s.name))])),
        })
      })
      .catch(() => {})
  }, [rpc, workspaces])

  // Load state whenever the panel mounts or the workspace scope changes.
  React.useEffect(() => {
    let alive = true
    rpc('getState', { workspacePath: currentPath }).then((v) => { if (alive) hydrateState(v as SkillsState) }).catch(() => {})
    return () => { alive = false }
  }, [rpc, currentPath, hydrateState])

  React.useEffect(() => { loadPresence() }, [loadPresence])

  /** Close the confirmation popup (Escape, Cancel, or scrim click). */
  function closeConfirm(): void {
    setConfirmRemove(null)
    setConfirmProvider(null)
  }

  /** Close the Add-skill modal without installing. */
  function closeAddModal(): void {
    setAddTarget(null)
    setAddSelection(new Set())
  }

  React.useEffect(() => {
    if (confirmRemove === null && confirmProvider === null && detail === null && addTarget === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeConfirm(); closeAddModal(); setDetail(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmRemove, confirmProvider, detail, addTarget])

  /** Open the detail modal with a skill's full SKILL.md configuration. */
  async function openDetail(method: string, args: Record<string, unknown>): Promise<void> {
    setBusy(true)
    try {
      const d = await rpc(method, args)
      if (d && typeof d === 'object') {
        setDetail(d as SkillDetail)
        setError(null)
      } else {
        setError('could not load the skill detail')
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const openCatalogDetail = (skill: CatalogSkillView): Promise<void> =>
    openDetail('getCatalogSkillDetail', { providerId: skill.providerId, skillPath: skill.skillPath })
  const openInstalledDetail = (skill: InstalledSkill): Promise<void> =>
    openDetail('getInstalledSkillDetail', { name: skill.name, scope: skill.scope, workspacePath: currentPath })

  const applyMutation = (result: MutationResult): void => {
    if (isMutationError(result)) {
      setError(result.error)
      setWarning(null)
      loadState()
    } else {
      hydrateState(result.state)
      closeConfirm()
      setError(null)
      setWarning(result.warning ?? null)
    }
  }

  /** RPCs whose success changes the installed skill set the chat UI surfaces. */
  function mutate(method: string, args: Record<string, unknown>, refreshMarket = false): void {
    setBusy(true)
    rpc(method, args)
      .then((v) => {
        applyMutation(v as MutationResult)
        if (!isMutationError(v) && CATALOG_MUTATIONS.has(method)) notifyInstalledChanged?.()
        if (refreshMarket) void loadMarket()
        void loadPresence()
      })
      .catch((e) => { setError(errMsg(e)); setWarning(null); loadState() })
      .finally(() => setBusy(false))
  }

  function toggleSkill(skill: InstalledSkill): void {
    // Disabling while a workspace is selected shadows a global skill for that
    // workspace only (re-enabling removes the shadow); every other toggle
    // applies to the skill's own scope. "Global only" toggles globally.
    const disabling = skill.enabled
    const scope = disabling && skill.scope === 'global' && currentPath !== undefined
      ? 'workspace'
      : skill.scope
    mutate('setEnabled', {
      name: skill.name,
      scope,
      enabled: !skill.enabled,
      workspacePath: currentPath,
      description: skill.description,
    })
  }

  /** First Remove click opens the confirmation popup; the dialog confirms. */
  function requestRemove(skill: InstalledSkill): void {
    setConfirmRemove(skill)
  }

  function confirmRemoveSkill(): void {
    if (confirmRemove === null) return
    const skill = confirmRemove
    closeConfirm()
    mutate('remove', { name: skill.name, scope: skill.scope, workspacePath: currentPath })
  }

  function updateSkill(skill: InstalledSkill): void {
    mutate('updateSkill', { name: skill.name, scope: skill.scope, workspacePath: currentPath })
  }

  /** Update every copy of the skill (global plus each workspace) in one call. */
  function updateAllCopies(skill: InstalledSkill): void {
    mutate('updateAllCopies', {
      name: skill.name,
      workspacePaths: workspaces.map((w) => w.path),
    })
  }

  /** Open the Add modal: pick any mix of global + workspaces in one go. */
  function openAddModal(skill: CatalogSkillView): void {
    setAddSelection(new Set())
    setAddTarget(skill)
  }

  function toggleAddTarget(key: string): void {
    setAddSelection((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Install into every checked target; targets already holding the skill are locked. */
  async function confirmAddSkill(): Promise<void> {
    if (addTarget === null || addSelection.size === 0) return
    const skill = addTarget
    const targets = [...addSelection]
    setAddTarget(null)
    setAddSelection(new Set())
    setBusy(true)
    try {
      let lastState: SkillsState | undefined
      const failures: string[] = []
      for (const key of targets) {
        const workspaceScoped = key !== ''
        const result = await rpc('installSkill', {
          providerId: skill.providerId,
          skillPath: skill.skillPath,
          scope: workspaceScoped ? 'workspace' : 'global',
          workspacePath: workspaceScoped ? key : undefined,
        }) as MutationResult
        if (isMutationError(result)) failures.push(result.error)
        else lastState = result.state
      }
      if (lastState !== undefined) hydrateState(lastState)
      if (failures.length === targets.length) {
        setError(failures[0])
        setWarning(null)
        loadState()
      } else if (failures.length > 0) {
        setError(null)
        setWarning(`Added to ${targets.length - failures.length} of ${targets.length} targets; first failure: ${failures[0]}`)
      } else {
        setError(null)
        setWarning(null)
      }
      notifyInstalledChanged?.()
      void loadPresence()
    } catch (e) {
      setError(errMsg(e))
      setWarning(null)
      loadState()
    } finally {
      setBusy(false)
    }
  }

  function addProvider(): void {
    const spec = providerInput.trim()
    if (spec === '') return
    setProviderInput('')
    mutate('addProvider', { spec }, true)
  }

  function removeProvider(provider: ProviderView): void {
    setConfirmProvider(provider)
  }

  function confirmRemoveProvider(): void {
    if (confirmProvider === null) return
    const provider = confirmProvider
    closeConfirm()
    mutate('removeProvider', { providerId: provider.id }, true)
  }

  function refreshProvider(provider: ProviderView): void {
    mutate('refreshProvider', { providerId: provider.id }, true)
  }

  function refreshProviders(): void {
    mutate('refreshProviders', {}, true)
  }

  const installed = state?.installed ?? []

  const installedBody = installed.length === 0
    ? React.createElement('p', { className: styles.hint }, 'No skills installed in this scope.')
    : installed.map((skill) => {
      // A disabled skill dims only its title and description; badges and
      // buttons stay crisp.
      const dim = skill.enabled ? '' : ' ' + styles.skillDisabled
      return React.createElement('div', { className: styles.skill + ' ' + styles.skillVertical, key: skill.name },
        React.createElement('div', {
          className: styles.titleRow + ' ' + styles.clickable, role: 'button', tabIndex: 0,
          'aria-label': 'View ' + skill.name,
          onClick: () => { void openInstalledDetail(skill) },
        },
          React.createElement('span', { className: styles.label + dim }, skill.name),
          React.createElement('span', { className: styles.badge }, scopeChipText(skill, workspaces))),
        React.createElement('div', {
          className: styles.metaRow + ' ' + styles.clickable,
          onClick: () => { void openInstalledDetail(skill) },
        },
          React.createElement('span', {
            className: styles.badge + (skill.provider !== undefined ? '' : ' ' + styles.customBadge),
          }, skill.provider !== undefined ? skill.provider : 'custom')),
        React.createElement('div', {
          className: styles.hint + dim + ' ' + styles.clickable,
          onClick: () => { void openInstalledDetail(skill) },
        }, skill.description),
        React.createElement('div', { className: styles.skillActions },
          React.createElement('button', {
            type: 'button',
            className: styles.ghost + ' ' + (skill.enabled ? styles.danger : styles.success),
            disabled: busy,
            onClick: () => toggleSkill(skill),
          }, skill.enabled ? 'Disable' : 'Enable'),
          React.createElement('button', {
            type: 'button', className: styles.ghost, disabled: busy,
            onClick: () => requestRemove(skill),
          }, 'Remove'),
          React.createElement('button', {
            type: 'button', className: styles.ghost, disabled: busy || skill.updateAvailable !== true,
            onClick: () => updateSkill(skill),
          }, 'Update'),
          skill.updateAvailable === true && copyCount(skill.name) > 1
            ? React.createElement('button', {
              type: 'button', className: styles.ghost + ' ' + styles.danger, disabled: busy,
              onClick: () => updateAllCopies(skill),
            }, 'Update all copies')
            : null))
    })

  const q = searchQuery.trim().toLowerCase()
  const catalogSkills = (market?.skills ?? []).filter((s) =>
    (providerFilter === '' || s.providerId === providerFilter)
    && (q === ''
      || s.name.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.providerSpec.toLowerCase().includes(q)))

  // Infinite scroll: render a page of results and load more as the sentinel
  // reaches the viewport (the Load-more button is the keyboard/fallback path).
  const SEARCH_PAGE = 30
  const [visibleCount, setVisibleCount] = React.useState(SEARCH_PAGE)
  const sentinelRef = React.useRef<HTMLButtonElement | null>(null)
  const hasMore = catalogSkills.length > visibleCount

  React.useEffect(() => { setVisibleCount(SEARCH_PAGE) }, [searchQuery, providerFilter])

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = sentinelRef.current
    if (el === null || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setVisibleCount((current) => current + SEARCH_PAGE)
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, tab])

  /** How many targets (global + known workspaces) hold this skill name. */
  function copyCount(name: string): number {
    if (presence === null) return 0
    let count = presence.global.has(name) ? 1 : 0
    for (const set of presence.byPath.values()) if (set.has(name)) count += 1
    return count
  }

  /** Where a skill name is already installed, across every target. */
  function presenceLabel(name: string): string {
    if (presence === null) return ''
    const inGlobal = presence.global.has(name)
    const wsCount = [...presence.byPath.values()].filter((set) => set.has(name)).length
    const parts: string[] = []
    if (inGlobal) parts.push('global')
    if (wsCount > 0) parts.push(`${wsCount} workspace${wsCount === 1 ? '' : 's'}`)
    return parts.length === 0 ? '' : `in ${parts.join(' + ')}`
  }

  const searchBody = React.createElement('div', { className: styles.market },
    React.createElement('div', { className: styles.row },
      React.createElement('input', {
        type: 'search', className: styles.input, placeholder: 'Search skills…', value: searchQuery,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
      }),
      React.createElement('span', { className: styles.selectWrap },
        React.createElement('select', {
          className: styles.select, value: providerFilter,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setProviderFilter(e.target.value),
          'aria-label': 'Provider',
        },
          React.createElement('option', { value: '' }, 'All providers'),
          (market?.providers ?? []).map((p) => React.createElement('option', { key: p.id, value: p.id }, p.spec))))),
    catalogSkills.length === 0
      ? React.createElement('p', { className: styles.hint }, (market?.providers ?? []).length === 0
        ? 'No providers yet. Add a GitHub repository in the Providers tab to search its skills.'
        : (market?.providers ?? []).every((p) => p.lastRefresh === '')
          ? 'No skills in the catalog yet — refresh the providers in the Providers tab.'
          : 'No skills match this search.')
      : [
        ...catalogSkills.slice(0, visibleCount).map((skill) => {
          const label = presenceLabel(skill.name)
          return React.createElement('div', { className: styles.skill, key: `${skill.providerId}:${skill.skillPath}` },
            React.createElement('span', {
              className: styles.skillText + ' ' + styles.clickable, role: 'button', tabIndex: 0,
              'aria-label': 'View ' + skill.name,
              onClick: () => { void openCatalogDetail(skill) },
            },
              React.createElement('span', { className: styles.label }, skill.name),
              React.createElement('span', { className: styles.hint }, skill.description + '\n' + skill.providerSpec)),
            label !== '' ? React.createElement('span', { className: styles.badge }, label) : null,
            React.createElement('button', {
              type: 'button', className: styles.ghost, disabled: busy,
              onClick: () => openAddModal(skill),
            }, 'Add'))
        }),
        hasMore
          ? React.createElement('div', { className: styles.moreRow, key: 'load-more' },
            React.createElement('p', { className: styles.hint }, `Showing ${visibleCount} of ${catalogSkills.length} skills`),
            React.createElement('button', {
              type: 'button', className: styles.ghost, disabled: busy, ref: sentinelRef,
              onClick: () => setVisibleCount((current) => current + SEARCH_PAGE),
            }, 'Load more skills'))
          : catalogSkills.length > SEARCH_PAGE
            ? React.createElement('p', { className: styles.hint, key: 'all-shown' }, `All ${catalogSkills.length} skills shown`)
            : null,
      ])

  const providers = market?.providers ?? []

  const providersBody = React.createElement('div', { className: styles.market },
    React.createElement('div', { className: styles.row },
      React.createElement('input', {
        type: 'text', className: styles.input, placeholder: 'https://github.com/owner/repo or owner/repo…', value: providerInput,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setProviderInput(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') addProvider() },
      }),
      React.createElement('button', { type: 'button', className: styles.ghost, disabled: busy, onClick: () => addProvider() }, 'Add'),
      React.createElement('button', {
        type: 'button', className: styles.ghost, disabled: busy || providers.length === 0,
        onClick: () => refreshProviders(),
      }, 'Refresh all')),
    providers.length === 0
      ? React.createElement('p', { className: styles.hint }, 'No providers. Add a GitHub repository that contains skills (directories with a SKILL.md) to download them into the local marketplace.')
      : providers.map((provider) => React.createElement('div', { className: styles.skill, key: provider.id },
        React.createElement('span', { className: styles.skillText },
          React.createElement('span', { className: styles.label }, provider.spec),
          React.createElement('span', { className: styles.hint },
            (provider.description !== undefined && provider.description !== '' ? provider.description + '\n' : '')
            + `${provider.skillCount} skill${provider.skillCount === 1 ? '' : 's'}`
            + (provider.stars !== undefined ? ` · ★ ${provider.stars}` : '')
            + ` · ${timeAgo(provider.lastRefresh)}`
            + (provider.error !== undefined ? '\n' + provider.error : ''))),
        React.createElement('button', {
          type: 'button', className: styles.ghost, disabled: busy,
          onClick: () => refreshProvider(provider),
        }, 'Refresh'),
        React.createElement('button', {
          type: 'button', className: styles.ghost + ' ' + styles.danger, disabled: busy,
          onClick: () => removeProvider(provider),
        }, 'Remove'))))

  /** The removal confirmation popup shared by skills and providers. */
  function confirmDialog(title: string, message: string, onConfirm: () => void): React.ReactElement {
    return React.createElement('div', {
      className: styles.overlay,
      role: 'presentation',
      onClick: () => closeConfirm(),
    },
      React.createElement('div', {
        className: styles.modal,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('p', { className: styles.modalTitle }, title),
        React.createElement('p', { className: styles.hint }, message),
        React.createElement('div', { className: styles.modalActions },
          React.createElement('button', {
            type: 'button', className: styles.ghost, disabled: busy,
            onClick: () => closeConfirm(),
          }, 'Cancel'),
          React.createElement('button', {
            type: 'button', className: styles.ghost + ' ' + styles.danger, disabled: busy,
            onClick: onConfirm,
          }, 'Remove'))))
  }

  /** The Add modal: multi-target install picker over global + every workspace.
   * Targets already holding the skill render checked and locked. */
  function addSkillDialog(): React.ReactElement {
    const skill = addTarget as CatalogSkillView
    const options: { key: string; label: string; installed: boolean }[] = [
      { key: '', label: '⭐ Global', installed: presence?.global.has(skill.name) ?? false },
      ...workspaces.map((w) => ({
        key: w.path,
        label: w.title,
        installed: presence?.byPath.get(w.path)?.has(skill.name) ?? false,
      })),
    ]
    return React.createElement('div', {
      className: styles.overlay,
      role: 'presentation',
      onClick: () => closeAddModal(),
    },
      React.createElement('div', {
        className: styles.modal,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `Add skill "${skill.name}"`,
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('p', { className: styles.modalTitle }, `Add skill "${skill.name}"`),
        React.createElement('p', { className: styles.hint },
          'Choose where to add it. Targets already holding the skill are marked and locked.'),
        React.createElement('div', { className: styles.optionList },
          options.map((option) => React.createElement('label', {
            className: styles.optionRow + (option.installed ? ' ' + styles.optionLocked : ''),
            key: option.key === '' ? 'global' : option.key,
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: option.installed || addSelection.has(option.key),
              disabled: busy || option.installed,
              onChange: () => toggleAddTarget(option.key),
            }),
            React.createElement('span', { className: styles.optionLabel }, option.label),
            option.installed ? React.createElement('span', { className: styles.addedBadge }, 'added') : null))),
        React.createElement('div', { className: styles.modalActions },
          React.createElement('button', {
            type: 'button', className: styles.ghost, disabled: busy,
            onClick: () => closeAddModal(),
          }, 'Cancel'),
          React.createElement('button', {
            type: 'button',
            className: styles.ghost + ' ' + styles.success,
            disabled: busy || addSelection.size === 0,
            onClick: () => { void confirmAddSkill() },
          }, addSelection.size > 1 ? `Add to ${addSelection.size} targets` : 'Add'))))
  }

  return React.createElement('div', { className: styles.page },
    workspaces.length > 0
      ? React.createElement('div', { className: styles.row },
        React.createElement('span', { className: styles.text },
          React.createElement('span', { className: styles.label }, 'Workspace'),
          React.createElement('span', { className: styles.hint }, 'Installed-tab scope; toggling off here disables a global skill only in this workspace')),
        React.createElement('select', {
          className: styles.select, value: currentPath ?? '',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { setWorkspacePath(e.target.value); closeConfirm() },
        },
          React.createElement('option', { value: '' }, 'Global only'),
          workspaces.map((w) => React.createElement('option', { key: w.id, value: w.path }, w.title))))
      : null,
    React.createElement('div', { className: styles.tabs },
      React.createElement('button', {
        type: 'button', className: styles.tab + (tab === 'installed' ? ' ' + styles.tabActive : ''),
        onClick: () => { setTab('installed'); closeConfirm() },
      }, 'Installed'),
      React.createElement('button', {
        type: 'button', className: styles.tab + (tab === 'search' ? ' ' + styles.tabActive : ''),
        onClick: () => { setTab('search'); closeConfirm(); if (market === null) void loadMarket(); void loadState() },
      }, 'Search'),
      React.createElement('button', {
        type: 'button', className: styles.tab + (tab === 'providers' ? ' ' + styles.tabActive : ''),
        onClick: () => { setTab('providers'); closeConfirm(); void loadMarket() },
      }, 'Providers')),
    tab === 'installed' ? installedBody : tab === 'search' ? searchBody : providersBody,
    React.createElement('div', { className: styles.footer },
      error ? React.createElement('p', { className: styles.status + ' ' + styles.statusErr }, String(error)) : null,
      !error && warning ? React.createElement('p', { className: styles.status }, String(warning)) : null,
      busy ? React.createElement('p', { className: styles.status }, 'Working…') : null),
    confirmRemove !== null
      ? confirmDialog(
        `Remove skill "${confirmRemove.name}"?`,
        'It moves to the .trash directory of its skill root, so it can be restored by hand.',
        () => confirmRemoveSkill())
      : confirmProvider !== null
        ? confirmDialog(
          `Remove provider "${confirmProvider.spec}"?`,
          'Its cached catalog is deleted; skills already installed stay installed.',
          () => confirmRemoveProvider())
        : addTarget !== null
          ? addSkillDialog()
          : detail !== null
          ? React.createElement('div', {
            className: styles.overlay,
            role: 'presentation',
            onClick: () => setDetail(null),
          },
            React.createElement('div', {
              className: styles.modal + ' ' + styles.modalWide,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': `Skill ${detail.name}`,
              onClick: (e: React.MouseEvent) => e.stopPropagation(),
            },
              React.createElement('p', { className: styles.modalTitle }, detail.name),
              React.createElement('div', { className: styles.metaRow },
                React.createElement('span', { className: styles.badge },
                  detail.modelInvocable ? 'model invocable' : 'model blocked'),
                React.createElement('span', { className: styles.badge },
                  detail.userInvocable ? 'user invocable' : 'not user invocable')),
              React.createElement('p', { className: styles.hint },
                detail.description
                + (detail.whenToUse !== undefined ? `\nWhen to use: ${detail.whenToUse}` : '')),
              React.createElement('div', { className: styles.modalBody + ' ' + styles.md }, renderMarkdown(detail.body)),
              React.createElement('div', { className: styles.modalActions },
                React.createElement('button', {
                  type: 'button', className: styles.ghost, disabled: busy,
                  onClick: () => setDetail(null),
                }, 'Close'))))
          : null)
}
