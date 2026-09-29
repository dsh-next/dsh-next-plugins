import * as React from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { changeFileTitle } from '../../core/address.ts'
import type { Translate } from '../dictionaries.ts'
import { peekStore, storesVersion, subscribeStores } from './store-registry.ts'
import classes from '../panel.module.css'

/** The branch glyph used in the chip and at the guide capsule. */
export function BranchGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return <IconBranchOutlineRegular size={size} />
}

/**
 * The live chip title: branch name, or the changed-file count.
 *
 * The chip is never blank. With neither a branch nor a count to show — no
 * store yet, a store mid-read, an empty branch name — the type label speaks,
 * read fresh so a language change reaches it. The label is the last resort
 * rather than the title recorded when the tab opened, which would freeze the
 * copy in the language of that moment.
 */
export function GitTitle(props: { t: Translate; sessionId?: string }): React.ReactElement {
  const { t } = props
  // The body registers this session's store a beat after the strip paints.
  React.useSyncExternalStore(subscribeStores, storesVersion, storesVersion)
  const store = peekStore(props.sessionId)
  const snapshot = React.useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => null),
    store?.getSnapshot ?? (() => null),
  )
  const state = snapshot?.state ?? null
  const head = state?.head ?? null
  const branch = head?.branch ?? null
  const label = branch !== null && branch !== ''
    ? branch
    : head?.detached === true
      ? t('header.detached')
      : null
  const count = state === null
    ? 0
    : state.changes.staged.length + state.changes.unstaged.length + state.changes.untracked.length
  return (
    <React.Fragment>
      <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
      <span data-dsh-git="chip-title">{label ?? (count > 0 ? `${t('type.label')} (${count})` : t('type.label'))}</span>
    </React.Fragment>
  )
}

/**
 * The change view's chip title: the branch glyph, then the file name.
 *
 * The glyph is the point: several tabs can be open on the same file name from
 * different surfaces, and the branch marks this one as Source control's own
 * view of a change rather than a plain file preview. The name comes from the
 * address the tab was opened with, so it stays right without the panel store.
 */
export function ChangeFileTitle(props: { t: Translate; address: string }): React.ReactElement {
  const title = changeFileTitle(props.address)
  return (
    <React.Fragment>
      <IconBranchOutlineRegular size={14} className={classes.branchGlyph} />
      <span data-dsh-git="change-file-chip">{title === '' ? props.t('type.label') : title}</span>
    </React.Fragment>
  )
}
