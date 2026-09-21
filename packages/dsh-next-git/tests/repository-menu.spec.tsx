import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositoryMenu } from '../src/client/repository/RepositoryMenu.tsx'
import type { RepositoryMenuCommand as RepositoryAction } from '../src/client/repository/commands.ts'
import type { PanelState } from '../src/core/types.ts'
import { en, type MessageKey } from '../src/client/dictionaries/en.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Deliberately use the real SDK Menu, including its portal and keyboard handlers.
const t = (key: MessageKey): string => en[key]
let root: Root
let container: HTMLDivElement
let onAction: ReturnType<typeof vi.fn<(action: RepositoryAction) => void>>
const trigger = (): HTMLButtonElement => document.querySelector('[data-dsh-git="repository-menu"]')!
const item = (key: MessageKey): HTMLButtonElement => {
  const matches = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(node => node.textContent === t(key))
  const found = matches.find(node => node.hasAttribute('aria-haspopup')) ?? matches[0]
  expect(found, key).toBeDefined()
  return found!
}
const click = async (node: HTMLElement): Promise<void> => { await act(async () => { node.click() }) }
const key = async (value: string): Promise<void> => {
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })) })
}
async function render(disabled = false, state?: PanelState): Promise<void> {
  await act(async () => { root.render(<RepositoryMenu t={t} disabled={disabled} state={state} onAction={onAction} />) })
}

// Independent inventory: never derive expected commands or labels from commandLabels.
const top: MessageKey[] = ['commands.pull', 'repository.push', 'repository.fetch', 'repository.stash', 'commit.button', 'changes.title', 'commands.network', 'repository.branches', 'commands.remoteGroup', 'repository.stash', 'commands.tagsGroup', 'worktrees.title', 'commands.output']
const groups: [MessageKey, [RepositoryAction, MessageKey][]][] = [
  ['commit.button', [['commit', 'commit.button'], ['commit-staged', 'commands.commitStaged'], ['commit-all', 'commands.commitAll'], ['undo-commit', 'commands.undoCommit'], ['abort-rebase', 'commands.abortRebase'], ['commit-amend', 'commands.commitAmend'], ['commit-staged-amend', 'commands.commitStagedAmend'], ['commit-all-amend', 'commands.commitAllAmend'], ['commit-signoff', 'commands.commitSignoff'], ['commit-staged-signoff', 'commands.commitStagedSignoff'], ['commit-all-signoff', 'commands.commitAllSignoff']]],
  ['changes.title', [['stage-all', 'changes.stageAll'], ['unstage-all', 'changes.unstageAll'], ['discard-all', 'changes.discardAll']]],
  ['commands.network', [['sync', 'commands.sync'], ['pull', 'commands.pull'], ['pull-rebase', 'commands.pullRebase'], ['pull-from', 'commands.pullFrom'], ['push', 'repository.push'], ['push-force', 'commands.pushForce'], ['push-to', 'commands.pushTo'], ['push-to-force', 'commands.pushToForce'], ['fetch', 'repository.fetch'], ['fetch-prune', 'commands.fetchPrune'], ['fetch-all', 'commands.fetchAll']]],
  ['repository.branches', [['merge', 'commands.merge'], ['rebase', 'commands.rebase'], ['branch-create', 'repository.branch.create'], ['branch-create-from', 'commands.branchCreateFrom'], ['branch-rename', 'repository.branch.rename'], ['branch-delete', 'repository.branch.delete'], ['remote-branch-delete', 'commands.remoteBranchDelete'], ['publish', 'commands.publish']]],
  ['commands.remoteGroup', [['remote-add', 'commands.remoteAdd'], ['remote-remove', 'commands.remoteRemove']]],
  ['repository.stash', [['stash-save', 'repository.stash-save'], ['stash-untracked', 'commands.stashUntracked'], ['stash-staged', 'commands.stashStaged'], ['stash-apply-latest', 'commands.stashApplyLatest'], ['stash-apply', 'repository.stash-apply'], ['stash-pop-latest', 'commands.stashPopLatest'], ['stash-pop', 'commands.stashPop'], ['stash-drop', 'commands.stashDrop'], ['stash-clear', 'commands.stashClear'], ['stash-view', 'commands.stashView']]],
  ['commands.tagsGroup', [['tag-create', 'commands.tagCreate'], ['tag-delete', 'commands.tagDelete'], ['remote-tag-delete', 'commands.remoteTagDelete'], ['tags-push', 'commands.tagsPush']]],
  ['worktrees.title', [['worktree-create', 'header.newWorktree'], ['worktree-manage', 'commands.worktreeManage']]],
]
const rebaseState = { operation: { kind: 'rebase' }, head: { unborn: false } } as PanelState

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onAction = vi.fn()
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  document.body.replaceChildren()
})

