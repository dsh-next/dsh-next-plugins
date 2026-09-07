/**
 * GitHub-style +/− counts plus a five-block bar. Colors stay on harness tokens.
 */
import * as React from 'react'
import { diffstatBlocks, formatDiffCount } from '../core/diffstat.ts'
import type { Translate } from './dictionaries.ts'
import styles from './diffstat.module.css'

export interface DiffStatProps {
  readonly added: number
  readonly removed: number
  readonly t: Translate
  readonly testId?: string
  readonly addedTestId?: string
  readonly removedTestId?: string
}

export function DiffStat(props: DiffStatProps): React.ReactElement | null {
  if (props.added <= 0 && props.removed <= 0) return null
  const blocks = diffstatBlocks(props.added, props.removed)
  return (
    <span
      className={styles.root}
      data-testid={props.testId ?? 'dsh-next-checkpoints-diffstat'}
      aria-label={props.t('files.statAria', { added: props.added, removed: props.removed })}
    >
      {props.added > 0 && (
        <span
          className={styles.added}
          data-testid={props.addedTestId ?? 'dsh-next-checkpoints-file-added'}
        >
          {props.t('files.added', { count: formatDiffCount(props.added) })}
        </span>
      )}
      {props.removed > 0 && (
        <span
          className={styles.removed}
          data-testid={props.removedTestId ?? 'dsh-next-checkpoints-file-removed'}
        >
          {props.t('files.removed', { count: formatDiffCount(props.removed) })}
        </span>
      )}
      <span className={styles.blocks} aria-hidden="true">
        {blocks.map((kind, index) => (
          <span
            key={index}
            className={styles.block}
            data-kind={kind}
            data-testid="dsh-next-checkpoints-diffstat-block"
          />
        ))}
      </span>
    </span>
  )
}
