import * as React from 'react'
import { CodeBlock, IconRefreshOutline16, IconWrapLinesOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileChanges } from '../../core/types.ts'
import type { HunkPreview } from '../../core/repository-actions.ts'
import { parseChangeFileAddress } from '../../core/address.ts'
import { hiddenLineNumbers } from '../../core/file-view.ts'
import { asApiError, type GitApi } from '../api.ts'
import { failureFix, failureTitleKey, type Translate } from '../GitPanel.tsx'
import classes from './change-file.module.css'

/** What the tab needs from the shell: one API and one translation function. */
export interface ChangeFileTabProps {
  /** The address the tab was opened with; it carries session, side and path. */
  address: string
  api: GitApi
  t: Translate
}

/**
 * A changed file as the whole file, with its changed lines marked.
 *
 * This is the panel diff's sibling, not its replacement: the diff answers what
 * changed inside the hunks, this keeps the file's own line numbering and marks
 * the same lines in place. The code arrives highlighted by the platform
 * primitive the filesystem preview uses, so the two surfaces read alike; only
 * the decorations are ours.
 */
export function ChangeFileTab(props: ChangeFileTabProps): React.ReactElement {
  const parsed = parseChangeFileAddress(props.address)
  return <ChangeFile key={props.address} {...props} parsed={parsed} />
}

