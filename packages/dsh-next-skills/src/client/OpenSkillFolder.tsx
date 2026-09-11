/** Thin browser adaptation of the native opener; the host HTTP routes own detection and launch. */
import * as React from 'react'
import { IconChevronDownOutline14, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageKey } from './dictionaries.ts'
import styles from './open-skill-folder.module.css'

// The HTTP face is the seam; never import the native controller or host runtime.
const APPS_ROUTE = '/open-in-app/apps'
const ICON_ROUTE = '/open-in-app/icon'
const OPEN_ROUTE = '/open-in-app/open'
// This preference belongs only to the skill opener, not the native session opener.
const CHOICE_KEY = 'dsh-next-skills.open-in-app.choice'
const APP_LABELS = {
  finder: 'openFolder.app.finder', explorer: 'openFolder.app.explorer', filemanager: 'openFolder.app.filemanager',
  cursor: 'openFolder.app.cursor', vscode: 'openFolder.app.vscode', vscodeinsiders: 'openFolder.app.vscodeinsiders',
  windsurf: 'openFolder.app.windsurf', zed: 'openFolder.app.zed', sublimetext: 'openFolder.app.sublimetext',
  xcode: 'openFolder.app.xcode', androidstudio: 'openFolder.app.androidstudio', intellij: 'openFolder.app.intellij',
  pycharm: 'openFolder.app.pycharm', webstorm: 'openFolder.app.webstorm', phpstorm: 'openFolder.app.phpstorm',
  goland: 'openFolder.app.goland', rider: 'openFolder.app.rider', rustrover: 'openFolder.app.rustrover',
  fork: 'openFolder.app.fork', sourcetree: 'openFolder.app.sourcetree', github: 'openFolder.app.github',
  tower: 'openFolder.app.tower', gitkraken: 'openFolder.app.gitkraken', smartgit: 'openFolder.app.smartgit',
  sublimemerge: 'openFolder.app.sublimemerge', ghostty: 'openFolder.app.ghostty', warp: 'openFolder.app.warp',
  iterm: 'openFolder.app.iterm', kitty: 'openFolder.app.kitty', terminal: 'openFolder.app.terminal',
  windowsterminal: 'openFolder.app.windowsterminal', gitbash: 'openFolder.app.gitbash',
  gnometerminal: 'openFolder.app.gnometerminal', konsole: 'openFolder.app.konsole',
} as const satisfies Record<string, MessageKey>
type AppId = keyof typeof APP_LABELS
type Props = {
  directory: string
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

// Match the native connection carrier for opaque-origin/embedded browser hosts.
function hostUrl(route: string): URL {
  const origin = globalThis.location?.origin
  return new URL(route, origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal')
}

function supported(id: unknown): id is AppId {
  return typeof id === 'string' && Object.hasOwn(APP_LABELS, id)
}

function readChoice(): string {
  try { return localStorage.getItem(CHOICE_KEY) ?? '' } catch { return '' }
}

// Like native UI, missing bundle icons are attempted only once per page.
const failedIcons = new Set<AppId>()
function AppIcon({ id, size }: { id: AppId; size: number }) {
  const [failed, setFailed] = React.useState(() => failedIcons.has(id))
  if (failed || failedIcons.has(id)) return (
    <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={5} />
    </svg>
  )
  return <img className={styles.icon} src={hostUrl(`${ICON_ROUTE}/${id}`).href} width={size} height={size}
    alt="" aria-hidden="true" draggable={false} onError={() => { failedIcons.add(id); setFailed(true) }} />
}

/** Opens an installed skill directory; unavailable hosts render no wrapper at all. */
export function OpenSkillFolder(props: Props) {
  // A folder switch retires every old callback, request, menu and error together.
  return props.directory ? <FolderAction key={props.directory} {...props} /> : null
}

function FolderAction({ directory, t }: Props) {
  const [apps, setApps] = React.useState<AppId[]>([])
  const [choice, setChoice] = React.useState(readChoice)
  const [open, setOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<'idle' | 'busy' | 'error'>('idle')
  const mainButton = React.useRef<HTMLButtonElement>(null)
  const menuButton = React.useRef<HTMLButtonElement>(null)
  const selectedLabel = React.useRef<HTMLSpanElement>(null)
  const keyboardOpen = React.useRef(false)
  const lifetime = React.useRef<AbortController>()
  const inFlight = React.useRef(false)
  const busyTimer = React.useRef<ReturnType<typeof setTimeout>>()

  React.useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    async function load() {
      try {
        const response = await fetch(hostUrl(APPS_ROUTE), { headers: { accept: 'application/json' }, signal: controller.signal })
        if (!response.ok) return
        const payload: unknown = await response.json()
        if (controller.signal.aborted) return
        if (payload && typeof payload === 'object' && 'apps' in payload && Array.isArray(payload.apps)) {
          setApps([...new Set(payload.apps.filter(supported))])
        }
      } catch { /* Missing route, offline host and invalid JSON all hide the action. */ }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(busyTimer.current)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    // Native Menu first measures a hidden portal; focus after its placement commit.
    let active = true
    const focusFrame = keyboardOpen.current ? requestAnimationFrame(() => {
      if (active) selectedLabel.current?.closest<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }) : undefined
    keyboardOpen.current = false
    // Consume before document/React modal handlers, including shells that ignore defaultPrevented.
    const consumeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', consumeEscape, true)
    return () => {
      active = false
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', consumeEscape, true)
    }
  }, [open])

  const current = apps.find(id => id === choice) ?? apps[0]
  if (!current) return null

  async function launch(app: AppId, remember = false) {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || inFlight.current) return
    inFlight.current = true
    setOpen(false)
    setPhase('idle')
    if (remember) {
      // Keep keyboard focus in the opener when selecting removes the focused row.
      if (document.activeElement?.getAttribute('role') === 'menuitem') mainButton.current?.focus()
      setChoice(app)
      try { localStorage.setItem(CHOICE_KEY, app) } catch { /* Storage is optional. */ }
    }
    busyTimer.current = setTimeout(() => {
      if (!controller.signal.aborted) setPhase('busy')
    }, 250)
    try {
      const response = await fetch(hostUrl(OPEN_ROUTE), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app, path: directory }), signal: controller.signal,
      })
      if (!controller.signal.aborted) setPhase(response.ok ? 'idle' : 'error')
    } catch {
      if (!controller.signal.aborted) setPhase('error')
    } finally {
      clearTimeout(busyTimer.current)
      inFlight.current = false
    }
  }

  const title = t('openFolder.title', { app: t(APP_LABELS[current]) })
  return <div className={styles.control} data-testid="skills-folder-opener">
    <Menu open={open} align="end" dense portal selectedId={current} onClose={() => setOpen(false)}
      items={apps.map(id => ({
        id, label: <span ref={id === current ? selectedLabel : undefined}>{t(APP_LABELS[id])}</span>,
        icon: <AppIcon key={id} id={id} size={18} />,
      }))}
      onSelect={id => { if (supported(id) && apps.includes(id)) void launch(id, true) }}
      anchor={<div className={styles.split}>
        <Tooltip label={phase === 'error' ? t('openFolder.error') : t('openFolder.label')} side="bottom">
          <button ref={mainButton} type="button" className={styles.main} data-testid="skills-open-folder"
            data-state={phase} disabled={phase === 'busy'} aria-busy={phase === 'busy'}
            aria-label={title} onClick={() => { void launch(current) }}>
            <AppIcon key={current} id={current} size={15} />
          </button>
        </Tooltip>
        <button ref={menuButton} type="button" className={styles.chevron} data-testid="skills-open-folder-menu"
          aria-expanded={open} aria-haspopup="menu" aria-label={t('openFolder.menu')}
          disabled={phase === 'busy'} onClick={event => {
            if (inFlight.current) return
            keyboardOpen.current = event.detail === 0 && !open
            setOpen(value => !value)
          }}>
          <IconChevronDownOutline14 size={11} />
        </button>
      </div>} />
    {phase === 'error' && <span className={styles.error} role="alert" data-testid="skills-open-folder-error">{t('openFolder.error')}</span>}
  </div>
}
