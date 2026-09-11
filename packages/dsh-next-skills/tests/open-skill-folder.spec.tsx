/** Standalone native-primitives/jsdom tests. Every HTTP request is stubbed; no apps launch. */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenSkillFolder } from '../src/client/OpenSkillFolder.tsx'
import { englishTranslate } from '../src/client/dictionaries.ts'
import { en, type MessageKey } from '../src/client/dictionaries/en.ts'
import { zh } from '../src/client/dictionaries/zh.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const DIRECTORY = '/Users/test/.agents/skills/a folder/技能'
const CHOICE = 'dsh-next-skills.open-in-app.choice'
const fetcher = vi.fn<typeof fetch>()
let root: Root | undefined
let container: HTMLDivElement
let animationFrames: Map<number, FrameRequestCallback>

function response(payload: unknown = {}, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function available(apps: unknown[] = ['finder', 'vscode']) {
  fetcher.mockImplementation(async (_url, init) => init?.method === 'POST' ? response() : response({ apps }))
}
async function render(directory = DIRECTORY, t = englishTranslate) {
  await act(async () => { root!.render(<OpenSkillFolder directory={directory} t={t} />) })
}
async function unmount() {
  await act(async () => { root?.unmount(); root = undefined })
}
function main() { return container.querySelector<HTMLButtonElement>('[data-testid="skills-open-folder"]')! }
function toggle() { return container.querySelector<HTMLButtonElement>('[data-testid="skills-open-folder-menu"]')! }
function rows() { return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] }
async function click(element: HTMLElement) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
}
async function activate(element: HTMLElement, activationKey = 'Enter') {
  const down = await key(activationKey, element)
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keyup', { key: activationKey, bubbles: true }))
    // jsdom lacks browser keyboard default activation; emit its detail=0 click.
    if (!down.defaultPrevented) element.click()
  })
}
async function frame() {
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  await act(async () => { callbacks.forEach(callback => callback(0)) })
}
function posts() { return fetcher.mock.calls.filter(([, init]) => init?.method === 'POST') }
async function key(key: string, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => { target.dispatchEvent(event) })
  return event
}

beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
  animationFrames = new Map()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    animationFrames.set(++frameId, callback)
    return frameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { animationFrames.delete(id) }))
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await unmount()
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenSkillFolder host URLs', () => {
  it.each([
    [{ origin: 'https://dsh.example:8123' }, 'https://dsh.example:8123'],
    [{ origin: 'null' }, 'http://dsh.internal'],
    [undefined, 'http://dsh.internal'],
  ])('matches native host routing for location %j', async (locationValue, base) => {
    vi.stubGlobal('location', locationValue)
    available(['finder'])
    await render()
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(base + '/open-in-app/apps')
    expect(main().querySelector('img')?.getAttribute('src')).toBe(base + '/open-in-app/icon/finder')
    await click(main())
    expect(String(posts()[0]?.[0])).toBe(base + '/open-in-app/open')
    expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({ app: 'finder', path: DIRECTORY })
  })
})

