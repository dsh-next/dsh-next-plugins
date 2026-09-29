import * as React from 'react'
import type { SkillDetail } from '../../core/types.ts'
import styles from '../card.module.css'
import type { MessageKey } from '../dictionaries.ts'
import { renderMarkdown } from '../markdown.tsx'
import { OpenSkillFolder } from '../OpenSkillFolder.tsx'
import type { GridEntry } from './grid.ts'

interface SkillDetailDialogProps {
  detail: GridEntry
  detailData?: SkillDetail
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  onClose(): void
}

/** Render the selected skill copy or catalog offering without owning the panel's RPC. */
export function SkillDetailDialog({ detail, detailData, t, onClose }: SkillDetailDialogProps): React.ReactElement {
  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.aria', { name: detail.name })}
        data-testid="skills-skill-detail"
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <p className={styles.modalTitle}>{detail.name}</p>
          {detail.row !== undefined && (
            <OpenSkillFolder key={detail.row.path} directory={detail.row.directory} t={t} />
          )}
        </div>
        <p className={styles.modalHint}>
          {[
            detailData?.modelInvocable === false ? t('detail.modelBlocked') : t('detail.modelInvocable'),
            detailData?.userInvocable === false ? t('detail.userBlocked') : t('detail.userInvocable'),
            detailData?.whenToUse !== undefined ? t('detail.whenToUse', { text: detailData.whenToUse }) : '',
          ].filter(Boolean).join(' · ')}
        </p>
        {detailData === undefined ? (
          <p className={styles.modalHint}>{t('status.working')}</p>
        ) : (
          <div className={`${styles.modalBody} ${styles.md}`} data-testid="skills-detail-body">
            {renderMarkdown(detailData.body)}
          </div>
        )}
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghost} onClick={onClose} data-testid="skills-detail-close">{t('detail.close')}</button>
        </div>
      </div>
    </div>
  )
}
