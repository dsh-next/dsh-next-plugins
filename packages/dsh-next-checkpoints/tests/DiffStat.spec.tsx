import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffStat } from '../src/client/DiffStat.tsx'
import { englishTranslate } from '../src/client/dictionaries.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('DiffStat', () => {
  const container = document.createElement('div')
  let root: Root | undefined

  afterEach(async () => {
    if (root !== undefined) await act(async () => { root!.unmount() })
    container.remove()
  })

  it('renders nothing when both counts are zero', async () => {
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(DiffStat, { added: 0, removed: 0, t: englishTranslate }))
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-diffstat"]')).toBeNull()
  })

  it('shows grouped counts, colored numbers, and five blocks', async () => {
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(DiffStat, { added: 4801, removed: 66, t: englishTranslate }))
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-added"]')?.textContent).toBe('+4,801')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-removed"]')?.textContent).toBe('-66')
    const kinds = [...container.querySelectorAll('[data-testid="dsh-next-checkpoints-diffstat-block"]')]
      .map((el) => el.getAttribute('data-kind'))
    expect(kinds).toEqual(['add', 'add', 'add', 'add', 'empty'])
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-diffstat"]')?.getAttribute('aria-label'))
      .toBe('4801 added, 66 removed')
  })
})
