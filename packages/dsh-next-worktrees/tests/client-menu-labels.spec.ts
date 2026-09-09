/** Regress production apply/bridge labels, not a test-owned menuLabel callback. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuDecoration } from '../src/client/bridge.ts'
import { interpolate, NS, type MessageKey } from '../src/client/dictionaries.ts'

vi.mock('../src/generated/workspace-browser.generated.mjs', () => ({
  runOfficialWorkspaceClient: () => ({ inject: [], apply: vi.fn() }),
}))

const disposers: (() => void)[] = []
const decoration: MenuDecoration = {
  slug: 'topic', title: 'Topic', branch: 'feature/source', primaryBranch: 'release/destination',
  path: '/repos/project/.dsh/worktrees/topic', dirty: false, ahead: 1, merged: false, conflict: false,
}

async function mount(language?: 'en' | 'zh') {
  let dictionaries: Record<'en' | 'zh', Record<MessageKey, string>> | undefined
  const locale = {
    register: vi.fn((namespace: string, values: NonNullable<typeof dictionaries>) => {
      expect(namespace).toBe(NS)
      dictionaries = values
      return () => { dictionaries = undefined }
    }),
    bind: vi.fn((namespace: string) => {
      expect(namespace).toBe(NS)
      return (key: MessageKey, params?: Record<string, string | number>) =>
        interpolate(dictionaries![language!][key], params)
    }),
  }
  const ctx = {
    get: (name: string) => name === 'locale' && language ? locale : undefined,
    effect: (setup: () => void | (() => void)) => {
      const dispose = setup()
      if (dispose) disposers.push(dispose)
    },
    slots: { register: vi.fn() },
    on: vi.fn(),
  }
  const { apply } = await import('../src/client/index.ts')
  apply(ctx as unknown as Context)
  expect(window.__dshNextWorktreesBridge).toBeDefined()
  if (language) {
    expect(locale.register).toHaveBeenCalledOnce()
    expect(locale.bind).toHaveBeenCalledOnce()
  }
  return window.__dshNextWorktreesBridge!
}

beforeEach(() => { vi.stubGlobal('require', vi.fn()) })
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  expect(window.__dshNextWorktreesBridge).toBeUndefined()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const cases = [
  { language: undefined, update: 'Update from release/destination', merge: 'Merge to release/destination', next: 'Merge to hotfix/next', fallback: 'Merge', remove: 'Delete worktree', refresh: 'Refresh' },
  { language: 'en', update: 'Update from release/destination', merge: 'Merge to release/destination', next: 'Merge to hotfix/next', fallback: 'Merge', remove: 'Delete worktree', refresh: 'Refresh' },
  { language: 'zh', update: '从 release/destination 更新', merge: '合并到 release/destination', next: '合并到 hotfix/next', fallback: '合并', remove: '删除工作树', refresh: '刷新' },
] as const

describe.each(cases)('production context menu labels ($language)', (labels) => {
  it('uses the destination, not the distinct worktree source, without trailing ellipses', async () => {
    const bridge = await mount(labels.language)
    expect(bridge.menuLabel('row.update', decoration)).toBe(labels.update)
    expect(bridge.menuLabel('row.merge', decoration)).toBe(labels.merge)
    expect(bridge.menuLabel('row.delete', decoration)).toBe(labels.remove)
    expect(bridge.menuLabel('row.refresh', decoration)).toBe(labels.refresh)
    for (const key of ['row.update', 'row.merge', 'row.delete']) {
      const label = bridge.menuLabel(key, decoration)
      expect(label).not.toMatch(/(?:…|\.{3})$/)
      expect(label).not.toContain(decoration.branch)
      expect(label).not.toMatch(/\{\w+\}/)
    }
  })

  it('reads each new primary branch without reinstalling the bridge', async () => {
    const bridge = await mount(labels.language)
    expect(bridge.menuLabel('row.merge', decoration)).toBe(labels.merge)
    const switched = { ...decoration, primaryBranch: 'hotfix/next' }
    expect(bridge.menuLabel('row.merge', switched)).toBe(labels.next)
    expect(bridge.menuLabel('row.update', switched)).toBe(labels.update.replace('release/destination', 'hotfix/next'))
    expect(bridge.menuLabel('row.merge', { ...switched, primaryBranch: undefined })).toBe(labels.fallback)
    expect(bridge.menuLabel('row.merge', decoration)).toBe(labels.merge)
    expect(window.__dshNextWorktreesBridge).toBe(bridge)
  })

  it.each([
    ['missing decoration', undefined],
    ['missing primary branch', { ...decoration, primaryBranch: undefined }],
    ['empty primary branch', { ...decoration, primaryBranch: '' }],
  ] as const)('uses a generic merge label for %s rather than inventing a destination', async (_name, row) => {
    const bridge = await mount(labels.language)
    expect(bridge.menuLabel('row.merge', row)).toBe(labels.fallback)
  })
})
