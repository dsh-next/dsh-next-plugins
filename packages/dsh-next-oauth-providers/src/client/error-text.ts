/**
 * Shared error copy: an RPC failure becomes its dictionary key, anything else
 * the generic unknown error.
 */
import { ClientRpcError } from './api.ts'
import type { MessageKey } from './dictionaries.ts'

export function errorText(error: unknown, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (error instanceof ClientRpcError) return t(`error.${error.code}` as MessageKey, error.params)
  return t('error.unknown')
}
