import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { DecisionError, SERVICE_KEY } from '../core/types.ts'
import { providerId } from '../core/validation.ts'

export interface DecisionKeys { read(id: string): Promise<string | undefined>; write(id: string, key: string | undefined): Promise<void> }
export function decisionKeys(credentials: CredentialProvider): DecisionKeys {
  const key = (id: string) => credentialKey(SERVICE_KEY, providerId(id))
  return {
    read: async id => {
      const record = await credentials.readRecord(key(id))
      if (record === undefined) return undefined
      if (record.kind !== 'api-key' || typeof record.key !== 'string') throw new DecisionError('credentials')
      return record.key
    },
    write: async (id, value) => {
      if (value === undefined) await credentials.deleteRecord(key(id))
      else await credentials.modifyRecord(key(id), async () => ({ kind: 'api-key', key: value }))
    },
  }
}