describe('repository native menu', () => {
  it.each(groups)('pins the exact %s submenu inventory', async (group, leaves) => {
    await render(false, rebaseState); await click(trigger()); await click(item(group))
    const menus = [...document.querySelectorAll('[role="menu"]')]
    expect([...menus[menus.length - 1]!.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)).toEqual(leaves.map(([, label]) => t(label)))
    expect(onAction).not.toHaveBeenCalled()
  })
  it.each(groups.flatMap(([group, leaves]) => leaves.map(([action, label]) => ({ group, action, label }))))('dispatches exact nested $action', async ({ group, action, label }) => {
    await render(false, rebaseState); await click(trigger()); await click(item(group))
    const matches = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(node => node.textContent === t(label))
    await click(matches[matches.length - 1]!)
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
  it.each([['pull', 'commands.pull'], ['output', 'commands.output']] as const)('dispatches top-level %s', async (action, label) => {
    await render(); await click(trigger()); await click(item(label)); expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
  })
  it('dispatches the plain Stash shortcut without opening the Stash submenu', async () => {
    await render(); await click(trigger())
    const shortcut = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][3]!
    expect(shortcut.textContent).toBe('Stash')
    expect(shortcut.hasAttribute('aria-haspopup')).toBe(false)
    await click(shortcut)
    expect(onAction).toHaveBeenCalledExactlyOnceWith('stash-save')
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
  it.each([undefined, null, 'merge'] as const)('disables abort when operation is %s', async kind => {
    await render(false, kind === undefined ? undefined : { ...rebaseState, operation: { ...rebaseState.operation, kind } })
    await click(trigger()); await click(item('commit.button'))
    const abort = item('commands.abortRebase')
    expect(abort.disabled || abort.getAttribute('aria-disabled') === 'true').toBe(true)
    await click(abort); expect(onAction).not.toHaveBeenCalled()
  })
  it('disables undo on unborn HEAD', async () => {
    await render(false, { ...rebaseState, head: { ...rebaseState.head, unborn: true } }); await click(trigger()); await click(item('commit.button'))
    const undo = item('commands.undoCommit'); expect(undo.disabled || undo.getAttribute('aria-disabled') === 'true').toBe(true)
    await click(undo); expect(onAction).not.toHaveBeenCalled()
  })
  it('opens a portaled menu without opening a dialog or dispatching an action', async () => {
    await render()
    expect(trigger().getAttribute('aria-label')).toBe(t('repository.title'))
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect([...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)).toEqual(top.map(t))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    await click(trigger())
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it.each(['fetch', 'push'] as const)('selects %s exactly once and closes', async action => {
    await render()
    await click(trigger())
    await click(item(`repository.${action}`))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  const nested: { group: MessageKey; label: MessageKey; action: RepositoryAction }[] = [
    { group: 'repository.branches', label: 'repository.branch.create', action: 'branch-create' },
    { group: 'repository.branches', label: 'repository.branch.rename', action: 'branch-rename' },
    { group: 'repository.branches', label: 'repository.branch.delete', action: 'branch-delete' },
    { group: 'repository.stash', label: 'repository.stash-save', action: 'stash-save' },
    { group: 'repository.stash', label: 'repository.stash-apply', action: 'stash-apply' },
  ]
  it.each(nested)('selects nested $action without dispatching its group', async ({ group, label, action }) => {
    await render()
    await click(trigger())
    await click(item(group))
    expect(item(group).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    await click(item(label))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('dismisses nested menus with Escape and restores trigger focus', async () => {
    await render()
    trigger().focus()
    await click(trigger())
    await click(item('repository.branches'))
    await key('Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(onAction).not.toHaveBeenCalled()
    await click(trigger())
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(item('repository.branches').getAttribute('aria-expanded')).toBe('false')
  })

  it('dismisses on an outside pointer press without selecting', async () => {
    await render()
    await click(trigger())
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('prevents disabled opening and closes an already-open menu when disabled', async () => {
    await render(true)
    expect(trigger().disabled).toBe(true)
    await click(trigger())
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await render(false)
    await click(trigger())
    await click(item('repository.stash'))
    await render(true)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    await render(false)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('supports native arrow navigation into a submenu and keyboard selection', async () => {
    await render()
    trigger().focus()
    await click(trigger())
    expect(document.activeElement).toBe(item('commands.pull'))
    await key('ArrowDown')
    expect(document.activeElement).toBe(item('repository.push'))
    await act(async () => item('repository.branches').focus())
    await key('ArrowRight')
    expect(item('repository.branches').getAttribute('aria-expanded')).toBe('true')
    await key('ArrowDown')
    expect(document.activeElement).toBe(item('commands.merge'))
    await key('ArrowDown')
    await key('ArrowDown')
    expect(document.activeElement).toBe(item('repository.branch.create'))
    // The SDK explicitly activates the focused menu item on Tab; jsdom does
    // not synthesize the browser's default button click for Enter/Space.
    await key('Tab')
    expect(onAction).toHaveBeenCalledExactlyOnceWith('branch-create')
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
})
