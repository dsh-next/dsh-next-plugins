import { describe, expect, it } from 'vitest'
import { createConfigEditorDraftingStore, type ConfigEditor } from '../src/host/drafting-config.ts'
import type { DraftSettings } from '../src/host/drafting.ts'

const empty: DraftSettings = { draftingProvider: '', draftingModel: '', draftingInstructions: '' }

describe('Loader-backed Git drafting config', () => {
  it('reads current entry config and persists patches without dropping other fields', async () => {
    const entry = { id: 'dsh-next-git' }
    let raw: Record<string, unknown> = { ...empty, unrelated: 'preserve' }
    const editor: ConfigEditor = {
      entries: () => [entry],
      configuration: () => [{ entry, inherited: {}, override: raw }],
      async edit(target, change) {
        expect(target).toBe(entry)
        raw = change(raw, {})
      },
    }
    const store = createConfigEditorDraftingStore(editor, entry, () => ({
      draftingProvider: String(raw.draftingProvider ?? ''),
      draftingModel: String(raw.draftingModel ?? ''),
      draftingInstructions: String(raw.draftingInstructions ?? ''),
    }))

    expect(store.get()).toEqual(empty)
    await store.update({ draftingInstructions: 'Use Conventional Commits.' })

    expect(raw).toEqual({ ...empty, unrelated: 'preserve', draftingInstructions: 'Use Conventional Commits.' })
    expect(store.get().draftingInstructions).toBe('Use Conventional Commits.')
  })
})
