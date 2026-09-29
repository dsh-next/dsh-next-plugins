import * as React from 'react'
import { IconChevronLeftOutlineRegular, IconEllipsisOutlineRegular, Menu, type MenuEntry, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from '../../core/types.ts'
import type { Translate } from '../dictionaries.ts'
import { commandLabels, type RepositoryMenuCommand } from './commands.ts'
import classes from '../panel.module.css'
import menuClasses from './repository-menu.module.css'
import { useRepositoryMenuPlacement } from './menu-placement.ts'
import { IconTooltip } from '../ui/IconTooltip.tsx'

/** Commands share the same handlers as the panel; opening the menu never writes. */
export function RepositoryMenu({ t, disabled, state, onAction }: {
  t: Translate
  disabled: boolean
  state?: PanelState
  onAction(action: RepositoryMenuCommand): void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  useRepositoryMenuPlacement(open && !disabled)
  React.useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const item = (id: RepositoryMenuCommand): MenuItem => ({ id, label: t(commandLabels[id]),
    disabled: id === 'abort-rebase' ? state?.operation.kind !== 'rebase'
      : id === 'undo-commit' ? state?.head.unborn === true : false,
  })
  const group = (id: string, label: string, commands: RepositoryMenuCommand[]): MenuItem => ({
    id, label: <span className={menuClasses.groupLabel} data-dsh-git="repository-group"><span>{label}</span><IconChevronLeftOutlineRegular size={14} /></span>,
    submenu: commands.map(item),
  })
  const items: MenuEntry[] = [
    ...(['pull', 'push', 'fetch'] as const).map(item),
    { ...item('stash-save'), label: t('repository.stash') },
    { type: 'separator', id: 'repository-groups' },
    group('commit-group', t('commit.button'), ['commit', 'commit-staged', 'commit-all', 'undo-commit', 'abort-rebase', 'commit-amend', 'commit-staged-amend', 'commit-all-amend', 'commit-signoff', 'commit-staged-signoff', 'commit-all-signoff']),
    group('changes-group', t('changes.title'), ['stage-all', 'unstage-all', 'discard-all']),
    group('network', t('commands.network'), ['sync', 'pull', 'pull-rebase', 'pull-from', 'push', 'push-force', 'push-to', 'push-to-force', 'fetch', 'fetch-prune', 'fetch-all']),
    group('branches', t('repository.branches'), ['merge', 'rebase', 'branch-create', 'branch-create-from', 'branch-rename', 'branch-delete', 'remote-branch-delete', 'publish']),
    group('remotes', t('commands.remoteGroup'), ['remote-add', 'remote-remove']),
    group('stash', t('repository.stash'), ['stash-save', 'stash-untracked', 'stash-staged', 'stash-apply-latest', 'stash-apply', 'stash-pop-latest', 'stash-pop', 'stash-drop', 'stash-clear', 'stash-view']),
    group('tags', t('commands.tagsGroup'), ['tag-create', 'tag-delete', 'remote-tag-delete', 'tags-push']),
    group('worktrees', t('worktrees.title'), ['worktree-create', 'worktree-manage']),
    { type: 'separator', id: 'repository-output' },
    item('output'),
  ]
  return <Menu open={open && !disabled} items={items} portal align="end" autoFocus dense
    onClose={() => setOpen(false)}
    onSelect={id => {
      if (!(id in commandLabels)) return
      setOpen(false)
      onAction(id as RepositoryMenuCommand)
    }}
    anchor={<IconTooltip label={t('repository.title')}>
      <button type="button" className={classes.iconButton}
        aria-label={t('repository.title')}
        aria-haspopup="menu" aria-expanded={open && !disabled}
        data-dsh-git="repository-menu" disabled={disabled}
        onClick={() => setOpen(value => !value)}>
        <IconEllipsisOutlineRegular size={16} />
      </button>
    </IconTooltip>} />
}
