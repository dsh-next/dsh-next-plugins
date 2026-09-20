/** Session/checkout-scoped drafts and section preferences, never live stores. */
export interface PanelPreferences {
  readonly message: string
  readonly collapsed: Readonly<Record<'changes' | 'worktrees' | 'history', boolean>>
}

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Storage is optional: private browsing and quota errors retain an in-memory draft. */
export class PanelPreferenceStore {
  private readonly memory = new Map<string, PanelPreferences>()

  constructor(private readonly storage: () => PreferenceStorage | undefined = () => {
    try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined }
  }) {}

  read(sessionId: string, root: string): PanelPreferences | undefined {
    const key = this.key(sessionId, root)
    const cached = this.memory.get(key)
    if (cached !== undefined) return cached
    try {
      const raw = this.storage()?.getItem(key)
      if (!raw) return undefined
      const value = JSON.parse(raw) as Partial<PanelPreferences>
      if (typeof value.message !== 'string' || !value.collapsed) return undefined
      if (!['changes', 'worktrees', 'history'].every((name) =>
        typeof value.collapsed?.[name as keyof PanelPreferences['collapsed']] === 'boolean')) return undefined
      const valid = value as PanelPreferences
      this.memory.set(key, valid)
      return valid
    } catch { return undefined }
  }

  write(sessionId: string, root: string, value: PanelPreferences): void {
    const key = this.key(sessionId, root)
    this.memory.set(key, value)
    try { this.storage()?.setItem(key, JSON.stringify(value)) } catch { /* Keep the in-memory draft. */ }
  }

  private key(sessionId: string, root: string): string {
    return 'dsh-next-git:preferences:' + JSON.stringify([sessionId, root])
  }
}

export const panelPreferences = new PanelPreferenceStore()