describe('OpenSkillFolder availability', () => {
  it('renders no wrapper while loading then offers supported apps without a workspace', async () => {
    const pending = deferred<Response>()
    fetcher.mockReturnValue(pending.promise)
    await render()
    expect(container.innerHTML).toBe('')
    expect(fetcher).toHaveBeenCalledWith(new URL('/open-in-app/apps', location.origin), {
      headers: { accept: 'application/json' }, signal: expect.any(AbortSignal),
    })
    await act(async () => { pending.resolve(response({ apps: ['finder'] })) })
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in Finder')
    expect(main().textContent).toBe('')
    expect(posts()).toHaveLength(0)
  })

  it.each([null, {}, [], 'finder', { apps: null }, { apps: 'finder' }, { apps: [] },
    { apps: ['unknown', 'constructor', '__proto__', 'toString', '../finder', ' finder', 'Finder', '', 1, null, {}] },
  ])('renders nothing for empty, malformed or unknown-only payload %j', async payload => {
    fetcher.mockResolvedValue(response(payload))
    await render()
    expect(container.innerHTML).toBe('')
  })

  it.each([404, 500])('hides when host route returns HTTP %s', async status => {
    fetcher.mockResolvedValue(response({ apps: ['finder'] }, status))
    await render()
    expect(container.innerHTML).toBe('')
  })

  it('hides on network failure and invalid JSON', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'))
    await render()
    expect(container.innerHTML).toBe('')
    fetcher.mockResolvedValueOnce(new Response('not json'))
    await render('/another')
    expect(container.innerHTML).toBe('')
  })

  it('does not fetch or mount for an empty directory', async () => {
    await render('')
    expect(container.innerHTML).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('filters unknown/malformed IDs and duplicates while preserving host order', async () => {
    available(['vscode', 'constructor', null, 'finder', 'vscode', {}, 'unknown'])
    await render()
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
    await click(toggle())
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(rows().map(row => row.textContent)).toEqual(['VS Code', 'Finder'])
  })

  it('names all 34 native app IDs through the supplied translator in both dictionaries', async () => {
    const keys = Object.keys(en).filter(key => key.startsWith('openFolder.app.')) as MessageKey[]
    expect(keys).toHaveLength(34)
    available(keys.map(key => key.replace('openFolder.app.', '')))
    const t = vi.fn((key: MessageKey, params?: Record<string, string | number>) => {
      let text = zh[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
      return text
    })
    await render(DIRECTORY, t)
    await click(toggle())
    expect(rows().map(row => row.textContent)).toEqual(keys.map(key => zh[key]))
    expect(main().getAttribute('aria-label')).toBe('在 访达 中打开技能文件夹')
    expect(toggle().getAttribute('aria-label')).toBe(zh['openFolder.menu'])
    for (const key of keys) expect(t).toHaveBeenCalledWith(key)
  })
})

describe('OpenSkillFolder launch and preference', () => {
  it('posts the exact app and unmodified directory only, never the SKILL.md path', async () => {
    available()
    await render()
    await click(main())
    expect(posts()).toEqual([[new URL('/open-in-app/open', location.origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'finder', path: DIRECTORY }), signal: expect.any(AbortSignal),
    }]])
    expect(main().dataset.state).toBe('idle')
  })

  it('dropdown selects, launches, persists only the skill preference and main repeats it', async () => {
    available()
    localStorage.setItem('dsh.open-in-app.choice', 'native-untouched')
    await render()
    await click(toggle())
    await click(rows()[1]!)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
    expect(localStorage.getItem(CHOICE)).toBe('vscode')
    expect(localStorage.getItem('dsh.open-in-app.choice')).toBe('native-untouched')
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
    await click(main())
    expect(posts().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { app: 'vscode', path: DIRECTORY }, { app: 'vscode', path: DIRECTORY },
    ])
    await render('/different-skill')
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
  })

  it.each(['zed', '{broken json', '"vscode"', 'constructor', ''])('falls back for unavailable/corrupt preference %j', async saved => {
    available()
    localStorage.setItem(CHOICE, saved)
    await render()
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in Finder')
    await click(main())
    expect(JSON.parse(String(posts()[0]?.[1]?.body)).app).toBe('finder')
  })

  it('loads an available saved app', async () => {
    available()
    localStorage.setItem(CHOICE, 'vscode')
    await render()
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
  })

  it('keeps launch and in-memory choice working when storage reads and writes throw', async () => {
    available()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await render()
    await click(toggle())
    await click(rows()[1]!)
    expect(set).toHaveBeenCalledWith(CHOICE, 'vscode')
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
    await click(main())
    expect(posts()).toHaveLength(2)
  })

  it('prevents same-tick double launches and menu choices while in flight; delays busy 250ms', async () => {
    vi.useFakeTimers()
    available()
    await render()
    const pending = deferred<Response>()
    fetcher.mockReturnValue(pending.promise)
    await click(toggle())
    const secondChoice = rows()[1]!
    await act(async () => { main().click(); main().click(); secondChoice.click(); toggle().click() })
    expect(posts()).toHaveLength(1)
    expect(localStorage.getItem(CHOICE)).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    await act(async () => { vi.advanceTimersByTime(249) })
    expect(main().dataset.state).toBe('idle')
    expect(main().disabled).toBe(false)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(main().dataset.state).toBe('busy')
    expect(main().disabled).toBe(true)
    expect(toggle().disabled).toBe(true)
    await act(async () => { pending.resolve(response()) })
    expect(main().dataset.state).toBe('idle')
    expect(main().disabled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['http', 'network'])('keeps a translated retry error after %s failure and recovers', async failure => {
    vi.useFakeTimers()
    available()
    await render()
    if (failure === 'http') fetcher.mockResolvedValueOnce(response({ error: 'host private text' }, 500))
    else fetcher.mockRejectedValueOnce(new Error('host private text'))
    await click(main())
    expect(main().dataset.state).toBe('error')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(en['openFolder.error'])
    expect(container.textContent).not.toContain('host private text')
    await act(async () => { main().focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(en['openFolder.error'])
    await click(main())
    expect(main().dataset.state).toBe('idle')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { main().blur(); vi.advanceTimersByTime(250) })
    expect(main().dataset.state).toBe('idle')
  })

  it.each(['Enter', ' '])('focuses the first portaled row on %j activation without stealing pointer-open focus', async activationKey => {
    available()
    await render()
    await act(async () => { toggle().focus() })
    await click(toggle())
    expect(document.activeElement).toBe(toggle())
    await click(toggle())
    await activate(toggle(), activationKey)
    expect(document.activeElement).toBe(toggle())
    await frame()
    expect(document.activeElement).toBe(rows()[0])
    expect(document.activeElement?.textContent).toBe('Finder')
    await key('Escape', document.activeElement!)
    expect(document.activeElement).toBe(toggle())
    expect(rows()).toHaveLength(0)
  })

  it.each(['close', 'unmount', 'folder'])('cancels pending keyboard-entry focus on %s before placement', async retirement => {
    available()
    await render()
    await act(async () => { toggle().focus() })
    await activate(toggle())
    expect(document.activeElement).toBe(toggle())
    const queued = [...animationFrames.entries()]
    expect(queued).toHaveLength(1)
    const focus = vi.spyOn(rows()[0]!, 'focus')
    if (retirement === 'close') await click(toggle())
    else if (retirement === 'unmount') await unmount()
    else await render('/retired-menu')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(queued[0]![0])
    expect(animationFrames.size).toBe(0)
    // Even a callback already handed to the renderer cannot focus a retired menu.
    await act(async () => { queued[0]![1](0) })
    expect(focus).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
  })

  it('restores main focus after focused-row selection but leaves outside dismissal focus alone', async () => {
    available()
    localStorage.setItem(CHOICE, 'vscode')
    await render()
    await act(async () => { toggle().focus() })
    await activate(toggle())
    await frame()
    expect(document.activeElement).toBe(rows()[1])
    await activate(document.activeElement as HTMLElement)
    expect(rows()).toHaveLength(0)
    expect(document.activeElement).toBe(main())
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
    await click(toggle())
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      await act(async () => {
        outside.focus()
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      })
      expect(rows()).toHaveLength(0)
      expect(document.activeElement).toBe(outside)
    } finally { outside.remove() }
  })

  it('keeps native menu buttons keyboard-focusable and consumes Escape before an outer modal', async () => {
    available()
    await render()
    // Native Settings Modal listens on document and ignores defaultPrevented.
    const outer = vi.fn((event: KeyboardEvent) => { if (event.key === 'Escape') throw new Error('outer modal closed') })
    document.addEventListener('keydown', outer)
    window.addEventListener('keydown', outer)
    try {
      await act(async () => { toggle().focus() })
      await activate(toggle())
      await frame()
      expect(document.activeElement).toBe(rows()[0])
      expect(outer).toHaveBeenCalledTimes(2) // Non-Escape keys still reach native ancestors.
      outer.mockClear()
      const event = await key('Escape', document.activeElement!)
      expect(event.defaultPrevented).toBe(true)
      expect(outer).not.toHaveBeenCalled()
      expect(rows()).toHaveLength(0)
      expect(document.activeElement).toBe(toggle())
    } finally {
      document.removeEventListener('keydown', outer)
      window.removeEventListener('keydown', outer)
    }
    expect((await key('Escape')).defaultPrevented).toBe(false)
    await click(toggle())
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(rows()).toHaveLength(0)
  })
})

describe('OpenSkillFolder icons and cleanup', () => {
  it('uses native icon routes/sizes with decorative attributes and remembers failed icons across menus', async () => {
    available(['warp', 'kitty'])
    await render()
    const image = main().querySelector('img')!
    expect(image.getAttribute('src')).toBe(new URL('/open-in-app/icon/warp', location.origin).href)
    expect(image.width).toBe(15)
    expect(image.alt).toBe('')
    expect(image.getAttribute('aria-hidden')).toBe('true')
    expect(image.draggable).toBe(false)
    await act(async () => { image.dispatchEvent(new Event('error')) })
    expect(main().querySelector('img')).toBeNull()
    expect(main().querySelector('svg rect')).not.toBeNull()
    await click(toggle())
    expect(rows()[0]!.querySelector('img')).toBeNull()
    expect(rows()[0]!.querySelector('svg')?.getAttribute('width')).toBe('18')
    expect(rows()[1]!.querySelector('img')?.width).toBe(18)
    await click(rows()[1]!)
    expect(main().querySelector('img')?.getAttribute('src')).toBe(new URL('/open-in-app/icon/kitty', location.origin).href)
    await click(toggle())
    await click(rows()[0]!)
    expect(main().querySelector('img')).toBeNull()
    await render('/new-icon-mount')
    expect(main().querySelector('img')).toBeNull()
  })

  it('aborts loading on unmount and ignores late JSON completion', async () => {
    const json = deferred<unknown>()
    const reply = response()
    vi.spyOn(reply, 'json').mockReturnValue(json.promise)
    fetcher.mockResolvedValue(reply)
    await render()
    const signal = fetcher.mock.calls[0]?.[1]?.signal
    await unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { json.resolve({ apps: ['finder'] }) })
    expect(container.innerHTML).toBe('')
  })

  it('ignores availability from a retired folder while a new folder is still loading', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetcher.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render()
    const firstSignal = fetcher.mock.calls[0]?.[1]?.signal
    await render('/replacement')
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => { first.resolve(response({ apps: ['finder'] })) })
    expect(container.innerHTML).toBe('')
    await act(async () => { second.resolve(response({ apps: ['vscode'] })) })
    expect(main().getAttribute('aria-label')).toBe('Open skill folder in VS Code')
  })

  it('removes the open-menu Escape listener and tooltip when unmounted', async () => {
    available()
    await render()
    await act(async () => { main().focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(en['openFolder.label'])
    await click(toggle())
    await unmount()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect((await key('Escape')).defaultPrevented).toBe(false)
    expect(container.innerHTML).toBe('')
  })

  it.each(['resolve', 'reject'])('aborts launch and cancels its timer on unmount (%s late)', async settle => {
    vi.useFakeTimers()
    available()
    await render()
    const pending = deferred<Response>()
    fetcher.mockReturnValue(pending.promise)
    await click(main())
    const signal = posts()[0]?.[1]?.signal
    expect(vi.getTimerCount()).toBe(1)
    await unmount()
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { if (settle === 'resolve') pending.resolve(response({}, 500)); else pending.reject(new Error('late')) })
    expect(container.innerHTML).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retires old folder requests, menu and errors, then dispatches only the current directory', async () => {
    vi.useFakeTimers()
    available()
    await render()
    const oldLaunch = deferred<Response>()
    fetcher.mockReturnValueOnce(oldLaunch.promise)
    await click(main())
    const oldSignal = posts()[0]?.[1]?.signal
    await render('/next skill')
    expect(oldSignal?.aborted).toBe(true)
    expect(main().dataset.state).toBe('idle')
    await act(async () => { oldLaunch.resolve(response({}, 500)); vi.advanceTimersByTime(250) })
    expect(main().dataset.state).toBe('idle')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await click(main())
    expect(posts().map(([, init]) => JSON.parse(String(init?.body)).path)).toEqual([DIRECTORY, '/next skill'])
    await click(toggle())
    await render('/third skill')
    expect(rows()).toHaveLength(0)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })
})
