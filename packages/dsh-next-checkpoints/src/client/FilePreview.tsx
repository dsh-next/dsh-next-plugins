/**
 * GitHub-style unified diff: dual line numbers, hunk headers, +/- rows,
 * language highlighting. Colors stay on harness tokens.
 */
import * as React from 'react'
import { languageFromPath } from '../core/lang.ts'
import type { FileDiffHunk, FileRow } from '../core/types.ts'
import { highlightLine } from './highlight.ts'
import styles from './file-preview.module.css'

export interface FilePreviewProps {
  readonly file: FileRow
  readonly hunks: readonly FileDiffHunk[]
}

function hunkHeader(hunk: FileDiffHunk): string {
  let oldCount = 0
  let newCount = 0
  for (const line of hunk.lines) {
    if (line.kind !== 'add') oldCount += 1
    if (line.kind !== 'del') newCount += 1
  }
  return `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
}

function signOf(kind: FileDiffHunk['lines'][number]['kind']): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '-'
  return ''
}

export function FilePreview(props: FilePreviewProps): React.ReactElement {
  const language = languageFromPath(props.file.displayPath)
  return (
    <div className={styles.wrap} data-testid="dsh-next-checkpoints-diff">
      <table className={styles.table}>
        <tbody>
          {props.hunks.map((hunk, hunkIndex) => {
            let oldLine = hunk.oldStart
            let newLine = hunk.newStart
            const rows: React.ReactNode[] = [
              <tr key={`${hunkIndex}-hunk`} className={styles.hunk} data-testid="dsh-next-checkpoints-hunk">
                <td className={styles.gutter} colSpan={2} />
                <td className={styles.sign} />
                <td className={styles.code}>{hunkHeader(hunk)}</td>
              </tr>,
            ]
            hunk.lines.forEach((line, lineIndex) => {
              const oldNo = line.kind === 'add' ? '' : String(oldLine)
              const newNo = line.kind === 'del' ? '' : String(newLine)
              if (line.kind !== 'add') oldLine += 1
              if (line.kind !== 'del') newLine += 1
              const rowClass = line.kind === 'add'
                ? styles.add
                : line.kind === 'del' ? styles.del : styles.ctx
              rows.push(
                <tr key={`${hunkIndex}-${lineIndex}`} className={rowClass}>
                  <td className={styles.gutter}>{oldNo}</td>
                  <td className={styles.gutter}>{newNo}</td>
                  <td className={styles.sign}>{signOf(line.kind)}</td>
                  <td
                    className={styles.code}
                    dangerouslySetInnerHTML={{ __html: highlightLine(line.text, language) }}
                  />
                </tr>,
              )
            })
            return rows
          })}
        </tbody>
      </table>
    </div>
  )
}
