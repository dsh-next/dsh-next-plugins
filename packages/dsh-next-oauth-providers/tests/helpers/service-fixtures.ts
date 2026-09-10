/**
 * Shared in-memory fixtures for SubscriptionsService specs: a pi-ai
 * CredentialStore, a settings scope face, and one long-lived OAuth grant.
 */
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import type { ConfigScopeFace } from '../../src/host/service.ts'

/** A valid stored grant; expires far enough out that no spec races expiry. */
export const grant = {
  type: 'oauth' as const,
  access: 'a',
  refresh: 'r',
  expires: Date.now() + 60_000,
}

export function memoryStore(seed: Record<string, Credential> = {}): CredentialStore {
  const map = new Map<string, Credential>(Object.entries(seed))
  return {
    read: async (id) => map.get(id),
    list: async () => [...map.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: async (id, fn) => {
      const next = await fn(map.get(id))
      if (next !== undefined) map.set(id, next)
      return map.get(id)
    },
    delete: async (id) => { map.delete(id) },
  }
}

export function memoryConfig(initial: object = {}): ConfigScopeFace {
  let value: object = initial
  return {
    get: () => value,
    update: async (patch) => { value = { ...value, ...patch } },
    replace: async (section) => { value = section },
    watch: () => () => {},
  }
}