function ChangeFile(props: ChangeFileTabProps & {
  parsed: ReturnType<typeof parseChangeFileAddress>
}): React.ReactElement {
  const { parsed, api, t } = props
  const read = useFileChanges(parsed, api)
  const hunkApply = useHunkStaging(parsed, api, read.reload)
  const codes = React.useRef<HTMLDivElement>(null)
  // The preview renders long lines unwrapped until its wrap tool is pressed,
  // so the toggle starts off and publishes `data-wrap` the same way.
  const [wrap, setWrap] = React.useState(false)
  // The change view opens on the changes themselves, not on the whole file.
  const [changedOnly, setChangedOnly] = React.useState(true)
  useChangeDecorations(codes, read.value, changedOnly)

  if (parsed === null) {
    return <div className={classes.body} data-dsh-git="change-file"><p className={classes.status}>{t('fileChanges.invalid')}</p></div>
  }

  const value = read.value
  const display = value?.absolutePath ?? parsed.path
  const pathBox = React.useRef<HTMLDivElement>(null)
  const pathText = React.useRef<HTMLSpanElement>(null)
  usePathClipped(pathBox, pathText, display)
  const name = display.slice(display.lastIndexOf('/') + 1)
  const directory = display.slice(0, Math.max(0, display.length - name.length))
  const staged = parsed.side === 'staged'
  const added = value === undefined ? 0 : value.markers.filter(marker => marker.kind === 'added').length
  const removed = value === undefined ? 0 : value.markers.filter(marker => marker.kind === 'removed').length
  // Applying hunks on the unstaged side stages them; the same call on the
  // staged side reverses them out of the index.
  const hunkAction = staged
    ? { label: t('fileChanges.unstage'), glyph: '\u2212' }
    : { label: t('fileChanges.stage'), glyph: '+' }

  return (
    <div className={classes.body} data-dsh-git="change-file" data-side={parsed.side}>
      <div className={classes.header} data-dsh-git="change-file-header">
        <div ref={pathBox} className={classes.path} data-dsh-git="change-file-path" title={display}>
          <span ref={pathText} className={classes.pathText}>
            {directory === '' ? null : <span className={classes.directory}>{directory}</span>}
            <span className={classes.name}>{name}</span>
          </span>
        </div>
        <span className={classes.side} data-dsh-git="change-file-side">{t(staged ? 'fileChanges.staged' : 'fileChanges.unstaged')}</span>
        {value === undefined || value.binary || value.text === '' || value.deleted ? null : (
          <ToolbarAction
            label={hunkApply.applying ? t('fileChanges.working') : hunkAction.label}
            disabled={hunkApply.applying}
            glyph={hunkAction.glyph}
            marker="change-file-hunks"
            onClick={() => void hunkApply.apply()}
          />
        )}
        <ToolbarAction
          label={t('fileChanges.refresh')}
          disabled={read.loading}
          marker="change-file-refresh"
          onClick={read.reload}
          icon={<IconRefreshOutline16 size={15} className={read.loading ? classes.spinning : undefined} />}
        />
        <ToolbarAction
          label={t('fileChanges.changedOnly')}
          pressed={changedOnly}
          marker="change-file-changed-only"
          onClick={() => setChangedOnly(current => !current)}
          icon={<ChangesOnlyGlyph size={15} />}
        />
        <ToolbarAction
          label={t('fileChanges.wrap')}
          pressed={wrap}
          marker="change-file-wrap"
          onClick={() => setWrap(current => !current)}
          icon={<IconWrapLinesOutline16 size={15} />}
        />
      </div>
      {read.failed !== null ? (
        <div role="alert" className={classes.failure}>
          <p>{read.failed === 'git-failed' ? t('fileChanges.readFailed') : t(failureTitleKey(read.failed as Parameters<typeof failureTitleKey>[0]))}</p>
          {read.failed === 'git-failed' ? null : <p className={classes.fix}>{failureFix(read.failed as Parameters<typeof failureFix>[0], t)}</p>}
          <button type="button" className={classes.retry} onClick={read.reload}>{t('historyDetails.retry')}</button>
        </div>
      ) : value === undefined ? (
        <p role="status" className={classes.status}>{t('diff.loading')}</p>
      ) : value.binary ? (
        <p className={classes.status}>{t('diff.binary')}</p>
      ) : value.truncated ? (
        <p className={classes.status}>{t('fileChanges.tooLarge')}</p>
      ) : value.text === '' ? (
        <p className={classes.status}>{value.deleted ? t('fileChanges.gone') : t('diff.empty')}</p>
      ) : (
        <>
          <div ref={codes} className={classes.codes} data-wrap={wrap ? 'true' : 'false'} data-dsh-git="change-file-code">
            <CodeBlock
              code={value.text}
              {...(value.language === null ? {} : { lang: value.language })}
              lineNumbers
              copyLabel={t('diff.copyPatch')}
              copiedLabel={t('diff.copied')}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The changed-lines glyph: lines with a stretch skipped between them.
 *
 * The icon set has no diff glyph, so this draws one in the same 16x16 filled
 * style as the platform's icons, at the 15px the preview's tools use.
 */
function ChangesOnlyGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.2h12v1.3H2z" />
      <path d="M2 4.9h12v1.3H2z" />
      <circle cx="3.4" cy="8" r="0.75" />
      <circle cx="8" cy="8" r="0.75" />
      <circle cx="12.6" cy="8" r="0.75" />
      <path d="M2 9.8h12v1.3H2z" />
      <path d="M2 12.5h12v1.3H2z" />
    </svg>
  )
}

/** One header action: the same 26px target the panel's own header uses. */
function ToolbarAction(props: {
  label: string
  marker: string
  disabled?: boolean
  pressed?: boolean
  glyph?: string
  icon?: React.ReactNode
  onClick: () => void
}): React.ReactElement {
  return (
    <Tooltip label={props.label} side="bottom">
      <button
        type="button"
        className={classes.tool}
        aria-label={props.label}
        title={props.label}
        data-dsh-git={props.marker}
        {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
        {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed })}
        onClick={props.onClick}
      >
        {props.glyph === undefined ? props.icon : <span aria-hidden="true" className={classes.glyph}>{props.glyph}</span>}
      </button>
    </Tooltip>
  )
}

/** One read of the changed file, reloadable on demand. */
function useFileChanges(
  parsed: ReturnType<typeof parseChangeFileAddress>,
  api: GitApi,
): { value: FileChanges | undefined; loading: boolean; failed: string | null; reload: () => void } {
  const [value, setValue] = React.useState<FileChanges | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)
  // The named failure, not just a boolean: a read can fail because this host
  // build does not implement the method, which has its own fix.
  const [failed, setFailed] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const live = React.useRef(true)
  const key = parsed === null ? null : JSON.stringify([parsed.sessionId, parsed.side, parsed.path])
  React.useEffect(() => () => { live.current = false }, [])
  React.useEffect(() => {
    if (key === null || parsed === null) return
    const abort = new AbortController()
    setLoading(true)
    setFailed(null)
    void api.call<FileChanges>('getFileChanges', {
      sessionId: parsed.sessionId,
      path: parsed.path,
      side: parsed.side,
    }, abort.signal)
      .then(next => { if (!abort.signal.aborted && live.current) setValue(next) })
      .catch((cause: unknown) => { if (!abort.signal.aborted && live.current) setFailed(asApiError(cause).code) })
      .finally(() => { if (!abort.signal.aborted && live.current) setLoading(false) })
    return () => abort.abort()
    // `key` is the read's whole identity; the parsed parts are read after it.
  }, [api, key, revision])
  return { value, loading, failed, reload: () => setRevision(current => current + 1) }
}

