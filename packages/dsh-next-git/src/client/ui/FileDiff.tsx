import * as React from 'react'
import { DiffBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { toDiffHunks } from '../../core/diff.ts'
import type { DiffFile } from '../../core/types.ts'
import type { Translate } from '../dictionaries.ts'
import classes from '../panel.module.css'
import diffClasses from './diff.module.css'

/** Shared read-only diff rendering for working-tree and committed files. */
export function FileDiff({ file, t }: { file: DiffFile; t: Translate }): React.ReactElement {
  return <>
    <div className={diffClasses.diffMeta}>
      <span className={diffClasses.added}>{t('diff.added', { count: file.added })}</span>
      <span className={diffClasses.removed}>{t('diff.removed', { count: file.removed })}</span>
    </div>
    {file.binary && <div className={classes.caption}>{t('diff.binary')}</div>}
    {file.tooLarge && <>
      <div className={classes.caption}>
        {file.byteLimited ? t('diff.byteLimit') : t('diff.tooLarge', { added: file.added, removed: file.removed })}
      </div>
      <pre className={diffClasses.patchBlock}>{file.patch}</pre>
    </>}
    {!file.binary && !file.tooLarge && (file.hunks.length > 0 ? <DiffBlock
      diffs={toDiffHunks(file)}
      maxLines={400}
      labels={{
        copy: t('diffBlock.copy'),
        copied: t('diffBlock.copied'),
        codeLabel: t('diffBlock.codeLabel'),
        wrapLabel: t('diffBlock.wrapLabel'),
        unwrapLabel: t('diffBlock.unwrapLabel'),
        collapseAria: t('diffBlock.collapseAria'),
        expandAria: (hidden: number) => t('diffBlock.expandAria', { count: hidden }),
        collapse: t('diffBlock.collapse'),
        expand: (hidden: number) => t('diffBlock.expand', { count: hidden }),
      }}
    /> : <pre className={diffClasses.patchBlock}>{file.patch}</pre>)}
  </>
}
