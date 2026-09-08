/**
 * pi-ai CredentialStore over DSH credential records in this plugin's scope.
 */
import type { AuthContext, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import {
  credentialKey,
  credentialKeyId,
  credentialKeyScope,
  isCredentialKeySegment,
  type CredentialKey,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import { isNativeId } from '../core/catalog.ts'
import { RECORD_SCOPE } from '../core/ids.ts'
import { isOauthGrant, jsonImage } from '../core/records.ts'
import { RpcError } from '../core/errors.ts'

export function recordKeyFor(nativeId: string): CredentialKey {
  return credentialKey(RECORD_SCOPE, nativeId)
}

function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...record.key === undefined ? {} : { key: record.key },
      ...record.env === undefined ? {} : { env: { ...record.env } },
    }
  }
  if (!isOauthGrant(record.payload)) return undefined
  return record.payload
}

function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    throw new RpcError('store', 'subscription credentials must be OAuth grants')
  }
  return { kind: 'grant', payload: jsonImage(credential) }
}

export function credentialStoreFrom(credentials: CredentialProvider): CredentialStore {
  return {
    async read(providerId, options) {
      options?.signal?.throwIfAborted()
      if (!isCredentialKeySegment(providerId) || !isNativeId(providerId)) return undefined
      const record = await credentials.readRecord(recordKeyFor(providerId))
      options?.signal?.throwIfAborted()
      return toPiCredential(record)
    },
    async list(options) {
      options?.signal?.throwIfAborted()
      const stored = await credentials.listRecords()
      options?.signal?.throwIfAborted()
      const mine: CredentialInfo[] = []
      for (const entry of stored) {
        if (credentialKeyScope(entry.key) !== RECORD_SCOPE) continue
        const providerId = credentialKeyId(entry.key)
        if (!isNativeId(providerId)) continue
        mine.push({
          providerId,
          type: entry.kind === 'api-key' ? 'api_key' : 'oauth',
        })
      }
      return mine
    },
    async modify(providerId, mutate, options) {
      options?.signal?.throwIfAborted()
      if (!isCredentialKeySegment(providerId) || !isNativeId(providerId)) {
        throw new RpcError('store', `provider id "${providerId}" cannot address a credential record`)
      }
      return toPiCredential(await credentials.modifyRecord(recordKeyFor(providerId), async (current) => {
        // Cancellation while waiting for the lock must not commit a stale login.
        options?.signal?.throwIfAborted()
        const next = await mutate(toPiCredential(current))
        // Once refresh starts, persist its rotated token even if the caller aborts.
        return next === undefined ? undefined : toRecord(next)
      }))
    },
    async delete(providerId, options) {
      options?.signal?.throwIfAborted()
      if (!isCredentialKeySegment(providerId) || !isNativeId(providerId)) return
      await credentials.deleteRecord(recordKeyFor(providerId))
    },
  }
}

/** No ambient API-key fallback: subscriptions authenticate only through grants. */
export function denyAmbientAuthContext(): AuthContext {
  return {
    env: async () => undefined,
    fileExists: async () => false,
  }
}