/**
 * Apply every hunk this file has on its side.
 *
 * The panel's per-hunk controls stay where they are; this is the same audited
 * pair of calls for the whole file, offered where the change is being read.
 * Each application is bound to the version the host just previewed, so a
 * checkout that moved under the tab refuses instead of applying a stale patch.
 */
function useHunkStaging(
  parsed: ReturnType<typeof parseChangeFileAddress>,
  api: GitApi,
  reload: () => void,
): { applying: boolean; apply: () => Promise<void> } {
  const [applying, setApplying] = React.useState(false)
  const apply = React.useCallback(async (): Promise<void> => {
    if (parsed === null || applying) return
    setApplying(true)
    try {
      const preview = await api.call<HunkPreview>('inspectHunks', {
        sessionId: parsed.sessionId,
        path: parsed.path,
        side: parsed.side,
      })
      if (preview.hunks.length === 0) return
      await api.call('applyHunks', {
        sessionId: parsed.sessionId,
        path: parsed.path,
        side: parsed.side,
        version: preview.version,
        hunkIds: preview.hunks.map(hunk => hunk.id),
        approved: true,
      })
    } catch {
      // The reload below is what tells the reader the index moved; the panel
      // names the failure if the write itself was refused.
    } finally {
      setApplying(false)
      reload()
    }
  }, [api, parsed === null ? null : JSON.stringify([parsed.sessionId, parsed.side, parsed.path]), applying, reload])
  return { applying, apply }
}

/**
 * Fade a path too long for its header row, exactly as the file preview does.
 *
 * The absolute path is what a reader checks, so it is never truncated in the
 * middle: the leading directories simply fade out when the row cannot hold
 * them, and the final segment stays fully inked.
 */
function usePathClipped(
  box: React.RefObject<HTMLElement | null>,
  text: React.RefObject<HTMLElement | null>,
  key: string,
): void {
  React.useLayoutEffect(() => {
    const outer = box.current
    const inner = text.current
    if (outer === null || inner === null) return
    const apply = (): void => {
      if (inner.offsetWidth > outer.clientWidth) outer.dataset.clipped = ''
      else delete outer.dataset.clipped
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(outer)
    observer?.observe(inner)
    return () => observer?.disconnect()
  }, [box, text, key])
}

/**
 * Mark the changed lines inside the highlighted code.
 *
 * The platform's code surface draws its own highlighted lines and exposes no
 * per-line hook, so the decorations are applied to the line elements it renders
 * and re-applied whenever it replaces them (a grammar finishing its load, a
 * re-tokenize on scroll, a theme change). Only classes are added; nothing in the
 * rendered code is moved or rewritten.
 */
function useChangeDecorations(
  root: React.RefObject<HTMLElement | null>,
  value: FileChanges | undefined,
  changedOnly: boolean,
): void {
  React.useEffect(() => {
    const element = root.current
    if (element === null || value === undefined) return
    const kinds = new Map(value.markers.map(marker => [marker.line, marker.kind]))
    const body = value.text.endsWith('\n') ? value.text.slice(0, -1) : value.text
    const lineCount = body === '' ? 0 : body.split('\n').length
    const hidden = changedOnly ? hiddenLineNumbers(value.markers, lineCount) : new Set<number>()
    const apply = (): void => {
      element.querySelectorAll('span.line').forEach((line, index) => {
        const number = index + 1
        const kind = kinds.get(number)
        line.classList.toggle(classes.added, kind === 'added')
        line.classList.toggle(classes.removed, kind === 'removed')
        // The class names are hashed by the build, so the state is also
        // published as data attributes for anything outside this module.
        if (kind === undefined) delete (line as HTMLElement).dataset.change
        else (line as HTMLElement).dataset.change = kind
        // The gutter must keep the file's own numbering even while lines are
        // hidden: the primitive's counter skips a `display: none` line, so the
        // number is published and the style reads it instead.
        ;(line as HTMLElement).dataset.line = String(number)
        const skipped = hidden.has(number)
        line.classList.toggle(classes.collapsed, skipped)
        if (skipped) (line as HTMLElement).dataset.hidden = ''
        else delete (line as HTMLElement).dataset.hidden
        // The first line after a skipped stretch says so, so a jump in line
        // numbers never reads as missing content.
        if (!skipped && hidden.has(number - 1)) (line as HTMLElement).dataset.gap = ''
        else delete (line as HTMLElement).dataset.gap
      })
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(element, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [root, value, changedOnly])
}
