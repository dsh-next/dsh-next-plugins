import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FilePreview } from '../src/client/FilePreview.tsx'
import type { FileRow } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('FilePreview', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  afterEach(() => {
    act(() => { root?.unmount() })
    container.remove()
  })

  it('renders GitHub-style hunk headers, line numbers, and python highlighting', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const file: FileRow = {
      targetKey: '/repo/tests/test_settings.py',
      displayPath: 'tests/test_settings.py',
      kind: 'create',
      added: 2,
      removed: 0,
      changedAt: null,
      hunks: [],
    }
    act(() => {
      root!.render(React.createElement(FilePreview, {
        file,
        hunks: [{
          path: file.displayPath,
          oldText: null,
          newText: 'class TestHome:\n    pass\n',
          oldStart: 0,
          newStart: 1336,
          lines: [
            { kind: 'add', text: 'class TestHome:' },
            { kind: 'add', text: '    pass' },
          ],
        }],
      }))
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-hunk"]')?.textContent).toContain('@@ -0,0 +1336,2 @@')
    expect(container.textContent).toContain('1336')
    expect(container.textContent).toContain('+')
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('class')
  })
})
