import type { DraftingSettingsStore, DraftSettings } from './drafting.ts'

export interface LoaderConfigEntry {
  readonly id: string
}

export interface ConfigEditor {
  entries(): LoaderConfigEntry[]
  configuration(): Array<{
    entry: LoaderConfigEntry
    inherited: Record<string, unknown>
    override: Record<string, unknown>
  }>
  edit(
    entry: LoaderConfigEntry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** Adapt Loader entry config persistence to the drafting settings store contract. */
export function createConfigEditorDraftingStore(
  editor: ConfigEditor,
  entry: LoaderConfigEntry,
  read: () => DraftSettings,
): DraftingSettingsStore {
  return {
    get: read,
    update: async patch => {
      await editor.edit(entry, current => ({ ...current, ...patch }))
    },
  }
}
