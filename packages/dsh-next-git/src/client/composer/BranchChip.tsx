/**
 * The composer's branch chip.
 *
 * One compact control in the composer's tool row: the branch this session's
 * checkout is on, opening the very same ref picker the panel's header uses.
 * It is how a branch is chosen where a session starts, before anyone thinks to
 * open the Source control tab.
 *
 * A workspace that is not a git repository renders nothing at all — the chip
 * is an addition to the composer, never a state of it — and the same is true
 * for a host that cannot answer git at all. The read is the small
 * `refSummary` envelope, not the panel's whole state, because this surface
 * shows a branch name and nothing else.
 */

import * as React from 'react'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RefOption } from '../../core/refs.ts'
import type { RefSummary } from '../../core/types.ts'
import { asApiError, GitApiError, type GitApi } from '../api.ts'
import { BranchPicker } from '../branches/BranchPicker.tsx'
import { failureTitleKey, type Translate } from '../GitPanel.tsx'
import classes from './branch-chip.module.css'

/** Re-reads of a session the host has not loaded yet, at {@link RETRY_MS} apart. */
const READY_RETRIES = 20
const RETRY_MS = 500

export interface BranchChipProps {
  /** The session whose checkout is shown; the host resolves its directory. */
  readonly sessionId: SessionId
  readonly api: GitApi
  readonly t: Translate
}

export function BranchChip(props: BranchChipProps): React.ReactElement | null {
  const { sessionId, api, t } = props
  const [summary, setSummary] = React.useState<RefSummary | null>(null)
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Bumped to re-read after a write or when the window regains focus.
  const [revision, setRevision] = React.useState(0)
  const refresh = React.useCallback((): void => setRevision((value) => value + 1), [])

  React.useEffect(() => {
    let alive = true
    let retries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const read = async (): Promise<void> => {
      try {
        const value = await api.call<RefSummary>('refSummary', { sessionId }, controller.signal)
        if (alive) setSummary(value)
      } catch (cause) {
        if (!alive) return
        // A session the host has not loaded yet resolves itself, so it is
        // worth waiting for. Every other failure — no repository, a bare one,
        // no git, no permission — means there is nothing to show here.
        if (cause instanceof GitApiError && cause.code === 'session-not-ready' && retries < READY_RETRIES) {
          retries += 1
          timer = setTimeout(() => void read(), RETRY_MS)
          return
        }
        setSummary(null)
      }
    }
    void read()
    // Coming back to the window is the one moment another surface (the panel,
    // a terminal, the agent) may have moved the checkout behind this chip.
    const onFocus = (): void => {
      retries = 0
      void read()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, sessionId, revision])

  const fail = (cause: unknown): void => setError(t(failureTitleKey(asApiError(cause).code)))
  const close = (): void => {
    setOpen(false)
    setError(null)
  }

  /**
   * Check out a picked ref.
   *
   * Unlike the panel, this chip reads no status: git itself refuses a switch
   * it cannot carry, and the refusal is shown in the card instead of a
   * confirmation the chip cannot describe. A remote-tracking ref whose local
   * twin exists switches to the twin rather than asking git to create it.
   */
  const switchRef = (option: RefOption): void => {
    const twin = option.kind === 'remote'
      ? summary?.branches.find((branch) => !branch.remote && branch.name === option.localName)
      : undefined
    const call = twin !== undefined
      ? api.call('branchSwitch', { sessionId, name: twin.name })
      : api.call('branchSwitch', {
        sessionId,
        name: option.localName,
        ...(option.kind === 'remote' ? { remote: option.name } : {}),
      })
    void call.then(() => {
      close()
      refresh()
    }, fail)
  }

  const detach = (option: RefOption): void => {
    void api.call('checkoutCommit', { sessionId, hash: option.oid }).then(() => {
      close()
      refresh()
    }, fail)
  }

  const create = async (name: string, from: string | null): Promise<string | null> => {
    try {
      await api.call('branchCreate', { sessionId, name, ...(from === null ? {} : { from }) })
      await api.call('branchSwitch', { sessionId, name })
    } catch (cause) {
      return t(failureTitleKey(asApiError(cause).code))
    }
    refresh()
    return null
  }

  if (summary === null) return null
  const head = summary.head
  const label = head.unborn ? t('header.unborn') : head.branch ?? t('header.detached')
  return (
    <React.Fragment>
      <button
        type="button"
        className={classes.chip}
        data-dsh-git="composer-branch"
        aria-haspopup="dialog"
        aria-expanded={open}
        // The visible label disappears on a narrow composer, so the name is
        // carried explicitly and stays the button's accessible name either way.
        aria-label={label}
        title={t('composer.branchTitle', { branch: label })}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <IconBranchOutlineRegular size={14} className={classes.glyph} />
        <span className={classes.name}>{label}</span>
        <IconChevronDownOutlineRegular size={12} className={classes.glyph} />
      </button>
      {open ? (
        <BranchPicker
          state={summary}
          t={t}
          error={error}
          onSwitch={switchRef}
          onDetached={detach}
          onCreate={create}
          onClose={close}
        />
      ) : null}
    </React.Fragment>
  )
}
