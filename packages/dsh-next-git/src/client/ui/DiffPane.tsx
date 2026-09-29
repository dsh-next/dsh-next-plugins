import * as React from 'react'
import { IconCheckOutlineRegular, IconChevronLeftOutlineRegular, IconCopyOutlineRegular, IconFolderOpenRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelStore, type PanelSnapshot } from '../controller.ts'
import type { Translate } from '../dictionaries.ts'
import { HunkControls } from '../changes/HunkControls.tsx'
import { PanelBoundary } from '../panel/PanelBoundary.tsx'
import { FileDiff } from './FileDiff.tsx'
import { IconTooltip } from './IconTooltip.tsx'
import { baseName } from './path-label.ts'
import classes from '../panel.module.css'
import diffClasses from './diff.module.css'

/** The enclosing tab face, as the slot framework binds it. */
export interface GitTabInfo {
  readonly tab: {
    readonly title: string
    readonly actions: { openResource(address: string, options?: unknown): void }
  }
}

/**
 * The diff header's "open in the viewer" control.
 *
 * This is the panel's only read of the enclosing tab's framework hook, and
 * that hook throws while the tab record is not committed — a state the shell
 * passes through during a session switch or a layout restore. Keeping the read
 * in its own component, under a null-fallback guard, means such a throw costs
 * one button instead of the whole panel, and never retires the tab's
 * registration.
 */
function OpenFileButton(props: {
  t: Translate
  useTabInfo: () => GitTabInfo
  address: string
}): React.ReactElement {
  const { t, useTabInfo, address } = props
  const tabInfo = useTabInfo()
  return (
    <IconTooltip label={t('changes.open')}>
      <button
        type="button"
        className={classes.iconButton}
        aria-label={t('changes.open')}
        data-dsh-git="diff-open-file"
        onClick={() => tabInfo.tab.actions.openResource(address)}
      >
        <IconFolderOpenRegular size={14} />
      </button>
    </IconTooltip>
  )
}

/**
 * Publish the enclosing tab's actions to the panel.
 *
 * The framework's tab hook is a real hook — it may only run during render —
 * while a row click is an event handler, so the two cannot meet directly. This
 * seat reads the hook where the rules allow and writes the actions into the
 * panel's ref; the boundary around it keeps an uncommitted record from costing
 * the panel its own registration.
 */
export function TabActionsSink(props: {
  useTabInfo: () => GitTabInfo
  sink: React.MutableRefObject<GitTabInfo['tab']['actions'] | null>
}): null {
  const actions = props.useTabInfo().tab.actions
  React.useLayoutEffect(() => {
    props.sink.current = actions
    return () => {
      if (props.sink.current === actions) props.sink.current = null
    }
  }, [actions, props.sink])
  return null
}

export function DiffPane(props: {
  sessionId: string
  store: PanelStore
  snapshot: PanelSnapshot
  t: Translate
  onBack: () => void
  /** Resource address of one changed path, or null while there is no state. */
  addressFor: (path: string) => string | null
  useTabInfo?: (() => GitTabInfo) | undefined
}): React.ReactElement {
  const { snapshot, t, onBack, addressFor } = props
  const view = snapshot.view
  const path = view.kind === 'diff' ? view.path : ''
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const file = snapshot.diff?.file ?? null
  const copyKey = React.useMemo(() => JSON.stringify([path, view.kind === 'diff' ? view.side : '', file?.patch]), [path, view, file?.patch])
  const copied = file !== null && copiedKey === copyKey
  const copyScope = React.useRef<{ active: boolean; request: number } | null>(null)
  React.useLayoutEffect(() => {
    setCopiedKey(null)
    const scope = { active: true, request: 0 }
    copyScope.current = scope
    return () => { scope.active = false; if (copyScope.current === scope) copyScope.current = null }
  }, [copyKey])
  const readTabInfo = props.useTabInfo
  const openAddress = readTabInfo === undefined ? null : addressFor(path)

  return (
    <div data-dsh-git="diff">
      <div className={diffClasses.diffHeader} data-dsh-git="diff-header">
        <IconTooltip label={t('diff.back')}>
          <button
            type="button"
            className={classes.iconButton}
            aria-label={t('diff.back')}
            data-dsh-git="diff-back"
            onClick={onBack}
          >
            <IconChevronLeftOutlineRegular size={14} />
          </button>
        </IconTooltip>
        <span className={diffClasses.diffTitle} title={file?.displayPath ?? path}>
          {baseName(file?.displayPath ?? path)}
        </span>
        {openAddress === null || readTabInfo === undefined ? null : (
          <PanelBoundary renderFallback={() => null} resetKey={openAddress}>
            <OpenFileButton t={t} useTabInfo={readTabInfo} address={openAddress} />
          </PanelBoundary>
        )}
        <IconTooltip label={copied ? t('diff.copied') : t('diff.copyPatch')}>
          <button
            type="button"
            className={classes.iconButton}
            aria-label={copied ? t('diff.copied') : t('diff.copyPatch')}
            data-dsh-git="diff-copy-patch"
            disabled={file === null}
            onClick={() => {
              if (file === null) return
              setCopiedKey(null)
              const scope = copyScope.current
              const request = scope === null ? 0 : ++scope.request
              void writeClipboard(file.patch).then(
                (accepted) => { if (accepted && scope?.active && copyScope.current === scope && scope.request === request) setCopiedKey(copyKey) },
                () => { /* A failed clipboard write never reports success. */ },
              )
            }}
          >
            {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
          </button>
        </IconTooltip>
      </div>
      {view.kind === 'diff' ? <HunkControls sessionId={props.sessionId} path={view.path} side={view.side} api={props.store.api} t={t} onChanged={() => props.store.refresh()} onWholeFile={() => view.side === 'staged' ? props.store.unstage([view.path]) : props.store.stage([view.path])} /> : null}
      <div className={diffClasses.diffBody} data-dsh-git="diff-body">
        {snapshot.diffLoading ? <div className={classes.caption}>{t('diff.loading')}</div> : null}
        {!snapshot.diffLoading && file === null ? (
          <div className={classes.caption}>{t('diff.empty')}</div>
        ) : null}
        {file === null ? null : <FileDiff file={file} t={t} />}
      </div>
    </div>
  )
}
